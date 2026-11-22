import { AppError } from '../../../shared/app-error';
import { periodDates } from '../../../shared/period';
import { allFacilitiesClosed } from '../../../shared/calendar';
import { historyForPeriod, japanToday } from '../../../shared/staff';
import type {
  BuildingEntry,
  RequestSheetDailyRequest,
  FacilityDay,
  NoRequest,
  RequestChangeNumberResponse,
  RequestRequestsResponse,
  RequestSheetPeriod,
  RequestSheetResponse,
  RequestSheetStaff,
  ResponseMetadata,
  Staff,
  StaffHistory,
} from '../../../shared/protocol';
import { readAnnualRules } from './first-load';

export interface RequestPeriod extends RequestSheetPeriod {
  requests_closed_at: string | null;
  request_change_number: number;
}
type SqlRow<T> = { [K in keyof T]: T[K] };

export function readRequestPeriod(sql: SqlStorage, key: string): RequestPeriod {
  const period = sql
    .exec<SqlRow<RequestPeriod>>(
      'SELECT id, name, start_date, end_date, request_deadline_date, requests_closed_at, request_change_number FROM periods WHERE request_url_key = ?',
      key,
    )
    .toArray()[0];
  if (!period || !period.request_deadline_date) throw new AppError('E-27');
  return period;
}

export function requestChangeNumber(period: RequestPeriod): RequestChangeNumberResponse {
  return {
    requestChangeNumber: period.request_change_number,
    requestsClosed: !!period.requests_closed_at || period.request_deadline_date < japanToday(),
  };
}

export function readRequestStaff(sql: SqlStorage, period: RequestPeriod): RequestSheetStaff[] {
  type Person = Pick<
    Staff,
    'id' | 'name' | 'employment_status' | 'leave_start_date' | 'leave_expected_end_date'
  >;
  const staff = sql
    .exec<Person>(
      'SELECT id, name, employment_status, leave_start_date, leave_expected_end_date FROM staff ORDER BY sort_order, id',
    )
    .toArray();
  const histories = sql
    .exec<SqlRow<StaffHistory>>('SELECT * FROM staff_history ORDER BY staff_id')
    .toArray();
  const periods = sql
    .exec<{ id: string; start_date: string }>('SELECT id, start_date FROM periods')
    .toArray();
  return staff
    .filter(
      (person) =>
        person.employment_status === 'active' ||
        (person.employment_status === 'leave' &&
          person.leave_expected_end_date !== null &&
          ((person.leave_start_date !== null && person.leave_start_date > period.start_date) ||
            person.leave_expected_end_date < period.end_date)),
    )
    .map((person) => {
      const history = historyForPeriod(
        histories.filter((row) => row.staff_id === person.id),
        periods,
        period.start_date,
      );
      if (!history) throw new Error('Staff employment history is missing');
      return { id: person.id, name: person.name, employment_type: history.employment_type };
    });
}

export function readRequestClosedDates(sql: SqlStorage, period: RequestPeriod): string[] {
  const rules = readAnnualRules(sql);
  const facilityDays = sql
    .exec<{ facility: FacilityDay['facility']; date: string; is_open: number | null }>(
      'SELECT facility, date, is_open FROM facility_days WHERE date BETWEEN ? AND ?',
      period.start_date,
      period.end_date,
    )
    .toArray()
    .map((row) => ({ ...row, is_open: row.is_open === null ? null : row.is_open === 1 }));
  const closed: string[] = [];
  for (const date of periodDates(period)) {
    if (allFacilitiesClosed(date, rules, facilityDays)) closed.push(date);
  }
  return closed;
}

export function readRequests(sql: SqlStorage, period: RequestPeriod): RequestRequestsResponse {
  return {
    ...requestChangeNumber(period),
    dailyRequests: sql
      .exec<Omit<SqlRow<RequestSheetDailyRequest>, 'has_memo'> & { has_memo: number }>(
        'SELECT staff_id, date, kind, start_time, end_time, memo IS NOT NULL AS has_memo, revision FROM daily_requests INDEXED BY daily_requests_date WHERE date BETWEEN ? AND ? ORDER BY date, staff_id',
        period.start_date,
        period.end_date,
      )
      .toArray()
      .map((row) => ({ ...row, has_memo: row.has_memo === 1 })),
    noRequests: sql
      .exec<SqlRow<NoRequest>>(
        'SELECT staff_id, period_id, pressed_at, revision FROM no_requests INDEXED BY no_requests_period WHERE period_id = ? ORDER BY staff_id',
        period.id,
      )
      .toArray(),
  };
}

export function readRequestSheet(
  sql: SqlStorage,
  period: RequestPeriod,
  metadata: ResponseMetadata,
): RequestSheetResponse {
  return {
    ...metadata,
    ...readRequests(sql, period),
    period: {
      id: period.id,
      name: period.name,
      start_date: period.start_date,
      end_date: period.end_date,
      request_deadline_date: period.request_deadline_date,
    },
    staff: readRequestStaff(sql, period),
    closedDates: readRequestClosedDates(sql, period),
    events: sql
      .exec<{ date: string; building: 1 | 2; entries: string }>(
        'SELECT date, building, entries FROM building_days WHERE date BETWEEN ? AND ? ORDER BY date, building',
        period.start_date,
        period.end_date,
      )
      .toArray()
      .flatMap((row) =>
        (JSON.parse(row.entries) as BuildingEntry[])
          .filter((entry) => entry.kind === 'event')
          .map((entry) => ({ date: row.date, building: row.building, name: entry.content })),
      ),
  };
}
