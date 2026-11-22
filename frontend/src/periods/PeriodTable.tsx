import { useMemo } from 'react';
import { CalendarDays, LockKeyhole, MessageSquare, Pencil } from 'lucide-react';
import type { PeriodSummary } from '../../../shared/protocol';
import { japanToday } from '../../../shared/staff';
import { Reveal } from '../parts/Reveal';
import { containsToday, dayCount, requestClosedDate, requestState } from './model';
import { RequestQrIcon } from './UrlDialog';
import { monthDay } from '../format/date';
import { NumberUnits } from '../parts/NumberUnits';

export function PeriodTable({
  periods,
  edit,
  showUrl,
}: {
  periods: PeriodSummary[];
  edit: (period: PeriodSummary) => void;
  showUrl: (period: PeriodSummary) => void;
}) {
  const today = japanToday();
  const rows = useMemo(
    () =>
      [...periods]
        .sort((a, b) => b.start_date.localeCompare(a.start_date))
        .map((period) => {
          const current = containsToday(period, today);
          const state = requestState(period, today);
          const kind = state === 'none' ? 'none' : state === 'open' ? 'open' : 'closed';
          const text =
            kind === 'none'
              ? '未定'
              : kind === 'open'
                ? `受付中：${monthDay(period.request_deadline_date!)}まで`
                : monthDay(requestClosedDate(period));
          return {
            key: period.id,
            content: (
              <div className={`period-row${current ? ' period-current' : ''}`}>
                <div className="period-name">
                  <b>{period.name}</b>
                  {current && <span className="period-now">期間中</span>}
                </div>
                <div className="period-row-dates">
                  {period.start_date} 〜 {period.end_date}
                </div>
                <div>
                  <b className="period-days">
                    <NumberUnits>{`${dayCount(period.start_date, period.end_date)}日間`}</NumberUnits>
                  </b>
                </div>
                <div className="l">
                  <span className={`period-deadline ${kind}`}>
                    {kind === 'open' && <MessageSquare size={16} strokeWidth={2.4} />}
                    {kind === 'closed' && <LockKeyhole size={16} strokeWidth={2.4} />}
                    {text}
                  </span>
                </div>
                <div className="period-actions">
                  {state === 'open' && (
                    <button
                      className="btn btn-sub btn-small"
                      type="button"
                      onClick={() => showUrl(period)}
                    >
                      <RequestQrIcon size={18} />
                      URL
                    </button>
                  )}
                  <button
                    className="btn btn-sub btn-small"
                    type="button"
                    onClick={() => edit(period)}
                  >
                    <Pencil size={18} strokeWidth={2.2} />
                    編集
                  </button>
                </div>
              </div>
            ),
          };
        }),
    [periods, today, edit, showUrl],
  );
  const empty = useMemo(
    () => [
      { key: 'empty', content: <div className="staff-empty">ピリオドが登録されていません</div> },
    ],
    [],
  );
  return (
    <section className="period-list">
      <header className="band nv">
        <CalendarDays size={22} strokeWidth={2.4} />
        <b>ピリオド</b>
        <span>
          <NumberUnits>{`${periods.length}件`}</NumberUnits>
        </span>
      </header>
      <div>
        <div className="period-row head list-head">
          {['ピリオド', '期間', '日数', '希望の締め切り', ''].map((label, index) => (
            <div key={index} className={index === 0 || index === 3 ? 'l' : ''}>
              {label}
            </div>
          ))}
        </div>
        <Reveal items={rows.length ? rows : empty} />
      </div>
    </section>
  );
}
