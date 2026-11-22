const MAX_ID_LENGTH = 64;
export const MAX_STAFF_NAME_LENGTH = 20;
export const MAX_STAFF_NOTES_LENGTH = 500;
export const MAX_PERIOD_DAYS = 31;
export const MAX_COVERAGE_REQUIRED = 99;
export const MAX_QUARTER_HOUR_PAY = 10_000;
export const MAX_PERIOD_BUDGET = 10_000_000;
const MIN_FISCAL_YEAR = 2000;
const MAX_FISCAL_YEAR = 2100;
export const MAX_INPUT_BYTES = 256 * 1024;
export const MAX_JSON_DEPTH = 16;

export function validIdentifier(value: unknown, period = false): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value.length <= MAX_ID_LENGTH &&
    (!period || (value !== 'initial' && value !== 'pending'))
  );
}

export function validFiscalYear(value: unknown): value is number {
  return (
    Number.isSafeInteger(value) &&
    (value as number) >= MIN_FISCAL_YEAR &&
    (value as number) <= MAX_FISCAL_YEAR
  );
}
