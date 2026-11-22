import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { AppError } from '../../../shared/app-error';
import type { ErrorCode } from '../../../shared/error-codes';
import type { CurrentRevision, JsonValue } from '../../../shared/protocol';
import { useAppFrame } from '../app/context';
import { getSavePresentation, type SavePresentation } from './presentation';
import { SAVE_TIMING } from './timing';
import type { SaveEvent, SaveInput, SaveState } from './types';
import type { SaveWindow } from './window';

export type SaveOutcome =
  | { kind: 'saved'; data: JsonValue }
  | { kind: 'input-error'; field: string }
  | { kind: 'conflict'; conflicts: CurrentRevision[] }
  | { kind: 'failed'; code: ErrorCode }
  | { kind: 'reload-required'; code: 'E-42' | 'E-47' };
export interface SaveProgress {
  saving: boolean;
  showSpinner: boolean;
  outcome: SaveOutcome | null;
}
interface StoppedSave {
  operationId: string;
  input: SaveInput;
  state: SaveState;
}
export interface SaveOptions {
  handlesInputError?: (field: string) => boolean;
}
type SavingPort = Pick<SaveWindow, 'save' | 'resend' | 'discard' | 'subscribe' | 'closeDialog'>;

function comparable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(comparable);
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, comparable(item)]),
    );
  return value;
}
/** Labels are presentation only; an operation number identifies the sent content. */
async function requestSave(
  window: SavingPort,
  input: SaveInput,
  stopped?: StoppedSave,
): Promise<string> {
  if (stopped) {
    const content = ({ operation, revisions, data }: SaveInput) =>
      comparable({ operation, revisions, data });
    if (
      stopped.state.kind === 'failed' &&
      JSON.stringify(content(input)) === JSON.stringify(content(stopped.input))
    ) {
      if (!(await window.resend(stopped.operationId))) throw new AppError('E-93');
      return stopped.operationId;
    }
    if (!(await window.discard(stopped.operationId))) throw new AppError('E-93');
  }
  return window.save(input, true);
}

/** Each dialog owns its progress; closing it leaves the window's save running. */
export function createSaveController(
  window: SavingPort,
  presentation: SavePresentation,
  options: SaveOptions = {},
) {
  let progress: SaveProgress = { saving: false, showSpinner: false, outcome: null };
  let stopped: StoppedSave | undefined;
  let operationId: string | undefined;
  let content: SaveInput | undefined;
  let collecting: SaveEvent[] | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  const listeners = new Set<() => void>();
  const setProgress = (next: SaveProgress) => {
    progress = next;
    listeners.forEach((listener) => listener());
  };
  const receive = (event: SaveEvent) => {
    if (collecting) {
      collecting.push(event);
      return;
    }
    if (
      event.kind === 'version-changed' ||
      event.kind === 'discarded' ||
      event.kind === 'dialog-closed'
    )
      return;
    const id = event.kind === 'saved' ? event.operationId : event.pending.operationId;
    if (id !== operationId || !content) return;
    if (event.kind === 'saved') {
      clearTimeout(timer);
      stopped = undefined;
      setProgress({
        saving: false,
        showSpinner: false,
        outcome: { kind: 'saved', data: event.result.data },
      });
      return;
    }
    const state = event.pending.state;
    if (
      state.kind === 'failed' ||
      state.kind === 'input-error' ||
      state.kind === 'conflict' ||
      state.kind === 'reload-required'
    ) {
      clearTimeout(timer);
      stopped = { operationId: id, input: content, state };
      setProgress({ saving: false, showSpinner: false, outcome: state });
    }
  };
  const unsubscribe = window.subscribe(receive);
  return {
    getSnapshot: () => progress,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async save(input: SaveInput, successMessage?: string): Promise<void> {
      if (progress.saving || closed) return;
      content = structuredClone(input);
      const startedAt = Date.now();
      collecting = [];
      setProgress({ saving: true, showSpinner: false, outcome: null });
      timer = setTimeout(() => {
        if (progress.saving) setProgress({ ...progress, showSpinner: true });
      }, SAVE_TIMING.showAfterMs);
      try {
        operationId = await requestSave(window, content, stopped);
        stopped = undefined;
        presentation.requested(
          operationId,
          input.label,
          startedAt,
          successMessage,
          options.handlesInputError,
        );
        if (closed) {
          presentation.close(operationId);
          void window.closeDialog(operationId).catch(() => {});
        }
        const events = collecting;
        collecting = undefined;
        events.forEach(receive);
      } catch (error) {
        collecting = undefined;
        clearTimeout(timer);
        const code = error instanceof AppError ? error.code : 'E-93';
        // Persistence can fail before the window returns a number or emits an event.
        operationId = crypto.randomUUID();
        presentation.receive({
          kind: 'state',
          pending: { operationId, label: input.label, state: { kind: 'failed', code } },
        });
        if (closed) presentation.close(operationId);
        setProgress({ saving: false, showSpinner: false, outcome: { kind: 'failed', code } });
      }
    },
    dispose() {
      closed = true;
      unsubscribe();
      clearTimeout(timer);
      listeners.clear();
      if (operationId) {
        presentation.close(operationId);
        void window.closeDialog(operationId).catch(() => {});
      }
    },
  };
}

export function useSave({ handlesInputError }: SaveOptions = {}) {
  const { saving } = useAppFrame();
  const controller = useMemo(
    () =>
      saving
        ? createSaveController(saving, getSavePresentation(saving), { handlesInputError })
        : null,
    [saving, handlesInputError],
  );
  useEffect(() => () => controller?.dispose(), [controller]);
  const empty = useMemo<SaveProgress>(
    () => ({ saving: false, showSpinner: false, outcome: null }),
    [],
  );
  const progress = useSyncExternalStore(
    controller?.subscribe ?? (() => () => {}),
    controller?.getSnapshot ?? (() => empty),
  );
  return {
    ...progress,
    save: async (input: SaveInput, successMessage?: string) => {
      if (!controller) throw new AppError('E-93');
      await controller.save(input, successMessage);
    },
  };
}
