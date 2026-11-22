import type { PeriodSummary, Staff } from '../../../shared/protocol';
import { japanToday } from '../../../shared/staff';
import { historyChanges, type HistoryField, type SinceSelections, type StaffForm } from './model';
import { slashMonthDay } from '../format/date';
import { containsToday } from '../../../shared/period';
import { periodChoice } from '../parts/periodChoice';

export const historyNames: Record<HistoryField, string> = {
  quarter_hour_pay: '15分給',
  employment_type: '雇用区分',
  qualification: '資格',
  budget: '予算',
};
export interface SinceChange {
  field: HistoryField;
  label: string;
}
export function sinceChanges(
  form: StaffForm,
  original: Staff | undefined,
  periods: readonly PeriodSummary[],
  kept: readonly HistoryField[] = [],
): SinceChange[] {
  if (!original || !periods.length) return [];
  return historyChanges(form, original, kept).map((field) => ({
    field,
    label: historyNames[field],
  }));
}
export function appliedSince(person: Staff, field: HistoryField) {
  let index = person.history.length - 1;
  while (index > 0 && person.history[index - 1][field] === person.history[index][field]) index--;
  return person.history[index].since;
}
export function orderSinceChanges(
  changes: readonly SinceChange[],
  order: readonly HistoryField[],
): SinceChange[] {
  return [
    ...order.flatMap((field) => changes.filter((change) => change.field === field)),
    ...changes.filter((change) => !order.includes(change.field)),
  ];
}
export function sinceOptions(periods: readonly PeriodSummary[], today = japanToday()) {
  return periods
    .filter((period) => period.end_date >= today)
    .sort((a, b) => b.start_date.localeCompare(a.start_date))
    .map((period) => ({ ...periodChoice(period, today), short: period.name }));
}
export function sincePeriodParts(period: PeriodSummary, today = japanToday()) {
  return [
    period.name,
    ' ',
    slashMonthDay(period.start_date),
    '〜',
    slashMonthDay(period.end_date),
    ...(containsToday(period, today) ? ['（今日を含む）'] : []),
  ];
}
export type SinceProblem = 'missing_since';
export function pendingSinceField(
  changes: readonly SinceChange[],
  selections: SinceSelections,
  periods: readonly PeriodSummary[],
  today = japanToday(),
): HistoryField | null {
  const options = sinceOptions(periods, today);
  return (
    changes.find((change) => !options.some((option) => option.value === selections[change.field]))
      ?.field ?? null
  );
}
export function sinceProblem(
  changes: readonly SinceChange[],
  selections: SinceSelections,
  periods: readonly PeriodSummary[],
  today = japanToday(),
): SinceProblem | null {
  return pendingSinceField(changes, selections, periods, today) ? 'missing_since' : null;
}
