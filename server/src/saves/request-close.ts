import { resolvedDayOpening, type Facility } from '../../../shared/calendar';
import type { DailyRequest, ReplacedShift, Staff, StaffHistory } from '../../../shared/protocol';
import { historyForPeriod, japanToday, requestedWorkAssignment } from '../../../shared/staff';
import {
  dayStateFromRow,
  workSlotFromRow,
  type StoredDayState,
  type StoredWorkSlot,
} from '../reads/period-load';
import { readRequestClosedDates, type RequestPeriod } from '../reads/request-sheet';
import { readAnnualRules } from '../reads/first-load';
import { readCalendarRows } from '../reads/year-load';
import { writeWorkDay } from './work-day';

// Like the other synchronous save writers, the caller owns the transaction and change number.
export function closeRequests(
  sql: SqlStorage,
  periodId: string,
  revision: number,
  now = new Date(),
): void {
  const period = sql
    .exec<{ [K in keyof RequestPeriod]: RequestPeriod[K] }>(
      'SELECT * FROM periods WHERE id = ?',
      periodId,
    )
    .one();
  if (period.requests_closed_at) return;
  const changedAt = now.toISOString();
  sql.exec(
    'UPDATE periods SET requests_closed_at = ?, revision = ? WHERE id = ?',
    changedAt,
    revision,
    periodId,
  );
  if (period.end_date < japanToday(now)) return;

  const closedDates = new Set(readRequestClosedDates(sql, period));
  const histories = sql
    .exec<{ [K in keyof StaffHistory]: StaffHistory[K] }>('SELECT * FROM staff_history')
    .toArray();
  const periods = sql
    .exec<{ id: string; start_date: string }>('SELECT id, start_date FROM periods')
    .toArray();
  const requests = sql
    .exec<Pick<DailyRequest, 'staff_id' | 'date' | 'kind' | 'start_time' | 'end_time'>>(
      "SELECT staff_id, date, kind, start_time, end_time FROM daily_requests INDEXED BY daily_requests_date WHERE date BETWEEN ? AND ? AND kind IN ('unavailable', 'available') ORDER BY date, staff_id",
      period.start_date,
      period.end_date,
    )
    .toArray();
  const calendar = requests.some((row) => row.kind === 'available')
    ? {
        rules: readAnnualRules(sql),
        rows: readCalendarRows(sql, period.start_date, period.end_date),
      }
    : null;
  for (const request of requests) {
    const { staff_id: staffId, date } = request;
    const history = historyForPeriod(
      histories.filter((row) => row.staff_id === staffId),
      periods,
      period.start_date,
    );
    if (!history) throw new Error('Staff employment history is missing');
    const available = request.kind === 'available';
    if (available ? history.employment_type !== 'casual' : history.employment_type === 'casual')
      continue;
    let assignment: { building: 1 | 2; facility: Facility; roles: string } | undefined;
    if (available) {
      const person = sql
        .exec<
          Pick<Staff, 'default_first_facility' | 'default_second_facility'> & {
            default_roles: string;
          }
        >(
          'SELECT default_first_facility, default_second_facility, default_roles FROM staff WHERE id = ?',
          staffId,
        )
        .one();
      const { building, facility } = requestedWorkAssignment(date, person);
      if (facility === null) throw new Error('Default facility is missing');
      const opening = resolvedDayOpening(date, facility, calendar!.rows, calendar!.rules);
      if (!opening) throw new Error('Opening rule is missing');
      if (closedDates.has(date) || !opening.isOpen) continue;
      assignment = { building, facility, roles: person.default_roles };
    }
    const stateRow = sql
      .exec<StoredDayState>(
        'SELECT * FROM day_states WHERE staff_id = ? AND date = ?',
        staffId,
        date,
      )
      .toArray()[0];
    const state = stateRow ? dayStateFromRow(stateRow) : null;
    if (
      history.employment_type === 'full_time' &&
      (new Date(`${date}T00:00:00Z`).getUTCDay() === 6 ||
        closedDates.has(date) ||
        state?.status === 'paid_leave')
    )
      continue;
    const work = sql
      .exec<StoredWorkSlot>(
        'SELECT * FROM work_slots WHERE staff_id = ? AND date = ? ORDER BY building',
        staffId,
        date,
      )
      .toArray()
      .map(workSlotFromRow);
    if (
      history.employment_type === 'part_time' &&
      !work.length &&
      (!state || state.status === 'none')
    )
      continue;
    const replaced: ReplacedShift = {
      status: state?.status ?? 'none',
      roles: state?.roles ?? [],
      special_care: state?.special_care ?? false,
      buildings: work.map(({ building, slots }) => ({ building, slots })),
    };
    if (!available || work.length || (state && state.status !== 'none')) {
      sql.exec(
        'UPDATE daily_requests SET replaced_shift = ?, revision = ? WHERE staff_id = ? AND date = ?',
        JSON.stringify(replaced),
        revision,
        staffId,
        date,
      );
    }
    writeWorkDay(sql, {
      staff_id: staffId,
      date,
      replaceAll: true,
      buildings: assignment
        ? [
            {
              building: assignment.building,
              slots: [
                {
                  start_time: request.start_time!,
                  end_time: request.end_time!,
                  facility: assignment.facility,
                  is_office: false,
                },
              ],
            },
          ]
        : [],
      state: {
        status: history.employment_type === 'full_time' ? 'paid_leave' : 'none',
        roles: assignment?.roles ?? '[]',
        special_care: false,
      },
      last_changed_by: 'request',
      last_changed_at: changedAt,
      revision,
    });
  }
}
