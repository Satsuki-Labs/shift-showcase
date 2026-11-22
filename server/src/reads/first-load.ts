import type {
  AnnualRules,
  ContactNames,
  FirstLoadResponse,
  Identity,
  OpeningRule,
  PeriodSummary,
  ResponseMetadata,
  Staff,
  StaffHistory,
} from '../../../shared/protocol';
import type { ErrorCode } from '../../../shared/error-codes';
import { sortStaffHistory } from '../../../shared/staff';

type BackupState = {
  failed_nights: number;
  last_failure_code: ErrorCode;
  data_change_number: number;
};
type SqlRow<T> = { [K in keyof T]: T[K] };

export function readChangeNumber(storage: DurableObjectStorage): number {
  return storage.sql
    .exec<BackupState>('SELECT data_change_number FROM backup_state WHERE id = 1')
    .one().data_change_number;
}

export function readGeneration(storage: DurableObjectStorage): {
  generation: string;
  restoredTo: string | null;
} {
  const row = storage.sql
    .exec<{ generation: string; restored_to: string | null }>(
      'SELECT generation, restored_to FROM data_version WHERE id = 1',
    )
    .one();
  return { generation: row.generation, restoredTo: row.restored_to ?? null };
}

export function readStaff(sql: SqlStorage): Staff[] {
  const histories = sql
    .exec<SqlRow<StaffHistory>>('SELECT * FROM staff_history ORDER BY staff_id')
    .toArray();
  const periods = sql
    .exec<{ id: string; start_date: string }>('SELECT id, start_date FROM periods')
    .toArray();
  type StoredStaff = Omit<Staff, 'default_work_times' | 'default_roles' | 'history' | 'in_use'> & {
    default_work_times: string;
    default_roles: string;
    in_use: number;
  };
  return sql
    .exec<StoredStaff>(
      `SELECT s.*, (
    EXISTS (SELECT 1 FROM day_states WHERE staff_id = s.id)
    OR EXISTS (SELECT 1 FROM work_slots WHERE staff_id = s.id)
    OR EXISTS (SELECT 1 FROM daily_requests WHERE staff_id = s.id)
    OR EXISTS (SELECT 1 FROM no_requests WHERE staff_id = s.id)
  ) AS in_use FROM staff s ORDER BY sort_order, id`,
    )
    .toArray()
    .map((row) => ({
      ...row,
      in_use: row.in_use === 1,
      default_work_times: JSON.parse(row.default_work_times) as Staff['default_work_times'],
      default_roles: JSON.parse(row.default_roles) as Staff['default_roles'],
      history: sortStaffHistory(
        histories.filter((entry) => entry.staff_id === row.id),
        periods,
      ),
    }));
}

export function readContactNames(sql: SqlStorage): ContactNames {
  const rows = sql
    .exec<{ site: keyof ContactNames; name: string }>('SELECT site, name FROM contact_names')
    .toArray();
  return Object.fromEntries(rows.map((row) => [row.site, row.name])) as unknown as ContactNames;
}

export function readAnnualRules(sql: SqlStorage): AnnualRules {
  return {
    openingRules: sql
      .exec<SqlRow<OpeningRule>>(
        'SELECT fiscal_year, facility, normal_start_time, normal_end_time, peak_start_time, peak_end_time, saturday_start_time, saturday_end_time, arrival_end_mode, arrival_end_time, arrival_duration_minutes FROM opening_rules ORDER BY fiscal_year, facility',
      )
      .toArray(),
    peaks: sql
      .exec<AnnualRules['peaks'][number]>(
        'SELECT start_date, end_date, name FROM peaks ORDER BY start_date, end_date',
      )
      .toArray(),
    annualClosures: sql
      .exec<AnnualRules['annualClosures'][number]>(
        'SELECT start_month, start_day, end_month, end_day, name FROM annual_closures ORDER BY start_month, start_day, end_month, end_day',
      )
      .toArray(),
  };
}

export function readPeriods(sql: SqlStorage): PeriodSummary[] {
  const coverage = sql
    .exec<SqlRow<PeriodSummary['coverage'][number] & { period_id: string }>>(
      'SELECT period_id, facility, total_required FROM coverage_requirements ORDER BY period_id, facility',
    )
    .toArray();
  type StoredPeriod = Omit<PeriodSummary, 'coverage' | 'has_request_submissions'> & {
    has_request_submissions: number;
  };
  // staff_idも指定し、no_requestsの既存の主キー（staff_id, period_id）で絞る。
  return sql
    .exec<SqlRow<StoredPeriod>>(
      `SELECT id, name, start_date, end_date, request_deadline_date,
    request_url_key, requests_closed_at, first_published_at, second_published_at,
    first_last_distributed_at, second_last_distributed_at, revision,
    (EXISTS (SELECT 1 FROM daily_requests INDEXED BY daily_requests_date WHERE date BETWEEN p.start_date AND p.end_date)
      OR EXISTS (SELECT 1 FROM no_requests WHERE staff_id IN (SELECT id FROM staff) AND period_id = p.id)) AS has_request_submissions
    FROM periods p ORDER BY start_date, id`,
    )
    .toArray()
    .map((row) => ({
      ...row,
      has_request_submissions: row.has_request_submissions === 1,
      coverage: coverage
        .filter((item) => item.period_id === row.id)
        .map(({ facility, total_required }) => ({
          facility,
          total_required,
        })),
    }));
}

export function readFirstLoad(
  storage: DurableObjectStorage,
  identity: Identity,
  metadata: ResponseMetadata,
  stalled = false,
): FirstLoadResponse {
  const backup = storage.sql
    .exec<BackupState>(
      'SELECT failed_nights, last_failure_code, data_change_number FROM backup_state WHERE id = 1',
    )
    .one();
  const staff = readStaff(storage.sql);
  const periods = readPeriods(storage.sql);
  return {
    ...metadata,
    identity,
    staff,
    periods,
    dataChangeNumber: backup.data_change_number,
    annualRules: readAnnualRules(storage.sql),
    contactNames: readContactNames(storage.sql),
    annualRuleRevisions: [
      ...storage.sql
        .exec<{ start_date: string; end_date: string; revision: number }>(
          'SELECT start_date, end_date, revision FROM peaks ORDER BY start_date, end_date',
        )
        .toArray()
        .map((row) => ({
          target: { unit: 'peak' as const, startDate: row.start_date, endDate: row.end_date },
          revision: row.revision,
        })),
      ...storage.sql
        .exec<{
          start_month: number;
          start_day: number;
          end_month: number;
          end_day: number;
          revision: number;
        }>(
          'SELECT start_month, start_day, end_month, end_day, revision FROM annual_closures ORDER BY start_month, start_day, end_month, end_day',
        )
        .toArray()
        .map((row) => ({
          target: {
            unit: 'annual-closure' as const,
            startMonth: row.start_month,
            startDay: row.start_day,
            endMonth: row.end_month,
            endDay: row.end_day,
          },
          revision: row.revision,
        })),
      ...storage.sql
        .exec<{ fiscal_year: number; facility: 'A' | 'B' | 'C' | 'D'; revision: number }>(
          'SELECT fiscal_year, facility, revision FROM opening_rules ORDER BY fiscal_year, facility',
        )
        .toArray()
        .map((row) => ({
          target: {
            unit: 'opening-rule' as const,
            fiscalYear: row.fiscal_year,
            facility: row.facility,
          },
          revision: row.revision,
        })),
    ],
    staffOrderRevision: storage.sql
      .exec<{ staff_order_revision: number }>(
        'SELECT staff_order_revision FROM data_version WHERE id = 1',
      )
      .one().staff_order_revision,
    contactNameRevisions: Object.fromEntries(
      storage.sql
        .exec<{ site: keyof ContactNames; revision: number }>(
          'SELECT site, revision FROM contact_names',
        )
        .toArray()
        .map((row) => [row.site, row.revision]),
    ) as FirstLoadResponse['contactNameRevisions'],
    notifications: [
      ...(backup.failed_nights >= 2
        ? [{ kind: 'backup_failure' as const, code: backup.last_failure_code }]
        : []),
      ...(stalled ? [{ kind: 'schedule_stalled' as const, code: 'E-94' as const }] : []),
    ],
  };
}
