import type {
  AnnualRules,
  CalendarRows,
  FacilityDay,
  OpeningConflict,
  OpeningRule,
} from './protocol';
import { HOLIDAYS_END_DATE, holidayName } from './holidays';

export const facilities = ['A', 'B', 'C', 'D'] as const;
export type Facility = (typeof facilities)[number];
export interface DayOpening {
  isOpen: boolean;
  startTime: string;
  endTime: string;
  source: 'normal' | 'peak' | 'saturday' | 'arrival';
}

export function fiscalYearOf(date: string): number {
  const year = Number(date.slice(0, 4));
  return date.slice(5, 10) < '04-01' ? year - 1 : year;
}
export function fiscalYearStart(year: number): string {
  return `${year}-04-01`;
}
export function fiscalYearEnd(year: number): string {
  return `${year + 1}-03-31`;
}
export function fiscalYearLabel(year: number): string {
  return `令和${year - 2018}年度`;
}
export function selectableFiscalYears(today: string): number[] {
  const years: number[] = [];
  for (let year = fiscalYearOf(today) - 1; fiscalYearEnd(year) <= HOLIDAYS_END_DATE; year++)
    years.push(year);
  return years;
}

function annualClosure(date: string, closures: AnnualRules['annualClosures']) {
  const monthDay = Number(date.slice(5, 7)) * 100 + Number(date.slice(8, 10));
  return closures.find(({ start_month, start_day, end_month, end_day }) => {
    const start = start_month * 100 + start_day;
    const end = end_month * 100 + end_day;
    return start <= end
      ? start <= monthDay && monthDay <= end
      : monthDay >= start || monthDay <= end;
  });
}
function addMinutes(time: string, duration: number): string {
  const [hour, minute] = time.split(':').map(Number);
  const total = hour * 60 + minute + duration;
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/** Dates are YYYY-MM-DD and times are HH:mm. No rule means no invented opening hours. */
export function dayOpening(
  date: string,
  facility: Facility,
  rules: AnnualRules,
  arrivalTime: string | null = null,
): DayOpening | undefined {
  const year = fiscalYearOf(date);
  const rule = rules.openingRules.reduce<OpeningRule | undefined>(
    (latest, row) =>
      row.facility === facility &&
      row.fiscal_year <= year &&
      (!latest || row.fiscal_year > latest.fiscal_year)
        ? row
        : latest,
    undefined,
  );
  if (!rule) return undefined;

  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  const source =
    weekday === 6
      ? 'saturday'
      : rules.peaks.some(({ start_date, end_date }) => start_date <= date && date <= end_date)
        ? 'peak'
        : 'normal';
  const result: DayOpening = {
    isOpen:
      weekday !== 0 &&
      holidayName(date) === undefined &&
      !annualClosure(date, rules.annualClosures) &&
      (weekday !== 6 || facility === 'A'),
    startTime: rule[`${source}_start_time`],
    endTime: rule[`${source}_end_time`],
    source,
  };
  if (arrivalTime !== null) {
    const end =
      rule.arrival_end_mode === 'fixed_time'
        ? rule.arrival_end_time
        : rule.arrival_duration_minutes === null
          ? null
          : addMinutes(arrivalTime, rule.arrival_duration_minutes);
    if (end !== null && end > arrivalTime)
      return { ...result, startTime: arrivalTime, endTime: end, source: 'arrival' };
  }
  return result;
}

type OpeningRows = {
  facilityDays: readonly (Pick<FacilityDay, 'facility' | 'date' | 'is_open'> &
    Partial<FacilityDay>)[];
  buildingDays?: CalendarRows['buildingDays'];
};
/** Each saved item takes precedence over the automatic value. */
export function resolvedDayOpening(
  date: string,
  facility: Facility,
  data: OpeningRows,
  rules: AnnualRules,
): Pick<DayOpening, 'isOpen' | 'startTime' | 'endTime'> | undefined {
  const saved = data.facilityDays.find((row) => row.date === date && row.facility === facility);
  const building = facility === 'A' || facility === 'B' ? 1 : 2;
  const event = data.buildingDays
    ?.find((row) => row.date === date && row.building === building)
    ?.entries.find((row) => row.kind === 'event');
  const automatic = dayOpening(
    date,
    facility,
    rules,
    event?.kind === 'event' ? event.arrival_time || null : null,
  );
  if (
    !automatic &&
    (saved?.is_open == null ||
      (saved.is_open && (saved.start_time == null || saved.end_time == null)))
  )
    return undefined;
  return {
    isOpen: saved?.is_open ?? automatic!.isOpen,
    startTime: saved?.start_time ?? automatic?.startTime ?? '',
    endTime: saved?.end_time ?? automatic?.endTime ?? '',
  };
}

export function openingConflicts(data: CalendarRows, rules: AnnualRules): OpeningConflict[] {
  return data.facilityDays
    .flatMap((row) => {
      if (row.start_time === null && row.end_time === null) return [];
      const opening = resolvedDayOpening(row.date, row.facility, data, rules);
      if (!opening?.isOpen || opening.startTime < opening.endTime) return [];
      const field = row.start_time !== null ? ('start_time' as const) : ('end_time' as const);
      return [{ date: row.date, facility: row.facility, field, time: row[field]! }];
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.facility.localeCompare(b.facility));
}

export function allFacilitiesClosed(
  date: string,
  rules: AnnualRules,
  facilityDays: readonly Pick<FacilityDay, 'facility' | 'date' | 'is_open'>[],
): boolean {
  return facilities.every((facility) => {
    return resolvedDayOpening(date, facility, { facilityDays }, rules)?.isOpen === false;
  });
}
type CalendarRestDay = { kind: 'holiday' } | { kind: 'closure'; name: string };
export function calendarRestDay(
  date: string,
  rules: AnnualRules,
  facilityDays: readonly Pick<FacilityDay, 'facility' | 'date' | 'is_open'>[],
): CalendarRestDay | null {
  if (!allFacilitiesClosed(date, rules, facilityDays)) return null;
  if (new Date(`${date}T00:00:00Z`).getUTCDay() === 0 || holidayName(date))
    return { kind: 'holiday' };
  const closure = annualClosure(date, rules.annualClosures);
  return closure ? { kind: 'closure', name: closure.name } : { kind: 'holiday' };
}
