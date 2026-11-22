import { AppError } from '../../../shared/app-error';
import { isValidDate } from '../../../shared/date';
import { periodDates } from '../../../shared/period';
import { validFiscalYear } from '../../../shared/limits';
import {
  facilities,
  dayOpening,
  openingConflicts,
  resolvedDayOpening,
  type DayOpening,
  type Facility,
} from '../../../shared/calendar';
import { japanToday } from '../../../shared/staff';
import type {
  AnnualRules,
  AnnualRulesChangedData,
  BuildingEntry,
  CalendarDaySaveInput,
  CalendarDaysSaveInput,
  CalendarRows,
  Identity,
  JsonValue,
  OpeningRule,
  RevisionTarget,
} from '../../../shared/protocol';
import { readAnnualRules, readPeriods } from '../reads/first-load';
import { readCalendarRows } from '../reads/year-load';
import type { SaveOperation } from './operations';
import {
  dayOpenings,
  planDayWork,
  readWorkContext,
  writeDayWork,
  type DayWorkPlan,
  type WorkContext,
} from './day-work';
import { targetKey } from './revisions';

function invalid(field: string): never {
  throw new AppError('E-32', field);
}
function object(value: unknown, fields: readonly string[], field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(field);
  const row = value as Record<string, unknown>;
  if (Object.keys(row).length !== fields.length || fields.some((key) => !Object.hasOwn(row, key)))
    invalid(field);
  return row;
}
function date(value: unknown, field: string): string {
  if (!isValidDate(value)) invalid(field);
  return value;
}
function time(value: unknown, field: string): string {
  if (
    typeof value !== 'string' ||
    !/^\d{2}:[0-5]\d$/.test(value) ||
    value < '07:00' ||
    value > '22:00'
  )
    invalid(field);
  return value;
}
function text(value: unknown, limit: number, field: string, allowEmpty = false): string {
  if (typeof value !== 'string' || value.trim().length > limit || (!allowEmpty && !value.trim()))
    invalid(field);
  return value.trim();
}
type DayInput = Omit<CalendarDaySaveInput, 'confirmed'>;
export function parseDay(value: unknown): DayInput {
  const input = object(value, ['date', 'buildings'], 'data');
  const day = date(input.date, 'date');
  if (!Array.isArray(input.buildings) || input.buildings.length < 1 || input.buildings.length > 2)
    invalid('buildings');
  const buildings = input.buildings.map((raw): CalendarDaySaveInput['buildings'][number] => {
    const group = object(raw, ['building', 'event', 'memo', 'facilities'], 'buildings');
    if (group.building !== 1 && group.building !== 2) invalid('building');
    let event: CalendarDaySaveInput['buildings'][number]['event'] = null;
    if (group.event !== null) {
      const item = object(group.event, ['content', 'arrival_time'], 'event');
      event = {
        content: text(item.content, 100, 'event.content'),
        arrival_time:
          item.arrival_time === null ? null : time(item.arrival_time, 'event.arrival_time'),
      };
    }
    const memo = group.memo === null ? null : text(group.memo, 100, 'memo');
    const allowed = group.building === 1 ? ['A', 'B'] : ['C', 'D'];
    if (!Array.isArray(group.facilities) || group.facilities.length !== 2) invalid('facilities');
    const facilities = group.facilities.map((rawFacility) => {
      const item = object(
        rawFacility,
        ['facility', 'is_open', 'start_time', 'end_time'],
        'facilities',
      );
      if (
        !allowed.includes(item.facility as string) ||
        (item.is_open !== null && typeof item.is_open !== 'boolean')
      )
        invalid('facilities');
      const start = item.start_time === null ? null : time(item.start_time, 'start_time');
      const end = item.end_time === null ? null : time(item.end_time, 'end_time');
      if (item.is_open === true && start !== null && end !== null && start >= end)
        invalid('opening_conflict');
      return {
        facility: item.facility as Facility,
        is_open: item.is_open as boolean | null,
        start_time: start,
        end_time: end,
      };
    });
    if (new Set(facilities.map((item) => item.facility)).size !== 2) invalid('facilities');
    return { building: group.building, event, memo, facilities };
  });
  if (new Set(buildings.map((item) => item.building)).size !== buildings.length)
    invalid('buildings');
  return { date: day, buildings };
}
function parseDays(value: unknown, preview = false): CalendarDaysSaveInput {
  const input = object(value, ['days', 'confirmed'], 'data');
  if (!Array.isArray(input.days) || input.days.length < 1 || input.days.length > 100)
    invalid('days');
  const days = input.days.map(parseDay);
  if (new Set(days.map((day) => day.date)).size !== days.length) invalid('days');
  return { days, confirmed: confirmation(input.confirmed, preview) };
}
function dayTargets(input: DayInput): RevisionTarget[] {
  return input.buildings.flatMap((group) => [
    { unit: 'building-day', building: group.building, date: input.date } as RevisionTarget,
    ...group.facilities.map(({ facility }): RevisionTarget => ({
      unit: 'facility-day',
      facility,
      date: input.date,
    })),
  ]);
}
function confirmation(value: unknown, preview = false): number | null {
  if (preview) return null;
  if (value !== null && (!Number.isSafeInteger(value) || (value as number) < 0))
    invalid('confirmed');
  return value as number | null;
}
function parseSingleDay(value: unknown, preview = false): CalendarDaySaveInput {
  const input = object(value, ['date', 'buildings', 'confirmed'], 'data');
  return {
    ...parseDay({ date: input.date, buildings: input.buildings }),
    confirmed: confirmation(input.confirmed, preview),
  };
}
function changedDay(rows: CalendarRows, input: DayInput, rules: AnnualRules): CalendarRows {
  const result: CalendarRows = {
    facilityDays: [...rows.facilityDays],
    buildingDays: [...rows.buildingDays],
  };
  for (const group of input.buildings) {
    result.buildingDays = result.buildingDays.filter(
      (row) => row.date !== input.date || row.building !== group.building,
    );
    const entries: BuildingEntry[] = [];
    if (group.event) entries.push({ kind: 'event', ...group.event });
    if (group.memo !== null) entries.push({ kind: 'memo', content: group.memo });
    if (entries.length)
      result.buildingDays.push({
        date: input.date,
        building: group.building,
        entries,
        revision: 1,
      });
    for (const item of group.facilities) {
      const automatic = dayOpening(
        input.date,
        item.facility,
        rules,
        group.event?.arrival_time ?? null,
      );
      if (!automatic) throw new Error('Opening rule is missing');
      const saved = rows.facilityDays.find(
        (row) => row.date === input.date && row.facility === item.facility,
      );
      const updated = {
        date: input.date,
        facility: item.facility,
        revision: saved?.revision ?? 1,
        is_open:
          item.is_open === null
            ? (saved?.is_open ?? null)
            : item.is_open === automatic.isOpen
              ? null
              : item.is_open,
        start_time:
          item.start_time === null
            ? (saved?.start_time ?? null)
            : item.start_time === automatic.startTime
              ? null
              : item.start_time,
        end_time:
          item.end_time === null
            ? (saved?.end_time ?? null)
            : item.end_time === automatic.endTime
              ? null
              : item.end_time,
      };
      result.facilityDays = result.facilityDays.filter(
        (row) => row.date !== input.date || row.facility !== item.facility,
      );
      if (updated.is_open !== null || updated.start_time !== null || updated.end_time !== null)
        result.facilityDays.push(updated);
    }
  }
  return result;
}
function validateOpenings(rows: CalendarRows, rules: AnnualRules): void {
  if (openingConflicts(rows, rules).length) invalid('opening_conflict');
}
function saveDay(
  sql: SqlStorage,
  input: DayInput,
  rules: AnnualRules,
  plan: DayWorkPlan,
  identity: Identity,
  next: number,
): JsonValue {
  const updated = changedDay(readCalendarRows(sql, input.date), input, rules);
  for (const group of input.buildings) {
    const entries: BuildingEntry[] = [];
    if (group.event) entries.push({ kind: 'event', ...group.event });
    if (group.memo !== null) entries.push({ kind: 'memo', content: group.memo });
    if (entries.length) {
      sql.exec(
        'INSERT INTO building_days (building, date, entries) VALUES (?, ?, ?) ON CONFLICT (building, date) DO UPDATE SET entries = excluded.entries',
        group.building,
        input.date,
        JSON.stringify(entries),
      );
    } else
      sql.exec(
        'DELETE FROM building_days WHERE building = ? AND date = ?',
        group.building,
        input.date,
      );
    for (const item of group.facilities) {
      const saved = updated.facilityDays.find((row) => row.facility === item.facility);
      if (!saved)
        sql.exec(
          'DELETE FROM facility_days WHERE facility = ? AND date = ?',
          item.facility,
          input.date,
        );
      else
        sql.exec(
          'INSERT INTO facility_days (facility, date, is_open, start_time, end_time) VALUES (?, ?, ?, ?, ?) ON CONFLICT (facility, date) DO UPDATE SET is_open = excluded.is_open, start_time = excluded.start_time, end_time = excluded.end_time',
          item.facility,
          input.date,
          saved.is_open === null ? null : saved.is_open ? 1 : 0,
          saved.start_time,
          saved.end_time,
        );
    }
  }
  writeDayWork(sql, plan, identity, next);
  const rows = readCalendarRows(sql, input.date);
  const buildings = new Set(input.buildings.map((group) => group.building));
  const facilities = new Set(
    input.buildings.flatMap((group) => group.facilities.map((item) => item.facility)),
  );
  return {
    facilityDays: rows.facilityDays.map((row) =>
      facilities.has(row.facility) ? { ...row, revision: next } : row,
    ),
    buildingDays: rows.buildingDays.map((row) =>
      buildings.has(row.building) ? { ...row, revision: next } : row,
    ),
  } as unknown as JsonValue;
}

function saveAnnualRules(
  sql: SqlStorage,
  revision: number,
  before: AnnualRules,
  periods: ReturnType<typeof readPeriods>,
  write: () => void,
  plans: DayWorkPlan[] = [],
  identity?: Identity,
  expectedClosures?: AnnualRules['annualClosures'],
): JsonValue {
  const ended = periods.filter((period) => period.end_date < japanToday());
  const days: Array<{
    date: string;
    facility: Facility;
    arrivalTime: string | null;
    opening: DayOpening;
    saved: CalendarRows['facilityDays'][number] | undefined;
  }> = [];
  for (const period of ended) {
    const rows = readCalendarRows(sql, period.start_date, period.end_date);
    const arrivalTimes = new Map(
      rows.buildingDays.map((row) => [
        `${row.date}:${row.building}`,
        row.entries.find((entry) => entry.kind === 'event')?.arrival_time ?? null,
      ]),
    );
    for (const date of periodDates(period)) {
      for (const facility of facilities) {
        const saved = rows.facilityDays.find(
          (row) => row.date === date && row.facility === facility,
        );
        const arrivalTime =
          arrivalTimes.get(`${date}:${facility === 'A' || facility === 'B' ? 1 : 2}`) ?? null;
        const opening = dayOpening(date, facility, before, arrivalTime);
        if (opening) days.push({ date, facility, arrivalTime, opening, saved });
      }
    }
  }
  write();
  const after = readAnnualRules(sql);
  if (
    expectedClosures &&
    (after.annualClosures.length !== expectedClosures.length ||
      after.annualClosures.some((row, i) => {
        const expected = expectedClosures[i];
        return (
          row.start_month !== expected.start_month ||
          row.start_day !== expected.start_day ||
          row.end_month !== expected.end_month ||
          row.end_day !== expected.end_day ||
          row.name !== expected.name
        );
      }))
  )
    throw new Error('Saved annual closures differ from the planned rules');
  for (const { date, facility, arrivalTime, opening, saved } of days) {
    const updated = dayOpening(date, facility, after, arrivalTime);
    const isOpen = saved?.is_open ?? (updated?.isOpen !== opening.isOpen ? opening.isOpen : null);
    const start =
      saved?.start_time ?? (updated?.startTime !== opening.startTime ? opening.startTime : null);
    const end = saved?.end_time ?? (updated?.endTime !== opening.endTime ? opening.endTime : null);
    if (
      isOpen === (saved?.is_open ?? null) &&
      start === (saved?.start_time ?? null) &&
      end === (saved?.end_time ?? null)
    )
      continue;
    sql.exec(
      'INSERT INTO facility_days (facility, date, is_open, start_time, end_time, revision) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (date, facility) DO UPDATE SET is_open = excluded.is_open, start_time = excluded.start_time, end_time = excluded.end_time, revision = excluded.revision',
      facility,
      date,
      isOpen === null ? null : isOpen ? 1 : 0,
      start,
      end,
      revision,
    );
  }
  for (const { date } of sql.exec<{ date: string }>(
    'SELECT DISTINCT date FROM facility_days WHERE start_time IS NOT NULL OR end_time IS NOT NULL',
  )) {
    validateOpenings(readCalendarRows(sql, date), after);
  }
  const skipped: AnnualRulesChangedData['skipped'] = [];
  if (identity)
    for (const plan of plans) {
      if (plan.paid_leave.length)
        skipped.push({ date: plan.date, staff_ids: [...plan.paid_leave].sort() });
      else writeDayWork(sql, plan, identity, revision);
    }
  return { rules: after, skipped } as unknown as JsonValue;
}

type Peak = AnnualRules['peaks'][number];
type AnnualClosure = AnnualRules['annualClosures'][number];
export function peak(value: unknown): Peak {
  const row = object(value, ['start_date', 'end_date', 'name'], 'peak');
  const start = date(row.start_date, 'start_date'),
    end = date(row.end_date, 'end_date');
  if (end < start) invalid('end_date');
  return { start_date: start, end_date: end, name: text(row.name, 20, 'name', true) };
}
function monthDay(month: unknown, day: unknown, field: string): { month: number; day: number } {
  if (!Number.isInteger(month) || !Number.isInteger(day)) invalid(field);
  date(`2000-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`, field);
  return { month: month as number, day: day as number };
}
export function annualClosure(value: unknown): AnnualClosure {
  const row = object(
    value,
    ['start_month', 'start_day', 'end_month', 'end_day', 'name'],
    'annualClosure',
  );
  const start = monthDay(row.start_month, row.start_day, 'start_date'),
    end = monthDay(row.end_month, row.end_day, 'end_date');
  return {
    start_month: start.month,
    start_day: start.day,
    end_month: end.month,
    end_day: end.day,
    name: text(row.name, 20, 'name', true),
  };
}
function change<Row>(
  value: unknown,
  parse: (row: unknown) => Row,
): { before: Row | null; after: Row | null } {
  const input = object(value, ['before', 'after'], 'data');
  if (input.before === null && input.after === null) invalid('data');
  return {
    before: input.before === null ? null : parse(input.before),
    after: input.after === null ? null : parse(input.after),
  };
}
function parsePeakChange(value: unknown) {
  const input = change(value, peak);
  if (input.after && !input.after.name) invalid('name');
  return input;
}
function ruleTargets<Row>(
  input: { before: Row | null; after: Row | null },
  target: (row: Row) => RevisionTarget,
): RevisionTarget[] {
  const targets = [input.before, input.after]
    .filter((row): row is Row & {} => row !== null)
    .map(target);
  return [...new Map(targets.map((row) => [targetKey(row), row])).values()];
}
function breakTarget(row: Peak): RevisionTarget {
  return { unit: 'peak', startDate: row.start_date, endDate: row.end_date };
}
function closureTarget(row: AnnualClosure): RevisionTarget {
  return {
    unit: 'annual-closure',
    startMonth: row.start_month,
    startDay: row.start_day,
    endMonth: row.end_month,
    endDay: row.end_day,
  };
}

const timeColumns = [
  'normal_start_time',
  'normal_end_time',
  'peak_start_time',
  'peak_end_time',
  'saturday_start_time',
  'saturday_end_time',
] as const;
export function openingRules(value: unknown): { fiscal_year: number; rules: OpeningRule[] } {
  const input = object(value, ['fiscal_year', 'rules'], 'data');
  if (!validFiscalYear(input.fiscal_year)) invalid('fiscal_year');
  if (
    !Array.isArray(input.rules) ||
    input.rules.length < 1 ||
    input.rules.length > facilities.length
  )
    invalid('rules');
  const rules = input.rules.map((raw): OpeningRule => {
    const row = object(
      raw,
      [
        'facility',
        ...timeColumns,
        'arrival_end_mode',
        'arrival_end_time',
        'arrival_duration_minutes',
      ],
      'rules',
    );
    if (!(facilities as readonly string[]).includes(row.facility as string)) invalid('facility');
    const times = Object.fromEntries(
      timeColumns.map((column) => [column, time(row[column], column)]),
    ) as Pick<OpeningRule, (typeof timeColumns)[number]>;
    for (const kind of ['normal', 'peak', 'saturday'] as const) {
      if (times[`${kind}_end_time`] <= times[`${kind}_start_time`]) invalid(`${kind}_end_time`);
    }
    if (row.arrival_end_mode !== 'fixed_time' && row.arrival_end_mode !== 'duration')
      invalid('arrival_end_mode');
    const fixed = row.arrival_end_mode === 'fixed_time';
    const end = fixed ? time(row.arrival_end_time, 'arrival_end_time') : null;
    const duration = fixed ? null : row.arrival_duration_minutes;
    if (
      !fixed &&
      (!Number.isInteger(duration) || (duration as number) < 1 || (duration as number) > 900)
    )
      invalid('arrival_duration_minutes');
    return {
      fiscal_year: input.fiscal_year as number,
      facility: row.facility as string,
      ...times,
      arrival_end_mode: row.arrival_end_mode,
      arrival_end_time: end,
      arrival_duration_minutes: duration as number | null,
    };
  });
  if (new Set(rules.map((row) => row.facility)).size !== rules.length) invalid('rules');
  return { fiscal_year: input.fiscal_year as number, rules };
}

function parseClosureChange(value: unknown, preview = false) {
  const input = object(value, ['before', 'after', 'confirmed'], 'data');
  return {
    ...change({ before: input.before, after: input.after }, annualClosure),
    confirmed: confirmation(input.confirmed, preview),
  };
}
function closureRules(
  rules: AnnualRules,
  input: ReturnType<typeof parseClosureChange>,
): AnnualRules {
  const key = (row: AnnualClosure) =>
    [row.start_month, row.start_day, row.end_month, row.end_day].join(':');
  const rows = rules.annualClosures.filter(
    (row) =>
      (!input.before || key(row) !== key(input.before)) &&
      (!input.after || key(row) !== key(input.after)),
  );
  if (input.after) rows.push(input.after);
  rows.sort(
    (a, b) =>
      a.start_month - b.start_month ||
      a.start_day - b.start_day ||
      a.end_month - b.end_month ||
      a.end_day - b.end_day,
  );
  return { ...rules, annualClosures: rows };
}
function peakRules(rules: AnnualRules, input: ReturnType<typeof change<Peak>>): AnnualRules {
  const same = (a: Peak, b: Peak) => a.start_date === b.start_date && a.end_date === b.end_date;
  const rows = rules.peaks.filter((row) => !input.before || !same(row, input.before));
  const after = input.after;
  if (
    after &&
    rows.some((row) => row.start_date <= after.end_date && after.start_date <= row.end_date)
  )
    invalid('peak');
  if (after) rows.push(after);
  return { ...rules, peaks: rows };
}
function previewOpeningConflicts(
  sql: SqlStorage,
  rules: AnnualRules,
  periods: ReturnType<typeof readPeriods>,
) {
  const ended = periods.filter((period) => period.end_date < japanToday());
  return [
    ...sql.exec<{ date: string }>(
      'SELECT DISTINCT date FROM facility_days WHERE start_time IS NOT NULL OR end_time IS NOT NULL',
    ),
  ]
    .filter(
      ({ date }) => !ended.some((period) => period.start_date <= date && date <= period.end_date),
    )
    .flatMap(({ date }) => openingConflicts(readCalendarRows(sql, date), rules))
    .sort((a, b) => a.date.localeCompare(b.date) || a.facility.localeCompare(b.facility));
}
export function prepareCalendarChange(
  sql: SqlStorage,
  operation: string,
  data: unknown,
  preview = false,
) {
  if (
    ![
      'calendar.day.save',
      'calendar.days.save',
      'calendar.annual-closure.save',
      'calendar.peak.save',
    ].includes(operation)
  )
    invalid('operation');
  const input =
    operation === 'calendar.day.save'
      ? parseSingleDay(data, preview)
      : operation === 'calendar.days.save'
        ? parseDays(data, preview)
        : operation === 'calendar.peak.save'
          ? { ...parsePeakChange(data), confirmed: null }
          : parseClosureChange(data, preview);
  const rules = readAnnualRules(sql),
    periods = readPeriods(sql),
    today = japanToday();
  let context: WorkContext | undefined;
  const getContext = () => (context ??= readWorkContext(sql, periods));
  const plans: DayWorkPlan[] = [];
  const days: DayInput[] =
    'date' in input
      ? [{ date: input.date, buildings: input.buildings }]
      : 'days' in input
        ? input.days
        : [];
  let afterRules = rules;
  if (operation === 'calendar.peak.save') {
    afterRules = peakRules(rules, parsePeakChange(data));
  } else if ('before' in input) {
    afterRules = closureRules(rules, parseClosureChange(data, preview));
    for (const period of periods.filter((row) => row.end_date > today)) {
      for (const date of periodDates(period)) {
        if (date > today) {
          const closed = new Set<Facility>(),
            opened = new Set<Facility>();
          for (const facility of facilities) {
            const wasOpen = dayOpening(date, facility, rules)?.isOpen,
              isOpen = dayOpening(date, facility, afterRules)?.isOpen;
            if (wasOpen === true && isOpen === false) closed.add(facility);
            if (wasOpen === false && isOpen === true) opened.add(facility);
          }
          if (closed.size || opened.size) {
            const rows = readCalendarRows(sql, date);
            for (const row of rows.facilityDays)
              if (row.is_open !== null) {
                closed.delete(row.facility);
                opened.delete(row.facility);
              }
            if (closed.size || opened.size)
              plans.push(
                planDayWork(sql, getContext, date, closed, opened, afterRules, () =>
                  dayOpenings(date, afterRules, rows),
                ),
              );
          }
        }
      }
    }
  } else
    for (const day of days) {
      const rows = readCalendarRows(sql, day.date);
      const updated = changedDay(rows, day, rules);
      validateOpenings(updated, rules);
      const closed = new Set<Facility>(),
        opened = new Set<Facility>();
      for (const item of day.buildings.flatMap((group) => group.facilities)) {
        const wasOpen = resolvedDayOpening(day.date, item.facility, rows, rules)?.isOpen;
        const isOpen = resolvedDayOpening(day.date, item.facility, updated, rules)?.isOpen;
        if (wasOpen === true && isOpen === false) closed.add(item.facility);
        if (wasOpen === false && isOpen === true) opened.add(item.facility);
      }
      plans.push(
        planDayWork(sql, getContext, day.date, closed, opened, rules, () =>
          dayOpenings(day.date, rules, updated),
        ),
      );
    }
  return {
    rules,
    afterRules,
    periods,
    plans,
    days,
    confirmed: input.confirmed,
    openingConflicts:
      preview && 'before' in input ? previewOpeningConflicts(sql, afterRules, periods) : [],
  };
}
function confirmPlans(
  sql: SqlStorage,
  change: ReturnType<typeof prepareCalendarChange>,
  annual = false,
): void {
  if (!annual && change.plans.some((plan) => plan.paid_leave.length)) invalid('paid_leave');
  const current = sql
    .exec<{ data_change_number: number }>(
      'SELECT data_change_number FROM backup_state WHERE id = 1',
    )
    .one().data_change_number;
  if (
    change.plans.some(
      (plan) => plan.remove.length || plan.add.length || (annual && plan.paid_leave.length),
    ) &&
    change.confirmed !== current
  )
    invalid('confirmation');
}
function saveDays(
  sql: SqlStorage,
  operation: string,
  data: unknown,
  identity: Identity,
  revision: number,
): JsonValue {
  const prepared = prepareCalendarChange(sql, operation, data);
  confirmPlans(sql, prepared);
  const rows = prepared.days.map(
    (day, i) =>
      saveDay(
        sql,
        day,
        prepared.rules,
        prepared.plans[i],
        identity,
        revision,
      ) as unknown as CalendarRows,
  );
  return {
    facilityDays: rows.flatMap((row) => row.facilityDays),
    buildingDays: rows.flatMap((row) => row.buildingDays),
  } as unknown as JsonValue;
}
export const calendarOperations: Readonly<Record<string, SaveOperation>> = {
  'calendar.days.save': {
    validate(data) {
      parseDays(data);
    },
    targets(data) {
      return parseDays(data).days.flatMap(dayTargets);
    },
    write({ sql, identity, revision }, data) {
      return saveDays(sql, 'calendar.days.save', data, identity, revision);
    },
  },
  'calendar.day.save': {
    validate(data) {
      parseSingleDay(data);
    },
    targets(data) {
      return dayTargets(parseSingleDay(data));
    },
    write({ sql, identity, revision }, data) {
      return saveDays(sql, 'calendar.day.save', data, identity, revision);
    },
  },
  'calendar.peak.save': {
    validate(data) {
      parsePeakChange(data);
    },
    targets(data) {
      return ruleTargets(parsePeakChange(data), breakTarget);
    },
    write({ sql, revision }, data) {
      const input = parsePeakChange(data),
        rules = readAnnualRules(sql);
      peakRules(rules, input);
      const { before, after } = input;
      return saveAnnualRules(sql, revision, rules, readPeriods(sql), () => {
        if (before)
          sql.exec(
            'DELETE FROM peaks WHERE start_date = ? AND end_date = ?',
            before.start_date,
            before.end_date,
          );
        if (after)
          sql.exec(
            'INSERT INTO peaks (start_date, end_date, name) VALUES (?, ?, ?) ON CONFLICT (start_date, end_date) DO UPDATE SET name = excluded.name',
            after.start_date,
            after.end_date,
            after.name,
          );
      });
    },
  },
  'calendar.annual-closure.save': {
    validate(data) {
      parseClosureChange(data);
    },
    targets(data) {
      return ruleTargets(parseClosureChange(data), closureTarget);
    },
    write({ sql, identity, revision }, data) {
      const input = parseClosureChange(data),
        prepared = prepareCalendarChange(sql, 'calendar.annual-closure.save', data);
      confirmPlans(sql, prepared, true);
      const { before, after } = input;
      return saveAnnualRules(
        sql,
        revision,
        prepared.rules,
        prepared.periods,
        () => {
          if (before)
            sql.exec(
              'DELETE FROM annual_closures WHERE start_month = ? AND start_day = ? AND end_month = ? AND end_day = ?',
              before.start_month,
              before.start_day,
              before.end_month,
              before.end_day,
            );
          if (after)
            sql.exec(
              'INSERT INTO annual_closures (start_month, start_day, end_month, end_day, name) VALUES (?, ?, ?, ?, ?) ON CONFLICT (start_month, start_day, end_month, end_day) DO UPDATE SET name = excluded.name',
              after.start_month,
              after.start_day,
              after.end_month,
              after.end_day,
              after.name,
            );
        },
        prepared.plans,
        identity,
        prepared.afterRules.annualClosures,
      );
    },
  },
  'calendar.opening-rules.save': {
    validate(data) {
      openingRules(data);
    },
    targets(data) {
      return openingRules(data).rules.map((row) => ({
        unit: 'opening-rule',
        fiscalYear: row.fiscal_year,
        facility: row.facility as Facility,
      }));
    },
    write({ sql, revision }, data) {
      const input = openingRules(data);
      return saveAnnualRules(sql, revision, readAnnualRules(sql), readPeriods(sql), () => {
        for (const row of input.rules)
          sql.exec(
            `INSERT INTO opening_rules (fiscal_year, facility, ${timeColumns.join(', ')}, arrival_end_mode, arrival_end_time, arrival_duration_minutes) VALUES (${Array(11).fill('?').join(', ')}) ON CONFLICT (fiscal_year, facility) DO UPDATE SET ${[...timeColumns, 'arrival_end_mode', 'arrival_end_time', 'arrival_duration_minutes'].map((column) => `${column} = excluded.${column}`).join(', ')}`,
            row.fiscal_year,
            row.facility,
            ...timeColumns.map((column) => row[column]),
            row.arrival_end_mode,
            row.arrival_end_time,
            row.arrival_duration_minutes,
          );
      });
    },
  },
};
