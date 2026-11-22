import type { PeriodLoadResponse, PeriodSummary, ShiftCellChangedData } from './protocol';
import { dateRange } from './date';
import type { PeriodStaff } from './period-snapshot';

export function containsToday(
  period: Pick<PeriodSummary, 'start_date' | 'end_date'>,
  today: string,
) {
  return period.start_date <= today && today <= period.end_date;
}
export function periodOptions(periods: readonly PeriodSummary[]): PeriodSummary[] {
  return [...periods].sort((a, b) => b.start_date.localeCompare(a.start_date));
}
export function selectedPeriod(
  periods: readonly PeriodSummary[],
  today: string,
  selected: string | null = null,
): PeriodSummary | undefined {
  return (
    periods.find((row) => row.id === selected) ??
    periods.find((row) => row.start_date <= today && today <= row.end_date) ??
    periodOptions(periods)[0]
  );
}
export function periodDates(period: Pick<PeriodSummary, 'start_date' | 'end_date'>): string[] {
  return dateRange(period.start_date, period.end_date);
}
export function periodStaff(
  staff: readonly PeriodStaff[],
  period: PeriodSummary,
  data: PeriodLoadResponse,
): readonly PeriodStaff[] {
  if (!data.snapshot) return staff;
  const current = new Map(staff.map((person) => [person.id, person]));
  const inPeriod = (date: string) => period.start_date <= date && date <= period.end_date;
  return data.snapshot.staff
    .filter(
      (person) =>
        current.has(person.id) ||
        data.workSlots.some((row) => row.staff_id === person.id && inPeriod(row.date)) ||
        data.dayStates.some(
          (row) =>
            row.staff_id === person.id &&
            inPeriod(row.date) &&
            ['paid_leave', 'empty'].includes(row.status),
        ),
    )
    .map((person) => ({ ...person, revision: current.get(person.id)?.revision ?? null }));
}

export function applyCellData(
  data: PeriodLoadResponse,
  changed: ShiftCellChangedData,
): PeriodLoadResponse {
  const other = (row: { staff_id: string; date: string }) =>
    row.staff_id !== changed.staff_id || row.date !== changed.date;
  return {
    ...data,
    dayStates: [...data.dayStates.filter(other), ...(changed.dayState ? [changed.dayState] : [])],
    workSlots: [...data.workSlots.filter(other), ...changed.workSlots],
  };
}
