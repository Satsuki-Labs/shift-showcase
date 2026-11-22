import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ChevronRight, CircleCheck, ClipboardCheck, Save, Trash2 } from 'lucide-react';
import { Dialog } from '../parts/Dialog';
import type { FirstLoadResponse } from '../../../shared/protocol';
import type { ClosingNotification } from './Frame';
import { getSavePresentation } from '../saving/presentation';
import type { StoredPendingSave } from '../saving/types';
import type { SaveWindow } from '../saving/window';
import { createUnsavedDialogController, unsavedNotifications } from './unsaved-notifications';
import { WarningMark, FailureMark } from '../parts/icons';
import { layoutRect } from '../parts/viewport';

export function useUnsavedNotifications(saving: SaveWindow | null) {
  const [pending, setPending] = useState<StoredPendingSave[]>([]);
  useEffect(() => {
    if (!saving) {
      setPending([]);
      return;
    }
    const update = () => setPending(saving.getPending());
    const unsubscribe = saving.subscribe(update);
    update();
    return unsubscribe;
  }, [saving]);
  return unsavedNotifications(pending);
}
const notificationTitles: Record<FirstLoadResponse['notifications'][number]['kind'], string> = {
  backup_failure: 'バックアップに失敗しています',
  schedule_stalled: 'バックアップが止まっています',
};
export function UnsavedNotifications({
  items,
  select,
  closing,
  selectClosing,
  budget,
  selectBudget,
  notifications,
}: {
  notifications: FirstLoadResponse['notifications'];
  items: ReturnType<typeof unsavedNotifications>;
  select: (item: StoredPendingSave) => void;
  closing: readonly ClosingNotification[];
  selectClosing: (item: ClosingNotification) => void;
  budget: string | null;
  selectBudget: () => void;
}) {
  const selectingCode = useRef(false);
  const panel = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const node = panel.current;
    if (!node) return;
    (node.querySelector<HTMLElement>('button:not(:disabled)') ?? node).focus({
      preventScroll: true,
    });
  }, []);
  useLayoutEffect(() => {
    const node = panel.current;
    if (!node) return;
    const resize = () => {
      node.style.maxHeight = `calc(var(--viewport-height, 100vh) - ${layoutRect(node).top}px - var(--space-2))`;
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(node.parentElement!);
    window.addEventListener('resize', resize);
    document.addEventListener('scroll', resize, true);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', resize);
      document.removeEventListener('scroll', resize, true);
    };
  }, []);
  return (
    <div className="npanel" id="notifications" ref={panel} tabIndex={-1}>
      <div className="nh">
        <ClipboardCheck size={22} strokeWidth={2.2} />
        対応が必要なこと
      </div>
      <div className="notification-list scrollbar-thin">
        {notifications.map((item) => (
          <div className="ni" key={item.kind}>
            <FailureMark size={26} />
            <div>
              {notificationTitles[item.kind]}
              <small>アプリ製作者に連絡してください</small>
            </div>
            <span className="code">{item.code}</span>
          </div>
        ))}
        {items.map((item) => (
          <button
            className="ni"
            type="button"
            key={item.operationId}
            onPointerDown={(event) => {
              selectingCode.current =
                event.target instanceof Element && event.target.closest('.code') !== null;
            }}
            onClick={(event) => {
              if (event.detail === 0 || !selectingCode.current) select(item);
            }}
          >
            <FailureMark size={26} />
            <div>
              {item.title}
              <small>{item.label}</small>
            </div>
            {item.code && <span className="code">{item.code}</span>}
            <span className="go">
              <ChevronRight size={22} strokeWidth={2.6} />
            </span>
          </button>
        ))}
        {closing.map((item) => (
          <button
            className="ni"
            type="button"
            key={`${item.date}-${item.building}`}
            onClick={() => selectClosing(item)}
          >
            <WarningMark size={26} />
            <div>
              締め作業の担当がいません<small>{item.label}</small>
            </div>
            <span className="go">
              <ChevronRight size={22} strokeWidth={2.6} />
            </span>
          </button>
        ))}
        {budget && (
          <button className="ni" type="button" onClick={selectBudget}>
            <WarningMark size={26} />
            <div>
              予算を超えています<small>{budget}</small>
            </div>
            <span className="go">
              <ChevronRight size={22} strokeWidth={2.6} />
            </span>
          </button>
        )}
        {!items.length && !closing.length && !budget && !notifications.length && (
          <div className="empty">
            <CircleCheck size={22} strokeWidth={2.2} />
            対応が必要なことはありません
          </div>
        )}
      </div>
    </div>
  );
}
export function UnsavedDialog({
  saving,
  item,
  close,
}: {
  saving: SaveWindow;
  item: StoredPendingSave;
  close: () => void;
}) {
  const controller = useMemo(
    () => createUnsavedDialogController(saving, getSavePresentation(saving), item),
    [saving, item],
  );
  useEffect(() => () => controller.dispose(), [controller]);
  const progress = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  return (
    <Dialog
      className="unsaved-dialog"
      title="保存できていません"
      icon={<FailureMark size={26} />}
      open={!progress.closed}
      close={close}
      footerStart={
        <button
          className="btn btn-danger"
          type="button"
          disabled={progress.busy}
          onClick={() => {
            void controller.discard();
          }}
        >
          <Trash2 size={22} strokeWidth={2} />
          この入力を破棄
        </button>
      }
      footer={
        <>
          {progress.detail.resend && (
            <button
              className="btn btn-main"
              type="button"
              disabled={progress.busy}
              onClick={() => {
                void controller.resend();
              }}
            >
              {progress.showSpinner ? (
                <span className="spinner" />
              ) : (
                <Save size={22} strokeWidth={2} />
              )}
              もう一度保存する
            </button>
          )}
        </>
      }
    >
      <div className="unsaved-details">
        <div className="unsaved-details-top">
          <small>{item.label}</small>
        </div>
        <p className="why-line">{progress.detail.message}</p>
        {progress.detail.code && (
          <div className="unsaved-code-row">
            <span className="code">{progress.detail.code}</span>
          </div>
        )}
      </div>
    </Dialog>
  );
}
