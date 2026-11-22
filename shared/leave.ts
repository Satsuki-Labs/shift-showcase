import { fiscalYearOf } from './calendar';
import type { PeriodSummary } from './protocol';

interface LeaveLabel {
  date: string;
  label: string;
}

function circledNumber(number: number): string {
  return number >= 1 && number <= 20
    ? String.fromCodePoint(0x2460 + number - 1)
    : number <= 35 && number >= 21
      ? String.fromCodePoint(0x3251 + number - 21)
      : number <= 50 && number >= 36
        ? String.fromCodePoint(0x32b1 + number - 36)
        : String(number);
}

function numberLabels(days: { date: string; range: string; prefix: string }[]): LeaveLabel[] {
  const counts = new Map<string, number>();
  return days
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((day) => {
      const count = (counts.get(day.range) ?? 0) + 1;
      counts.set(day.range, count);
      return { date: day.date, label: `${day.prefix}${circledNumber(count)}` };
    });
}

export function holidayLabels(
  dates: readonly string[],
  period: Pick<PeriodSummary, 'start_date' | 'end_date'>,
): LeaveLabel[] {
  return numberLabels(
    dates
      .filter((date) => period.start_date <= date && date <= period.end_date)
      .map((date) => ({ date, range: period.start_date, prefix: '休' })),
  );
}

export function paidLeaveLabels(dates: readonly string[]): LeaveLabel[] {
  return numberLabels(
    dates.map((date) => ({ date, range: String(fiscalYearOf(date)), prefix: '有' })),
  );
}
