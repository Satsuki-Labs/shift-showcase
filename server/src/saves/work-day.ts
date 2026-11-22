import type { Facility } from '../../../shared/calendar';
import type { DayState, WorkSlotTime } from '../../../shared/protocol';
import { roleFitsWork, workSlotsOverlap, type DefaultWorkSlot } from '../../../shared/staff';
import { workSlotFromRow, type StoredDayState, type StoredWorkSlot } from '../reads/period-load';

export interface WorkBuilding {
  building: 1 | 2;
  slots: readonly WorkSlotTime[];
}
type RejectWork = (field: string) => never;
function invalidWork(field: string): never {
  throw new Error(`Invalid work day: ${field}`);
}

export function validateWorkSlotCount(
  slots: readonly unknown[],
  reject: RejectWork = invalidWork,
): void {
  if (slots.length > 2) reject('slots');
}
export function validateWorkSlotTime(
  slot: { start_time: unknown; end_time: unknown },
  reject: RejectWork = invalidWork,
): { start_time: string; end_time: string } {
  function time(value: unknown, field: string): string {
    if (
      typeof value !== 'string' ||
      !/^\d{2}:[0-5]\d$/.test(value) ||
      value < '07:00' ||
      value > '22:00'
    )
      reject(field);
    return value;
  }
  const start_time = time(slot.start_time, 'start_time'),
    end_time = time(slot.end_time, 'end_time');
  if (end_time <= start_time) reject('end_time');
  return { start_time, end_time };
}
export function validateWorkSlots(
  slots: readonly WorkSlotTime[],
  reject: RejectWork = invalidWork,
): void {
  validateWorkSlotCount(slots, reject);
  for (const slot of slots) validateWorkSlotTime(slot, reject);
  if (slots.length === 2 && slots[0].end_time > slots[1].start_time) reject('slots');
}
export function validateWorkDay(
  buildings: readonly WorkBuilding[],
  reject: RejectWork = invalidWork,
): void {
  for (const item of buildings) validateWorkSlots(item.slots, reject);
  for (const left of buildings)
    for (const right of buildings) {
      if (left.building >= right.building) continue;
      if (
        left.slots.some((a) =>
          right.slots.some((b) =>
            workSlotsOverlap(
              { start: a.start_time, end: a.end_time },
              { start: b.start_time, end: b.end_time },
            ),
          ),
        )
      )
        reject('buildings');
    }
}

export function defaultWorkBuildings(
  work: readonly {
    building: 1 | 2;
    facility: Facility;
    first: DefaultWorkSlot;
    second: DefaultWorkSlot | null;
  }[],
): WorkBuilding[] {
  return work.map((item) => ({
    building: item.building,
    slots: [item.first, ...(item.second ? [item.second] : [])].map((slot) => ({
      start_time: slot.start,
      end_time: slot.end,
      facility: item.facility,
      is_office: false,
    })),
  }));
}

type WorkDayState =
  { status: DayState['status']; roles: string; special_care: boolean } | { keepRoles: boolean };
interface WorkDayWrite {
  staff_id: string;
  date: string;
  buildings: readonly WorkBuilding[];
  state: WorkDayState;
  last_changed_by: string;
  last_changed_at: string;
  revision: number;
  replaceAll?: boolean;
  preserveUnchanged?: boolean;
  confirmUnchanged?: boolean;
}

// The caller owns the transaction. Validate only the complete work that will remain.
export function writeWorkDay(
  sql: SqlStorage,
  input: WorkDayWrite,
  reject: RejectWork = invalidWork,
): void {
  const { staff_id, date, buildings, last_changed_by, last_changed_at, revision } = input;
  let { state } = input;
  const beforeWork = sql
    .exec<StoredWorkSlot>(
      'SELECT * FROM work_slots WHERE staff_id = ? AND date = ?',
      staff_id,
      date,
    )
    .toArray()
    .map(workSlotFromRow);
  const remaining = input.replaceAll
    ? []
    : beforeWork.filter((row) => !buildings.some((item) => item.building === row.building));
  const complete = [...remaining, ...buildings];
  validateWorkDay(complete, reject);
  const workingBuildings = complete
    .filter((item) => item.slots.length)
    .map((item) => item.building);
  if (
    !('keepRoles' in state) &&
    !(JSON.parse(state.roles) as string[]).every((role) => roleFitsWork(role, workingBuildings))
  )
    reject('roles');
  if ('keepRoles' in state) {
    const before = sql
      .exec<Pick<StoredDayState, 'status' | 'roles' | 'special_care'>>(
        'SELECT status, roles, special_care FROM day_states WHERE staff_id = ? AND date = ?',
        staff_id,
        date,
      )
      .toArray()[0];
    const roles: string[] = state.keepRoles && before ? JSON.parse(before.roles) : [];
    state = {
      status: before?.status ?? 'none',
      roles: JSON.stringify(roles.filter((role) => roleFitsWork(role, workingBuildings))),
      special_care: state.keepRoles && before ? Boolean(before.special_care) : false,
    };
  }
  const beforeState = sql
    .exec<StoredDayState>(
      'SELECT * FROM day_states WHERE staff_id = ? AND date = ?',
      staff_id,
      date,
    )
    .toArray()[0];
  const stateChanged =
    !beforeState ||
    beforeState.status !== state.status ||
    JSON.stringify((JSON.parse(beforeState.roles) as string[]).sort()) !==
      JSON.stringify((JSON.parse(state.roles) as string[]).sort()) ||
    Boolean(beforeState.special_care) !== state.special_care;
  const changedBuildings = buildings.filter((item) => {
    const before = beforeWork.find((row) => row.building === item.building)?.slots ?? [];
    return (
      before.length !== item.slots.length ||
      item.slots.some((slot, index) => {
        const old = before[index];
        return (
          old.start_time !== slot.start_time ||
          old.end_time !== slot.end_time ||
          old.facility !== slot.facility ||
          old.is_office !== slot.is_office
        );
      })
    );
  });
  const removedBuildings = input.replaceAll
    ? beforeWork.filter((row) => !buildings.some((item) => item.building === row.building))
    : [];
  // A single-cell save with no changes acknowledges the other editor. Notes-only and bulk saves do not.
  const confirm =
    input.confirmUnchanged && !stateChanged && !changedBuildings.length && !removedBuildings.length;
  if (!input.preserveUnchanged || stateChanged || confirm)
    sql.exec(
      `INSERT INTO day_states (staff_id, date, status, roles, special_care, last_changed_by, last_changed_at, revision)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (staff_id, date) DO UPDATE SET status = excluded.status,
    roles = excluded.roles, special_care = excluded.special_care,
    last_changed_by = excluded.last_changed_by, last_changed_at = excluded.last_changed_at, revision = excluded.revision`,
      staff_id,
      date,
      state.status,
      state.roles,
      Number(state.special_care),
      last_changed_by,
      last_changed_at,
      revision,
    );
  if (input.replaceAll && !input.preserveUnchanged)
    sql.exec('DELETE FROM work_slots WHERE staff_id = ? AND date = ?', staff_id, date);
  for (const item of input.preserveUnchanged
    ? [
        ...changedBuildings,
        ...removedBuildings.map((row) => ({ building: row.building, slots: [] })),
      ]
    : buildings) {
    if (!input.replaceAll || input.preserveUnchanged)
      sql.exec(
        'DELETE FROM work_slots WHERE staff_id = ? AND date = ? AND building = ?',
        staff_id,
        date,
        item.building,
      );
    const [first, second] = item.slots;
    if (!first) continue;
    sql.exec(
      `INSERT INTO work_slots (staff_id, date, building, first_start_time, first_end_time, first_facility, first_is_office,
      second_start_time, second_end_time, second_facility, second_is_office, last_changed_by, last_changed_at, revision)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      staff_id,
      date,
      item.building,
      first.start_time,
      first.end_time,
      first.facility,
      Number(first.is_office),
      second?.start_time ?? null,
      second?.end_time ?? null,
      second?.facility ?? null,
      Number(second?.is_office ?? false),
      last_changed_by,
      last_changed_at,
      revision,
    );
  }
}
