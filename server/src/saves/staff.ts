import { AppError } from '../../../shared/app-error';
import { isValidDate } from '../../../shared/date';
import {
  MAX_STAFF_NAME_LENGTH,
  MAX_STAFF_NOTES_LENGTH,
  MAX_QUARTER_HOUR_PAY,
  MAX_PERIOD_BUDGET,
  validIdentifier,
} from '../../../shared/limits';
import type { JsonValue, Staff, StaffHistory } from '../../../shared/protocol';
import {
  DEFAULT_STAFF_ROLES,
  staffAssignments,
  historyForPeriod,
  japanToday,
  orderedWorkPair,
  sortStaffHistory,
  validRoles,
  workSlotsOverlap,
  type DefaultWorkPair,
  type DefaultWorkSlot,
  type DefaultWorkTimes,
} from '../../../shared/staff';
import { readPeriods, readStaff } from '../reads/first-load';
import type { SaveOperation } from './operations';

type StaffFields = Omit<Staff, 'sort_order' | 'revision' | 'history' | 'in_use'>;
type HistoryValues = Omit<StaffHistory, 'staff_id' | 'since'>;
type HistoryChanges = {
  [K in keyof HistoryValues]?: { value: HistoryValues[K]; period_id?: string };
};
export interface StaffSaveInput {
  staff: StaffFields;
  history: HistoryChanges;
}
const staffColumns = [
  'name',
  'notes',
  'default_first_facility',
  'default_second_facility',
  'default_work_times',
  'default_roles',
  'employment_status',
  'leave_start_date',
  'leave_expected_end_date',
  'retirement_date',
] as const;
const historyColumns = ['quarter_hour_pay', 'employment_type', 'qualification', 'budget'] as const;
function invalid(field: string): never {
  throw new AppError('E-32', field);
}
function object(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(field);
  return value as Record<string, unknown>;
}
function keys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
  field: string,
) {
  if (
    required.some((key) => !Object.hasOwn(value, key)) ||
    Object.keys(value).some((key) => !required.includes(key) && !optional.includes(key))
  )
    invalid(field);
}
function identifier(value: unknown, field: string): string {
  if (!validIdentifier(value, field.endsWith('.period_id'))) invalid(field);
  return value;
}
function date(value: unknown, field: string): string {
  if (!isValidDate(value)) invalid(field);
  return value;
}
function slot(value: unknown, field: string): DefaultWorkSlot | null {
  if (value === null) return null;
  const item = object(value, field);
  keys(item, ['start', 'end'], [], field);
  const time = (value: unknown): value is string =>
    typeof value === 'string' &&
    /^\d{2}:[0-5]\d$/.test(value) &&
    value >= '07:00' &&
    value <= '22:00';
  if (!time(item.start) || !time(item.end) || item.end <= item.start) invalid(field);
  return { start: item.start, end: item.end };
}
function pair(value: unknown, field: string): DefaultWorkPair {
  const raw = object(value, field);
  keys(raw, ['slot1', 'slot2'], [], field);
  const items: DefaultWorkPair = { slot1: slot(raw.slot1, field), slot2: slot(raw.slot2, field) };
  if (items.slot1 && items.slot2 && workSlotsOverlap(items.slot1, items.slot2)) invalid(field);
  return orderedWorkPair(items);
}
export function workTimes(value: unknown, first: boolean, second: boolean): DefaultWorkTimes {
  const item = object(value, 'default_work_times');
  keys(item, ['normal', 'peak', 'saturday'], [], 'default_work_times');
  const category = (name: 'normal' | 'peak') => {
    const groups = object(item[name], `default_work_times.${name}`);
    keys(groups, ['first', 'second'], [], `default_work_times.${name}`);
    const times = {
      first: first
        ? pair(groups.first, `default_work_times.${name}.first`)
        : { slot1: null, slot2: null },
      second: second
        ? pair(groups.second, `default_work_times.${name}.second`)
        : { slot1: null, slot2: null },
    };
    if (
      first &&
      second &&
      Object.values(times.first).some(
        (left) =>
          left &&
          Object.values(times.second).some((right) => right && workSlotsOverlap(left, right)),
      )
    )
      invalid(`default_work_times.${name}`);
    return times;
  };
  return {
    normal: category('normal'),
    peak: category('peak'),
    saturday: slot(item.saturday, 'default_work_times.saturday'),
  };
}
export function parseSave(value: unknown): StaffSaveInput {
  const input = object(value, 'data');
  keys(input, ['staff', 'history'], [], 'data');
  const fields = object(input.staff, 'staff');
  keys(fields, ['id', ...staffColumns], [], 'staff');
  identifier(fields.id, 'id');
  if (
    typeof fields.name !== 'string' ||
    !fields.name.trim() ||
    fields.name.trim().length > MAX_STAFF_NAME_LENGTH
  )
    invalid('name');
  if (typeof fields.notes !== 'string' || fields.notes.length > MAX_STAFF_NOTES_LENGTH)
    invalid('notes');
  if (
    fields.default_first_facility !== null &&
    !['A', 'B'].includes(fields.default_first_facility as string)
  )
    invalid('default_first_facility');
  if (
    fields.default_second_facility !== null &&
    !['C', 'D'].includes(fields.default_second_facility as string)
  )
    invalid('default_second_facility');
  const { first, second } = staffAssignments(fields as unknown as StaffFields);
  if (!first && !second) invalid('default_first_facility');
  if (
    !Array.isArray(fields.default_roles) ||
    fields.default_roles.some(
      (role) => !DEFAULT_STAFF_ROLES.includes(role as (typeof DEFAULT_STAFF_ROLES)[number]),
    ) ||
    !validRoles(fields.default_roles)
  )
    invalid('default_roles');
  if (!['active', 'leave', 'retired'].includes(fields.employment_status as string))
    invalid('employment_status');
  if (fields.employment_status === 'leave') {
    const start = date(fields.leave_start_date, 'leave_start_date');
    if (
      fields.leave_expected_end_date !== null &&
      date(fields.leave_expected_end_date, 'leave_expected_end_date') < start
    )
      invalid('leave_expected_end_date');
  } else if (fields.leave_start_date !== null || fields.leave_expected_end_date !== null)
    invalid('leave_start_date');
  if (fields.employment_status === 'retired') date(fields.retirement_date, 'retirement_date');
  else if (fields.retirement_date !== null) invalid('retirement_date');
  const history = object(input.history, 'history');
  keys(history, [], historyColumns, 'history');
  for (const [field, raw] of Object.entries(history)) {
    const change = object(raw, field);
    keys(change, ['value'], ['period_id'], field);
    if (Object.hasOwn(change, 'period_id')) identifier(change.period_id, `${field}.period_id`);
    if (field === 'quarter_hour_pay' || field === 'budget') {
      const maximum = field === 'quarter_hour_pay' ? MAX_QUARTER_HOUR_PAY : MAX_PERIOD_BUDGET;
      if (
        typeof change.value !== 'number' ||
        !Number.isFinite(change.value) ||
        change.value < 0 ||
        change.value > maximum
      )
        invalid(field);
      if (field === 'quarter_hour_pay' && !Number.isInteger(change.value)) invalid(field);
    } else {
      const allowed =
        field === 'employment_type'
          ? ['full_time', 'part_time', 'casual']
          : ['certified', 'assistant', 'none'];
      if (!allowed.includes(change.value as string)) invalid(field);
    }
  }
  return {
    staff: {
      ...fields,
      name: fields.name.trim(),
      default_first_facility: first ? fields.default_first_facility : null,
      default_second_facility: second ? fields.default_second_facility : null,
      default_work_times: workTimes(fields.default_work_times, first, second),
    } as StaffFields,
    history: history as HistoryChanges,
  };
}
function historyRows(sql: SqlStorage, id: string): StaffHistory[] {
  return sortStaffHistory(
    sql
      .exec<StaffHistory & Record<string, SqlStorageValue>>(
        'SELECT * FROM staff_history WHERE staff_id = ?',
        id,
      )
      .toArray(),
    readPeriods(sql),
  );
}
function insertHistory(sql: SqlStorage, row: StaffHistory) {
  sql.exec(
    'INSERT INTO staff_history (staff_id, since, quarter_hour_pay, employment_type, qualification, budget) VALUES (?, ?, ?, ?, ?, ?)',
    row.staff_id,
    row.since,
    row.quarter_hour_pay,
    row.employment_type,
    row.qualification,
    row.budget,
  );
}
function saveStaff(sql: SqlStorage, input: StaffSaveInput, revision: number): JsonValue {
  const { staff, history } = input;
  const exists = sql.exec('SELECT id FROM staff WHERE id = ?', staff.id).toArray().length > 0;
  const values = staffColumns.map((column) =>
    column === 'default_work_times' || column === 'default_roles'
      ? JSON.stringify(staff[column])
      : staff[column],
  ) as SqlStorageValue[];
  if (exists)
    sql.exec(
      `UPDATE staff SET ${staffColumns.map((column) => `${column} = ?`).join(', ')} WHERE id = ?`,
      ...values,
      staff.id,
    );
  else {
    const order = sql
      .exec<{ next: number }>('SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM staff')
      .one().next;
    sql.exec(
      `INSERT INTO staff (id, ${staffColumns.join(', ')}, sort_order) VALUES (${Array(12).fill('?').join(', ')})`,
      staff.id,
      ...values,
      order,
    );
    for (const column of historyColumns)
      if (!history[column] || history[column]!.period_id !== undefined) invalid(column);
    insertHistory(sql, {
      staff_id: staff.id,
      since: 'initial',
      ...Object.fromEntries(historyColumns.map((column) => [column, history[column]!.value])),
    } as StaffHistory);
  }
  if (exists && Object.keys(history).length) {
    const periods = readPeriods(sql);
    const today = japanToday();
    for (const column of historyColumns) {
      const change = history[column];
      if (!change) continue;
      if (periods.length) {
        if (!change.period_id) invalid(`${column}.period_id`);
        const period = periods.find((row) => row.id === change.period_id);
        if (!period || period.end_date < today) invalid(`${column}.period_id`);
        const rows = historyRows(sql, staff.id);
        if (!rows.some((row) => row.since === period.id)) {
          const previous = historyForPeriod(rows, periods, period.start_date);
          if (!previous) throw new Error('Staff history is missing');
          insertHistory(sql, { ...previous, since: period.id });
        }
        const ordered = historyRows(sql, staff.id);
        for (const row of ordered.slice(ordered.findIndex((row) => row.since === period.id))) {
          sql.exec(
            `UPDATE staff_history SET ${column} = ? WHERE staff_id = ? AND since = ?`,
            change.value,
            staff.id,
            row.since,
          );
        }
      } else {
        if (change.period_id !== undefined) invalid(`${column}.period_id`);
        sql.exec(
          `UPDATE staff_history SET ${column} = ? WHERE staff_id = ?`,
          change.value,
          staff.id,
        );
      }
    }
  }
  const latest = historyRows(sql, staff.id).at(-1);
  if (!latest) throw new Error('Staff history is missing');
  // The receiver advances revisions after write returns, in this same transaction.
  return readStaff(sql).map((row) =>
    row.id === staff.id ? { ...row, revision } : row,
  ) as unknown as JsonValue;
}
function deleteId(value: unknown): string {
  const item = object(value, 'data');
  keys(item, ['id'], [], 'data');
  return identifier(item.id, 'id');
}
function reorderIds(value: unknown): string[] {
  if (!Array.isArray(value)) invalid('ids');
  const ids = value.map((id) => identifier(id, 'ids'));
  if (new Set(ids).size !== ids.length) invalid('ids');
  return ids;
}
export const staffOperations: Readonly<Record<string, SaveOperation>> = {
  'staff.save': {
    validate(data) {
      parseSave(data);
    },
    targets(data) {
      return [{ unit: 'staff', id: parseSave(data).staff.id }];
    },
    write({ sql, revision }, data) {
      return saveStaff(sql, parseSave(data), revision);
    },
  },
  'staff.delete': {
    validate(data) {
      deleteId(data);
    },
    targets(data) {
      return [{ unit: 'staff', id: deleteId(data) }];
    },
    write({ sql }, data) {
      const id = deleteId(data);
      if (readStaff(sql).find((row) => row.id === id)?.in_use) invalid('in_use');
      sql.exec('DELETE FROM staff_history WHERE staff_id = ?', id);
      sql.exec('DELETE FROM staff WHERE id = ?', id);
      return readStaff(sql) as unknown as JsonValue;
    },
  },
  'staff.reorder': {
    validate(data) {
      reorderIds(data);
    },
    targets() {
      return [{ unit: 'staff-order' }];
    },
    write({ sql }, data) {
      const current = readStaff(sql).map((row) => row.id);
      const ids = reorderIds(data).filter((id) => current.includes(id));
      [...ids, ...current.filter((id) => !ids.includes(id))].forEach((id, index) =>
        sql.exec('UPDATE staff SET sort_order = ? WHERE id = ?', index, id),
      );
      return readStaff(sql) as unknown as JsonValue;
    },
  },
};
