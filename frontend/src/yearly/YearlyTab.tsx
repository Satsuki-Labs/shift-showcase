import './yearly.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CalendarCog, CalendarDays, ChevronLeft, ChevronRight, List, Plus } from 'lucide-react';
import {
  fiscalYearEnd,
  fiscalYearLabel,
  fiscalYearOf,
  fiscalYearStart,
  selectableFiscalYears,
} from '../../../shared/calendar';
import type { AnnualRules, CalendarRows, PeriodSummary } from '../../../shared/protocol';
import { japanToday } from '../../../shared/staff';
import { LoadStatus } from '../loading/LoadStatus';
import { useAppFrame } from '../app/context';
import { useLoadingIndicator } from '../loading/useLoadingIndicator';
import { usePeriodArrival } from '../parts/usePeriodArrival';
import { Segmented } from '../parts/Segmented';
import { SelectBox } from '../parts/SelectBox';
import { RangeWell } from '../parts/RangeWell';
import { Calendar } from './Calendar';
import { AddEventsDialog } from './AddEventsDialog';
import { DayDialog } from './DayDialog';
import { EventList } from './EventList';
import { YearLoadClient } from './client';
import { Rules } from './Rules';
import { YearlyPanel } from './YearlyPanel';

const views = ['カレンダー', '行事一覧', '年間予定'] as const;
function initialMonth(year: number, today: string): string {
  return fiscalYearOf(today) === year ? today.slice(0, 7) : `${year}-04`;
}
export function YearlyTab({
  annualRules,
  periods,
}: {
  annualRules: AnnualRules;
  periods: readonly PeriodSummary[];
}) {
  const { saving, subscribeRefresh, checkChange } = useAppFrame();
  const today = japanToday();
  const [year, setYear] = useState(fiscalYearOf(today));
  const [month, setMonth] = useState(() => initialMonth(year, today));
  const [scrollMonth, setScrollMonth] = useState<string | null>(null);
  const [view, setView] = useState<(typeof views)[number]>('カレンダー');
  const viewContent = usePeriodArrival(view);
  const [client] = useState(() => new YearLoadClient());
  const [loading, setLoading] = useState(client.state);
  const showLoading = useLoadingIndicator(loading.kind === 'loading' ? loading : null);
  const [date, setDate] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const openDay = useCallback((next: string) => setDate(next), []);
  const closeDay = useCallback(() => setDate(null), []);
  const closeAdd = useCallback(() => setAdding(false), []);
  const reload = useCallback(
    (date?: string) => {
      const targetYear = date ? fiscalYearOf(date) : year;
      return targetYear === year ? client.load(year) : new YearLoadClient().load(targetYear);
    },
    [client, year],
  );
  const lastMonth = useRef(month);
  useEffect(() => client.subscribe(setLoading), [client]);
  useEffect(
    () => subscribeRefresh(() => client.load(year, true)),
    [client, year, subscribeRefresh],
  );
  useEffect(
    () =>
      saving?.subscribe((event) => {
        if (
          event.kind !== 'saved' ||
          !['calendar.day.save', 'calendar.days.save'].includes(event.operation)
        )
          return;
        const dates = event.result.revisions.flatMap(({ target }) =>
          target.unit === 'building-day' ? [target.date] : [],
        );
        client.applyDays(dates, event.result.data as unknown as CalendarRows);
      }),
    [client, saving],
  );
  useEffect(() => {
    void client.load(year);
    checkChange();
    return () => client.cancel();
  }, [client, year, checkChange]);
  if (loading.year === year) lastMonth.current = month;
  const shownMonth = loading.year === year ? month : lastMonth.current;
  const options = useMemo(
    () =>
      selectableFiscalYears(today).map((value) => ({
        value: String(value),
        label: fiscalYearLabel(value),
      })),
    [today],
  );
  const monthOptions = useMemo(
    () =>
      Array.from({ length: 12 }, (_, index) => {
        const date = new Date(Date.UTC(year, index + 3, 1));
        return {
          value: date.toISOString().slice(0, 7),
          label: `${date.getUTCFullYear()}年${date.getUTCMonth() + 1}月`,
        };
      }),
    [year],
  );
  const content = useMemo(
    () =>
      view === '年間予定' ? (
        <Rules
          year={year}
          rules={annualRules}
          periods={periods}
          calendar={{ data: loading.data, reload }}
        />
      ) : loading.data ? (
        view === '行事一覧' ? (
          <EventList data={loading.data} edit={openDay} />
        ) : (
          <Calendar
            month={shownMonth}
            data={loading.data}
            rules={annualRules}
            scrollMonth={scrollMonth}
            openDay={openDay}
          />
        )
      ) : null,
    [view, year, annualRules, periods, loading.data, shownMonth, scrollMonth, openDay, reload],
  );
  const first = new Date(`${month}-01T00:00:00Z`);
  const selectMonth = (next: string) => {
    setScrollMonth(next);
    setMonth(next);
  };
  const move = (amount: number) => {
    const next = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + amount, 1))
      .toISOString()
      .slice(0, 7);
    if (next < `${year}-04` || next > `${year + 1}-03`) return;
    selectMonth(next);
  };
  return (
    <div className="yearly-tab">
      <div className="tab-toolbar">
        <h1>年間予定</h1>
        <RangeWell
          period={
            <>
              {fiscalYearStart(year)} 〜 {fiscalYearEnd(year)}
            </>
          }
        >
          <SelectBox
            value={String(year)}
            options={options}
            onChange={(value) => {
              const next = Number(value);
              setScrollMonth(null);
              setYear(next);
              setMonth(initialMonth(next, today));
            }}
          />
        </RangeWell>
      </div>
      <YearlyPanel
        view={view}
        switcher={
          <Segmented
            value={view}
            options={views}
            onChange={(value) => {
              setScrollMonth(null);
              setView(value);
            }}
            prefix={(option) =>
              option === 'カレンダー' ? (
                <CalendarDays size={20} strokeWidth={2.2} />
              ) : option === '行事一覧' ? (
                <List size={20} strokeWidth={2.2} />
              ) : (
                <CalendarCog size={20} strokeWidth={2.2} />
              )
            }
          />
        }
        actions={
          view === 'カレンダー' ? (
            <div className="yearly-month-nav">
              <button
                className="icon-button step"
                aria-disabled={month === `${year}-04`}
                onClick={() => move(-1)}
              >
                <ChevronLeft size={22} strokeWidth={2.6} />
              </button>
              <div className="yearly-month-label">
                <SelectBox
                  value={month}
                  options={monthOptions}
                  selectedAtStart
                  onChange={selectMonth}
                />
              </div>
              <button
                className="icon-button step"
                aria-disabled={month === `${year + 1}-03`}
                onClick={() => move(1)}
              >
                <ChevronRight size={22} strokeWidth={2.6} />
              </button>
            </div>
          ) : view === '行事一覧' ? (
            <button
              className="btn btn-main"
              type="button"
              disabled={!loading.data || loading.kind !== 'ready'}
              onClick={() => setAdding(true)}
            >
              <Plus size={22} />
              行事を追加
            </button>
          ) : null
        }
      >
        <div className="yearly-content">
          {loading.kind === 'unreachable' && view !== '年間予定' ? (
            <LoadStatus
              state={{ kind: 'unreachable' }}
              reload={() => {
                void client.load(year);
              }}
            />
          ) : (
            <>
              <div ref={viewContent}>{content}</div>
              {loading.kind === 'loading' && showLoading && (
                <div className="yearly-loading">
                  <span className="spinner dark" />
                </div>
              )}
            </>
          )}
        </div>
      </YearlyPanel>
      {date && loading.data && (
        <DayDialog
          key={date}
          date={date}
          data={loading.data}
          rules={annualRules}
          close={closeDay}
          reload={() => client.load(year)}
        />
      )}
      {adding && loading.data && (
        <AddEventsDialog
          year={year}
          data={loading.data}
          rules={annualRules}
          close={closeAdd}
          reload={() => client.load(year)}
        />
      )}
    </div>
  );
}
