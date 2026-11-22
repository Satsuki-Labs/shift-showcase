import './parts/controls.css';
import './loading/LoadStatus.css';
import './parts/Dialog.css';
import './parts/Reveal.css';
import './parts/SelectBox.css';
import './parts/TimeField.css';
import './parts/DateField.css';
import './parts/Popup.css';
import './parts/Segmented.css';
import './parts/ConfirmDialog.css';
import './parts/FacilityCircle.css';
import './parts/TimeBar.css';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppFrameProvider, useAppFrame } from './app/context';
import { Frame, type ClosingNotification, type Tab } from './frame/Frame';
import { budgetNotification } from './frame/budget-notice';
import { LoadStatus } from './loading/LoadStatus';
import { PeriodLoadClient } from './loading/period-client';
import { StaffTab } from './staff/StaffTab';
import { YearlyTab } from './yearly/YearlyTab';
import { PeriodTab } from './periods/PeriodTab';
import { ShiftTab } from './shift/ShiftTab';
import { PayTab } from './pay/PayTab';
import type { DailySelection, ShiftView } from './shift/daily-model';
import { periodDateProblems, type DateProblemSelection } from './shift/date-problems';
import type { PeriodLoadResponse, ShiftCellChangedData } from '../../shared/protocol';
import { selectedPeriod } from '../../shared/period';
import { japanToday } from '../../shared/staff';

function Screens() {
  const { loading, reload, checkChange, subscribeRefresh, saving } = useAppFrame();
  const [selected, setSelected] = useState<Tab>('shift');
  const [skipNavTransition, setSkipNavTransition] = useState(false);
  const [shiftPeriodId, setShiftPeriodId] = useState<string | null>(null);
  const [shiftView, setShiftView] = useState<ShiftView>('一覧');
  const [shiftDailySelection, setShiftDailySelection] = useState<DailySelection | null>(null);
  const [shiftClient] = useState(() => new PeriodLoadClient());
  const [shiftData, setShiftData] = useState<PeriodLoadResponse | null>(null);
  const [shiftWarningRequest, setShiftWarningRequest] = useState<DateProblemSelection | null>(null);
  const warningOpened = useCallback(() => setShiftWarningRequest(null), []);
  const [bulkStaffRoute, setBulkStaffRoute] = useState<{
    staffId: string;
    building: 1 | 2;
    destination: 'staff' | 'shift';
  } | null>(null);
  const bulkOpened = useCallback(() => setBulkStaffRoute(null), []);
  const openBulkStaff = (staffId: string, building: 1 | 2) => {
    setBulkStaffRoute({ staffId, building, destination: 'staff' });
    setSkipNavTransition(true);
    setSelected('staff');
    checkChange();
  };
  const finishBulkStaff = useCallback(
    (reopen: boolean) => {
      setBulkStaffRoute((current) =>
        reopen && current ? { ...current, destination: 'shift' } : null,
      );
      if (reopen) {
        setSkipNavTransition(true);
        setSelected('shift');
        checkChange();
      }
    },
    [checkChange],
  );
  const [today, setToday] = useState(japanToday);
  const period =
    loading.kind === 'ready'
      ? selectedPeriod(loading.data.periods, today, shiftPeriodId)
      : undefined;
  useEffect(
    () =>
      (selected === 'shift' || selected === 'salary') && period
        ? subscribeRefresh(() => shiftClient.load(period.id, true))
        : undefined,
    [selected, period?.id, shiftClient, subscribeRefresh],
  );
  useEffect(() => {
    checkChange();
  }, [selected, period?.id, checkChange]);
  useEffect(
    () =>
      shiftClient.subscribe((state) => {
        if (state.kind === 'ready') setShiftData(state.data);
      }),
    [shiftClient],
  );
  useEffect(
    () =>
      saving?.subscribe((event) => {
        if (event.kind !== 'saved' || shiftClient.state.kind !== 'ready') return;
        const loadedId = shiftClient.state.data.periodId;
        if (['shift.cell.save', 'shift.cell.cancel'].includes(event.operation)) {
          const changed = event.result.data as unknown as ShiftCellChangedData;
          const loadedPeriod =
            loading.kind === 'ready'
              ? loading.data.periods.find((row) => row.id === loadedId)
              : undefined;
          if (
            loadedPeriod &&
            loadedPeriod.start_date <= changed.date &&
            changed.date <= loadedPeriod.end_date
          )
            shiftClient.apply(changed);
        }
      }),
    [saving, shiftClient, loading],
  );
  const shiftProblems = useMemo(() => {
    const period =
      loading.kind === 'ready'
        ? selectedPeriod(loading.data.periods, today, shiftPeriodId)
        : undefined;
    return loading.kind === 'ready' && period && shiftData?.periodId === period.id
      ? periodDateProblems({
          period,
          periods: loading.data.periods,
          staff: loading.data.staff,
          rules: loading.data.annualRules,
          data: shiftData,
        })
      : { days: [], closing: [] };
  }, [loading, today, shiftPeriodId, shiftData]);
  const budget = useMemo(() => {
    const period =
      loading.kind === 'ready'
        ? selectedPeriod(loading.data.periods, today, shiftPeriodId)
        : undefined;
    return loading.kind === 'ready' && period && shiftData?.periodId === period.id
      ? budgetNotification({
          period,
          periods: loading.data.periods,
          staff: loading.data.staff,
          data: shiftData,
          today,
        })
      : null;
  }, [loading, today, shiftPeriodId, shiftData]);
  useEffect(() => {
    const timer = setInterval(() => setToday(japanToday()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const selectTab = (id: Tab) => {
    if (selected !== id) {
      setBulkStaffRoute(null);
      setSkipNavTransition(false);
      setSelected(id);
      checkChange();
    }
  };
  const selectClosing = (item: ClosingNotification) => {
    setBulkStaffRoute(null);
    setSkipNavTransition(false);
    setSelected('shift');
    setShiftView('一覧');
    setShiftWarningRequest(item);
    if (selected !== 'shift') checkChange();
  };
  if (loading.kind === 'unregistered')
    return (
      <main className="load-page">
        <LoadStatus state={loading} reload={reload} />
      </main>
    );
  return (
    <Frame
      selected={selected}
      selectTab={selectTab}
      skipNavTransition={skipNavTransition}
      closing={shiftProblems.closing}
      budget={budget}
      selectClosing={selectClosing}
      selectBudget={() => selectTab('salary')}
    >
      {loading.kind === 'ready' && selected === 'staff' ? (
        <StaffTab
          staff={loading.data.staff}
          initialStaffId={
            bulkStaffRoute?.destination === 'staff' ? bulkStaffRoute.staffId : undefined
          }
          finishBulkEdit={finishBulkStaff}
        />
      ) : loading.kind === 'ready' && selected === 'shift' ? (
        <ShiftTab
          staff={loading.data.staff}
          periods={loading.data.periods}
          annualRules={loading.data.annualRules}
          periodId={shiftPeriodId}
          selectPeriod={setShiftPeriodId}
          view={shiftView}
          selectView={setShiftView}
          dailySelection={shiftDailySelection}
          selectDaily={setShiftDailySelection}
          client={shiftClient}
          problems={shiftProblems.days}
          warningRequest={shiftWarningRequest}
          warningOpened={warningOpened}
          bulkRequest={bulkStaffRoute?.destination === 'shift' ? bulkStaffRoute : null}
          bulkOpened={bulkOpened}
          openStaff={openBulkStaff}
          openPay={() => selectTab('salary')}
        />
      ) : loading.kind === 'ready' && selected === 'salary' ? (
        <PayTab
          staff={loading.data.staff}
          periods={loading.data.periods}
          periodId={shiftPeriodId}
          selectPeriod={setShiftPeriodId}
          client={shiftClient}
        />
      ) : loading.kind === 'ready' && selected === 'period' ? (
        <PeriodTab periods={loading.data.periods} staff={loading.data.staff} />
      ) : loading.kind === 'ready' && selected === 'yearly' ? (
        <YearlyTab annualRules={loading.data.annualRules} periods={loading.data.periods} />
      ) : (
        <LoadStatus state={loading} reload={reload} />
      )}
    </Frame>
  );
}

export default function App() {
  return (
    <AppFrameProvider>
      <Screens />
    </AppFrameProvider>
  );
}
