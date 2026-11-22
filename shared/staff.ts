import type { PeriodSummary, Staff, StaffHistory } from './protocol';
import type { Facility } from './calendar';
import { japanDate } from './date';

export function splitStaffName(name: string): { familyName: string; givenName: string } {
  const separator = name.search(/[ \u3000]/);
  return separator < 0
    ? { familyName: name, givenName: '' }
    : { familyName: name.slice(0, separator), givenName: name.slice(separator + 1) };
}

export function joinStaffName(familyName: string, givenName: string): string {
  return givenName ? `${familyName} ${givenName}` : familyName;
}

export function staffFamilyName(name: string): string {
  return splitStaffName(name).familyName;
}

export interface DefaultWorkSlot {
  start: string;
  end: string;
}
export interface DefaultWorkPair {
  slot1: DefaultWorkSlot | null;
  slot2: DefaultWorkSlot | null;
}
export interface DefaultWorkTimes {
  normal: { first: DefaultWorkPair; second: DefaultWorkPair };
  peak: { first: DefaultWorkPair; second: DefaultWorkPair };
  saturday: DefaultWorkSlot | null;
}

export function workSlotsOverlap(left: DefaultWorkSlot, right: DefaultWorkSlot): boolean {
  return left.start < right.end && right.start < left.end;
}

export function staffAssignments(
  person: Pick<Staff, 'default_first_facility' | 'default_second_facility'>,
): { first: boolean; second: boolean } {
  return {
    first: person.default_first_facility !== null,
    second: person.default_second_facility !== null,
  };
}

export function requestedWorkAssignment(
  date: string,
  person: Pick<Staff, 'default_first_facility' | 'default_second_facility'>,
): {
  building: 1 | 2;
  facility: Facility | null;
} {
  if (new Date(`${date}T00:00:00Z`).getUTCDay() === 6) return { building: 1, facility: 'A' };
  return !staffAssignments(person).first
    ? { building: 2, facility: person.default_second_facility as Facility | null }
    : { building: 1, facility: person.default_first_facility as Facility | null };
}

// 閉、主、副、準備、抜、α。Y belongs to an individual work slot.
export const DEFAULT_STAFF_ROLES = [
  'closing',
  'lead',
  'deputy',
  'prep',
  'temporary_absence',
  'alpha',
] as const;
export type DefaultStaffRole = (typeof DEFAULT_STAFF_ROLES)[number];
export const MOVEMENT_ROLES = ['movement_first', 'movement_second'] as const;
export type MovementRole = (typeof MOVEMENT_ROLES)[number];
export const DAY_ROLES = [...DEFAULT_STAFF_ROLES, ...MOVEMENT_ROLES] as const;
export type DayRole = (typeof DAY_ROLES)[number];

export function movementRole(buildings: readonly (1 | 2)[]): MovementRole | null {
  const first = buildings.includes(1),
    second = buildings.includes(2);
  return first === second ? null : first ? 'movement_first' : 'movement_second';
}

export function roleFitsWork(role: string, buildings: readonly (1 | 2)[]): boolean {
  return !MOVEMENT_ROLES.some((value) => value === role) || role === movementRole(buildings);
}

export function suggestedMovementRole(
  person: Pick<Staff, 'default_first_facility' | 'default_second_facility'>,
  saturday: boolean,
  buildings: readonly (1 | 2)[],
): MovementRole | null {
  if (saturday) return null;
  const role = movementRole(buildings);
  const assigned = staffAssignments(person);
  return role === 'movement_first' && !assigned.first
    ? role
    : role === 'movement_second' && !assigned.second
      ? role
      : null;
}

export function validRoles(roles: readonly string[]): boolean {
  return (
    new Set(roles).size === roles.length && !(roles.includes('lead') && roles.includes('deputy'))
  );
}

export function orderedWorkPair(pair: DefaultWorkPair): DefaultWorkPair {
  if (!pair.slot1 && pair.slot2) return { slot1: pair.slot2, slot2: null };
  if (pair.slot1 && pair.slot2 && pair.slot2.start < pair.slot1.start)
    return { slot1: pair.slot2, slot2: pair.slot1 };
  return pair;
}

type HistoryPeriod = Pick<PeriodSummary, 'id' | 'start_date'>;

export function sortStaffHistory(
  history: readonly StaffHistory[],
  periods: readonly HistoryPeriod[],
): StaffHistory[] {
  const starts = new Map(periods.map((period) => [period.id, period.start_date]));
  const order = (row: StaffHistory): string => {
    if (row.since === 'initial') return '';
    if (row.since === 'pending') return 'pending';
    const start = starts.get(row.since);
    if (start === undefined) throw new Error('Staff history period is missing');
    return start;
  };
  return [...history].sort((left, right) => order(left).localeCompare(order(right)));
}

export function historyForPeriod(
  history: readonly StaffHistory[],
  periods: readonly HistoryPeriod[],
  startDate: string,
): StaffHistory | undefined {
  const starts = new Map(periods.map((period) => [period.id, period.start_date]));
  const effective = sortStaffHistory(history, periods).filter(
    (row) =>
      row.since === 'initial' || (row.since !== 'pending' && starts.get(row.since)! <= startDate),
  );
  return effective[effective.length - 1];
}

export function japanToday(now = new Date()): string {
  return japanDate(now);
}
export function currentEmploymentStatus(
  staff: Pick<Staff, 'employment_status' | 'leave_start_date' | 'leave_expected_end_date'>,
  today = japanToday(),
): Staff['employment_status'] {
  if (
    staff.employment_status === 'leave' &&
    ((staff.leave_start_date !== null && staff.leave_start_date > today) ||
      (staff.leave_expected_end_date !== null && staff.leave_expected_end_date < today))
  )
    return 'active';
  return staff.employment_status;
}
