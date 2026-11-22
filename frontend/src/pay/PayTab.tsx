import './pay.css';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PeriodSummary, Staff } from '../../../shared/protocol';
import { japanToday } from '../../../shared/staff';
import { LoadStatus } from '../loading/LoadStatus';
import { SelectBox } from '../parts/SelectBox';
import { RangeWell } from '../parts/RangeWell';
import { periodChoice } from '../parts/periodChoice';
import { usePeriodArrival } from '../parts/usePeriodArrival';
import { PeriodLoadClient } from '../loading/period-client';
import { PayTable } from './PayTable';
import { periodDates, periodOptions, selectedPeriod } from '../../../shared/period';
import { PayExcelExport } from './PayExcelExport';
import {
  ExcelExportNotice,
  excelExportFailureMessage,
  type ExcelNotice,
} from '../parts/ExcelExportNotice';
import { payExcelFileName } from '../format/labels';
import type { PaySheetTarget } from '../excel/pay-sheet';

export function PayTab({
  staff,
  periods,
  periodId,
  selectPeriod,
  client,
}: {
  staff: readonly Staff[];
  periods: readonly PeriodSummary[];
  periodId: string | null;
  selectPeriod: (id: string | null) => void;
  client: PeriodLoadClient;
}) {
  const today = japanToday(),
    period = selectedPeriod(periods, today, periodId);
  const [loading, setLoading] = useState(client.state);
  const [openStaffId, setOpenStaffId] = useState<string | null>(null);
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const active = useRef(new Set<string>());
  const [notice, setNotice] = useState<ExcelNotice | null>(null);
  useLayoutEffect(() => setOpenStaffId(null), [period?.id]);
  useEffect(() => client.subscribe(setLoading), [client]);
  useEffect(() => {
    selectPeriod(period?.id ?? null);
  }, [period?.id, selectPeriod]);
  useEffect(() => {
    if (period)
      void client.load(
        period.id,
        client.state.kind === 'ready' && client.state.data.periodId === period.id,
      );
    return () => client.cancel();
  }, [client, period?.id]);
  const ready = loading.kind === 'ready' && loading.data.periodId === period?.id;
  const periodContent = usePeriodArrival(ready ? period!.id : null);
  const output = async (target: PaySheetTarget, outputDate: string, personName?: string) => {
    if (!period || loading.kind !== 'ready' || !ready) return;
    const key = typeof target === 'object' ? target.staffId : target;
    if (active.current.has(key)) return;
    active.current.add(key);
    setBusy(new Set(active.current));
    const file = payExcelFileName(period.name, personName ?? '全体', outputDate);
    try {
      const { buildPaySheet } = await import('../excel/pay-sheet');
      const { downloadExcel } = await import('../excel/download');
      const result = await buildPaySheet({
        staff,
        period,
        periods,
        data: loading.data,
        today,
        outputDate,
        target,
      });
      downloadExcel(result.bytes, result.fileName);
      setNotice({ file, failed: false, message: '給与管理の集計をExcelに出力しました' });
    } catch (error) {
      setNotice({ file, failed: true, message: excelExportFailureMessage(error) });
    } finally {
      active.current.delete(key);
      setBusy(new Set(active.current));
    }
  };
  return (
    <div id="pay">
      <div className="tab-toolbar">
        <h1>給与管理</h1>
        {period && (
          <RangeWell
            period={
              <>
                {period.start_date} 〜 {period.end_date}（{periodDates(period).length}日間）
              </>
            }
          >
            <SelectBox
              value={period.id}
              options={periodOptions(periods).map((row) => periodChoice(row, today))}
              onChange={selectPeriod}
            />
          </RangeWell>
        )}
        {period && (
          <PayExcelExport
            key={period.id}
            period={period}
            target="全体"
            disabled={!ready}
            busy={busy.has('all')}
            output={(outputDate) => {
              void output('all', outputDate);
            }}
          />
        )}
      </div>
      {!period ? (
        <div className="shift-no-periods empty-state">ピリオドが登録されていません</div>
      ) : loading.kind !== 'unreachable' ? (
        <div key={period.id} ref={periodContent} className="pay-content" inert={!ready}>
          <PayTable
            staff={staff}
            period={period}
            periods={periods}
            data={ready && loading.kind === 'ready' ? loading.data : null}
            today={today}
            openStaffId={openStaffId}
            exporting={busy}
            outputPerson={(id, name, outputDate) => {
              void output({ staffId: id }, outputDate, name);
            }}
            toggle={(id) => setOpenStaffId((current) => (current === id ? null : id))}
          />
        </div>
      ) : (
        <LoadStatus
          state={{ kind: 'unreachable' }}
          reload={() => {
            void client.load(period.id);
          }}
        />
      )}
      <ExcelExportNotice notice={notice} clear={() => setNotice(null)} />
    </div>
  );
}
