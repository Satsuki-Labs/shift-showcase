import './ConfirmDialog.css';
import { useState, type ReactNode } from 'react';
import { Dialog } from './Dialog';

export function ConfirmDialog({
  title,
  subtitle,
  message,
  detail,
  children,
  cancelLabel,
  confirmLabel,
  icon,
  open,
  close,
  confirm,
  saving,
  confirmVariant = 'danger',
  className = '',
}: {
  title: string;
  subtitle: string;
  message?: string;
  detail?: ReactNode;
  children?: ReactNode;
  cancelLabel: string;
  confirmLabel?: string;
  icon: ReactNode;
  open: boolean;
  close: () => void;
  confirm?: () => void;
  saving: boolean;
  confirmVariant?: 'danger' | 'main';
  className?: string;
}) {
  const [cancelled, setCancelled] = useState(false);
  return (
    <Dialog
      title={title}
      icon={icon}
      className={`confirm-dialog${message === undefined && !children ? ' confirm-without-message' : ''}${confirmLabel ? '' : ' confirm-close-only'}${className ? ` ${className}` : ''}`}
      subtitle={subtitle}
      open={open && !cancelled}
      close={close}
      hideClose
      dismissible={!saving}
      footer={
        <>
          {confirmLabel && (
            <button
              className={`btn btn-${confirmVariant}`}
              type="button"
              disabled={saving}
              onClick={confirm}
            >
              {confirmLabel}
            </button>
          )}
          <button
            className="btn btn-sub"
            type="button"
            disabled={saving}
            onClick={() => setCancelled(true)}
          >
            {cancelLabel}
          </button>
        </>
      }
    >
      {detail ? (
        <div className="confirm-message-detail">
          {message !== undefined && <p>{message}</p>}
          {detail}
        </div>
      ) : (
        message !== undefined && <p className="confirm-message">{message}</p>
      )}
      {children}
    </Dialog>
  );
}
