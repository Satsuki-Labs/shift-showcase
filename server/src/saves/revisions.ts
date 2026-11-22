import type {
  CurrentRevision,
  JsonValue,
  Revision,
  RevisionTarget,
} from '../../../shared/protocol';
import { facilities } from '../../../shared/calendar';
import { validFiscalYear } from '../../../shared/limits';

const units = {
  staff: { table: 'staff', fields: { id: 'id' } },
  'staff-order': { table: 'data_version', fields: {} },
  'contact-name': { table: 'contact_names', fields: { site: 'site' } },
  peak: { table: 'peaks', fields: { startDate: 'start_date', endDate: 'end_date' } },
  'annual-closure': {
    table: 'annual_closures',
    fields: {
      startMonth: 'start_month',
      startDay: 'start_day',
      endMonth: 'end_month',
      endDay: 'end_day',
    },
  },
  'opening-rule': {
    table: 'opening_rules',
    fields: { fiscalYear: 'fiscal_year', facility: 'facility' },
  },
  period: { table: 'periods', fields: { id: 'id' } },
  'day-state': { table: 'day_states', fields: { staffId: 'staff_id', date: 'date' } },
  'work-slot': {
    table: 'work_slots',
    fields: { staffId: 'staff_id', date: 'date', building: 'building' },
  },
  'facility-day': { table: 'facility_days', fields: { facility: 'facility', date: 'date' } },
  'building-day': { table: 'building_days', fields: { building: 'building', date: 'date' } },
  'daily-request': { table: 'daily_requests', fields: { staffId: 'staff_id', date: 'date' } },
  'no-request': { table: 'no_requests', fields: { staffId: 'staff_id', periodId: 'period_id' } },
} as const;

export function isTarget(value: unknown): value is RevisionTarget {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const target = value as Record<string, unknown>;
  if (typeof target.unit !== 'string' || !Object.hasOwn(units, target.unit)) return false;
  const fields = Object.keys(units[target.unit as RevisionTarget['unit']].fields);
  return (
    Object.keys(target).length === fields.length + 1 &&
    fields.every((field) => {
      if (field === 'fiscalYear') return validFiscalYear(target[field]);
      if (field === 'startMonth' || field === 'endMonth')
        return (
          Number.isInteger(target[field]) &&
          (target[field] as number) >= 1 &&
          (target[field] as number) <= 12
        );
      if (field === 'startDay' || field === 'endDay')
        return (
          Number.isInteger(target[field]) &&
          (target[field] as number) >= 1 &&
          (target[field] as number) <= 31
        );
      if (field === 'site') return target[field] === 'first' || target[field] === 'second';
      if (field === 'building') return target[field] === 1 || target[field] === 2;
      if (field === 'facility')
        return (facilities as readonly string[]).includes(target[field] as string);
      if (typeof target[field] !== 'string' || !(target[field] as string).trim()) return false;
      return (
        !['date', 'startDate', 'endDate'].includes(field) ||
        /^\d{4}-\d{2}-\d{2}$/.test(target[field] as string)
      );
    })
  );
}

export function targetKey(target: RevisionTarget): string {
  const fields = Object.keys(units[target.unit].fields);
  return JSON.stringify([
    target.unit,
    ...fields.map((field) => (target as unknown as Record<string, string | number>)[field]),
  ]);
}

function query(target: RevisionTarget) {
  const spec = units[target.unit];
  const fields = Object.entries(spec.fields);
  return {
    table: spec.table,
    where:
      target.unit === 'staff-order'
        ? 'id = 1'
        : fields.map(([, column]) => `${column} = ?`).join(' AND '),
    revisionColumn: target.unit === 'staff-order' ? 'staff_order_revision' : 'revision',
    values: fields.map(([field]) => (target as unknown as Record<string, string | number>)[field]),
  };
}

export function readRevision(sql: SqlStorage, target: RevisionTarget): CurrentRevision {
  const { table, where, values } = query(target);
  const columns =
    target.unit === 'staff-order'
      ? 'staff_order_revision AS revision'
      : target.unit === 'daily-request'
        ? 'staff_id, date, kind, start_time, end_time, memo, revision'
        : '*';
  const row = sql.exec(`SELECT ${columns} FROM ${table} WHERE ${where}`, ...values).toArray()[0];
  if (row && (!Number.isSafeInteger(row.revision) || (row.revision as number) < 1))
    throw new Error('Invalid stored revision');
  return {
    target,
    revision: row ? (row.revision as number) : null,
    data: row ? (row as JsonValue) : null,
  };
}

export function advanceRevision(
  sql: SqlStorage,
  target: RevisionTarget,
  revision: number,
): Revision {
  const current = readRevision(sql, target);
  if (current.revision === null) return { target, revision: null };
  if (!Number.isSafeInteger(revision) || revision < 1) throw new Error('Invalid next revision');
  const { table, where, values, revisionColumn } = query(target);
  sql.exec(`UPDATE ${table} SET ${revisionColumn} = ? WHERE ${where}`, revision, ...values);
  return { target, revision };
}
