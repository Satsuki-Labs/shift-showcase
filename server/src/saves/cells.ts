import { allFacilitiesClosed } from '../../../shared/calendar';
import { isValidDate } from '../../../shared/date';
import { readCalendarRows } from '../reads/year-load';
import { AppError } from '../../../shared/app-error';
import type {
  DayState,
  JsonValue,
  RevisionTarget,
  ShiftBulkSaveInput,
  ShiftCellCancelInput,
  ShiftCellChangedData,
  ShiftCellSaveInput,
  WorkSlotTime,
} from '../../../shared/protocol';
import { DAY_ROLES, validRoles } from '../../../shared/staff';
import {
  dayStateFromRow,
  workSlotFromRow,
  type StoredDayState,
  type StoredWorkSlot,
} from '../reads/period-load';
import { readAnnualRules, readStaff } from '../reads/first-load';
import type { SaveOperation } from './operations';
import {
  validateWorkSlotCount,
  validateWorkSlotTime,
  validateWorkSlots,
  writeWorkDay,
} from './work-day';

function invalid(field: string): never {
  throw new AppError('E-32', field);
}
function object(value: unknown, fields: readonly string[], field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(field);
  const row = value as Record<string, unknown>;
  for (const key of fields) if (!Object.hasOwn(row, key)) invalid(key);
  if (Object.keys(row).length !== fields.length) invalid(field);
  return row;
}
function personDate(row: Record<string, unknown>): { staff_id: string; date: string } {
  if (typeof row.staff_id !== 'string' || !row.staff_id.trim()) invalid('staff_id');
  if (!isValidDate(row.date)) invalid('date');
  return { staff_id: row.staff_id, date: row.date };
}
function building(value: unknown): 1 | 2 {
  if (value !== 1 && value !== 2) invalid('building');
  return value;
}
export function parseSave(value: unknown): ShiftCellSaveInput {
  const row = object(
    value,
    ['staff_id', 'date', 'status', 'roles', 'special_care', 'buildings', 'notes'],
    'data',
  );
  const keys = personDate(row);
  if (!['none', 'paid_leave', 'empty'].includes(row.status as string)) invalid('status');
  if (
    !Array.isArray(row.roles) ||
    !row.roles.every((role) => DAY_ROLES.includes(role)) ||
    !validRoles(row.roles)
  )
    invalid('roles');
  if (typeof row.special_care !== 'boolean') invalid('special_care');
  if (row.notes !== null && typeof row.notes !== 'string') invalid('notes');
  if (!Array.isArray(row.buildings)) invalid('buildings');
  const buildings = row.buildings.map((raw) => {
    const item = object(raw, ['building', 'slots'], 'buildings'),
      group = building(item.building);
    if (!Array.isArray(item.slots)) invalid('slots');
    validateWorkSlotCount(item.slots, invalid);
    const slots = item.slots.map((rawSlot) => {
      const slot = object(rawSlot, ['start_time', 'end_time', 'facility', 'is_office'], 'slots');
      const { start_time, end_time } = validateWorkSlotTime(
        { start_time: slot.start_time, end_time: slot.end_time },
        invalid,
      );
      if (!(group === 1 ? ['A', 'B'] : ['C', 'D']).includes(slot.facility as string))
        invalid('facility');
      if (typeof slot.is_office !== 'boolean') invalid('is_office');
      return {
        start_time,
        end_time,
        facility: slot.facility as WorkSlotTime['facility'],
        is_office: slot.is_office,
      };
    }) as ShiftCellSaveInput['buildings'][number]['slots'];
    validateWorkSlots(slots, invalid);
    return { building: group, slots };
  });
  if (new Set(buildings.map((item) => item.building)).size !== buildings.length)
    invalid('buildings');
  if (row.status !== 'none') {
    if (buildings.length) invalid('buildings');
    if (row.roles.length) invalid('roles');
    if (row.special_care) invalid('special_care');
  }
  return {
    ...keys,
    status: row.status as DayState['status'],
    roles: row.roles,
    special_care: row.special_care,
    buildings,
    notes: row.notes as string | null,
  };
}
function parseCancel(value: unknown): ShiftCellCancelInput {
  const row = object(value, ['staff_id', 'date', 'building'], 'data');
  return { ...personDate(row), building: building(row.building) };
}
function checkPersonDate(sql: SqlStorage, input: { staff_id: string; date: string }) {
  const staff = sql.exec('SELECT id FROM staff WHERE id = ?', input.staff_id).toArray()[0];
  if (!staff) invalid('staff_id');
  if (
    !sql
      .exec(
        'SELECT 1 FROM periods WHERE start_date <= ? AND end_date >= ? LIMIT 1',
        input.date,
        input.date,
      )
      .toArray().length
  )
    invalid('date');
}
function changedData(
  sql: SqlStorage,
  input: { staff_id: string; date: string },
): ShiftCellChangedData {
  const row = sql
    .exec<StoredDayState>(
      'SELECT * FROM day_states WHERE staff_id = ? AND date = ?',
      input.staff_id,
      input.date,
    )
    .toArray()[0];
  const dayState = row ? dayStateFromRow(row) : null;
  const workSlots = sql
    .exec<StoredWorkSlot>(
      'SELECT * FROM work_slots WHERE staff_id = ? AND date = ? ORDER BY building',
      input.staff_id,
      input.date,
    )
    .toArray()
    .map(workSlotFromRow);
  return { staff_id: input.staff_id, date: input.date, dayState, workSlots, staff: null };
}
function targets(
  input: { staff_id: string; date: string },
  groups: readonly (1 | 2)[],
): RevisionTarget[] {
  return [
    { unit: 'day-state', staffId: input.staff_id, date: input.date },
    ...groups.map((group) => ({
      unit: 'work-slot' as const,
      staffId: input.staff_id,
      date: input.date,
      building: group,
    })),
  ];
}
function parseBulk(value: unknown): ShiftBulkSaveInput {
  const row = object(value, ['cells'], 'data');
  if (!Array.isArray(row.cells) || row.cells.length < 1 || row.cells.length > 62) invalid('cells');
  const cells = row.cells.map(parseSave);
  if (cells.some((cell) => cell.staff_id !== cells[0].staff_id)) invalid('staff_id');
  if (new Set(cells.map((cell) => cell.date)).size !== cells.length) invalid('date');
  for (const cell of cells) {
    if (cell.notes !== null) invalid('notes');
  }
  return { cells };
}
function saveTargets(input: ShiftCellSaveInput): RevisionTarget[] {
  const result = targets(
    input,
    input.status === 'none' ? input.buildings.map((item) => item.building) : [1, 2],
  );
  if (input.notes !== null) result.push({ unit: 'staff', id: input.staff_id });
  return result;
}
function writeCell(
  { sql, identity }: Parameters<SaveOperation['write']>[0],
  input: ShiftCellSaveInput,
  savedAt: string,
  revision: number,
  confirmUnchanged = false,
): ShiftCellChangedData {
  checkPersonDate(sql, input);
  const before = changedData(sql, input);
  if (
    input.status === 'paid_leave' &&
    before.dayState?.status !== 'paid_leave' &&
    allFacilitiesClosed(
      input.date,
      readAnnualRules(sql),
      readCalendarRows(sql, input.date, input.date).facilityDays,
    )
  )
    invalid('status');
  const remaining =
    input.status === 'none'
      ? [
          ...before.workSlots.filter(
            (item) => !input.buildings.some((sent) => sent.building === item.building),
          ),
          ...input.buildings.filter((item) => item.slots.length),
        ]
      : [];
  if (!remaining.length) {
    if (input.roles.length) invalid('roles');
    if (input.special_care) invalid('special_care');
  }
  writeWorkDay(
    sql,
    {
      staff_id: input.staff_id,
      date: input.date,
      buildings: input.buildings,
      state: {
        status: input.status,
        roles: JSON.stringify(input.roles),
        special_care: input.special_care,
      },
      replaceAll: input.status !== 'none',
      preserveUnchanged: true,
      confirmUnchanged,
      last_changed_by: identity.role,
      last_changed_at: savedAt,
      revision,
    },
    invalid,
  );
  const changed = changedData(sql, input);
  if (input.notes !== null) {
    sql.exec(
      'UPDATE staff SET notes = ?, revision = ? WHERE id = ?',
      input.notes,
      revision,
      input.staff_id,
    );
    changed.staff = readStaff(sql).find((person) => person.id === input.staff_id)!;
  }
  return changed;
}

export const cellOperations: Readonly<Record<string, SaveOperation>> = {
  'shift.cell.save': {
    validate(data) {
      parseSave(data);
    },
    targets(data) {
      return saveTargets(parseSave(data));
    },
    write(context, data) {
      const input = parseSave(data);
      return writeCell(
        context,
        input,
        new Date().toISOString(),
        context.revision,
        input.notes === null,
      ) as unknown as JsonValue;
    },
  },
  'shift.bulk.save': {
    validate(data) {
      parseBulk(data);
    },
    targets(data) {
      return parseBulk(data).cells.flatMap(saveTargets);
    },
    write(context, data) {
      const { cells } = parseBulk(data),
        savedAt = new Date().toISOString();
      const { revision } = context;
      return {
        cells: cells.map((input) => writeCell(context, input, savedAt, revision)),
      } as unknown as JsonValue;
    },
  },
  'shift.cell.cancel': {
    validate(data) {
      parseCancel(data);
    },
    targets(data) {
      const input = parseCancel(data);
      return targets(input, [input.building]);
    },
    write({ sql, identity, revision }, data) {
      const input = parseCancel(data);
      const before = changedData(sql, { staff_id: input.staff_id, date: input.date });
      if (!before.workSlots.some((item) => item.building === input.building)) invalid('building');
      const remaining = before.workSlots.some((item) => item.building !== input.building);
      writeWorkDay(
        sql,
        {
          staff_id: input.staff_id,
          date: input.date,
          buildings: [{ building: input.building, slots: [] }],
          state: { keepRoles: remaining },
          last_changed_by: identity.role,
          last_changed_at: new Date().toISOString(),
          revision,
        },
        invalid,
      );
      return changedData(sql, {
        staff_id: input.staff_id,
        date: input.date,
      }) as unknown as JsonValue;
    },
  },
};
