import type { PeriodSummary } from '../../../shared/protocol';
import { containsToday } from '../../../shared/period';
import type { SelectOption } from './SelectBox';

export function periodChoice(period: PeriodSummary, today: string): SelectOption<string> {
  return {
    value: period.id,
    label: period.name,
    period: {
      start_date: period.start_date,
      end_date: period.end_date,
      current: containsToday(period, today),
    },
  };
}
