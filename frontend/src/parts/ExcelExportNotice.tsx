import { useEffect, useState } from 'react';
import { Toast } from './Toast';
import { WarningMark } from './icons';
import { SAVE_TIMING } from '../saving/timing';
import './ExcelExportNotice.css';

export interface ExcelNotice {
  file: string;
  failed: boolean;
  message: string;
}
export function excelExportFailureMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  const unavailable =
    (typeof navigator !== 'undefined' && navigator.onLine === false) ||
    /Failed to fetch|NetworkError|Load failed|Importing a module script failed|error loading dynamically imported module|Loading chunk .+ failed|^Excel template: \d+$/i.test(
      message,
    );
  return unavailable
    ? 'ネットにつながっていないため、Excelに出力できませんでした。'
    : 'Excelに出力できませんでした。';
}

// Keep the final date and extension together, as in the payroll notice.
export function excelFileLabel(file: string): string {
  return file.replace(
    /_([^_]+)$/,
    (_, suffix: string) => `_\u200b${suffix.split('').join('\u2060')}`,
  );
}

export function ExcelExportNotice({
  notice,
  clear,
}: {
  notice: ExcelNotice | null;
  clear: () => void;
}) {
  const [phase, setPhase] = useState<'in' | 'out'>('in');
  useEffect(() => {
    setPhase('in');
    if (!notice) return;
    const timer = setTimeout(
      () => setPhase('out'),
      notice.failed ? 5_000 : SAVE_TIMING.successVisibleMs,
    );
    return () => clearTimeout(timer);
  }, [notice]);
  const label = excelFileLabel(notice?.file ?? '');
  return (
    <Toast
      placement="navigation"
      open={Boolean(notice)}
      className={`${notice?.failed ? '' : 'saved '}excel-export-toast`}
      phase={phase}
      warn={notice?.failed}
      onExited={clear}
      message={notice?.message || (notice?.failed ? 'Excelに出力できませんでした。' : '')}
      label={label}
      icon={
        notice?.failed ? (
          <WarningMark size={26} />
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
