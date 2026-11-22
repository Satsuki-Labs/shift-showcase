import { Gzip } from 'fflate';

export const INCLUDED_TABLES = [
  'staff',
  'staff_history',
  'periods',
  'coverage_requirements',
  'facility_days',
  'building_days',
  'opening_rules',
  'peaks',
  'annual_closures',
  'day_states',
  'work_slots',
  'daily_requests',
  'no_requests',
  'period_snapshots',
  'distributed_sheets',
  'contact_names',
] as const;
export const EXCLUDED_TABLES = [
  'operation_receipts',
  'fatal_errors',
  'backup_state',
  'mail_state',
  'data_version',
  'scheduled_tasks',
] as const;

export interface BackupFile {
  key: string;
  createdAt: string;
  changeNumber: number;
  chunks: Uint8Array[];
  compressedBytes: number;
  uncompressedBytes: number;
}

// Keep this entire read and compression synchronous: no save can interleave.
export function createBackup(sql: SqlStorage, now: Date): BackupFile {
  const version = sql
    .exec<{ schema_version: number; generation: string }>(
      'SELECT schema_version, generation FROM data_version WHERE id = 1',
    )
    .one();
  const changeNumber = sql
    .exec<{ data_change_number: number }>(
      'SELECT data_change_number FROM backup_state WHERE id = 1',
    )
    .one().data_change_number;
  const createdAt = now.toISOString();
  const chunks: Uint8Array[] = [];
  let compressedBytes = 0,
    uncompressedBytes = 0;
  const gzip = new Gzip((chunk) => {
    chunks.push(chunk);
    compressedBytes += chunk.length;
  });
  const encoder = new TextEncoder();
  const push = (text: string) => {
    const bytes = encoder.encode(text);
    uncompressedBytes += bytes.length;
    gzip.push(bytes);
  };
  const header = {
    format: 'shift-showcase-backup',
    formatVersion: 2,
    schemaVersion: version.schema_version,
    generation: version.generation,
    changeNumber,
    createdAt,
  };
  push(JSON.stringify(header) + '\n');
  let rows = 0;
  for (const table of INCLUDED_TABLES) {
    const cursor = sql.exec(`SELECT * FROM "${table}"`);
    push(JSON.stringify({ table, columns: cursor.columnNames }) + '\n');
    for (const row of cursor.raw()) {
      push(JSON.stringify(row) + '\n');
      rows++;
    }
  }
  push(JSON.stringify({ end: true, tables: INCLUDED_TABLES.length, rows }) + '\n');
  gzip.push(new Uint8Array(0), true);
  return {
    key: `${version.generation}-${changeNumber}`,
    createdAt,
    changeNumber,
    chunks,
    compressedBytes,
    uncompressedBytes,
  };
}
