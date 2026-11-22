import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { Check, Download } from 'lucide-react';
import type { PeriodLoadResponse, PeriodSummary } from '../../../shared/protocol';
import { japanToday } from '../../../shared/staff';
import type { LoadState } from '../loading/client';
import { useAppFrame } from '../app/context';
import { payExcelFileName, shiftExcelFileName } from '../format/labels';
import { PeriodLoadClient } from '../loading/period-client';
import { ExcelExportNotice, type ExcelNotice } from '../parts/ExcelExportNotice';
import '../parts/ExcelExport.css';

const backups = [
  { id: 'first', name: '第一のシフト表', color: 'blue', site: 1 },
  { id: 'second', name: '第二のシフト表', color: 'brown', site: 2 },
  { id: 'pay', name: '給与管理の集計', color: 'navy', site: null },
] as const;
type Backup = (typeof backups)[number];

async function outputPeriodBackup(
  backup: Backup,
  {
    data,
    loading,
    done,
    active,
    setBusy,
    setDone,
    setNotice,
    period,
  }: {
    data: PeriodLoadResponse | null;
    loading: LoadState;
    done: ReadonlySet<string>;
    active: Set<string>;
    setBusy: (busy: ReadonlySet<string>) => void;
    setDone: Dispatch<SetStateAction<ReadonlySet<string>>>;
    setNotice: (notice: ExcelNotice | null) => void;
    period: PeriodSummary;
  },
) {
  if (!data || loading.kind !== 'ready' || done.has(backup.id) || active.has(backup.id)) return;
  active.add(backup.id);
  setBusy(new Set(active));
  const today = japanToday(),
    outputDate = today;
  const { staff, periods, annualRules: rules, contactNames } = loading.data;
  const file =
    backup.site === null
      ? payExcelFileName(period.name, '全体', outputDate)
      : shiftExcelFileName(period.name, backup.site, 'backup', outputDate);
  try {
    const { downloadExcel } = await import('../excel/download');
    const result =
      backup.site === null
        ? await (
            await import('../excel/pay-sheet')
          ).buildPaySheet({ staff, period, periods, data, today, outputDate, target: 'all' })
        : await (
            await import('../excel/shift-sheet')
          ).buildShiftSheet({
            contactNames,
            staff,
            period,
            periods,
            data,
            rules,
            today,
            outputDate,
            site: backup.site,
            kind: 'backup',
          });
    downloadExcel(result.bytes, result.fileName);
    setDone((current) => new Set([...current, backup.id]));
  } catch {
    setNotice({ file, failed: true, message: '' });
  } finally {
    active.delete(backup.id);
    setBusy(new Set(active));
  }
}

function remainingPeriodBackups(done: ReadonlySet<string>) {
  return backups.filter((backup) => !done.has(backup.id)).map((backup) => backup.name);
}

export function PeriodDeleteBackup({
  period,
  children,
}: {
  period: PeriodSummary;
  children: (content: ReactNode, remaining: readonly string[]) => ReactNode;
}) {
  const { loading } = useAppFrame();
  const [client] = useState(() => new PeriodLoadClient());
  const [data, setData] = useState<PeriodLoadResponse | null>(null);
  const [done, setDone] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const active = useRef(new Set<string>());
  const [notice, setNotice] = useState<ExcelNotice | null>(null);
  useEffect(() => {
    let mounted = true;
    void client.load(period.id).then((result) => {
      if (mounted && result) setData(result);
    });
    return () => {
      mounted = false;
      client.cancel();
    };
  }, [client, period.id]);
  const output = (backup: Backup) =>
    outputPeriodBackup(backup, {
      data,
      loading,
      done,
      active: active.current,
      setBusy,
      setDone,
      setNotice,
      period,
    });
  const content = (
    <div className="period-backup">
      <p className="period-backup-p">削除する前に、控えをダウンロードできます。</p>
      <div className="period-backup-rows">
        {backups.map((backup) => (
          <div
            key={backup.id}
            className={`period-backup-tile${done.has(backup.id) ? ' done' : ''}`}
          >
            <span className="excel-name">
              <span className={`excel-dot ${backup.color}`} />
              {backup.name}
            </span>
            <div className="period-backup-act">
              {done.has(backup.id) ? (
                <span className="period-backup-ok">
                  <Check size={18} strokeWidth={3.2} />
                  ダウンロード済み
                </span>
              ) : (
                <button
                  className="btn btn-sub btn-small"
                  type="button"
                  disabled={!data || loading.kind !== 'ready' || busy.has(backup.id)}
                  onClick={() => {
                    void output(backup);
                  }}
                >
                  <Download size={20} strokeWidth={2.4} />
                  ダウンロード
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
  return (
    <>
      {children(content, remainingPeriodBackups(done))}
      <ExcelExportNotice notice={notice} clear={() => setNotice(null)} />
    </>
  );
}
