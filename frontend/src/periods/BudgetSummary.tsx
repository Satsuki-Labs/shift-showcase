import { CircleDollarSign } from 'lucide-react';
import type { PeriodSummary, Staff } from '../../../shared/protocol';
import { periodBudget } from './budget';
import { yen } from '../format/number';
import { NumberUnits } from '../parts/NumberUnits';

export function BudgetSummary({
  staff,
  startDate,
  periods,
}: {
  staff: Staff[];
  startDate: string | null;
  periods: PeriodSummary[];
}) {
  const budget = periodBudget(staff, startDate, periods, undefined, true);
  return (
    <span className="period-budget-head">
      <small>
        <CircleDollarSign size={20} strokeWidth={2.2} />
        予算の合計
      </small>
      <b>
        <NumberUnits>{yen(budget.total)}</NumberUnits>
      </b>
    </span>
  );
}
