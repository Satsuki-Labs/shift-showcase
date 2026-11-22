import { AppError } from '../../../shared/app-error';
import { readSnapshotStaff } from '../../../shared/period-snapshot';
import { fiscalYearEnd, fiscalYearOf, fiscalYearStart } from '../../../shared/calendar';
import type {
  DayState,
  DistributedSheet,
  PeriodDailyRequest,
  PeriodLoadResponse,
  ResponseMetadata,
  WorkSlot,
  WorkSlotTime,
} from '../../../shared/protocol';
import { readCalendarRows } from './year-load';
import { readRequestStaff, type RequestPeriod } from './request-sheet';

const PERIOD_LOAD_SQL = {
  dayStates: 'SELECT * FROM day_states WHERE date BETWEEN ? AND ? ORDER BY date, staff_id',
  workSlots:
    'SELECT * FROM work_slots WHERE date BETWEEN ? AND ? ORDER BY date, staff_id, building',
  dailyRequests:
    'SELECT staff_id, date, kind, start_time, end_time, memo, replaced_shift, revision FROM daily_requests INDEXED BY daily_requests_date WHERE date BETWEEN ? AND ? ORDER BY date, staff_id',
  paidLeaveDates: `SELECT staff_id, date FROM day_states
    WHERE status = 'paid_leave' AND date BETWEEN ? AND ? AND (date < ? OR date > ?) ORDER BY date, staff_id`,
};

export type StoredDayState = Omit<DayState, 'roles' | 'special_care'> & {
  roles: string;
  special_care: number;
};
export type StoredWorkSlot = Omit<WorkSlot, 'slots'> & {
  first_start_time: string;
  first_end_time: string;
  first_facility: WorkSlotTime['facility'];
  first_is_office: number;
  second_start_time: string | null;
  second_end_time: string | null;
  second_facility: WorkSlotTime['facility'] | null;
  second_is_office: number;
};
export function dayStateFromRow(row: StoredDayState): DayState {
  return {
    ...row,
    roles: JSON.parse(row.roles) as string[],
    special_care: row.special_care === 1,
  };
}
export function workSlotFromRow(row: StoredWorkSlot): WorkSlot {
  const slots: WorkSlot['slots'] = [
    {
      start_time: row.first_start_time,
      end_time: row.first_end_time,
      facility: row.first_facility,
      is_office: row.first_is_office === 1,
    },
  ];
  if (row.second_start_time !== null)
    slots.push({
      start_time: row.second_start_time,
      end_time: row.second_end_time!,
      facility: row.second_facility!,
      is_office: row.second_is_office === 1,
    });
  return {
    staff_id: row.staff_id,
    date: row.date,
    building: row.building,
    slots,
    last_changed_by: row.last_changed_by,
    last_changed_at: row.last_changed_at,
    revision: row.revision,
  };
}
export function readPeriodLoad(
  storage: DurableObjectStorage,
  periodId: string,
  metadata: ResponseMetadata,
): PeriodLoadResponse {
  const sql = storage.sql;
  const period = sql
    .exec<{ [K in keyof RequestPeriod]: RequestPeriod[K] }>(
      'SELECT * FROM periods WHERE id = ?',
      periodId,
    )
    .toArray()[0];
  if (!period) throw new AppError('E-32', 'id');
  const { start_date: start, end_date: end } = period;
  const snapshot = sql
    .exec<{ staff: string; annual_closures: string; staff_format: number }>(
      'SELECT staff, annual_closures, staff_format FROM period_snapshots WHERE period_id = ?',
      periodId,
    )
    .toArray()[0];
  return {
    ...metadata,
    periodId,
    distributedSheets: Object.fromEntries(
      sql
        .exec<{ site: 'first' | 'second'; distributed_at: string; cells: string }>(
          'SELECT site, distributed_at, cells FROM distributed_sheets WHERE period_id = ?',
          periodId,
        )
        .toArray()
        .map((row) => [
          row.site,
          {
            distributed_at: row.distributed_at,
            cells: JSON.parse(row.cells),
          } satisfies DistributedSheet,
        ]),
    ),
    snapshot: snapshot
      ? {
          staff: readSnapshotStaff(JSON.parse(snapshot.staff), snapshot.staff_format),
          annualClosures: JSON.parse(snapshot.annual_closures),
        }
      : null,
    dayStates: sql
      .exec<StoredDayState>(PERIOD_LOAD_SQL.dayStates, start, end)
      .toArray()
      .map(dayStateFromRow),
    workSlots: sql
      .exec<StoredWorkSlot>(PERIOD_LOAD_SQL.workSlots, start, end)
      .toArray()
      .map(workSlotFromRow),
    dailyRequests: sql
      .exec<Omit<PeriodDailyRequest, 'replaced_shift'> & { replaced_shift: string | null }>(
        PERIOD_LOAD_SQL.dailyRequests,
        start,
        end,
      )
      .toArray()
      .map((row) => ({
        ...row,
        replaced_shift: row.replaced_shift === null ? null : JSON.parse(row.replaced_shift),
      })),
    noRequests: sql
      .exec<{ staff_id: string }>(
        'SELECT staff_id FROM no_requests INDEXED BY no_requests_period WHERE period_id = ? ORDER BY staff_id',
        periodId,
      )
      .toArray(),
    requestStaffIds: readRequestStaff(sql, period).map((person) => person.id),
    ...readCalendarRows(sql, start, end),
    paidLeaveDates: sql
      .exec<{ staff_id: string; date: string }>(
        PERIOD_LOAD_SQL.paidLeaveDates,
        fiscalYearStart(fiscalYearOf(start)),
        fiscalYearEnd(fiscalYearOf(end)),
        start,
        end,
      )
      .toArray(),
  };
}
