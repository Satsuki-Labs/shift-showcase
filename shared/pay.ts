import type { PeriodLoadResponse, PeriodSummary, Staff, StaffHistory, WorkSlot } from './protocol';
import { currentEmploymentStatus, historyForPeriod } from './staff';
import { periodStaff } from './period';
import type { PeriodStaff } from './period-snapshot';

export interface PeriodPayInput {
  period: Pick<PeriodSummary, 'start_date' | 'end_date'>;
  periods: readonly Pick<PeriodSummary, 'id' | 'start_date'>[];
  staff: readonly Pick<Staff, 'id' | 'history'>[];
  data: Pick<PeriodLoadResponse, 'dayStates' | 'workSlots'>;
}
export type PayDay = { date: string; minutes: number; amount: number } & (
  { kind: 'work'; work: WorkSlot[] } | { kind: 'paid_leave'; noAverage?: true }
);
export interface PersonPay extends Pick<
  StaffHistory,
  'staff_id' | 'employment_type' | 'quarter_hour_pay' | 'budget'
> {
  workDays: number;
  paidLeaveDays: number;
  workMinutes: number;
  amount: number;
  over: number;
  days: PayDay[];
}
export interface PayTotals {
  amount: number;
  budget: number;
  over: number;
  workMinutes: number;
}
interface PeriodPayResult {
  people: PersonPay[];
  all: PayTotals;
}

export function workMinutes(work: readonly WorkSlot[]): number {
  const minutes = (time: string): number => {
    const [hours, minutes] = time.split(':').map(Number);
    return hours * 60 + minutes;
  };
  return work.reduce(
    (total, row) =>
      total +
      row.slots.reduce((sum, slot) => sum + minutes(slot.end_time) - minutes(slot.start_time), 0),
    0,
  );
}

function totals(people: readonly PersonPay[]): PayTotals {
  const amount = people.reduce((sum, person) => sum + person.amount, 0);
  const budget = people.reduce((sum, person) => sum + person.budget, 0);
  const workMinutes = people.reduce((sum, person) => sum + person.workMinutes, 0);
  return { amount, budget, over: Math.max(0, amount - budget), workMinutes };
}

export function periodPay({ period, periods, staff, data }: PeriodPayInput): PeriodPayResult {
  const inPeriod = (date: string): boolean => period.start_date <= date && date <= period.end_date;
  const work = data.workSlots.filter((row) => inPeriod(row.date));
  const paidLeave = data.dayStates.filter(
    (row) => inPeriod(row.date) && row.status === 'paid_leave',
  );
  const people = staff.map((person): PersonPay => {
    const history = historyForPeriod(person.history, periods, period.start_date)!;
    const { employment_type, quarter_hour_pay, budget } = history;
    const workByDate = new Map<string, WorkSlot[]>();
    for (const row of work.filter((row) => row.staff_id === person.id)) {
      const rows = workByDate.get(row.date) ?? [];
      rows.push(row);
      workByDate.set(row.date, rows);
    }
    const days: PayDay[] = [...workByDate].map(([date, rows]) => {
      const minutes = workMinutes(rows);
      return {
        date,
        kind: 'work',
        minutes,
        amount: Math.round((minutes * quarter_hour_pay) / 15),
        work: rows,
      };
    });
    const workDays = days.length;
    const totalMinutes = days.reduce((sum, day) => sum + day.minutes, 0);
    const noAverage = employment_type !== 'full_time' && workDays === 0;
    const leaveMinutes =
      employment_type === 'full_time' ? 480 : workDays === 0 ? 0 : totalMinutes / workDays;
    const leaveDays = paidLeave.filter((row) => row.staff_id === person.id);
    for (const row of leaveDays) {
      days.push({
        date: row.date,
        kind: 'paid_leave',
        minutes: Math.round(leaveMinutes),
        amount: Math.round((leaveMinutes * quarter_hour_pay) / 15),
        ...(noAverage ? { noAverage: true as const } : {}),
      });
    }
    days.sort((left, right) => left.date.localeCompare(right.date));
    const amount = days.reduce((sum, day) => sum + day.amount, 0);
    return {
      staff_id: person.id,
      employment_type,
      quarter_hour_pay,
      budget,
      workDays,
      paidLeaveDays: leaveDays.length,
      workMinutes: totalMinutes,
      amount,
      over: Math.max(0, amount - budget),
      days,
    };
  });
  return {
    people,
    all: totals(people),
  };
}

export function payStaff(
  staff: readonly Staff[],
  period: PeriodSummary | null,
  data: PeriodLoadResponse | null,
  today: string,
): PeriodStaff[] {
  const asOf = period && period.end_date < today ? period.end_date : today;
  const inPeriod = (date: string) =>
    period !== null && period.start_date <= date && date <= period.end_date;
  return (period && data ? periodStaff(staff, period, data) : staff)
    .filter(
      (person) =>
        currentEmploymentStatus(person, asOf) === 'active' ||
        data?.workSlots.some((row) => row.staff_id === person.id && inPeriod(row.date)) ||
        data?.dayStates.some(
          (row) => row.staff_id === person.id && inPeriod(row.date) && row.status === 'paid_leave',
        ),
    )
    .sort((a, b) => a.sort_order - b.sort_order);
}

export function budgetOverages({
  staff,
  period,
  periods,
  data,
  today,
}: {
  staff: readonly Staff[];
  period: PeriodSummary;
  periods: readonly PeriodSummary[];
  data: PeriodLoadResponse;
  today: string;
}) {
  const people = payStaff(staff, period, data, today);
  return periodPay({ staff: people, period, periods, data })
    .people.filter((person) => person.over >= 1)
    .sort((a, b) => b.over - a.over)
    .map(({ staff_id, amount, budget, over }) => ({
      staff_id,
      name: people.find((person) => person.id === staff_id)!.name,
      amount,
      budget,
      over,
    }));
}

export type BudgetOverage = ReturnType<typeof budgetOverages>[number];
