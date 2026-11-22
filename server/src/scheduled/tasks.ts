import { japanToday } from '../../../shared/staff';
import { logAlarm, recordFatal } from '../entrance/records';
import { closeRequests } from '../saves/request-close';
import { capturePeriodSnapshots } from '../saves/snapshots';

import { runNightlyBackup } from '../backup/nightly';
import type { BackupEnvironment } from '../backup/send';
import { runNightlyMail } from '../mail/nightly';

const dayMs = 24 * 60 * 60 * 1000;
const closePrefix = 'close-requests:';
type DeadlinePeriod = { request_deadline_date: string | null; requests_closed_at: string | null };

function deadlineTime(date: string): string {
  return new Date(new Date(`${date}T00:00:00+09:00`).getTime() + dayMs).toISOString();
}
function nextCleanupTime(now: Date): string {
  const today = new Date(`${japanToday(now)}T03:00:00+09:00`).getTime();
  return new Date(today > now.getTime() ? today : today + dayMs).toISOString();
}
function putTask(sql: SqlStorage, task: string, scheduledAt: string): void {
  sql.exec(
    `INSERT INTO scheduled_tasks (task, scheduled_at) VALUES (?, ?)
    ON CONFLICT (task) DO UPDATE SET scheduled_at = excluded.scheduled_at`,
    task,
    scheduledAt,
  );
}

// The period writer owns the transaction, so its deadline and task change together.
export function syncPeriodTask(sql: SqlStorage, periodId: string): void {
  const period = sql
    .exec<DeadlinePeriod>(
      'SELECT request_deadline_date, requests_closed_at FROM periods WHERE id = ?',
      periodId,
    )
    .toArray()[0];
  const task = closePrefix + periodId;
  if (period?.request_deadline_date && period.requests_closed_at === null) {
    putTask(sql, task, deadlineTime(period.request_deadline_date));
  } else {
    sql.exec('DELETE FROM scheduled_tasks WHERE task = ?', task);
  }
}

export async function alignAlarm(storage: DurableObjectStorage): Promise<void> {
  // Check the existing alarm before setting one, including when the constructor wakes for an alarm.
  const current = await storage.getAlarm();
  const next = storage.sql
    .exec<{ scheduled_at: string }>(
      'SELECT scheduled_at FROM scheduled_tasks ORDER BY scheduled_at LIMIT 1',
    )
    .toArray()[0];
  if (next) {
    const time = new Date(next.scheduled_at).getTime();
    if (current !== time) await storage.setAlarm(time);
  } else if (current !== null) {
    await storage.deleteAlarm();
  }
}

export async function initializeScheduledTasks(storage: DurableObjectStorage): Promise<void> {
  storage.transactionSync(() => {
    const missing = storage.sql
      .exec<{ id: string }>(
        `SELECT id FROM periods
      WHERE request_deadline_date IS NOT NULL AND requests_closed_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM scheduled_tasks WHERE task = ? || periods.id)`,
        closePrefix,
      )
      .toArray();
    for (const period of missing) syncPeriodTask(storage.sql, period.id);
    for (const task of ['clean-receipts', 'nightly-backup', 'nightly-mail']) {
      storage.sql.exec(
        'INSERT OR IGNORE INTO scheduled_tasks (task, scheduled_at) VALUES (?, ?)',
        task,
        nextCleanupTime(new Date()),
      );
    }
  });
  await alignAlarm(storage);
}

export async function runScheduledTasks(
  storage: DurableObjectStorage,
  env: BackupEnvironment,
): Promise<void> {
  const now = new Date();
  const due = storage.sql
    .exec<{ task: string; scheduled_at: string }>(
      'SELECT task, scheduled_at FROM scheduled_tasks WHERE scheduled_at <= ? ORDER BY scheduled_at, task',
      now.toISOString(),
    )
    .toArray();
  // Explicitly order the two nightly jobs, independently of task names or SQL ordering.
  due.sort(
    (a, b) =>
      a.scheduled_at.localeCompare(b.scheduled_at) ||
      Number(a.task === 'nightly-mail') - Number(b.task === 'nightly-mail'),
  );
  for (const { task, scheduled_at } of due) {
    if (task === 'nightly-backup') {
      await runNightlyBackup(storage, env, scheduled_at, nextCleanupTime(now), now);
      continue;
    }
    if (task === 'nightly-mail') {
      await runNightlyMail(storage, env, scheduled_at, nextCleanupTime(now), now);
      continue;
    }
    const operation = task === 'clean-receipts' ? 'clean-receipts' : 'close-requests';
    const started = performance.now();
    try {
      storage.transactionSync(() => {
        const sql = storage.sql;
        if (task === 'clean-receipts') {
          sql.exec(
            'DELETE FROM operation_receipts WHERE received_at < ?',
            new Date(now.getTime() - 90 * dayMs).toISOString(),
          );
          putTask(sql, task, nextCleanupTime(now));
          return;
        }
        if (!task.startsWith(closePrefix)) throw new Error('Unknown scheduled task');
        const id = task.slice(closePrefix.length);
        const period = sql
          .exec<DeadlinePeriod>(
            'SELECT request_deadline_date, requests_closed_at FROM periods WHERE id = ?',
            id,
          )
          .toArray()[0];
        if (period?.request_deadline_date && period.requests_closed_at === null) {
          if (period.request_deadline_date >= japanToday(now)) {
            syncPeriodTask(sql, id);
            return;
          }
          capturePeriodSnapshots(sql);
          const revision = sql
            .exec<{ data_change_number: number }>(
              'UPDATE backup_state SET data_change_number = data_change_number + 1 WHERE id = 1 RETURNING data_change_number',
            )
            .one().data_change_number;
          closeRequests(sql, id, revision, now);
        }
        sql.exec('DELETE FROM scheduled_tasks WHERE task = ?', task);
      });
      logAlarm(operation, 'success', started);
    } catch {
      logAlarm(operation, 'failure', started);
      const retryAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      storage.transactionSync(() => putTask(storage.sql, task, retryAt));
      recordFatal(storage, 'E-92', null, `alarm:${task}`);
    }
  }
  await alignAlarm(storage);
}
