import { logAlarm } from '../entrance/records';
import { createBackup } from './file';
import {
  sendBackup,
  validBackupSettings,
  type BackupEnvironment,
  type BackupFailure,
} from './send';

export async function runNightlyBackup(
  storage: DurableObjectStorage,
  env: BackupEnvironment,
  scheduledAt: string,
  nextAt: string,
  now: Date,
): Promise<void> {
  const started = performance.now();
  let code: BackupFailure | null = null;
  let changeNumber: number | null = null;
  let size = 0;
  const state = storage.sql
    .exec<{ data_change_number: number; sent_change_number: number }>(
      'SELECT data_change_number, sent_change_number FROM backup_state WHERE id = 1',
    )
    .one();
  if (env.ENVIRONMENT !== '手元' && state.data_change_number !== state.sent_change_number) {
    if (!validBackupSettings(env)) code = 'E-52';
    else {
      try {
        const file = createBackup(storage.sql, now);
        changeNumber = file.changeNumber;
        size = file.compressedBytes;
        code = await sendBackup(file, env);
      } catch {
        code = 'E-92';
      }
    }
  }
  storage.transactionSync(() => {
    // A replay of a completed night must not count a second failure.
    const task = storage.sql
      .exec<{ scheduled_at: string }>(
        "SELECT scheduled_at FROM scheduled_tasks WHERE task = 'nightly-backup'",
      )
      .toArray()[0];
    if (task?.scheduled_at !== scheduledAt) return;
    if (code)
      storage.sql.exec(
        'UPDATE backup_state SET failed_nights = failed_nights + 1, last_failure_code = ? WHERE id = 1',
        code,
      );
    else if (changeNumber !== null)
      storage.sql.exec(
        `UPDATE backup_state SET last_success_at = ?, failed_nights = 0,
      last_failure_code = NULL, sent_change_number = ? WHERE id = 1`,
        new Date().toISOString(),
        changeNumber,
      );
    storage.sql.exec(
      "UPDATE scheduled_tasks SET scheduled_at = ? WHERE task = 'nightly-backup'",
      nextAt,
    );
  });
  logAlarm('nightly-backup', code ? 'failure' : 'success', started, { code, sizeBytes: size });
}
