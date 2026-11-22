import { AppError } from '../../../shared/app-error';
import { isValidDate } from '../../../shared/date';
import { roleFitsWork, sortStaffHistory } from '../../../shared/staff';
import { resolvedDayOpening, type Facility } from '../../../shared/calendar';
import { readAnnualRules } from '../reads/first-load';
import { readCalendarRows } from '../reads/year-load';
import type { StaffHistory, WorkSlotTime } from '../../../shared/protocol';
import { parseSave as parseStaff, workTimes } from '../saves/staff';
import {
  parsePeriod,
  validatePeriodRange,
  checkOverlap,
  parseDistribution,
} from '../saves/periods';
import { parseDay, openingRules, peak, annualClosure } from '../saves/calendar';
import { parseSave as parseCell } from '../saves/cells';
import { validateWorkDay } from '../saves/work-day';
import { validateRequestContent } from '../saves/requests';
import { workSlotFromRow, type StoredWorkSlot } from '../reads/period-load';
import { parseContactNames } from '../saves/settings';
import { invalidFile } from './response';
import { isSnapshotStaff, readSnapshotStaff } from '../../../shared/period-snapshot';

type Row = Record<string, SqlStorageValue> & { __row: number };
type History = StaffHistory & Record<string, SqlStorageValue>;
export type TableLines = Map<string, number>;
const historyColumns = ['quarter_hour_pay', 'employment_type', 'qualification', 'budget'] as const;
const staffColumns = [
  'id',
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
function pick(row: Record<string, unknown>, columns: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(columns.map((column) => [column, row[column]]));
}
function check(condition: unknown, field: string): asserts condition {
  if (!condition) throw new AppError('E-32', field);
}
function json(value: unknown): unknown {
  check(typeof value === 'string', 'JSON');
  return JSON.parse(value);
}
function staffInput(
  row: Record<string, unknown>,
  histories: (StaffHistory | Record<string, unknown>)[],
) {
  const fields = pick(row, staffColumns);
  const times =
    typeof fields.default_work_times === 'string'
      ? json(fields.default_work_times)
      : fields.default_work_times;
  workTimes(times, true, true);
  return parseStaff({
    staff: {
      ...fields,
      default_work_times: times,
      default_roles:
        typeof fields.default_roles === 'string'
          ? json(fields.default_roles)
          : fields.default_roles,
    },
    history: histories.length
      ? Object.fromEntries(
          historyColumns.map((column) => [column, { value: histories.at(-1)![column] }]),
        )
      : {},
  });
}
function validCell(
  state: Record<string, unknown>,
  buildings: { building: 1 | 2; slots: WorkSlotTime[] }[],
) {
  const input = parseCell({
    staff_id: state.staff_id,
    date: state.date,
    status: state.status,
    roles: typeof state.roles === 'string' ? json(state.roles) : state.roles,
    special_care: state.special_care === 1 || state.special_care === true,
    buildings: buildings.map(({ building, slots }) => ({ building, slots })),
    notes: null,
  });
  validateWorkDay(buildings, (field) => {
    throw new AppError('E-32', field);
  });
  check(
    input.roles.every((role) =>
      roleFitsWork(
        role,
        buildings.filter((item) => item.slots.length).map((item) => item.building),
      ),
    ),
    'roles',
  );
  if (buildings.every((item) => !item.slots.length))
    check(!input.roles.length && !input.special_care, 'roles/special_care');
}

// Only bounded groups (one staff history, one day, one snapshot) are held in memory.
// rowid follows insertion order after the importer clears each table.
export function validateImported(sql: SqlStorage, starts: TableLines): void {
  const rows = (table: string) =>
    sql.exec<Row>(`SELECT rowid AS __row, * FROM "${table}" ORDER BY rowid`);
  function at(table: string, row: Row, validate: () => void) {
    try {
      validate();
    } catch (error) {
      const reason =
        error instanceof AppError && error.field
          ? `項目 ${error.field} が決まりに合いません`
          : '保存したデータの形が決まりに合いません';
      invalidFile(table, starts.get(table)! + row.__row, reason);
    }
  }
  const contacts = rows('contact_names').toArray();
  if (contacts.length !== 2)
    invalidFile(
      'contact_names',
      starts.get('contact_names')!,
      '第一と第二の名前がそろっていません',
    );
  for (const row of contacts)
    at('contact_names', row, () => {
      parseContactNames({ [row.site as string]: row.name });
    });
  const periods = sql
    .exec<{ id: string; start_date: string; end_date: string }>(
      'SELECT id, start_date, end_date FROM periods',
    )
    .toArray();
  for (const row of rows('staff'))
    at('staff', row, () => {
      const histories = sql
        .exec<History>('SELECT * FROM staff_history WHERE staff_id = ?', row.id)
        .toArray();
      check(histories.length > 0, 'history');
      const sorted = sortStaffHistory(histories, periods);
      staffInput(row, sorted);
    });
  for (const row of rows('staff_history'))
    at('staff_history', row, () => {
      check(
        row.since === 'initial' ||
          row.since === 'pending' ||
          periods.some((period) => period.id === row.since),
        'since',
      );
      const person = sql.exec<Row>('SELECT * FROM staff WHERE id = ?', row.staff_id).one();
      staffInput(person, [row]);
    });
  for (const row of rows('periods'))
    at('periods', row, () => {
      const coverage = sql
        .exec(
          'SELECT facility, total_required FROM coverage_requirements WHERE period_id = ?',
          row.id,
        )
        .toArray();
      const input = parsePeriod({
        ...pick(row, ['id', 'name', 'start_date', 'end_date', 'request_deadline_date']),
        coverage,
      });
      validatePeriodRange(input);
      check(
        input.request_deadline_date === null || input.request_deadline_date <= input.end_date,
        'request_deadline_date',
      );
      checkOverlap(sql, input);
    });
  for (const row of rows('facility_days'))
    at('facility_days', row, () => {
      check(isValidDate(row.date), 'date');
      check(
        row.is_open !== null || row.start_time !== null || row.end_time !== null,
        'facility_days',
      );
      for (const field of ['start_time', 'end_time'] as const)
        check(
          row[field] === null ||
            (typeof row[field] === 'string' &&
              /^\d{2}:[0-5]\d$/.test(row[field]) &&
              row[field] >= '07:00' &&
              row[field] <= '22:00'),
          field,
        );
      const opening = resolvedDayOpening(
        row.date as string,
        row.facility as Facility,
        readCalendarRows(sql, row.date as string),
        readAnnualRules(sql),
      );
      check(
        opening && (!opening.isOpen || opening.startTime < opening.endTime),
        'opening_conflict',
      );
    });
  for (const row of rows('building_days'))
    at('building_days', row, () => {
      check(isValidDate(row.date), 'date');
      const entries = json(row.entries);
      check(Array.isArray(entries) && entries.length <= 2, 'entries');
      check(new Set(entries.map((entry) => entry.kind)).size === entries.length, 'entries');
      const event = entries.find((entry) => entry.kind === 'event'),
        memo = entries.find((entry) => entry.kind === 'memo');
      check(
        entries.every(
          (entry) =>
            entry &&
            (entry.kind === 'event' || entry.kind === 'memo') &&
            Object.keys(entry).length === (entry.kind === 'event' ? 3 : 2),
        ),
        'entries',
      );
      parseDay({
        date: row.date,
        buildings: [
          {
            building: row.building,
            event: event ? { content: event.content, arrival_time: event.arrival_time } : null,
            memo: memo?.content ?? null,
            facilities: (row.building === 1 ? ['A', 'B'] : ['C', 'D']).map((facility) => ({
              facility,
              is_open: false,
              start_time: null,
              end_time: null,
            })),
          },
        ],
      });
    });
  for (const row of rows('opening_rules'))
    at('opening_rules', row, () => {
      const group = sql
        .exec('SELECT * FROM opening_rules WHERE fiscal_year = ?', row.fiscal_year)
        .toArray();
      openingRules({
        fiscal_year: row.fiscal_year,
        rules: group.map((item) => {
          const { fiscal_year: _year, revision: _revision, ...rule } = item;
          return rule;
        }),
      });
    });
  for (const row of rows('peaks'))
    at('peaks', row, () => {
      peak(pick(row, ['start_date', 'end_date', 'name']));
    });
  for (const row of rows('annual_closures'))
    at('annual_closures', row, () => {
      annualClosure(pick(row, ['start_month', 'start_day', 'end_month', 'end_day', 'name']));
    });

  // Merge two ordered cursors per person rather than loading all shifts or querying every day.
  for (const person of sql.exec<{ id: string }>('SELECT id FROM staff')) {
    const work = sql.exec<StoredWorkSlot & { __row: number }>(
      'SELECT rowid AS __row, * FROM work_slots WHERE staff_id = ? ORDER BY date, building',
      person.id,
    );
    let next = work.next();
    for (const state of sql.exec<Row>(
      'SELECT rowid AS __row, * FROM day_states WHERE staff_id = ? ORDER BY date',
      person.id,
    )) {
      if (!next.done && next.value.date < (state.date as string))
        invalidFile(
          'work_slots',
          starts.get('work_slots')! + next.value.__row,
          'その日の状態がありません',
        );
      const group: (StoredWorkSlot & { __row: number })[] = [];
      while (!next.done && next.value.date === state.date) {
        group.push(next.value);
        next = work.next();
      }
      if (group.length)
        at('work_slots', group[0] as unknown as Row, () => {
          validateWorkDay(group.map(workSlotFromRow));
        });
      at('day_states', state, () => {
        check(
          periods.some(
            (period) => state.date! >= period.start_date && state.date! <= period.end_date,
          ),
          'date',
        );
        validCell(state, group.map(workSlotFromRow));
      });
    }
    if (!next.done)
      invalidFile(
        'work_slots',
        starts.get('work_slots')! + next.value.__row,
        'その日の状態がありません',
      );
  }
  for (const row of rows('daily_requests'))
    at('daily_requests', row, () => {
      check(isValidDate(row.date), 'date');
      check(
        periods.some((period) => row.date! >= period.start_date && row.date! <= period.end_date),
        'date',
      );
      validateRequestContent(row);
      if (row.replaced_shift !== null) {
        const replaced = json(row.replaced_shift) as Record<string, unknown>;
        check(
          replaced &&
            Object.keys(replaced).length === 4 &&
            ['status', 'roles', 'special_care', 'buildings'].every((key) =>
              Object.hasOwn(replaced, key),
            ) &&
            typeof replaced.special_care === 'boolean' &&
            Array.isArray(replaced.buildings),
          'replaced_shift',
        );
        validCell(
          { staff_id: row.staff_id, date: row.date, ...replaced },
          replaced.buildings as Parameters<typeof validCell>[1],
        );
      }
    });
  for (const row of rows('no_requests'))
    at('no_requests', row, () => {
      const period = periods.find((period) => period.id === row.period_id)!;
      check(
        !sql
          .exec(
            'SELECT 1 FROM daily_requests WHERE staff_id = ? AND date BETWEEN ? AND ? LIMIT 1',
            row.staff_id,
            period.start_date,
            period.end_date,
          )
          .toArray().length,
        'daily_requests',
      );
    });
  for (const row of rows('distributed_sheets'))
    at('distributed_sheets', row, () => {
      parseDistribution({ id: row.period_id, site: row.site, cells: json(row.cells) });
    });
  for (const row of rows('period_snapshots'))
    at('period_snapshots', row, () => {
      check(readSnapshotStaff(json(row.staff), row.staff_format).every(isSnapshotStaff), 'staff');
      const closures = json(row.annual_closures);
      check(Array.isArray(closures), 'snapshot');
      for (const closure of closures) annualClosure(closure);
    });
}
