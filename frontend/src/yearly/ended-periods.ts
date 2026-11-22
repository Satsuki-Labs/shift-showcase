import type { PeriodSummary } from '../../../shared/protocol';
import { japanToday } from '../../../shared/staff';

export function lastEndedPeriodDate(
  periods: readonly Pick<PeriodSummary, 'end_date'>[],
  today = japanToday(),
): string | null {
  return periods.reduce<string | null>(
    (latest, period) =>
      period.end_date < today && (latest === null || period.end_date > latest)
        ? period.end_date
        : latest,
    null,
  );
}
