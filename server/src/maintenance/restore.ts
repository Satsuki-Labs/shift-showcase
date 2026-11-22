import { AppError } from '../../../shared/app-error';
import { isValidDate } from '../../../shared/date';
import { alignAlarm } from '../scheduled/tasks';
import { recordFatal } from '../entrance/records';
import type { RestorePrepareReply } from './response';

export function operationId(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(value)
  )
    throw new AppError('E-32', 'id');
  return value;
}
function isoTime(value: unknown, field: string): string {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d\d-\d\dT(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(
      value,
    ) ||
    !isValidDate(value.slice(0, 10)) ||
    !Number.isFinite(Date.parse(value))
  )
    throw new AppError('E-32', field);
  return new Date(value).toISOString();
}
function japanTime(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\d \d\d:\d\d(?::\d\d)?$/.test(value))
    throw new AppError('E-32', 'at');
  return isoTime(value.replace(' ', 'T') + (value.length === 16 ? ':00' : '') + '+09:00', 'at');
}
export function restoreRecord(sql: SqlStorage): {
  finished_restore_ids: string;
  pending_restore_ids: string;
} {
  return sql
    .exec<{ finished_restore_ids: string; pending_restore_ids: string }>(
      'SELECT finished_restore_ids, pending_restore_ids FROM data_version WHERE id = 1',
    )
    .one();
}
export function finishRecord(sql: SqlStorage, id: string, to: string): void {
  const done: string[] = JSON.parse(restoreRecord(sql).finished_restore_ids);
  sql.exec(
    "UPDATE data_version SET generation = ?, restored_to = ?, finished_restore_ids = ?, pending_restore_ids = '[]' WHERE id = 1",
    crypto.randomUUID(),
    to,
    JSON.stringify([...done, id]),
  );
}
export async function alignAfterMaintenance(
  storage: DurableObjectStorage,
  operation: string,
): Promise<void> {
  try {
    await alignAlarm(storage);
  } catch {
    recordFatal(storage, 'E-92', 'maintenance', operation);
  }
}
export async function prepareRestore(
  storage: DurableObjectStorage,
  input: Record<string, unknown>,
): Promise<RestorePrepareReply> {
  const id = operationId(input.id);
  if ('bookmark' in input) throw new AppError('E-32', 'bookmark');
  const at = japanTime(input.at),
    age = Date.now() - Date.parse(at);
  if (age < 0 || age > 30 * 86400000) throw new AppError('E-32', 'at');
  const target = await storage.getBookmarkForTime(new Date(at));
  storage.transactionSync(() => {
    const pending: string[] = JSON.parse(restoreRecord(storage.sql).pending_restore_ids);
    if (!pending.includes(id))
      storage.sql.exec(
        'UPDATE data_version SET pending_restore_ids = ? WHERE id = 1',
        JSON.stringify([...pending, id]),
      );
  });
  const before = new Date().toISOString();
  await storage.onNextSessionRestoreBookmark(target);
  return { at: before };
}
export async function finishRestore(
  storage: DurableObjectStorage,
  input: Record<string, unknown>,
): Promise<{ ok: true }> {
  const id = operationId(input.id),
    to = isoTime(input.to, 'to');
  const changed = storage.transactionSync(() => {
    const record = restoreRecord(storage.sql);
    if (JSON.parse(record.finished_restore_ids).includes(id)) return false;
    if (JSON.parse(record.pending_restore_ids).includes(id)) throw new AppError('E-46');
    finishRecord(storage.sql, id, to);
    storage.sql.exec(
      'UPDATE backup_state SET data_change_number = data_change_number + 1 WHERE id = 1',
    );
    return true;
  });
  if (changed) await alignAfterMaintenance(storage, 'maintenance-restore-finish');
  return { ok: true };
}
