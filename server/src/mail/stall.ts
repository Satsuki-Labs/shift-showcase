import { japanDate } from '../../../shared/date';
import type { BackupEnvironment } from '../backup/send';
import { logAlarm, recordFatal } from '../entrance/records';
import { composeStallMail, type DelayedTask } from './compose';
import { sendMail } from './send';

export function stalledTasks(sql: SqlStorage, env: BackupEnvironment, now: Date): DelayedTask[] {
  if (env.ENVIRONMENT === '手元') return [];
  return sql
    .exec<DelayedTask>(
      'SELECT task, scheduled_at FROM scheduled_tasks WHERE scheduled_at < ? ORDER BY scheduled_at, task',
      new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString(),
    )
    .toArray();
}

// One instance belongs to one Durable Object; acquire the flag before any await.
export class StallMail {
  private sending = false;
  start(
    storage: DurableObjectStorage,
    env: BackupEnvironment,
    tasks: DelayedTask[],
    now: Date,
  ): Promise<void> | undefined {
    if (env.ENVIRONMENT === '手元' || !tasks.length || this.sending) return;
    const today = japanDate(now);
    if (
      storage.sql
        .exec<{ stall_mailed_on: string | null }>(
          'SELECT stall_mailed_on FROM mail_state WHERE id = 1',
        )
        .one().stall_mailed_on === today
    )
      return;
    this.sending = true;
    return this.send(storage, env, tasks, today).finally(() => {
      this.sending = false;
    });
  }
  private async send(
    storage: DurableObjectStorage,
    env: BackupEnvironment,
    tasks: DelayedTask[],
    today: string,
  ): Promise<void> {
    const started = performance.now();
    const failure = await sendMail(composeStallMail(storage.sql, tasks), env);
    if (failure) recordFatal(storage, 'E-65', null, 'stall-mail');
    else
      storage.transactionSync(() => {
        storage.sql.exec('UPDATE mail_state SET stall_mailed_on = ? WHERE id = 1', today);
      });
    logAlarm(
      'stall-mail',
      failure ? 'failure' : 'success',
      started,
      failure ? { code: 'E-65', failure } : undefined,
    );
  }
}
