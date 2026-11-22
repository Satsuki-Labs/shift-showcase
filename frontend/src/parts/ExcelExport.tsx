import { useEffect, useRef, useState, type ComponentPropsWithRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, FileSpreadsheet } from 'lucide-react';
import { slashMonthDay } from '../format/date';
import { FieldGroup } from './FieldGroup';
import { floatingHost, useFloating, type FloatingPlacement } from './Floating';
import { motionMs } from './motion';
import { useDismissOutside } from './useDismissOutside';
import { useFocusCycle } from './useFocusCycle';
import './ExcelExport.css';

function ExcelButton({ children, className, ...props }: ComponentPropsWithRef<'button'>) {
  return (
    <button type="button" {...props} className={`excel-button${className ? ` ${className}` : ''}`}>
      <FileSpreadsheet size={20} strokeWidth={2.4} />
      Excelに出力{children}
    </button>
  );
}

function ExcelMenuButton(props: ComponentPropsWithRef<'button'>) {
  return (
    <ExcelButton {...props}>
      <ChevronDown className="excel-chevron" size={20} strokeWidth={3} />
    </ExcelButton>
  );
}

type ExportAction = {
  label: ReactNode;
  variant: 'sub' | 'main';
  disabled: boolean;
  output: () => void;
};

export function ExcelExportPopup({
  disabled,
  busy = false,
  width = 760,
  placement,
  className = '',
  onOpen,
  children,
}: {
  disabled: boolean;
  busy?: boolean;
  width?: number;
  placement?: FloatingPlacement;
  className?: string;
  onOpen?: () => void;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false),
    [host, setHost] = useState<Element | null>(null);
  const [present, setPresent] = useState(false);
  const button = useRef<HTMLButtonElement>(null),
    popup = useRef<HTMLDivElement>(null);
  const openingScroll = useRef({ x: 0, y: 0 });
  const reveal = placement === 'reveal-below';
  const close = () => {
    setOpen(false);
    button.current?.focus({ preventScroll: true });
  };
  useEffect(() => setHost(floatingHost(button.current)), []);
  useEffect(() => {
    if (disabled) {
      setOpen(false);
      setPresent(false);
    }
  }, [disabled]);
  useEffect(() => {
    if (open || !present) return;
    if (!reveal || !popup.current) {
      setPresent(false);
      return;
    }
    const timer = setTimeout(() => setPresent(false), motionMs(popup.current, '--motion-reveal'));
    return () => clearTimeout(timer);
  }, [open, present, reveal]);
  useEffect(() => {
    if (open && host)
      popup.current
        ?.querySelector<HTMLButtonElement>('button:not(:disabled)')
        ?.focus({ preventScroll: true });
  }, [open, host]);
  // A nested Popup handles Tab in capture before this enclosing focus scope.
  useFocusCycle(popup, open && Boolean(host), false);
  useFloating(popup, {
    open: open && !disabled && Boolean(host),
    anchor: () => button.current,
    width,
    left: (anchor) => anchor.right - width,
    placement,
  });
  useDismissOutside(
    open,
    (target) =>
      Boolean(
        button.current?.contains(target) ||
        popup.current?.contains(target) ||
        // Focusing the trigger can queue a page scroll event before the popup opens.
        (reveal &&
          target === document &&
          window.scrollX === openingScroll.current.x &&
          window.scrollY === openingScroll.current.y),
      ),
    close,
    {
      escape: true,
      scroll: reveal,
      preserveRevealScroll: reveal,
      restoreFocus: () => button.current,
    },
  );
  return (
    <div className="excel-export">
      <ExcelMenuButton
        ref={button}
        disabled={disabled}
        aria-disabled={busy || undefined}
        className={open ? 'open' : undefined}
        onClick={() => {
          if (busy) return;
          if (open) close();
          else {
            openingScroll.current = { x: window.scrollX, y: window.scrollY };
            onOpen?.();
            setPresent(reveal);
            setOpen(true);
          }
        }}
      />
      {host &&
        (open || present) &&
        !disabled &&
        createPortal(
          <div
            ref={popup}
            className={`excel-popup${reveal ? ' excel-popup-reveal' : ''}${open ? ' open' : ''}${className ? ` ${className}` : ''}`}
            inert={!open}
          >
            {children(close)}
          </div>,
          host,
        )}
    </div>
  );
}

export function ExcelExportHeading({
  periodName,
  startDate,
  endDate,
}: {
  periodName: string;
  startDate: string;
  endDate: string;
}) {
  return (
    <div className="excel-export-heading">
      <b>
        <FileSpreadsheet size={22} strokeWidth={2.4} />
        Excelに出力
      </b>
      <span className="pill excel-period">
        {periodName}
        <small>
          {slashMonthDay(startDate)}〜{slashMonthDay(endDate)}
        </small>
      </span>
    </div>
  );
}

export function ExcelExport({
  periodName,
  startDate,
  endDate,
  disabled,
  rows,
  explanation,
}: {
  periodName: string;
  startDate: string;
  endDate: string;
  disabled: boolean;
  explanation?: ReactNode;
  rows: readonly {
    id: string;
    color: 'navy' | 'blue' | 'brown';
    name: string;
    status?: ReactNode;
    buttons: readonly [ExportAction] | readonly [ExportAction, ExportAction];
  }[];
}) {
  return (
    <ExcelExportPopup disabled={disabled}>
      {(close) => (
        <>
          <ExcelExportHeading periodName={periodName} startDate={startDate} endDate={endDate} />
          {rows.map((row) => (
            <FieldGroup key={row.id} className="excel-row">
              <span className="excel-name">
                <span className={`excel-dot ${row.color}`} />
                {row.name}
              </span>
              <div className="excel-status">{row.status}</div>
              <div className="excel-actions">
                {row.buttons.map((action, index) => (
                  <button
                    key={index}
                    type="button"
                    className={`btn btn-${action.variant} btn-small`}
                    disabled={action.disabled}
                    onClick={() => {
                      close();
                      action.output();
                    }}
                  >
                    {action.label}
                  </button>
                ))}
              </div>
            </FieldGroup>
          ))}
          {explanation && <p className="excel-explanation">{explanation}</p>}
        </>
      )}
    </ExcelExportPopup>
  );
}
