import type { ErrorCode } from '../../../shared/error-codes';
import { SAVE_SHAPE_MISMATCH_MESSAGE } from '../../../shared/save-shapes';
import { SAVE_TIMING } from './timing';
import type { SaveEvent, SaveState } from './types';
import type { SaveWindow } from './window';

export interface SavePopupView {
  kind: 'saving' | 'offline' | 'failed' | 'input-error' | 'saved';
  message: string;
  label: string;
  code?: ErrorCode;
  excelExport?: true;
}
interface Current {
  operationId: string;
  label: string;
  startedAt: number;
  state: SaveState | { kind: 'saved'; excelExport: boolean };
}

/** One presentation follows the last save started, including restored drafts. */
export class SavePresentation {
  private current?: Current;
  private readonly seen = new Set<string>();
  private readonly messages = new Map<string, string>();
  private readonly inputErrorHandlers = new Map<string, (field: string) => boolean>();
  private readonly closed = new Set<string>();
  private readonly listeners = new Set<() => void>();
  private visibleSince?: number;
  private savedSince?: number;
  private timer?: ReturnType<typeof setTimeout>;
  private view: SavePopupView | null = null;
  getSnapshot = () => this.view;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  connect(window: Pick<SaveWindow, 'subscribe' | 'getPending'>) {
    const unsubscribe = window.subscribe(this.receive);
    window.getPending().forEach((pending) => this.receive({ kind: 'state', pending }));
    this.update();
    return () => {
      unsubscribe();
      clearTimeout(this.timer);
    };
  }
  requested(
    operationId: string,
    label: string,
    startedAt: number,
    successMessage?: string,
    handlesInputError?: (field: string) => boolean,
  ) {
    if (successMessage) this.messages.set(operationId, successMessage);
    if (handlesInputError) this.inputErrorHandlers.set(operationId, handlesInputError);
    this.closed.delete(operationId);
    if (this.current?.operationId === operationId) {
      this.current.startedAt = startedAt;
      this.update();
    } else if (!this.seen.has(operationId))
      this.receive({ kind: 'state', pending: { operationId, label, state: { kind: 'queued' } } });
  }
  close(operationId: string) {
    this.closed.add(operationId);
    if (
      this.current?.operationId === operationId &&
      (this.current.state.kind === 'failed' || this.current.state.kind === 'input-error')
    )
      this.setView(null);
  }
  receive = (event: SaveEvent) => {
    if (event.kind === 'version-changed' || event.kind === 'dialog-closed') return;
    if (event.kind === 'discarded') {
      this.messages.delete(event.operationId);
      this.inputErrorHandlers.delete(event.operationId);
      this.closed.delete(event.operationId);
      if (this.current?.operationId === event.operationId) {
        clearTimeout(this.timer);
        this.current = undefined;
        this.visibleSince = undefined;
        this.savedSince = undefined;
        this.setView(null);
      }
      return;
    }
    const operationId = event.kind === 'state' ? event.pending.operationId : event.operationId;
    if (
      !this.seen.has(operationId) ||
      (event.kind === 'state' && event.pending.state.kind === 'queued')
    ) {
      this.seen.add(operationId);
      if (
        this.view?.kind === 'failed' ||
        this.view?.kind === 'input-error' ||
        this.view?.kind === 'saved'
      )
        this.setView(null);
      this.current = {
        operationId,
        label: event.kind === 'state' ? event.pending.label : event.label,
        startedAt: Date.now(),
        state: { kind: 'queued' },
      };
      this.visibleSince = this.view ? Date.now() : undefined;
      this.savedSince = undefined;
    }
    if (this.current?.operationId !== operationId) return;
    this.current.state =
      event.kind === 'saved'
        ? {
            kind: 'saved',
            excelExport:
              event.operation === 'period.publish' || event.operation === 'period.redistribute',
          }
        : event.pending.state;
    this.update();
  };
  private setView(view: SavePopupView | null) {
    if (JSON.stringify(this.view) === JSON.stringify(view)) return;
    this.view = view;
    this.listeners.forEach((listener) => listener());
  }
  private later(at: number) {
    this.timer = setTimeout(() => this.update(), Math.max(0, at - Date.now()));
  }
  private update() {
    clearTimeout(this.timer);
    const item = this.current;
    if (!item) return;
    const now = Date.now();
    const kind = item.state.kind;
    if (item.state.kind === 'reload-required' && item.state.code === 'E-47') {
      this.setView({ kind: 'failed', message: SAVE_SHAPE_MISMATCH_MESSAGE, label: item.label });
      return;
    }
    const handledInputError =
      item.state.kind === 'input-error' &&
      this.inputErrorHandlers.get(item.operationId)?.(item.state.field);
    if (
      handledInputError ||
      kind === 'conflict' ||
      kind === 'reload-required' ||
      ((kind === 'failed' || kind === 'input-error') && this.closed.has(item.operationId))
    ) {
      this.setView(null);
      this.visibleSince = undefined;
      return;
    }
    if (item.state.kind === 'saved') {
      if (
        this.savedSince === undefined &&
        this.view &&
        this.visibleSince !== undefined &&
        now < this.visibleSince + SAVE_TIMING.minimumVisibleMs
      ) {
        this.later(this.visibleSince + SAVE_TIMING.minimumVisibleMs);
        return;
      }
      this.savedSince ??= now;
      if (now >= this.savedSince + SAVE_TIMING.successVisibleMs) {
        this.setView(null);
        return;
      }
      this.setView({
        kind: 'saved',
        message: this.messages.get(item.operationId) ?? '保存しました',
        label: item.label,
        ...(item.state.excelExport ? { excelExport: true as const } : {}),
      });
      this.later(this.savedSince + SAVE_TIMING.successVisibleMs);
      return;
    }
    if (
      kind !== 'failed' &&
      kind !== 'input-error' &&
      !this.view &&
      now < item.startedAt + SAVE_TIMING.showAfterMs
    ) {
      this.later(item.startedAt + SAVE_TIMING.showAfterMs);
      return;
    }
    this.visibleSince ??= now;
    if (item.state.kind === 'failed') {
      this.setView({
        kind: 'failed',
        message: '保存できませんでした。アプリ製作者にご連絡ください。',
        label: item.label,
        code: item.state.code,
      });
    } else if (kind === 'input-error') {
      this.setView({
        kind: 'input-error',
        message: '保存できませんでした。入力を確認してください。',
        label: item.label,
      });
    } else if (kind === 'offline') {
      this.setView({
        kind: 'offline',
        message: 'ネットにつながっていません。接続を確認してください。',
        label: item.label,
      });
    } else {
      const slow = kind === 'slow' || now >= item.startedAt + SAVE_TIMING.slowAfterMs;
      const message =
        kind === 'service-wait'
          ? '通信に時間がかかっています。しばらくお待ちください。'
          : slow
            ? '保存中。通信に時間がかかっています。'
            : '保存中';
      this.setView({ kind: 'saving', message, label: item.label });
      if (!slow && kind !== 'service-wait') this.later(item.startedAt + SAVE_TIMING.slowAfterMs);
    }
  }
}

const presentations = new WeakMap<SaveWindow, SavePresentation>();
export function getSavePresentation(window: SaveWindow): SavePresentation {
  let presentation = presentations.get(window);
  if (!presentation) {
    presentation = new SavePresentation();
    presentations.set(window, presentation);
  }
  return presentation;
}
