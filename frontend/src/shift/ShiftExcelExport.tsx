import type { ShiftSheetInput } from '../excel/shift-sheet';
import type { PeriodStaff } from '../../../shared/period-snapshot';
import { useEffect, useState } from 'react';
import { FilePen, FileSpreadsheet, Info } from 'lucide-react';
import type { AnnualRules, PeriodLoadResponse, PeriodSummary } from '../../../shared/protocol';
import { japanToday } from '../../../shared/staff';
import { japanDate } from '../../../shared/date';
import { useShiftExcelExport } from '../app/shift-excel-export';
import { monthDay } from '../format/date';
import { PeriodLoadClient } from '../loading/period-client';
import { ExcelExport } from '../parts/ExcelExport';
import { ConfirmDialog } from '../parts/ConfirmDialog';
import { changedPrintedCellCount, printedCells } from './printed';
import { periodRules } from './model';

function prepareShiftExcelExport(source: Omit<ShiftSheetInput, 'contactNames'>) {
  const input = structuredClone(source);
  const cells = printedCells(
    input.staff,
    input.period,
    input.periods,
    input.site,
    input.data,
    periodRules(input.rules, input.data),
    input.today,
  );
  return { input, cells };
}

export function ShiftExcelExport({
  staff,
  period,
  periods,
  data,
  rules,
  client,
  today,
}: {
  staff: readonly PeriodStaff[];
  period: PeriodSummary;
  periods: readonly PeriodSummary[];
  data: PeriodLoadResponse | null;
  rules: AnnualRules;
  client: PeriodLoadClient;
  today: string;
}) {
  const exporter = useShiftExcelExport();
  const busy = exporter?.busy ?? false,
    settled = exporter?.settled;
  const [confirm, setConfirm] = useState<1 | 2 | null>(null);
  useEffect(() => setConfirm(null), [settled, period.id]);
  const produce = (site: 1 | 2, kind: 'draft' | 'initial' | 'revised') => {
    if (!data || !exporter || busy) return;
    const { input, cells } = prepareShiftExcelExport({
      staff,
      period,
      periods,
      data,
      rules,
      today,
      site,
      kind,
      outputDate: japanToday(),
    });
    void exporter.output(input, client, cells);
  };
  const name = confirm === 1 ? '第一' : '第二';
  return (
    <>
      <ExcelExport
        periodName={period.name}
        startDate={period.start_date}
        endDate={period.end_date}
        disabled={!data || !exporter}
        rows={([1, 2] as const).map((site) => {
          const key = site === 1 ? 'first' : 'second',
            name = site === 1 ? '第一' : '第二';
          const published = period[`${key}_published_at`],
            distributed = period[`${key}_last_distributed_at`];
          const changed = data
            ? changedPrintedCellCount(
                staff,
                period,
                periods,
                site,
                data,
                periodRules(rules, data),
                today,
              )
            : 0;
          return {
            id: key,
            name,
            color: site === 1 ? 'blue' : 'brown',
            status: !published ? (
              <span>未出力</span>
            ) : (
              <>
                <span className="excel-published">
                  {monthDay(japanDate(new Date(distributed!)))}に出力済み
                </span>
                {changed ? (
                  <span className="excel-changed">修正したマス {changed}か所</span>
                ) : (
                  <span>修正したマスなし</span>
                )}
              </>
            ),
            buttons: [
              {
                label: (
                  <>
                    <FilePen size={20} strokeWidth={2.4} />
                    下書き
                  </>
                ),
                variant: 'sub',
                disabled: busy,
                output: () => produce(site, 'draft'),
              },
              {
                label: (
                  <>
                    <FileSpreadsheet size={20} strokeWidth={2.4} />
                    {!published ? '初版' : changed ? '修正版' : '再出力'}
                  </>
                ),
                variant: 'main',
                disabled: busy,
                output: () => (published ? produce(site, 'revised') : setConfirm(site)),
              },
            ],
          };
        })}
        explanation={
          (!period.first_published_at || !period.second_published_at) && (
            <>
              <Info size={18} strokeWidth={2.4} />
              「初版」は、最初に確定したシフトを指します。
            </>
          )
        }
      />
      {confirm !== null && (
        <ConfirmDialog
          className="excel-confirm-dialog"
          title={`${name}の初版を出力しますか？`}
          subtitle={`${period.name}（${monthDay(period.start_date)}〜${monthDay(period.end_date)}）`}
          icon={<span className={`excel-dot ${confirm === 1 ? 'blue' : 'brown'}`} />}
          open
          close={() => setConfirm(null)}
          saving={busy}
          message="今のシフトを、初版としてExcelに出力します。"
          detail={
            <ul className="excel-confirm-list">
              <li>この後に修正したマスは、赤色になります。</li>
              <li>{name}の表のマスから、「希」の印が消えます。</li>
            </ul>
          }
          confirmVariant="main"
          confirmLabel="はい、出力する"
          cancelLabel="いいえ"
          confirm={() => produce(confirm, 'initial')}
        />
      )}
    </>
  );
}
