import { facilities, resolvedDayOpening, type Facility } from '../../../shared/calendar';
import type {
  AnnualRules,
  CalendarRows,
  Identity,
  SavePreviewDay,
  Staff,
  WorkSlotTime,
} from '../../../shared/protocol';
import { staffAssignments, historyForPeriod, japanToday } from '../../../shared/staff';
import { readPeriods, readStaff } from '../reads/first-load';
import { type StoredDayState, type StoredWorkSlot, workSlotFromRow } from '../reads/period-load';
import { initialDayEntry } from './initial-entry';
import { defaultWorkBuildings, writeWorkDay, type WorkBuilding } from './work-day';

export function readWorkContext(sql: SqlStorage, periods = readPeriods(sql)) {
  return { periods, staff: readStaff(sql), today: japanToday() };
}
export type WorkContext = ReturnType<typeof readWorkContext>;
export interface DayWorkPlan extends SavePreviewDay {
  removals: { row: StoredWorkSlot; remaining: WorkSlotTime[] }[];
  working: Set<string>;
  entries: { person: Staff; work: NonNullable<ReturnType<typeof initialDayEntry>>['work'] }[];
}
export function dayOpenings(
  date: string,
  rules: AnnualRules,
  rows: CalendarRows,
  overrides: ReadonlyMap<Facility, boolean> = new Map(),
): Map<Facility, boolean> {
  return new Map(
    facilities.map((facility) => {
      if (overrides.has(facility)) return [facility, overrides.get(facility)!];
      const opening = resolvedDayOpening(date, facility, rows, rules);
      if (!opening) throw new Error('Opening rule is missing');
      return [facility, opening.isOpen];
    }),
  );
}
export function planDayWork(
  sql: SqlStorage,
  getContext: () => WorkContext,
  date: string,
  closed: ReadonlySet<Facility>,
  opened: ReadonlySet<Facility>,
  rules: AnnualRules,
  openings: () => ReadonlyMap<Facility, boolean>,
): DayWorkPlan {
  const plan: DayWorkPlan = {
    date,
    closed: [...closed],
    opened: [...opened],
    remove: [],
    add: [],
    paid_leave: [],
    removals: [],
    working: new Set(),
    entries: [],
  };
  if (!closed.size && !opened.size) return plan;
  const context = getContext();
  const period = context.periods.find(
    (row) => row.start_date <= date && row.end_date >= date && row.end_date >= context.today,
  );
  if (!period) return plan;
  const states = new Map(
    sql
      .exec<StoredDayState>('SELECT * FROM day_states WHERE date = ?', date)
      .toArray()
      .map((row) => [row.staff_id, row]),
  );
  if (closed.size)
    plan.paid_leave = context.staff
      .filter((person) => states.get(person.id)?.status === 'paid_leave')
      .map((person) => person.id);
  if (plan.paid_leave.length) return plan;
  const affected = new Set<string>();
  for (const row of sql
    .exec<StoredWorkSlot>('SELECT * FROM work_slots WHERE date = ?', date)
    .toArray()) {
    const slots = workSlotFromRow(row).slots;
    const remaining = slots.filter((slot) => !closed.has(slot.facility));
    if (remaining.length) plan.working.add(row.staff_id);
    if (remaining.length !== slots.length) {
      affected.add(row.staff_id);
      plan.removals.push({ row, remaining });
    }
  }
  plan.remove = context.staff
    .filter((person) => affected.has(person.id))
    .map((person) => person.id);
  const available = openings();
  const saturday = new Date(`${date}T00:00:00Z`).getUTCDay() === 6;
  for (const person of context.staff) {
    if (plan.working.has(person.id)) continue;
    const state = states.get(person.id);
    const assigned = (['first', 'second'] as const)
      .filter((group) => staffAssignments(person)[group])
      .map(
        (group) =>
          (group === 'first'
            ? person.default_first_facility
            : person.default_second_facility) as Facility,
      );
    const canOpen =
      opened.size > 0 &&
      (saturday ? opened.has('A') : assigned.some((facility) => opened.has(facility))) &&
      (!state || state.status === 'none');
    if (!canOpen) continue;
    const history = historyForPeriod(person.history, context.periods, period.start_date);
    if (!history) throw new Error('Effective staff history is missing');
    const entry = initialDayEntry(person, date, history.employment_type, rules, available);
    if (!entry) continue;
    const work = entry.work.filter((item) => opened.has(item.facility));
    if (!work.length) continue;
    plan.entries.push({ person, work });
    plan.add.push(person.id);
  }
  return plan;
}
export function writeDayWork(
  sql: SqlStorage,
  plan: DayWorkPlan,
  identity: Identity,
  revision: number,
): void {
  const { date, working, remove: affected } = plan;
  const savedAt = new Date().toISOString();
  const changes = new Map<string, Map<1 | 2, WorkBuilding>>();
  for (const { row, remaining } of plan.removals) {
    if (!changes.has(row.staff_id)) changes.set(row.staff_id, new Map());
    changes.get(row.staff_id)!.set(row.building, { building: row.building, slots: remaining });
  }
  const entries = new Map(plan.entries.map((entry) => [entry.person.id, entry]));
  for (const { person, work } of plan.entries) {
    if (!changes.has(person.id)) changes.set(person.id, new Map());
    for (const item of defaultWorkBuildings(work)) changes.get(person.id)!.set(item.building, item);
  }
  for (const id of new Set([...affected, ...entries.keys()])) {
    const entry = entries.get(id);
    writeWorkDay(sql, {
      staff_id: id,
      date,
      buildings: [...changes.get(id)!.values()],
      state: entry
        ? {
            status: 'none',
            roles: JSON.stringify(entry.person.default_roles),
            special_care: false,
          }
        : { keepRoles: working.has(id) },
      last_changed_by: identity.role,
      last_changed_at: savedAt,
      revision,
    });
  }
}
