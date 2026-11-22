import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type RefObject,
} from 'react';
import { WifiOff } from 'lucide-react';
import { useAppFrame } from '../app/context';
import { getSavePresentation, type SavePopupView } from '../saving/presentation';
import type { SaveWindow } from '../saving/window';
import { WarningMark, FailureMark } from '../parts/icons';
import { Toast } from '../parts/Toast';
import { excelFileLabel } from '../parts/ExcelExportNotice';

function Popup({
  saving,
  anchor,
  hidden,
}: {
  saving: SaveWindow;
  anchor: RefObject<HTMLDivElement | null>;
  hidden: boolean;
}) {
  const presentation = useMemo(() => getSavePresentation(saving), [saving]);
  const view = useSyncExternalStore(presentation.subscribe, presentation.getSnapshot);
  const [shown, setShown] = useState<SavePopupView | null>(view);
  const [phase, setPhase] = useState<'in' | 'out'>('in');
  const latest = useRef(view);
  latest.current = view;
  useEffect(() => presentation.connect(saving), [presentation, saving]);
  useLayoutEffect(() => {
    if (hidden) {
      setShown(null);
      setPhase('in');
      return;
    }
    if (!shown) {
      if (view) {
        setShown(view);
        setPhase('in');
      }
    } else if (view !== shown) setPhase('out');
  }, [view, shown, hidden]);
  const warn =
    shown?.kind === 'offline' || shown?.kind === 'failed' || shown?.kind === 'input-error';
  const excelExport = shown?.kind === 'saved' && shown.excelExport;
  return (
    <Toast
      anchor={anchor}
      open={!hidden && Boolean(shown)}
      className={
        shown?.kind === 'saved'
          ? `saved${excelExport ? ' shift-excel-export-toast' : ''}`
          : undefined
      }
      phase={phase}
      warn={warn}
      message={shown?.message ?? ''}
      label={excelExport ? excelFileLabel(shown.label) : (shown?.label ?? '')}
      code={shown?.code}
      onExited={() => {
        setShown(latest.current);
        setPhase('in');
      }}
      icon={
        !shown ? null : shown.kind === 'saving' ? (
          <span className="spinner dark" />
        ) : shown.kind === 'offline' ? (
          <WifiOff size={26} strokeWidth={2.4} />
        ) : shown.kind === 'input-error' ? (
          <WarningMark size={26} />
        ) : shown.kind === 'failed' ? (
          <FailureMark size={26} />
        ) : (
          <svg width="26" height="26" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="11" fill="var(--action)" />
            <path
              d="m7.5 12.5 3 3 6-6.5"
              fill="none"
              stroke="var(--surface)"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )
      }
    />
  );
}

export function SavePopup({
  anchor,
  hidden = false,
}: {
  anchor: RefObject<HTMLDivElement | null>;
  hidden?: boolean;
}) {
  const { saving } = useAppFrame();
  return saving ? <Popup saving={saving} anchor={anchor} hidden={hidden} /> : null;
}
