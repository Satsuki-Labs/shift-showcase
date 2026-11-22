import { AppError } from '../../../shared/app-error';
import { SAVE_SHAPE_VERSION } from '../../../shared/save-shapes';
import type { RevisionTarget, SaveRequest } from '../../../shared/protocol';
import { DraftStore } from './drafts';
import { readSaveResponse } from './response';
import { SAVE_TIMING } from './timing';
import { observeDataResponse } from '../app/data-generation';
import type {
  BrowserPort,
  Draft,
  StoredPendingSave,
  SaveEvent,
  SaveInput,
  SaveState,
  SaveTransport,
} from './types';

interface Pending {
  draft: Draft;
  keys: string[];
  active: boolean;
  halted: boolean;
  dialogOpen: boolean;
  resolving?: boolean;
  controller?: AbortController;
  slowTimer?: ReturnType<typeof setTimeout>;
  retryTimer?: ReturnType<typeof setTimeout>;
  serviceTimer?: ReturnType<typeof setTimeout>;
}
export interface SaveWindowOptions {
  appVersion: string;
  dataGeneration: string;
  drafts?: DraftStore;
  browser?: BrowserPort;
  transport?: SaveTransport;
  onEvent?: (event: SaveEvent) => void;
  onReady?: (saving: SaveWindow, stale: Draft[]) => Promise<void>;
}
function targetKey(target: RevisionTarget): string {
  const item = target as unknown as Record<string, unknown>;
  return JSON.stringify(
    Object.keys(item)
      .sort()
      .map((key) => [key, item[key]]),
  );
}
const transient = (operation: string) =>
  operation === 'period.publish' || operation === 'period.redistribute';
const defaultTransport: SaveTransport = (request, signal) =>
  fetch('/api/save', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
    signal,
  });

let changedEditors = 0;
const editChangeListeners = new Set<() => void>();
/** The saving window also protects edits that have not been submitted yet. */
export function registerChangedEditor() {
  changedEditors++;
  editChangeListeners.forEach((listener) => listener());
  return () => {
    changedEditors--;
    editChangeListeners.forEach((listener) => listener());
  };
}

export class SaveWindow {
  private readonly pending = new Map<string, Pending>();
  private readonly listeners = new Set<(event: SaveEvent) => void>();
  private readonly seenVersions = new Set<string>();
  private readonly store: DraftStore;
  private readonly browser: BrowserPort;
  private readonly transport: SaveTransport;
  private disposed = false;
  private restored = false;
  private persisting = 0;
  private unloadAttached = false;
  private reloading = false;
  private readonly editorChanged = () => this.syncUnload();
  private readonly beforeUnload = (event: Event) => {
    event.preventDefault();
    (event as BeforeUnloadEvent).returnValue = '';
  };
  private readonly connectionChanged = () => {
    for (const item of this.pending.values()) {
      if (item.halted) continue;
      if (!this.browser.isOnline()) {
        this.clearTimers(item);
        item.controller?.abort();
        void this.setState(item, { kind: 'offline' }).catch(() => this.storageFailed(item));
      } else {
        clearTimeout(item.retryTimer);
        item.retryTimer = undefined;
      }
    }
    this.pump();
  };
  private constructor(private readonly options: SaveWindowOptions) {
    this.store = options.drafts ?? new DraftStore();
    this.browser = options.browser ?? { events: window, isOnline: () => navigator.onLine };
    this.transport = options.transport ?? defaultTransport;
    if (options.onEvent) this.listeners.add(options.onEvent);
  }
  static async create(options: SaveWindowOptions): Promise<SaveWindow> {
    const instance = new SaveWindow(options);
    const stale: Draft[] = [];
    for (const draft of await instance.store.list()) {
      if (draft.request.saveShapeVersion === undefined) {
        draft.request.saveShapeVersion = SAVE_SHAPE_VERSION;
        await instance.putDraft(draft);
      }
      if (transient(draft.request.operation)) {
        await instance.store.remove(draft.order);
      } else if (draft.request.dataGeneration !== options.dataGeneration) {
        stale.push(draft);
        await instance.store.remove(draft.order);
      } else instance.addPending({ ...draft, state: { kind: 'queued' } });
    }
    await options.onReady?.(instance, stale);
    instance.browser.events.addEventListener('online', instance.connectionChanged);
    instance.browser.events.addEventListener('offline', instance.connectionChanged);
    editChangeListeners.add(instance.editorChanged);
    instance.syncUnload();
    instance.pump();
    return instance;
  }
  subscribe(listener: (event: SaveEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  getPending(): StoredPendingSave[] {
    return structuredClone(this.ordered().map((item) => this.view(item)));
  }
  async discardForRestore(): Promise<void> {
    this.restored = true;
    const items = this.ordered();
    for (const item of items) {
      item.halted = true;
      item.resolving = true;
      this.clearTimers(item);
      item.controller?.abort();
      this.pending.delete(item.draft.request.operationId);
      this.emit({ kind: 'discarded', operationId: item.draft.request.operationId });
    }
    this.syncUnload();
    await Promise.all(items.map((item) => this.removeDraft(item.draft)));
  }
  suppressBeforeUnloadForReload() {
    this.reloading = true;
    this.syncUnload();
  }
  async save(input: SaveInput, dialogOpen = false): Promise<string> {
    if (this.disposed) throw new AppError('E-93');
    if (this.restored) throw new AppError('E-42');
    const { label, ...content } = input;
    const request: SaveRequest = structuredClone({
      ...content,
      operationId: crypto.randomUUID(),
      dataGeneration: this.options.dataGeneration,
      saveShapeVersion: SAVE_SHAPE_VERSION,
    });
    this.persisting++;
    this.syncUnload();
    try {
      const draft: Draft = transient(request.operation)
        ? {
            request,
            label,
            order: Math.max(0, ...this.ordered().map((item) => item.draft.order)) + 1,
            state: { kind: 'queued' },
          }
        : await this.store.add(request, label);
      if (this.restored) {
        await this.removeDraft(draft);
        throw new AppError('E-42');
      }
      if (!this.disposed) {
        this.addPending(draft, dialogOpen);
        this.emit({ kind: 'state', pending: this.view(this.pending.get(request.operationId)!) });
        this.pump();
      }
      return request.operationId;
    } catch (error) {
      throw error instanceof AppError ? error : new AppError('E-93');
    } finally {
      this.persisting--;
      this.syncUnload();
    }
  }
  async closeDialog(operationId: string): Promise<void> {
    const item = this.pending.get(operationId);
    if (this.disposed || !item) return;
    item.dialogOpen = false;
    if (item.draft.state.kind === 'input-error' || item.draft.state.kind === 'conflict')
      await this.discard(operationId);
    else this.emit({ kind: 'dialog-closed', operationId });
  }
  async discard(operationId: string): Promise<boolean> {
    const item = this.pending.get(operationId);
    if (this.disposed || !item || item.resolving) return false;
    item.resolving = true;
    item.halted = true;
    this.clearTimers(item);
    item.controller?.abort();
    try {
      await this.removeDraft(item.draft);
      this.pending.delete(operationId);
      this.syncUnload();
      this.emit({ kind: 'discarded', operationId });
      this.pump();
      return true;
    } catch {
      this.storageFailed(item);
      throw new AppError('E-93');
    } finally {
      item.resolving = false;
    }
  }
  async resend(operationId: string): Promise<boolean> {
    const item = this.pending.get(operationId);
    if (
      this.disposed ||
      this.restored ||
      !item?.halted ||
      item.resolving ||
      (item.draft.state.kind === 'reload-required' && item.draft.state.code === 'E-47')
    )
      return false;
    item.resolving = true;
    try {
      const draft: Draft = structuredClone({ ...item.draft, state: { kind: 'queued' } });
      await this.putDraft(draft);
      if (this.disposed) return false;
      // Keep the stopped attempt halted so its late completion cannot alter the new attempt.
      this.addPending(draft, item.dialogOpen);
      this.emit({ kind: 'state', pending: this.view(this.pending.get(operationId)!) });
      this.pump();
      return true;
    } catch {
      this.storageFailed(item);
      throw new AppError('E-93');
    } finally {
      item.resolving = false;
    }
  }
  async dispose(): Promise<void> {
    this.disposed = true;
    this.browser.events.removeEventListener('online', this.connectionChanged);
    this.browser.events.removeEventListener('offline', this.connectionChanged);
    this.browser.events.removeEventListener('beforeunload', this.beforeUnload);
    editChangeListeners.delete(this.editorChanged);
    for (const item of this.pending.values()) {
      this.clearTimers(item);
      item.controller?.abort();
    }
    this.listeners.clear();
    await this.store.close();
  }
  private async putDraft(draft: Draft) {
    if (!transient(draft.request.operation)) await this.store.put(draft);
  }
  private async removeDraft(draft: Draft) {
    if (!transient(draft.request.operation)) await this.store.remove(draft.order);
  }
  private addPending(draft: Draft, dialogOpen = false) {
    this.pending.set(draft.request.operationId, {
      draft,
      keys: draft.request.revisions.map((item) => targetKey(item.target)),
      active: false,
      halted: false,
      dialogOpen,
    });
  }
  private ordered(): Pending[] {
    return [...this.pending.values()].sort((left, right) => left.draft.order - right.draft.order);
  }
  private view(item: Pending): StoredPendingSave {
    return {
      operationId: item.draft.request.operationId,
      operation: item.draft.request.operation,
      order: item.draft.order,
      dialogOpen: item.dialogOpen,
      label: item.draft.label,
      state: item.draft.state,
    };
  }
  private emit(event: SaveEvent) {
    if (!this.disposed) this.listeners.forEach((listener) => listener(structuredClone(event)));
  }
  private syncUnload() {
    const needed =
      !this.disposed &&
      !this.reloading &&
      (changedEditors > 0 || this.pending.size > 0 || this.persisting > 0);
    if (needed === this.unloadAttached) return;
    if (needed) this.browser.events.addEventListener('beforeunload', this.beforeUnload);
    else this.browser.events.removeEventListener('beforeunload', this.beforeUnload);
    this.unloadAttached = needed;
  }
  private async setState(item: Pending, state: SaveState): Promise<void> {
    if (
      this.disposed ||
      item.resolving ||
      this.pending.get(item.draft.request.operationId) !== item
    )
      return;
    if (JSON.stringify(item.draft.state) === JSON.stringify(state)) return;
    item.draft.state = state;
    this.emit({ kind: 'state', pending: this.view(item) });
    await this.putDraft(structuredClone(item.draft));
  }
  private clearTimers(item: Pending) {
    clearTimeout(item.slowTimer);
    clearTimeout(item.retryTimer);
    clearTimeout(item.serviceTimer);
    item.slowTimer = item.retryTimer = item.serviceTimer = undefined;
  }
  private storageFailed(item: Pending) {
    if (this.disposed || this.pending.get(item.draft.request.operationId) !== item) return;
    item.halted = true;
    this.clearTimers(item);
    item.controller?.abort();
    item.draft.state = { kind: 'failed', code: 'E-93' };
    this.emit({ kind: 'state', pending: this.view(item) });
    this.pump();
  }
  private async finish(item: Pending, state: SaveState) {
    item.halted = true;
    this.clearTimers(item);
    item.controller?.abort();
    await this.setState(item, state);
    this.pump();
  }
  private pump() {
    if (this.disposed || this.restored) return;
    const items = this.ordered();
    if (!this.browser.isOnline()) {
      items
        .filter((item) => !item.halted)
        .forEach((item) => {
          void this.setState(item, { kind: 'offline' }).catch(() => this.storageFailed(item));
        });
      return;
    }
    items.forEach((item, index) => {
      if (item.active || item.halted || item.retryTimer !== undefined) return;
      if (
        items.some(
          (other) =>
            other !== item &&
            other.active &&
            !other.halted &&
            other.keys.some((key) => item.keys.includes(key)),
        )
      )
        return;
      if (
        items
          .slice(0, index)
          .some(
            (previous) => !previous.halted && previous.keys.some((key) => item.keys.includes(key)),
          )
      )
        return;
      item.active = true;
      void this.attempt(item).finally(() => {
        item.active = false;
        this.pump();
      });
    });
  }
  private retry(item: Pending) {
    if (this.disposed || item.halted || !this.browser.isOnline()) return;
    item.retryTimer = setTimeout(() => {
      item.retryTimer = undefined;
      this.pump();
    }, SAVE_TIMING.retryAfterMs);
  }
  private async waitForService(item: Pending): Promise<void> {
    clearTimeout(item.slowTimer);
    item.slowTimer = undefined;
    if (item.serviceTimer === undefined)
      item.serviceTimer = setTimeout(() => {
        void this.finish(item, { kind: 'failed', code: 'E-82' }).catch(() =>
          this.storageFailed(item),
        );
      }, SAVE_TIMING.serviceFailureAfterMs);
    await this.setState(item, { kind: 'service-wait' });
    this.retry(item);
  }
  private async attempt(item: Pending): Promise<void> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      if (!item.serviceTimer && item.draft.state.kind !== 'offline') {
        if (item.draft.state.kind !== 'slow') await this.setState(item, { kind: 'sending' });
        if (item.slowTimer === undefined)
          item.slowTimer = setTimeout(() => {
            if (!item.halted && this.browser.isOnline() && item.serviceTimer === undefined) {
              void this.setState(item, { kind: 'slow' }).catch(() => this.storageFailed(item));
            }
          }, SAVE_TIMING.slowAfterMs);
      }
      if (this.disposed || item.halted || !this.browser.isOnline()) return;
      item.controller = new AbortController();
      const signal = item.controller.signal;
      const transfer = async () => {
        const response = await this.transport(structuredClone(item.draft.request), signal);
        await observeDataResponse(response);
        try {
          return { response, body: readSaveResponse(await response.json()) };
        } catch {
          const unavailable =
            response.status === 429 || (response.status >= 500 && response.status < 600);
          throw new AppError(unavailable ? 'E-82' : 'E-73');
        }
      };
      const timedOut = new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          reject(new TypeError('Request timed out'));
          item.controller?.abort();
        }, SAVE_TIMING.requestTimeoutMs);
        signal.addEventListener('abort', () => reject(new TypeError('Request aborted')), {
          once: true,
        });
      });
      const { response, body } = await Promise.race([transfer(), timedOut]);
      if (this.disposed || item.halted) return;
      await observeDataResponse(response, undefined, 'code' in body ? body.code : undefined);
      if (this.disposed || item.halted) return;
      const version = response.headers.get('X-App-Version');
      if (version && version !== this.options.appVersion && !this.seenVersions.has(version)) {
        this.seenVersions.add(version);
        this.emit({ kind: 'version-changed', appVersion: version });
      }
      if ('ok' in body && body.ok) {
        this.clearTimers(item);
        await this.removeDraft(item.draft);
        if (this.disposed || item.halted) return;
        this.pending.delete(item.draft.request.operationId);
        this.syncUnload();
        this.emit({
          kind: 'saved',
          operationId: item.draft.request.operationId,
          operation: item.draft.request.operation,
          label: item.draft.label,
          result: body,
        });
      } else if ('code' in body) {
        if (body.code === 'E-82') await this.waitForService(item);
        else if (body.code === 'E-32')
          await this.finish(item, { kind: 'input-error', field: body.field! });
        else if (body.code === 'E-33' && 'conflicts' in body)
          await this.finish(item, { kind: 'conflict', conflicts: body.conflicts });
        else if (body.code === 'E-42' || body.code === 'E-47')
          await this.finish(item, { kind: 'reload-required', code: body.code });
        else await this.finish(item, { kind: 'failed', code: body.code });
      }
    } catch (error) {
      if (this.disposed || item.halted) return;
      if (error instanceof AppError && error.code === 'E-82')
        await this.waitForService(item).catch(() => this.storageFailed(item));
      else if (error instanceof AppError)
        await this.finish(item, { kind: 'failed', code: error.code }).catch(() =>
          this.storageFailed(item),
        );
      else {
        clearTimeout(item.slowTimer);
        clearTimeout(item.serviceTimer);
        item.slowTimer = item.serviceTimer = undefined;
        await this.setState(item, { kind: 'offline' }).catch(() => this.storageFailed(item));
        this.retry(item);
      }
    } finally {
      clearTimeout(timeout);
    }
  }
}
