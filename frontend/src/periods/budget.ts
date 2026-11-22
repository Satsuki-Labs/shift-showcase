import type { PeriodSummary, Staff } from '../../../shared/protocol';
import { historyForPeriod, japanToday } from '../../../shared/staff';
import { payStaff } from '../../../shared/pay';

export function periodBudget(
  staff: Staff[],
  startDate: string | null,
  periods: Pick<PeriodSummary, 'id' | 'start_date'>[],
  today = japanToday(),
  creating = false,
) {
  const date = startDate ?? today;
  const includePending =
    creating && startDate !== null && periods.every((period) => period.start_date < startDate);
  let total = 0;
  for (const person of payStaff(staff, null, null, today)) {
    const pending = includePending
      ? person.history.find((row) => row.since === 'pending')
      : undefined;
    const history = pending ?? historyForPeriod(person.history, periods, date);
    if (history) total += history.budget;
  }
  return { total };
}
