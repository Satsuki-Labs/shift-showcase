import {
  facilities,
  dayOpening,
  resolvedDayOpening,
  type Facility,
} from '../../../shared/calendar';
import { periodDates } from '../../../shared/period';
import type { AnnualRules, PeriodSaveInput, Staff, StaffHistory } from '../../../shared/protocol';
import {
  staffAssignments,
  historyForPeriod,
  type DefaultWorkPair,
  type DefaultWorkSlot,
} from '../../../shared/staff';
import { readAnnualRules, readPeriods, readStaff } from '../reads/first-load';
import { readCalendarRows } from '../reads/year-load';
import { defaultWorkBuildings, writeWorkDay } from './work-day';

function isPresent(staff: Staff, date: string): boolean {
  if (staff.retirement_date !== null && date > staff.retirement_date) return false;
  return !(
    staff.employment_status === 'leave' &&
    staff.leave_start_date !== null &&
    date >= staff.leave_start_date &&
    (staff.leave_expected_end_date === null || date <= staff.leave_expected_end_date)
  );
}
interface InitialWork {
  building: 1 | 2;
  facility: Facility;
  first: DefaultWorkSlot;
  second: DefaultWorkSlot | null;
}
function workPair(
  building: 1 | 2,
  facility: Facility,
  pair: DefaultWorkPair,
): InitialWork | undefined {
  const first = pair.slot1 ?? pair.slot2;
  return first ? { building, facility, first, second: pair.slot1 ? pair.slot2 : null } : undefined;
}

export function initialDayEntry(
  person: Staff,
  date: string,
  employmentType: StaffHistory['employment_type'],
  rules: AnnualRules,
  openings: ReadonlyMap<Facility, boolean>,
): { work: InitialWork[] } | null {
  if (!isPresent(person, date) || [...openings.values()].every((open) => !open)) return null;
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  const ordinarilyOpen = dayOpening(date, 'A', rules)?.isOpen === true;
  const kind = rules.peaks.some((row) => row.start_date <= date && date <= row.end_date)
    ? 'peak'
    : 'normal';
  const fullTime = employmentType === 'full_time';
  if (
    employmentType === 'casual' ||
    (!fullTime && (weekday === 0 || weekday === 6 || !ordinarilyOpen))
  )
    return null;
  const work: InitialWork[] = [];
  if (weekday === 6 && openings.get('A')) {
    if (fullTime && person.default_work_times.saturday)
      work.push({
        building: 1,
        facility: 'A',
        first: person.default_work_times.saturday,
        second: null,
      });
  } else if (weekday !== 6) {
    const groups = (['first', 'second'] as const).filter(
      (group) => staffAssignments(person)[group],
    );
    const assigned = groups.map((group) => ({
      building: group === 'first' ? (1 as const) : (2 as const),
      facility: (group === 'first'
        ? person.default_first_facility
        : person.default_second_facility) as Facility | null,
      pair: person.default_work_times[kind][group],
    }));
    if (assigned.some((group) => group.facility === null))
      throw new Error('Default facility is missing');
    for (const group of assigned) {
      if (!openings.get(group.facility!)) continue;
      const item = workPair(group.building, group.facility!, group.pair);
      if (item) work.push(item);
    }
  }
  return { work };
}

export function initializePeriodDays(
  sql: SqlStorage,
  period: PeriodSaveInput,
  revision: number,
  before?: { start_date: string; end_date: string },
) {
  const rules = readAnnualRules(sql),
    rows = readCalendarRows(sql, period.start_date, period.end_date),
    staff = readStaff(sql);
  const periods = readPeriods(sql);
  const existing = new Set(
    sql
      .exec<{ staff_id: string; date: string }>(
        'SELECT staff_id, date FROM day_states WHERE date BETWEEN ? AND ? UNION SELECT staff_id, date FROM work_slots WHERE date BETWEEN ? AND ?',
        period.start_date,
        period.end_date,
        period.start_date,
        period.end_date,
      )
      .toArray()
      .map((row) => `${row.staff_id}:${row.date}`),
  );
  const savedAt = new Date().toISOString();
  for (const date of periodDates(period)) {
    if (before && date >= before.start_date && date <= before.end_date) continue;
    const openings = new Map(
      facilities.map((facility) => {
        const opening = resolvedDayOpening(date, facility, rows, rules);
        if (!opening) throw new Error('Opening rule is missing');
        return [facility, opening.isOpen];
      }),
    );
    for (const person of staff) {
      if (existing.has(`${person.id}:${date}`)) continue;
      const history = historyForPeriod(person.history, periods, period.start_date);
      if (!history) throw new Error('Effective staff history is missing');
      const entry = initialDayEntry(person, date, history.employment_type, rules, openings);
      if (!entry) continue;
      const { work } = entry;
      if (!work.length) continue;
      writeWorkDay(sql, {
        staff_id: person.id,
        date,
        buildings: defaultWorkBuildings(work),
        state: {
          status: 'none',
          roles: JSON.stringify(person.default_roles),
          special_care: false,
        },
        last_changed_by: 'initial',
        last_changed_at: savedAt,
        revision,
      });
    }
  }
}
