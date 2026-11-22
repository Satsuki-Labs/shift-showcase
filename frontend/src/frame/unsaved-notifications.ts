import type { SavePresentation } from '../saving/presentation';
import { SAVE_SHAPE_MISMATCH_MESSAGE } from '../../../shared/save-shapes';
import { SAVE_TIMING } from '../saving/timing';
import type { SaveState, StoredPendingSave } from '../saving/types';
import type { SaveWindow } from '../saving/window';

const messages = {
  failed: '保存できませんでした。アプリ製作者にご連絡ください。',
  offline: 'ネットにつながっていません。接続を確認してください。',
  'service-wait': '通信に時間がかかっています。しばらくお待ちください。',
  conflict: '相手から変更がありました。この入力は、保存できません。',
  'input-error': '入力に誤りがあり、保存できません。',
  'reload-required': 'この入力は、保存できません。',
};
function unsavedDetail(state: SaveState) {
  if (!(state.kind in messages)) return null;
  return {
    message:
      state.kind === 'reload-required' && state.code === 'E-47'
        ? SAVE_SHAPE_MISMATCH_MESSAGE
        : messages[state.kind as keyof typeof messages],
    resend: state.kind === 'failed',
    discard: true,
    code: state.kind === 'failed' ? state.code : undefined,
  };
}
export function unsavedNotifications(pending: StoredPendingSave[]) {
  return pending
    .filter(
      (item) =>
        (!item.dialogOpen ||
          (item.state.kind === 'reload-required' && item.state.code === 'E-47')) &&
        unsavedDetail(item.state),
    )
    .sort((a, b) => a.order - b.order)
    .map((item) => ({
      ...item,
      title:
        item.state.kind === 'reload-required' && item.state.code === 'E-47'
          ? SAVE_SHAPE_MISMATCH_MESSAGE
          : item.operation.startsWith('shift.')
            ? '保存できていないシフト'
            : '保存できていない変更',
      code: item.state.kind === 'failed' ? item.state.code : undefined,
    }));
}

type SavingPort = Pick<SaveWindow, 'subscribe' | 'getPending' | 'resend' | 'discard'>;
export function createUnsavedDialogController(
  saving: SavingPort,
  presentation: SavePresentation,
  item: StoredPendingSave,
) {
  let snapshot = {
    item,
    detail: unsavedDetail(item.state)!,
    busy: false,
    showSpinner: false,
    closed: false,
  };
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const listeners = new Set<() => void>();
  const update = (next: typeof snapshot) => {
    snapshot = next;
    listeners.forEach((listener) => listener());
  };
  const refresh = () => {
    if (disposed) return;
    const pending = saving.getPending().find((row) => row.operationId === item.operationId);
    if (!pending) {
      clearTimeout(timer);
      update({ ...snapshot, busy: false, closed: true });
      return;
    }
    const detail = unsavedDetail(pending.state);
    const busy = !detail;
    if (!busy) clearTimeout(timer);
    update({
      ...snapshot,
      item: pending,
      detail: detail ?? snapshot.detail,
      busy,
      showSpinner: busy && snapshot.showSpinner,
    });
  };
  const unsubscribe = saving.subscribe((event) => {
    if (event.kind === 'version-changed') return;
    const id = event.kind === 'state' ? event.pending.operationId : event.operationId;
    if (id === item.operationId) refresh();
  });
  refresh();
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async resend() {
      if (snapshot.busy || snapshot.closed || !snapshot.detail.resend) return;
      update({ ...snapshot, busy: true, showSpinner: false });
      presentation.requested(item.operationId, item.label, Date.now(), '保存しました');
      timer = setTimeout(() => {
        if (!disposed && snapshot.busy) update({ ...snapshot, showSpinner: true });
      }, SAVE_TIMING.showAfterMs);
      try {
        await saving.resend(item.operationId);
      } catch {
        clearTimeout(timer);
      }
      refresh();
    },
    async discard() {
      if (snapshot.busy || snapshot.closed) return;
      update({ ...snapshot, busy: true });
      try {
        await saving.discard(item.operationId);
      } catch {
        /* The saving window publishes a storage error. */
      }
      refresh();
    },
    dispose() {
      disposed = true;
      unsubscribe();
      clearTimeout(timer);
      listeners.clear();
    },
  };
}
