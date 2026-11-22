import { AppError } from '../../../shared/app-error';
import { isValidDate } from '../../../shared/date';
import type {
  RequestSheetDailyRequest,
  JsonValue,
  NoRequest,
  RequestDaySaveInput,
  RevisionTarget,
} from '../../../shared/protocol';
import {
  readRequestClosedDates,
  readRequestStaff,
  type RequestPeriod,
} from '../reads/request-sheet';
import type { SaveOperation } from './operations';

export type RequestSaveOperation = Omit<SaveOperation, 'write'> & {
  write(
    context: Omit<Parameters<SaveOperation['write']>[0], 'identity'>,
    data: JsonValue,
  ): JsonValue;
};
const names = ['request.day.save', 'request.day.delete', 'request.none.set', 'request.none.clear'];
type SqlRow<T> = { [K in keyof T]: T[K] };
export function isRequestOperation(name: string): boolean {
  return names.includes(name);
}

function invalid(field: string): never {
  throw new AppError('E-32', field);
}
function object(
  data: JsonValue,
  fields: string[],
  optional: string[] = [],
): Record<string, JsonValue> {
  if (!data || typeof data !== 'object' || Array.isArray(data)) invalid('data');
  for (const field of fields) if (!Object.hasOwn(data, field)) invalid(field);
  if (Object.keys(data).some((field) => !fields.includes(field) && !optional.includes(field)))
    invalid('data');
  return data;
}

export function validateRequestContent(row: Record<string, unknown>): void {
  if (
    !['unavailable', 'am_unavailable', 'pm_unavailable', 'time_unavailable', 'available'].includes(
      row.kind as string,
    )
  )
    invalid('kind');
  if (row.kind === 'time_unavailable' || row.kind === 'available') {
    for (const field of ['start_time', 'end_time']) {
      if (typeof row[field] !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(row[field]))
        invalid(field);
      if (row.kind === 'available' && (row[field] < '07:00' || row[field] > '22:00'))
        invalid(field);
    }
    if ((row.start_time as string) >= (row.end_time as string)) invalid('end_time');
  } else {
    if (row.start_time !== null) invalid('start_time');
    if (row.end_time !== null) invalid('end_time');
  }
  if (
    row.memo !== undefined &&
    row.memo !== null &&
    (typeof row.memo !== 'string' || row.memo.trim().length < 1 || row.memo.trim().length > 100)
  )
    invalid('memo');
}

export function requestOperations(
  sql: SqlStorage,
  period: RequestPeriod,
): Record<string, RequestSaveOperation> {
  function parse(data: JsonValue, fields: string[], optional: string[] = []) {
    const row = object(data, fields, optional);
    if (typeof row.staff_id !== 'string' || !row.staff_id.trim()) invalid('staff_id');
    return row as Record<string, JsonValue> & { staff_id: string };
  }
  function validate(data: JsonValue, fields: string[], optional: string[] = []) {
    const row = parse(data, fields, optional);
    const staff = readRequestStaff(sql, period).find((person) => person.id === row.staff_id);
    if (!staff) invalid('staff_id');
    if (fields.includes('date')) {
      if (
        !isValidDate(row.date) ||
        row.date < period.start_date ||
        row.date > period.end_date ||
        readRequestClosedDates(sql, period).includes(row.date)
      )
        invalid('date');
    }
    if (fields.includes('kind')) {
      const kinds =
        staff.employment_type === 'casual'
          ? ['available']
          : ['unavailable', 'am_unavailable', 'pm_unavailable', 'time_unavailable'];
      if (typeof row.kind !== 'string' || !kinds.includes(row.kind)) invalid('kind');
      validateRequestContent(row);
    }
  }
  function dayTarget(data: JsonValue): RevisionTarget[] {
    const row = data as { staff_id: string; date: string };
    return [{ unit: 'daily-request', staffId: row.staff_id, date: row.date }];
  }
  function noneTarget(data: JsonValue): RevisionTarget[] {
    return [
      { unit: 'no-request', staffId: (data as { staff_id: string }).staff_id, periodId: period.id },
    ];
  }
  const dayFields = ['staff_id', 'date'];
  return {
    'request.day.save': {
      validate(data) {
        validate(data, [...dayFields, 'kind', 'start_time', 'end_time'], ['memo']);
      },
      targets(data) {
        return [...dayTarget(data), ...noneTarget(data)];
      },
      write({ revision }, data) {
        const row = data as unknown as RequestDaySaveInput;
        const request = sql
          .exec<Omit<SqlRow<RequestSheetDailyRequest>, 'has_memo'> & { has_memo: number }>(
            `INSERT INTO daily_requests (staff_id, date, kind, start_time, end_time, memo, revision)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (staff_id, date) DO UPDATE SET kind = excluded.kind, start_time = excluded.start_time,
             end_time = excluded.end_time, memo = CASE WHEN ? THEN excluded.memo ELSE daily_requests.memo END, revision = excluded.revision
           RETURNING staff_id, date, kind, start_time, end_time, memo IS NOT NULL AS has_memo, revision`,
            row.staff_id,
            row.date,
            row.kind,
            row.start_time,
            row.end_time,
            row.memo?.trim() ?? null,
            revision,
            Object.hasOwn(row, 'memo') ? 1 : 0,
          )
          .one();
        const removed = sql
          .exec(
            'DELETE FROM no_requests WHERE staff_id = ? AND period_id = ? RETURNING staff_id',
            row.staff_id,
            period.id,
          )
          .toArray();
        return {
          request: { ...request, has_memo: request.has_memo === 1 },
          noRequestRemoved: removed.length > 0,
        };
      },
    },
    'request.day.delete': {
      validate(data) {
        validate(data, dayFields);
      },
      targets: dayTarget,
      write(_context, data) {
        const row = data as { staff_id: string; date: string };
        sql.exec(
          'DELETE FROM daily_requests WHERE staff_id = ? AND date = ?',
          row.staff_id,
          row.date,
        );
        return null;
      },
    },
    'request.none.set': {
      validate(data) {
        validate(data, ['staff_id']);
        if (
          sql
            .exec(
              'SELECT 1 FROM daily_requests WHERE staff_id = ? AND date BETWEEN ? AND ? LIMIT 1',
              (data as { staff_id: string }).staff_id,
              period.start_date,
              period.end_date,
            )
            .toArray().length
        )
          invalid('staff_id');
      },
      targets: noneTarget,
      write({ revision }, data) {
        return sql
          .exec<SqlRow<NoRequest>>(
            `INSERT INTO no_requests (staff_id, period_id, pressed_at, revision)
           VALUES (?, ?, ?, ?)
           ON CONFLICT (staff_id, period_id) DO UPDATE SET pressed_at = excluded.pressed_at,
             revision = excluded.revision RETURNING *`,
            (data as { staff_id: string }).staff_id,
            period.id,
            new Date().toISOString(),
            revision,
          )
          .one();
      },
    },
    'request.none.clear': {
      validate(data) {
        validate(data, ['staff_id']);
      },
      targets: noneTarget,
      write(_context, data) {
        sql.exec(
          'DELETE FROM no_requests WHERE staff_id = ? AND period_id = ?',
          (data as { staff_id: string }).staff_id,
          period.id,
        );
        return null;
      },
    },
  };
}
