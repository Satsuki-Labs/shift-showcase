import type { AnnualRules, OpeningRule } from '../../../shared/protocol';
import { facilities } from '../../../shared/calendar';

export { facilities, type Facility } from '../../../shared/calendar';
export const openingKinds = ['normal', 'peak', 'saturday'] as const;
export type OpeningForm = Omit<OpeningRule, 'fiscal_year' | 'arrival_duration_minutes'> & {
  hours: string;
  minutes: string;
};
export function openingForms(rules: AnnualRules, year: number): OpeningForm[] {
  return facilities.map((facility) => {
    const row = rules.openingRules.reduce<OpeningRule | undefined>(
      (latest, rule) =>
        rule.facility === facility &&
        rule.fiscal_year <= year &&
        (!latest || rule.fiscal_year > latest.fiscal_year)
          ? rule
          : latest,
      undefined,
    );
    return {
      facility,
      normal_start_time: row?.normal_start_time ?? '',
      normal_end_time: row?.normal_end_time ?? '',
      peak_start_time: row?.peak_start_time ?? '',
      peak_end_time: row?.peak_end_time ?? '',
      saturday_start_time: row?.saturday_start_time ?? '',
      saturday_end_time: row?.saturday_end_time ?? '',
      arrival_end_mode: row?.arrival_end_mode ?? 'fixed_time',
      arrival_end_time: row?.arrival_end_time ?? '',
      hours:
        row?.arrival_duration_minutes === null || row?.arrival_duration_minutes === undefined
          ? ''
          : String(Math.floor(row.arrival_duration_minutes / 60)),
      minutes:
        row?.arrival_duration_minutes === null || row?.arrival_duration_minutes === undefined
          ? ''
          : String(row.arrival_duration_minutes % 60),
    };
  });
}
export function openingProblem(form: OpeningForm): boolean {
  return (
    openingKinds.some((kind) => !form[`${kind}_start_time`] || !form[`${kind}_end_time`]) ||
    (form.arrival_end_mode === 'fixed_time' ? !form.arrival_end_time : form.hours === '')
  );
}
export function openingPayload(year: number, forms: OpeningForm[]) {
  return {
    fiscal_year: year,
    rules: forms.map(({ hours, minutes, ...row }) => ({
      ...row,
      arrival_end_time: row.arrival_end_mode === 'fixed_time' ? row.arrival_end_time : null,
      arrival_duration_minutes:
        row.arrival_end_mode === 'duration' ? Number(hours) * 60 + Number(minutes) : null,
    })),
  };
}
