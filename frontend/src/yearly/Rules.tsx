import { useState } from 'react';
import { Clock, Info, LockKeyhole, Pencil, Plus, Sun } from 'lucide-react';
import { facilities, fiscalYearLabel } from '../../../shared/calendar';
import type { AnnualRules, OpeningRule, PeriodSummary } from '../../../shared/protocol';
import { FacilityBadge, yearBreaks } from './format';
import { lastEndedPeriodDate } from './ended-periods';
import { OpeningRulesDialog } from './OpeningRulesDialog';
import { PeakDialog } from './PeakDialog';
import { AnnualClosureDialog } from './AnnualClosureDialog';
import { dateRange, monthDay } from '../format/date';
import { duration, shortTime } from '../format/time';
import { NumberUnits } from '../parts/NumberUnits';
import type { RuleCalendar } from './client';

function closureRange(row: AnnualRules['annualClosures'][number]): string {
  const start = `${row.start_month}月${row.start_day}日`,
    end = `${row.end_month}月${row.end_day}日`;
  return start === end ? start : `${start}〜${end}`;
}
export function Rules({
  year,
  rules,
  periods,
  calendar,
}: {
  year: number;
  rules: AnnualRules;
  periods: readonly PeriodSummary[];
  calendar: RuleCalendar;
}) {
  const [dialog, setDialog] = useState<
    | { kind: 'opening'; year: number }
    | { kind: 'break'; year: number; before: AnnualRules['peaks'][number] | null }
    | { kind: 'closure'; year: number; before: AnnualRules['annualClosures'][number] | null }
    | null
  >(null);
  const opening = facilities.map((facility) =>
    rules.openingRules.reduce<OpeningRule | undefined>(
      (latest, row) =>
        row.facility === facility &&
        row.fiscal_year <= year &&
        (!latest || row.fiscal_year > latest.fiscal_year)
          ? row
          : latest,
      undefined,
    ),
  );
  const breaks = yearBreaks(rules, year);
  const closures = [...rules.annualClosures].sort(
    (a, b) => ((a.start_month + 8) % 12) - ((b.start_month + 8) % 12) || a.start_day - b.start_day,
  );
  const ended = lastEndedPeriodDate(periods);
  return (
    <div className="yearly-rules">
      {ended !== null && (
        <div className="notice info yearly-ended-notice">
          <Info size={22} />
          <span>
            終わったピリオド（{monthDay(ended)}
            まで）の日は、年間予定から直しても変わりません。修正したい場合はカレンダーから行ってください。
          </span>
        </div>
      )}
      <section className="yearly-section yearly-opening">
        <h2>
          <Clock size={22} />
          営業の時間（{fiscalYearLabel(year)}）
          <button
            className="btn btn-sub btn-small yearly-rule-action"
            type="button"
            onClick={() => setDialog({ kind: 'opening', year })}
          >
            <Pencil size={18} />
            編集
          </button>
        </h2>
        <table>
          <thead>
            <tr>
              <th />
              <th>平日</th>
              <th>繁忙期</th>
              <th>土曜</th>
              <th>受付開始から締めまで</th>
            </tr>
          </thead>
          <tbody>
            {opening.map((row, index) => (
              <tr key={index}>
                <th>
                  <FacilityBadge facility={facilities[index]} />
                </th>
                {(['normal', 'peak', 'saturday'] as const).map((kind) => (
                  <td key={kind}>
                    {row &&
                      `${shortTime(row[`${kind}_start_time`])}〜${shortTime(row[`${kind}_end_time`])}`}
                  </td>
                ))}
                <td>
                  {row &&
                    (row.arrival_end_mode === 'fixed_time'
                      ? `〜${row.arrival_end_time === null ? '' : shortTime(row.arrival_end_time)}`
                      : row.arrival_duration_minutes !== null
                        ? duration(row.arrival_duration_minutes)
                        : null)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="yearly-section">
        <h2>
          <Sun size={22} />
          繁忙期
          <button
            className="btn btn-sub btn-small yearly-rule-action"
            type="button"
            onClick={() => setDialog({ kind: 'break', year, before: null })}
          >
            <Plus size={18} />
            追加
          </button>
        </h2>
        {breaks.length ? (
          <div className="yearly-rule-rows yearly-breaks">
            {breaks.map((row) => (
              <div key={`${row.start_date}-${row.end_date}`}>
                <b>{row.name}</b>
                <span>{dateRange(row.start_date, row.end_date)}</span>
                <button
                  className="btn btn-sub btn-small"
                  type="button"
                  onClick={() => setDialog({ kind: 'break', year, before: { ...row } })}
                >
                  <Pencil size={18} />
                  編集
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="yearly-empty">まだ登録されていません</p>
        )}
      </section>
      <section className="yearly-section yearly-closure-section">
        <h2>
          <LockKeyhole size={22} />
          毎年の休業日
          <span className="yearly-count">
            <NumberUnits>{`${closures.length}件`}</NumberUnits>
          </span>
          <button
            className="btn btn-sub btn-small yearly-rule-action"
            type="button"
            onClick={() => setDialog({ kind: 'closure', year, before: null })}
          >
            <Plus size={18} />
            追加
          </button>
        </h2>
        {closures.length ? (
          <div className="yearly-rule-rows yearly-closures scrollbar-thin">
            {closures.map((row) => (
              <div key={`${row.start_month}-${row.start_day}-${row.end_month}-${row.end_day}`}>
                <span>{closureRange(row)}</span>
                <b>{row.name}</b>
                <button
                  className="btn btn-sub btn-small"
                  type="button"
                  onClick={() => setDialog({ kind: 'closure', year, before: { ...row } })}
                >
                  <Pencil size={18} />
                  編集
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="yearly-empty">まだ登録されていません</p>
        )}
      </section>
      {dialog?.kind === 'opening' && (
        <OpeningRulesDialog year={dialog.year} rules={rules} close={() => setDialog(null)} />
      )}
      {dialog?.kind === 'break' && (
        <PeakDialog
          year={dialog.year}
          before={dialog.before}
          rules={rules}
          calendar={calendar}
          close={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'closure' && (
        <AnnualClosureDialog
          year={dialog.year}
          before={dialog.before}
          close={() => setDialog(null)}
        />
      )}
    </div>
  );
}
