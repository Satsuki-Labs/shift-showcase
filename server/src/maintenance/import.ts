import { Gunzip } from 'fflate';
import { AppError } from '../../../shared/app-error';
import { INCLUDED_TABLES } from '../backup/file';
import { syncPeriodTask } from '../scheduled/tasks';
import { alignAfterMaintenance, finishRecord, operationId, restoreRecord } from './restore';
import { ImportVersionError, invalidFile, type ImportReply } from './response';
import { validateImported, type TableLines } from './validate';

const maxCompressed = 32 * 1024 * 1024;
const maxLine = 1024 * 1024;
const importLimits = { maxExpanded: 500 * 1024 * 1024 };
const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let bit = 0; bit < 8; bit++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
async function readGzip(request: Request): Promise<Uint8Array> {
  const reader = request.body?.getReader();
  if (!reader) invalidFile(null, 0, 'ファイルがありません');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.length;
      if (size > maxCompressed) {
        await reader.cancel();
        invalidFile(null, 0, '圧縮したファイルが32MBを超えています');
      }
      chunks.push(chunk.value);
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    invalidFile(null, 0, 'ファイルを受け取れませんでした');
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}
interface Header {
  changeNumber: number;
  createdAt: string;
}
function importGzip(storage: DurableObjectStorage, bytes: Uint8Array, id: string): ImportReply {
  const sql = storage.sql;
  if (JSON.parse(restoreRecord(sql).finished_restore_ids).includes(id)) {
    const createdAt = sql
      .exec<{ restored_to: string }>('SELECT restored_to FROM data_version WHERE id = 1')
      .one().restored_to;
    return counts(sql, createdAt);
  }
  if (
    sql.exec('SELECT 1 FROM staff LIMIT 1').toArray().length ||
    sql.exec('SELECT 1 FROM periods LIMIT 1').toArray().length
  )
    throw new AppError('E-44');
  for (const table of [...INCLUDED_TABLES].reverse()) sql.exec(`DELETE FROM "${table}"`);
  const schema = sql
    .exec<{ schema_version: number }>('SELECT schema_version FROM data_version WHERE id = 1')
    .one().schema_version;
  const starts: TableLines = new Map();
  let header: Header | undefined,
    table: string | null = null,
    columns: string[] = [],
    tableIndex = 0,
    rows = 0,
    line = 0,
    ended = false;
  let insert = '',
    revisionIndex = -1;
  const reject = (reason: string): never => invalidFile(table, line, reason);
  function consume(text: string) {
    line++;
    if (ended) reject('最後の行より後にデータがあります');
    let value: any;
    try {
      value = JSON.parse(text);
    } catch {
      reject('JSONを読めません');
    }
    if (line === 1) {
      if (!value || value.format !== 'shift-showcase-backup') reject('ファイルの種類が違います');
      if (value.formatVersion !== 2 || value.schemaVersion !== schema)
        throw new ImportVersionError(value.formatVersion ?? null, value.schemaVersion ?? null);
      if (!Number.isSafeInteger(value.changeNumber) || value.changeNumber < 0)
        reject('データの変更の番号が読めません');
      if (
        typeof value.createdAt !== 'string' ||
        !value.createdAt.trim() ||
        !Number.isFinite(Date.parse(value.createdAt))
      )
        reject('作った日時が読めません');
      header = { changeNumber: value.changeNumber, createdAt: value.createdAt };
      return;
    }
    if (Array.isArray(value)) {
      if (!table || value.length !== columns.length) reject('値の数が列の数と違います');
      if (
        value.some(
          (item) =>
            item !== null &&
            typeof item !== 'string' &&
            (typeof item !== 'number' || !Number.isFinite(item)),
        )
      )
        reject('値の種類が違います');
      if (
        revisionIndex >= 0 &&
        (!Number.isSafeInteger(value[revisionIndex]) ||
          value[revisionIndex] < 1 ||
          value[revisionIndex] > header!.changeNumber)
      )
        reject('行の変更の番号がファイルの番号に合いません');
      try {
        sql.exec(insert, ...value);
      } catch {
        reject('列の型・主キー・一意・外部キー・値の制約に合いません');
      }
      rows++;
    } else if (value && value.end === true) {
      if (
        tableIndex !== INCLUDED_TABLES.length ||
        value.tables !== tableIndex ||
        value.rows !== rows
      )
        reject('表か件数が足りないか、合いません');
      ended = true;
    } else {
      const expected = INCLUDED_TABLES[tableIndex];
      if (!value || !expected || value.table !== expected)
        reject('表が欠けているか、表の並びが違います');
      table = expected;
      columns = sql.exec(`SELECT * FROM "${table}" LIMIT 0`).columnNames;
      if (
        !Array.isArray(value.columns) ||
        value.columns.length !== columns.length ||
        columns.some((column, i) => column !== value.columns[i])
      )
        reject('列の名前か並びが違います');
      starts.set(table, line);
      insert = `INSERT INTO "${table}" (${columns.map((column) => `"${column}"`).join(',')}) VALUES (${columns.map(() => '?').join(',')})`;
      revisionIndex = columns.indexOf('revision');
      tableIndex++;
    }
  }
  const lineBytes = new Uint8Array(maxLine);
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  let used = 0,
    crc = 0xffffffff,
    totalBytes = 0,
    completed = false;
  const gzip = new Gunzip((chunk, final) => {
    totalBytes += chunk.length;
    if (totalBytes > importLimits.maxExpanded)
      invalidFile(table, line + 1, '解いた後の大きさが500MBを超えています');
    for (const byte of chunk) {
      crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
      if (byte === 10) {
        consume(decoder.decode(lineBytes.subarray(0, used)));
        used = 0;
      } else {
        if (used === maxLine) invalidFile(table, line + 1, '1行が1MBを超えています');
        lineBytes[used++] = byte;
      }
    }
    completed = final;
  });
  gzip.onmember = () => reject('gzipの終わりより後にデータがあります');
  try {
    if (bytes.length < 18) reject('gzipの終わりがありません');
    // Small compressed inputs bound the expanded callback chunk even for highly repetitive input.
    for (let offset = 0; offset < bytes.length; offset += 256)
      gzip.push(bytes.subarray(offset, offset + 256), offset + 256 >= bytes.length);
    const footer = new DataView(bytes.buffer, bytes.byteOffset + bytes.length - 8, 8);
    if (
      !completed ||
      footer.getUint32(0, true) !== (crc ^ 0xffffffff) >>> 0 ||
      footer.getUint32(4, true) !== totalBytes >>> 0
    )
      reject('gzipが途中で切れているか、壊れています');
    if (used) consume(decoder.decode(lineBytes.subarray(0, used)));
    if (!ended || !header) reject('最後の行がありません');
  } catch (error) {
    if (error instanceof AppError) throw error;
    invalidFile(table, line + 1, 'gzipか文字を読めません');
  }
  validateImported(sql, starts);
  if (!header) reject('最初の行がありません');
  sql.exec(
    'UPDATE backup_state SET data_change_number = MAX(data_change_number, ?) + 1 WHERE id = 1',
    header!.changeNumber,
  );
  finishRecord(sql, id, header!.createdAt);
  for (const period of sql.exec<{ id: string }>('SELECT id FROM periods'))
    syncPeriodTask(sql, period.id);
  return counts(sql, header!.createdAt);
}
function counts(sql: SqlStorage, createdAt: string): ImportReply {
  return {
    ok: true,
    createdAt,
    staff: sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM staff').one().n,
    periods: sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM periods').one().n,
  };
}
export async function receiveImport(
  request: Request,
  storage: DurableObjectStorage,
): Promise<ImportReply> {
  const id = operationId(new URL(request.url).searchParams.get('id'));
  const bytes = await readGzip(request);
  let changed = false;
  const reply = storage.transactionSync(() => {
    changed = !JSON.parse(restoreRecord(storage.sql).finished_restore_ids).includes(id);
    return importGzip(storage, bytes, id);
  });
  if (changed) await alignAfterMaintenance(storage, 'maintenance-import');
  return reply;
}
