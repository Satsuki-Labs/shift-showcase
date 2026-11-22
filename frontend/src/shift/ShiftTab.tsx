import type { PeriodStaff } from '../../../shared/period-snapshot';
import './shift.css';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { motionMs } from '../parts/motion';
import { CalendarDays, ChevronLeft, ChevronRight, Clock, MessageSquare } from 'lucide-react';
import type {
  AnnualRules,
  PeriodSummary,
  ShiftBulkChangedData,
  Staff,
} from '../../../shared/protocol';
import { japanToday } from '../../../shared/staff';
import { LoadStatus } from '../loading/LoadStatus';
import { SelectBox } from '../parts/SelectBox';
import { RangeWell } from '../parts/RangeWell';
import { ShiftExcelExport } from './ShiftExcelExport';
import { PeriodLoadClient } from '../loading/period-client';
import { periodRules, requestViewNotice, tableStaff } from './model';
import { ShiftTable, type BudgetWarningSelection } from './ShiftTable';
import { CellDialog } from './CellDialog';
import { BulkDialog } from './BulkDialog';
import { useAppFrame } from '../app/context';
import { DayDialog } from '../yearly/DayDialog';
import { Segmented } from '../parts/Segmented';
import { RaisedPanel } from '../parts/RaisedPanel';
import { DailyTable, useDailyDrag } from './DailyTable';
import { initialDailyDate, type DailySelection, type ShiftView } from './daily-model';
import type { DateProblemSelection, DayProblems } from './date-problems';
import { useDismissOutside } from '../parts/useDismissOutside';
import { usePeriodArrival } from '../parts/usePeriodArrival';
import { dayLabel } from '../format/date';
import { periodChoice } from '../parts/periodChoice';
import { periodDates, periodOptions, periodStaff, selectedPeriod } from '../../../shared/period';
import { budgetOverages } from '../../../shared/pay';
import type { BulkContext } from './bulk-model';

const views = ['一覧', '日別', '希望'] as const;

function ShiftTables({ view, children }: { view: ShiftView; children: ReactNode }) {
  const [layers, setLayers] = useState<{
    view: ShiftView;
    content: ReactNode;
    previous: { view: ShiftView; content: ReactNode } | null;
    change: number;
  }>({ view, content: children, previous: null, change: 0 });
  const incoming = useRef<HTMLDivElement>(null);
  if (layers.view !== view || layers.content !== children) {
    setLayers({
      view,
      content: children,
      previous:
        layers.view !== view ? { view: layers.view, content: layers.content } : layers.previous,
      change: layers.change + (layers.view !== view ? 1 : 0),
    });
  }
  useLayoutEffect(() => {
    const node = incoming.current;
    if (!node || !layers.previous) return;
    node.style.transition = 'none';
    node.classList.remove('open');
    void node.offsetHeight;
    node.style.removeProperty('transition');
    node.classList.add('open');
    const finish = () =>
      setLayers((current) =>
        current.change === layers.change ? { ...current, previous: null } : current,
      );
    const ended = (event: TransitionEvent) => {
      if (event.target === node && event.propertyName === 'opacity') finish();
    };
    node.addEventListener('transitionend', ended);
    const timer = setTimeout(finish, motionMs(node, '--reveal-duration'));
    return () => {
      node.removeEventListener('transitionend', ended);
      clearTimeout(timer);
    };
  }, [layers.change]);
  return (
    <div className="shift-tables-switch">
      {layers.previous && (
        <div key={layers.previous.view} className="shift-tables-layer leaving" inert>
          {layers.previous.content}
        </div>
      )}
      <div
        key={layers.view}
        ref={incoming}
        className={`shift-tables-layer${layers.previous ? ' reveal' : ''}`}
      >
        {layers.content}
      </div>
    </div>
  );
}

export function ShiftTab({
  staff,
  periods,
  annualRules,
  periodId,
  selectPeriod,
  view,
  selectView,
  dailySelection,
  selectDaily,
  client,
  problems,
  warningRequest,
  warningOpened,
  openPay,
  bulkRequest,
  bulkOpened,
  openStaff,
}: {
  staff: readonly Staff[];
  periods: readonly PeriodSummary[];
  annualRules: AnnualRules;
  periodId: string | null;
  selectPeriod: (id: string | null) => void;
  view: ShiftView;
  selectView: (view: ShiftView) => void;
  dailySelection: DailySelection | null;
  selectDaily: (selection: DailySelection) => void;
  client: PeriodLoadClient;
  problems: readonly DayProblems[];
  warningRequest: DateProblemSelection | null;
  warningOpened: () => void;
  openPay: () => void;
  bulkRequest: { staffId: string; building: 1 | 2 } | null;
  bulkOpened: () => void;
  openStaff: (staffId: string, building: 1 | 2) => void;
}) {
  const today = japanToday(),
    period = selectedPeriod(periods, today, periodId);
  const [loading, setLoading] = useState(client.state);
  const [cell, setCell] = useState<{ person: PeriodStaff; date: string; building: 1 | 2 } | null>(
    null,
  );
  const [day, setDay] = useState<string | null>(null);
  const [bulkStaff, setBulkStaff] = useState<{
    person: PeriodStaff;
    building: 1 | 2;
    appear?: boolean;
    context: BulkContext;
  } | null>(() => {
    if (!bulkRequest || !period || loading.kind !== 'ready' || loading.data.periodId !== period.id)
      return null;
    const person = tableStaff(staff, period, bulkRequest.building, loading.data, today).find(
      (person) => person.id === bulkRequest.staffId,
    );
    return person
      ? {
          person,
          building: bulkRequest.building,
          appear: false,
          context: {
            person,
            period,
            periods,
            data: loading.data,
            rules: periodRules(annualRules, loading.data),
          },
        }
      : null;
  });
  const { saving, loading: frameLoading } = useAppFrame();
  useEffect(
    () =>
      saving?.subscribe((event) => {
        if (event.kind === 'saved' && event.operation === 'calendar.day.save' && period)
          void client.load(period.id, true);
        if (
          event.kind === 'saved' &&
          event.operation === 'shift.bulk.save' &&
          period &&
          client.state.kind === 'ready' &&
          client.state.data.periodId === period.id
        ) {
          for (const cell of (event.result.data as unknown as ShiftBulkChangedData).cells) {
            if (period.start_date <= cell.date && cell.date <= period.end_date) client.apply(cell);
          }
        }
      }),
    [saving, client, period],
  );
  const [warning, setWarning] = useState<DateProblemSelection | BudgetWarningSelection | null>(
    null,
  );
  useDismissOutside(
    Boolean(warning),
    (target) =>
      target instanceof Element && Boolean(target.closest('.date-warn, .budget-warn, .date-pop')),
    () => setWarning(null),
    { escape: true, scroll: true, preserveRevealScroll: Boolean(warning && 'date' in warning) },
  );
  const [arrival, setArrival] = useState<(DateProblemSelection & { periodId: string }) | null>(
    null,
  );
  useLayoutEffect(() => setArrival(null), [period?.id]);
  useLayoutEffect(() => setWarning(null), [period?.id, view]);
  useEffect(() => client.subscribe(setLoading), [client]);
  useEffect(() => {
    selectPeriod(period?.id ?? null);
  }, [period?.id, selectPeriod]);
  const date =
    period &&
    dailySelection?.periodId === period.id &&
    period.start_date <= dailySelection.date &&
    dailySelection.date <= period.end_date
      ? dailySelection.date
      : period
        ? initialDailyDate(period, today)
        : '';
  const dates = period ? periodDates(period) : [];
  const dailyDrag = useDailyDrag({
    periodId: period?.id,
    date,
    view,
    reload: (id) => (id === period?.id ? client.load(id, true) : Promise.resolve(undefined)),
  });
  useEffect(() => {
    if (period && (dailySelection?.periodId !== period.id || dailySelection.date !== date))
      selectDaily({ periodId: period.id, date });
  }, [period?.id, date, dailySelection, selectDaily]);
  useEffect(() => {
    if (period)
      void client.load(
        period.id,
        client.state.kind === 'ready' && client.state.data.periodId === period.id,
      );
    return () => client.cancel();
  }, [client, period?.id]);
  const ready = loading.kind === 'ready' && loading.data.periodId === period?.id;
  useEffect(() => {
    if (!bulkRequest) return;
    if (!period) {
      bulkOpened();
      return;
    }
    if (!ready || loading.kind !== 'ready') return;
    const person = tableStaff(staff, period, bulkRequest.building, loading.data, today).find(
      (person) => person.id === bulkRequest.staffId,
    );
    if (person)
      setBulkStaff({
        person,
        building: bulkRequest.building,
        appear: false,
        context: {
          person,
          period,
          periods,
          data: loading.data,
          rules: periodRules(annualRules, loading.data),
        },
      });
    bulkOpened();
  }, [bulkRequest, bulkOpened, staff, period, ready, loading, today]);
  const periodContent = usePeriodArrival(ready ? period!.id : null);
  const displayStaff =
    ready && period && loading.kind === 'ready' ? periodStaff(staff, period, loading.data) : staff;
  const displayRules =
    ready && loading.kind === 'ready' ? periodRules(annualRules, loading.data) : annualRules;
  const openBulk = (person: PeriodStaff, building: 1 | 2) => {
    if (period && ready && loading.kind === 'ready')
      setBulkStaff({
        person,
        building,
        context: { person, period, periods, data: loading.data, rules: displayRules },
      });
  };
  const overBudget = useMemo(
    () =>
      view === '一覧' && ready && period && loading.kind === 'ready'
        ? budgetOverages({ staff, period, periods, data: loading.data, today })
        : [],
    [view, ready, staff, period, periods, loading, today],
  );
  const requestNotice = period && view === '希望' ? requestViewNotice(period) : null;
  const switcher = (
    <Segmented
      value={view}
      options={views}
      onChange={(next) => {
        setArrival(null);
        selectView(next);
      }}
      prefix={(option) =>
        option === '一覧' ? (
          <CalendarDays size={20} strokeWidth={2.2} />
        ) : option === '日別' ? (
          <Clock size={20} strokeWidth={2.2} />
        ) : (
          <MessageSquare size={20} strokeWidth={2.2} />
        )
      }
    />
  );
  const dateNav =
    period && view === '日別' ? (
      <div className="daily-date-nav">
        <button
          type="button"
          className="icon-button step"
          disabled={date === period.start_date}
          onClick={() => {
            setArrival(null);
            selectDaily({ periodId: period.id, date: dates[dates.indexOf(date) - 1] });
          }}
        >
          <ChevronLeft size={22} strokeWidth={2.6} />
        </button>
        <SelectBox
          selectedAtStart
          value={date}
          options={dates.map((value) => ({ value, label: dayLabel(value) }))}
          onChange={(date) => {
            setArrival(null);
            selectDaily({ periodId: period.id, date });
          }}
        />
        <button
          type="button"
          className="icon-button step"
          disabled={date === period.end_date}
          onClick={() => {
            setArrival(null);
            selectDaily({ periodId: period.id, date: dates[dates.indexOf(date) + 1] });
          }}
        >
          <ChevronRight size={22} strokeWidth={2.6} />
        </button>
      </div>
    ) : null;
  const table = (building: 1 | 2) =>
    period ? (
      view !== '日別' ? (
        <ShiftTable
          building={building}
          requestView={view === '希望'}
          staff={displayStaff}
          period={period}
          periods={periods}
          data={ready && loading.kind === 'ready' ? loading.data : null}
          rules={displayRules}
          today={today}
          role={frameLoading.kind === 'ready' ? frameLoading.data.identity.role : 'maintenance'}
          problems={ready ? problems : []}
          warning={warning && 'date' in warning ? warning : null}
          selectWarning={setWarning}
          warningRequest={warningRequest}
          warningOpened={warningOpened}
          overBudget={overBudget}
          budgetWarning={warning && 'staffId' in warning ? warning : null}
          selectBudgetWarning={setWarning}
          openPay={() => {
            setWarning(null);
            openPay();
          }}
          openDaily={(date) => {
            setWarning(null);
            setArrival({ periodId: period.id, date, building });
            selectDaily({ periodId: period.id, date });
            selectView('日別');
          }}
          openDay={setDay}
          openBulk={openBulk}
          openCell={(person, date, building) => setCell({ person, date, building })}
        />
      ) : (
        <DailyTable
          building={building}
          staff={displayStaff}
          period={period}
          periods={periods}
          data={ready && loading.kind === 'ready' ? dailyDrag.preview(loading.data) : null}
          rules={displayRules}
          today={today}
          date={date}
          drag={dailyDrag}
          arrive={
            arrival?.periodId === period.id &&
            arrival.date === date &&
            arrival.building === building
          }
          role={frameLoading.kind === 'ready' ? frameLoading.data.identity.role : 'maintenance'}
          openBulk={openBulk}
          openCell={(person, date, building) => setCell({ person, date, building })}
        />
      )
    ) : null;
  return (
    <div className="shift-tab">
      <div className="tab-toolbar">
        <h1>シフト入力</h1>
        {period && (
          <RangeWell
            period={
              <>
                {period.start_date} 〜 {period.end_date}（{dates.length}日間）
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
          <ShiftExcelExport
            staff={staff}
            period={period}
            periods={periods}
            data={ready && loading.kind === 'ready' ? loading.data : null}
            rules={annualRules}
            client={client}
            today={today}
          />
        )}
      </div>
      {!period ? (
        <div className="shift-no-periods empty-state">ピリオドが登録されていません</div>
      ) : (
        <>
          {requestNotice && (
            <div className="notice info request-view-note">
              <svg width="26" height="26" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10" fill="var(--text-sub)" />
                <path
                  d="M12 11v6"
                  stroke="var(--surface)"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                />
                <circle cx="12" cy="7.4" r="1.4" fill="var(--surface)" />
              </svg>
              <span>{requestNotice}</span>
            </div>
          )}
          <div
            key={period.id}
            ref={periodContent}
            className="shift-tables"
            inert={!ready && loading.kind !== 'unreachable'}
          >
            <RaisedPanel
              className={`shift-panel${view !== '日別' ? ' shift-list-panel' : ''}`}
              back
              left={switcher}
              actions={dateNav}
              raised="navy"
              padding={false}
              bandSelector=".shift-tables-layer:not(.leaving) .shift-table-section > .band"
            >
              {loading.kind !== 'unreachable' ? (
                <ShiftTables view={view}>{table(1)}</ShiftTables>
              ) : (
                <LoadStatus
                  state={{ kind: 'unreachable' }}
                  reload={() => {
                    void client.load(period.id);
                  }}
                />
              )}
            </RaisedPanel>
            {loading.kind !== 'unreachable' && (
              <ShiftTables view={view}>
                {view === '日別' ? (
                  <RaisedPanel
                    className="shift-panel shift-second-panel"
                    left={null}
                    actions={dateNav}
                    raised="navy"
                    padding={false}
                    bandSelector=".shift-table-section > .band"
                  >
                    {table(2)}
                  </RaisedPanel>
                ) : (
                  <div className="shift-second-frame">{table(2)}</div>
                )}
              </ShiftTables>
            )}
          </div>
        </>
      )}
      {dailyDrag.controls}
      {cell && period && loading.kind === 'ready' && (
        <CellDialog
          context={{
            ...cell,
            person: displayStaff.find((person) => person.id === cell.person.id) ?? cell.person,
            period,
            periods,
            data: loading.data,
            rules: displayRules,
          }}
          close={() => setCell(null)}
          reload={() => client.load(period.id, true)}
        />
      )}
      {day && period && loading.kind === 'ready' && (
        <DayDialog
          key={day}
          date={day}
          data={loading.data}
          rules={annualRules}
          close={() => setDay(null)}
          reload={() => client.load(period.id, true)}
        />
      )}
      {bulkStaff && period && loading.kind === 'ready' && (
        <BulkDialog
          key={`${period.id}-${bulkStaff.person.id}-${bulkStaff.building}`}
          context={bulkStaff.context}
          target={bulkStaff.building}
          appear={bulkStaff.appear}
          close={() => setBulkStaff(null)}
          reload={() => client.load(period.id, true)}
          openStaff={() => {
            setBulkStaff(null);
            openStaff(bulkStaff.person.id, bulkStaff.building);
          }}
        />
      )}
    </div>
  );
}
