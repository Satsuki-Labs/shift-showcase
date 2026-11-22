import type { AnnualRules, Staff, StaffHistory } from './protocol';
import { isValidDate } from './date';
import {
  MAX_PERIOD_BUDGET,
  MAX_QUARTER_HOUR_PAY,
  MAX_STAFF_NAME_LENGTH,
  MAX_STAFF_NOTES_LENGTH,
  validIdentifier,
} from './limits';
import { DEFAULT_STAFF_ROLES, validRoles, workSlotsOverlap, type DefaultWorkTimes } from './staff';

// Kept independently of Staff so additions to the live record do not change stored snapshots.
export interface SnapshotStaff {
  id: string;
  name: string;
  notes: string;
  sort_order: number;
  default_first_facility: string | null;
  default_second_facility: string | null;
  default_work_times: DefaultWorkTimes;
  default_roles: Staff['default_roles'];
  employment_status: Staff['employment_status'];
  leave_start_date: string | null;
  leave_expected_end_date: string | null;
  history: StaffHistory[];
}
export interface PeriodSnapshot {
  staff: SnapshotStaff[];
  annualClosures: AnnualRules['annualClosures'];
}
export interface PeriodStaff extends SnapshotStaff {
  revision: number | null;
}

export function snapshotStaff(person: SnapshotStaff): SnapshotStaff {
  const {
    id,
    name,
    notes,
    sort_order,
    default_first_facility,
    default_second_facility,
    default_work_times,
    default_roles,
    employment_status,
    leave_start_date,
    leave_expected_end_date,
    history,
  } = person;
  return {
    id,
    name,
    notes,
    sort_order,
    default_first_facility,
    default_second_facility,
    default_work_times,
    default_roles,
    employment_status,
    leave_start_date,
    leave_expected_end_date,
    history: history.map(
      ({ staff_id, since, quarter_hour_pay, employment_type, qualification, budget }) => ({
        staff_id,
        since,
        quarter_hour_pay,
        employment_type,
        qualification,
        budget,
      }),
    ),
  };
}
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function workSlot(value: unknown): boolean {
  if (value === null) return true;
  const time = (value: unknown): value is string =>
    typeof value === 'string' &&
    /^\d{2}:[0-5]\d$/.test(value) &&
    value >= '07:00' &&
    value <= '22:00';
  return object(value) && time(value.start) && time(value.end) && value.start < value.end;
}
function workTimes(value: unknown): boolean {
  if (!object(value) || !workSlot(value.saturday)) return false;
  return ['normal', 'peak'].every((kind) => {
    const group = value[kind];
    if (!object(group)) return false;
    const slots = ['first', 'second'].flatMap((site) => {
      const pair = group[site];
      return object(pair) ? [pair.slot1, pair.slot2] : [undefined];
    });
    if (!slots.every(workSlot)) return false;
    const present = slots.filter((slot) => slot !== null) as { start: string; end: string }[];
    return present.every((slot, index) =>
      present.slice(index + 1).every((other) => !workSlotsOverlap(slot, other)),
    );
  });
}
export function isSnapshotStaff(value: unknown): value is SnapshotStaff {
  if (!object(value)) return false;
  const number = (value: unknown, max: number) =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max;
  const {
    id,
    name,
    notes,
    default_first_facility: first,
    default_second_facility: second,
    history,
  } = value;
  return (
    validIdentifier(id) &&
    typeof name === 'string' &&
    Boolean(name.trim()) &&
    name.trim().length <= MAX_STAFF_NAME_LENGTH &&
    typeof notes === 'string' &&
    notes.length <= MAX_STAFF_NOTES_LENGTH &&
    Number.isSafeInteger(value.sort_order) &&
    (first === null || first === 'A' || first === 'B') &&
    (second === null || second === 'C' || second === 'D') &&
    (first !== null || second !== null) &&
    workTimes(value.default_work_times) &&
    Array.isArray(value.default_roles) &&
    value.default_roles.every((role) => DEFAULT_STAFF_ROLES.includes(role)) &&
    validRoles(value.default_roles) &&
    ['active', 'leave', 'retired'].includes(value.employment_status as string) &&
    (value.employment_status === 'leave'
      ? isValidDate(value.leave_start_date) &&
        (value.leave_expected_end_date === null ||
          (isValidDate(value.leave_expected_end_date) &&
            value.leave_expected_end_date >= value.leave_start_date))
      : value.leave_start_date === null && value.leave_expected_end_date === null) &&
    Array.isArray(history) &&
    history.length <= 1 &&
    history.every(
      (item) =>
        object(item) &&
        item.staff_id === id &&
        item.since === 'initial' &&
        number(item.quarter_hour_pay, MAX_QUARTER_HOUR_PAY) &&
        number(item.budget, MAX_PERIOD_BUDGET) &&
        ['full_time', 'part_time', 'casual'].includes(item.employment_type as string) &&
        ['certified', 'assistant', 'none'].includes(item.qualification as string),
    )
  );
}

// staff_format 0 is the original format; 1 already contains SnapshotStaff records.
// All readers use this conversion.
export function readSnapshotStaff(value: unknown, format: unknown): SnapshotStaff[] {
  if (
    (format !== 0 && format !== 1) ||
    !Array.isArray(value) ||
    !value.every((person) => object(person) && Array.isArray(person.history)) ||
    new Set(value.map((person) => person.id)).size !== value.length
  )
    throw new Error('Invalid period snapshot');
  return format === 0 ? (value as SnapshotStaff[]).map(snapshotStaff) : (value as SnapshotStaff[]);
}
