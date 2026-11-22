import { fiscalYearEnd, fiscalYearStart } from '../../../shared/calendar';
import type { AnnualRules } from '../../../shared/protocol';

export function yearBreaks(rules: AnnualRules, year: number) {
  return rules.peaks
    .filter((row) => row.start_date <= fiscalYearEnd(year) && row.end_date >= fiscalYearStart(year))
    .sort((a, b) => a.start_date.localeCompare(b.start_date));
}
export function FacilityBadge({ facility }: { facility: string }) {
  return (
    <span
      className={`yearly-facility ${facility === 'A' || facility === 'B' ? 'first' : 'second'}`}
    >
      {facility}
    </span>
  );
}
