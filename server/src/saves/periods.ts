import { AppError } from '../../../shared/app-error';
import { facilities } from '../../../shared/calendar';
import { isValidDate } from '../../../shared/date';
import { MAX_COVERAGE_REQUIRED, MAX_PERIOD_DAYS, validIdentifier } from '../../../shared/limits';
import { HOLIDAYS_END_DATE } from '../../../shared/holidays';
import type {
  JsonValue,
  PeriodDistributeInput,
  PeriodSaveInput,
  PeriodSummary,
  PeriodsChangedData,
} from '../../../shared/protocol';
import { japanToday } from '../../../shared/staff';
import { readPeriods, readStaff } from '../reads/first-load';
import { initializePeriodDays } from './initial-entry';
import { closeRequests } from './request-close';
import { syncPeriodTask } from '../scheduled/tasks';
import type { SaveOperation } from './operations';

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
function identifier(value: unknown): string {
  if (!validIdentifier(value, true)) invalid('id');
  return value;
}
function date(value: unknown, field: string): string {
  if (!isValidDate(value)) invalid(field);
  return value;
}
function integer(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) invalid(field);
  return value as number;
}
export function parsePeriod(value: unknown): PeriodSaveInput {
  const input = object(
    value,
    ['id', 'name', 'start_date', 'end_date', 'request_deadline_date', 'coverage'],
    'data',
  );
  const id = identifier(input.id);
  if (typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > 20)
    invalid('name');
  const start = date(input.start_date, 'start_date'),
    end = date(input.end_date, 'end_date');
  if (end < start) invalid('end_date');
  const deadline =
    input.request_deadline_date === null
      ? null
      : date(input.request_deadline_date, 'request_deadline_date');
  if (!Array.isArray(input.coverage)) invalid('coverage');
  const coverage = input.coverage.map((raw) => {
    const row = object(raw, ['facility', 'total_required'], 'coverage');
    if (!(facilities as readonly string[]).includes(row.facility as string))
      invalid('coverage.facility');
    const total = integer(row.total_required, 'coverage.total_required');
    if (total > MAX_COVERAGE_REQUIRED) invalid('coverage.total_required');
    return {
      facility: row.facility as PeriodSaveInput['coverage'][number]['facility'],
      total_required: total,
    };
  });
  if (new Set(coverage.map((row) => row.facility)).size !== coverage.length)
    invalid('coverage.facility');
  return {
    id,
    name: input.name.trim(),
    start_date: start,
    end_date: end,
    request_deadline_date: deadline,
    coverage,
  };
}
function deleteId(value: unknown): string {
  return identifier(object(value, ['id'], 'data').id);
}
export function parseDistribution(value: unknown): PeriodDistributeInput {
  const input = object(value, ['id', 'site', 'cells'], 'data');
  const id = identifier(input.id);
  if (input.site !== 'first' && input.site !== 'second') invalid('site');
  const cells = input.cells;
  if (!cells || typeof cells !== 'object' || Array.isArray(cells)) invalid('cells');
  for (const [staffId, days] of Object.entries(cells)) {
    if (!validIdentifier(staffId) || !days || typeof days !== 'object' || Array.isArray(days))
      invalid('cells');
    for (const [day, key] of Object.entries(days)) {
      if (!isValidDate(day) || typeof key !== 'string' || key.length > 200) invalid('cells');
    }
  }
  return { id, site: input.site, cells: cells as PeriodDistributeInput['cells'] };
}
function distributionOperation(publish: boolean): SaveOperation {
  return {
    validate(data) {
      parseDistribution(data);
    },
    targets(data) {
      return [{ unit: 'period', id: parseDistribution(data).id }];
    },
    write({ sql, revision }, data) {
      const input = parseDistribution(data),
        period = existingPeriod(sql, input.id);
      if (Boolean(period[`${input.site}_published_at`]) === publish) invalid('id');
      const people = new Set(
        sql
          .exec<{ id: string }>('SELECT id FROM staff')
          .toArray()
          .map((row) => row.id),
      );
      for (const [staffId, days] of Object.entries(input.cells)) {
        if (!people.has(staffId)) invalid('cells');
        for (const day of Object.keys(days))
          if (day < period.start_date || day > period.end_date) invalid('cells');
      }
      const at = new Date().toISOString();
      if (publish)
        sql.exec(
          `UPDATE periods SET ${input.site}_published_at = ?, ${input.site}_last_distributed_at = ? WHERE id = ?`,
          at,
          at,
          input.id,
        );
      else
        sql.exec(
          `UPDATE periods SET ${input.site}_last_distributed_at = ? WHERE id = ?`,
          at,
          input.id,
        );
      sql.exec(
        `INSERT INTO distributed_sheets (period_id, site, distributed_at, cells) VALUES (?, ?, ?, ?)
        ON CONFLICT (period_id, site) DO UPDATE SET distributed_at = excluded.distributed_at, cells = excluded.cells`,
        input.id,
        input.site,
        at,
        JSON.stringify(input.cells),
      );
      return changedPeriods(sql, input.id, revision);
    },
  };
}
function requestUrlKey(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let key = '';
  while (key.length < 22) {
    const bytes = crypto.getRandomValues(new Uint8Array(22 - key.length));
    for (const byte of bytes) {
      // 248 is a multiple of 62; reject the remainder to keep each character equally likely.
      if (byte < 248) key += alphabet[byte % alphabet.length];
    }
  }
  return key;
}
function requestsClosed(period: PeriodSummary, today: string): boolean {
  return (
    period.requests_closed_at !== null ||
    (period.request_deadline_date !== null && period.request_deadline_date < today)
  );
}
export function checkOverlap(sql: SqlStorage, input: PeriodSaveInput) {
  if (
    sql
      .exec(
        'SELECT 1 FROM periods WHERE id != ? AND start_date <= ? AND end_date >= ? LIMIT 1',
        input.id,
        input.end_date,
        input.start_date,
      )
      .toArray().length
  )
    invalid('start_date');
}
function replaceCoverage(sql: SqlStorage, input: PeriodSaveInput) {
  sql.exec('DELETE FROM coverage_requirements WHERE period_id = ?', input.id);
  for (const row of input.coverage)
    sql.exec(
      'INSERT INTO coverage_requirements (period_id, facility, total_required) VALUES (?, ?, ?)',
      input.id,
      row.facility,
      row.total_required,
    );
}
function changedPeriods(sql: SqlStorage, id: string, revision: number): JsonValue {
  const data: PeriodsChangedData = {
    periods: readPeriods(sql).map((row) => (row.id === id ? { ...row, revision } : row)),
    staff: readStaff(sql),
  };
  return data as unknown as JsonValue;
}
function moveHistory(sql: SqlStorage, from: string, to: string, revision: number) {
  const people = sql
    .exec<{ staff_id: string }>('SELECT staff_id FROM staff_history WHERE since = ?', from)
    .toArray();
  for (const person of people) {
    if (
      sql
        .exec('SELECT 1 FROM staff_history WHERE staff_id = ? AND since = ?', person.staff_id, to)
        .toArray().length
    ) {
      sql.exec('DELETE FROM staff_history WHERE staff_id = ? AND since = ?', person.staff_id, from);
    } else {
      sql.exec(
        'UPDATE staff_history SET since = ? WHERE staff_id = ? AND since = ?',
        to,
        person.staff_id,
        from,
      );
    }
    sql.exec('UPDATE staff SET revision = ? WHERE id = ?', revision, person.staff_id);
  }
}
function removeDays(
  sql: SqlStorage,
  start: string,
  end: string,
  remaining?: { start: string; end: string },
) {
  for (const table of ['day_states', 'work_slots', 'daily_requests']) {
    if (remaining)
      sql.exec(
        `DELETE FROM ${table} WHERE date BETWEEN ? AND ? AND (date < ? OR date > ?)`,
        start,
        end,
        remaining.start,
        remaining.end,
      );
    else sql.exec(`DELETE FROM ${table} WHERE date BETWEEN ? AND ?`, start, end);
  }
}
function existingPeriod(sql: SqlStorage, id: string): PeriodSummary {
  const period = readPeriods(sql).find((row) => row.id === id);
  if (!period) invalid('id');
  return period;
}
function sameCoverage(left: PeriodSummary['coverage'], right: PeriodSummary['coverage']): boolean {
  return (
    left.length === right.length &&
    left.every((row) =>
      right.some(
        (item) => item.facility === row.facility && item.total_required === row.total_required,
      ),
    )
  );
}

export function validatePeriodRange(input: PeriodSaveInput): void {
  if (input.end_date > HOLIDAYS_END_DATE) invalid('end_date');
  const days =
    (Date.parse(`${input.end_date}T00:00:00Z`) - Date.parse(`${input.start_date}T00:00:00Z`)) /
      86_400_000 +
    1;
  if (days > MAX_PERIOD_DAYS) invalid('end_date');
}

export const periodOperations: Readonly<Record<string, SaveOperation>> = {
  'period.publish': distributionOperation(true),
  'period.redistribute': distributionOperation(false),
  'period.create': {
    validate(data) {
      parsePeriod(data);
    },
    targets(data) {
      return [{ unit: 'period', id: parsePeriod(data).id }];
    },
    write({ sql, revision }, data) {
      const input = parsePeriod(data);
      validatePeriodRange(input);
      if (input.request_deadline_date && input.request_deadline_date > input.end_date)
        invalid('request_deadline_date');
      if (sql.exec('SELECT 1 FROM periods WHERE id = ?', input.id).toArray().length) invalid('id');
      checkOverlap(sql, input);
      sql.exec(
        'INSERT INTO periods (id, name, start_date, end_date, request_deadline_date, request_url_key) VALUES (?, ?, ?, ?, ?, ?)',
        input.id,
        input.name,
        input.start_date,
        input.end_date,
        input.request_deadline_date,
        requestUrlKey(),
      );
      replaceCoverage(sql, input);
      if (
        !sql
          .exec(
            'SELECT 1 FROM periods WHERE id != ? AND start_date >= ? LIMIT 1',
            input.id,
            input.start_date,
          )
          .toArray().length
      ) {
        moveHistory(sql, 'pending', input.id, revision);
      }
      initializePeriodDays(sql, input, revision);
      syncPeriodTask(sql, input.id);
      return changedPeriods(sql, input.id, revision);
    },
  },
  'period.update': {
    validate(data) {
      parsePeriod(data);
    },
    targets(data) {
      return [{ unit: 'period', id: parsePeriod(data).id }];
    },
    write({ sql, revision }, data) {
      const input = parsePeriod(data),
        before = existingPeriod(sql, input.id);
      if (input.start_date !== before.start_date || input.end_date !== before.end_date)
        validatePeriodRange(input);
      const today = japanToday(),
        deadlineChanged = input.request_deadline_date !== before.request_deadline_date;
      if (
        (deadlineChanged || input.end_date !== before.end_date) &&
        input.request_deadline_date &&
        input.request_deadline_date > input.end_date
      )
        invalid('request_deadline_date');
      if (before.end_date < today) {
        for (const field of ['start_date', 'end_date', 'request_deadline_date'] as const)
          if (input[field] !== before[field]) invalid(field);
        if (!sameCoverage(input.coverage, before.coverage)) invalid('coverage');
        sql.exec('UPDATE periods SET name = ? WHERE id = ?', input.name, input.id);
      } else {
        const closed = requestsClosed(before, today);
        if (closed && before.has_request_submissions && deadlineChanged)
          invalid('request_deadline_date');
        checkOverlap(sql, input);
        const crossesPeriod =
          sql
            .exec(
              'SELECT 1 FROM periods WHERE id != ? AND start_date > ? AND start_date < ? LIMIT 1',
              input.id,
              before.start_date < input.start_date ? before.start_date : input.start_date,
              before.start_date < input.start_date ? input.start_date : before.start_date,
            )
            .toArray().length > 0;
        if (crossesPeriod) {
          const next = sql
            .exec<{ id: string }>(
              'SELECT id FROM periods WHERE id != ? AND start_date > ? ORDER BY start_date LIMIT 1',
              input.id,
              before.start_date,
            )
            .toArray()[0];
          moveHistory(sql, input.id, next?.id ?? 'pending', revision);
        }
        sql.exec(
          'UPDATE periods SET name = ?, start_date = ?, end_date = ?, request_deadline_date = ? WHERE id = ?',
          input.name,
          input.start_date,
          input.end_date,
          input.request_deadline_date,
          input.id,
        );
        if (closed && deadlineChanged)
          sql.exec('UPDATE periods SET requests_closed_at = NULL WHERE id = ?', input.id);
        if (
          crossesPeriod &&
          !sql
            .exec(
              'SELECT 1 FROM periods WHERE id != ? AND start_date >= ? LIMIT 1',
              input.id,
              input.start_date,
            )
            .toArray().length
        ) {
          moveHistory(sql, 'pending', input.id, revision);
        }
        replaceCoverage(sql, input);
        removeDays(sql, before.start_date, before.end_date, {
          start: input.start_date,
          end: input.end_date,
        });
        initializePeriodDays(sql, input, revision, before);
      }
      syncPeriodTask(sql, input.id);
      return changedPeriods(sql, input.id, revision);
    },
  },
  'period.request-url.regenerate': {
    validate(data) {
      deleteId(data);
    },
    targets(data) {
      return [{ unit: 'period', id: deleteId(data) }];
    },
    write({ sql, revision }, data) {
      const id = deleteId(data),
        period = existingPeriod(sql, id),
        today = japanToday();
      if (
        period.request_deadline_date === null ||
        requestsClosed(period, today) ||
        period.end_date < today
      )
        invalid('id');
      sql.exec('UPDATE periods SET request_url_key = ? WHERE id = ?', requestUrlKey(), id);
      return changedPeriods(sql, id, revision);
    },
  },
  'period.requests.close': {
    validate(data) {
      deleteId(data);
    },
    targets(data) {
      return [{ unit: 'period', id: deleteId(data) }];
    },
    write({ sql, revision }, data) {
      const id = deleteId(data),
        period = existingPeriod(sql, id),
        today = japanToday();
      if (
        period.request_deadline_date === null ||
        requestsClosed(period, today) ||
        period.end_date < today
      )
        invalid('id');
      closeRequests(sql, id, revision);
      syncPeriodTask(sql, id);
      return changedPeriods(sql, id, revision);
    },
  },
  'period.delete': {
    validate(data) {
      deleteId(data);
    },
    targets(data) {
      return [{ unit: 'period', id: deleteId(data) }];
    },
    write({ sql, revision }, data) {
      const id = deleteId(data),
        period = existingPeriod(sql, id);
      const next = sql
        .exec<{ id: string }>(
          'SELECT id FROM periods WHERE start_date > ? ORDER BY start_date LIMIT 1',
          period.start_date,
        )
        .toArray()[0];
      moveHistory(sql, id, next?.id ?? 'pending', revision);
      removeDays(sql, period.start_date, period.end_date);
      sql.exec('DELETE FROM coverage_requirements WHERE period_id = ?', id);
      sql.exec('DELETE FROM no_requests WHERE period_id = ?', id);
      sql.exec('DELETE FROM periods WHERE id = ?', id);
      syncPeriodTask(sql, id);
      return changedPeriods(sql, id, revision);
    },
  },
};
