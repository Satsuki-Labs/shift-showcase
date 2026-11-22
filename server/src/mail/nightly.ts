import { japanDate } from '../../../shared/date';
import type { BackupEnvironment } from '../backup/send';
import { logAlarm, recordFatal } from '../entrance/records';
import { composeNightlyMail } from './compose';
import { sendMail } from './send';

export async function runNightlyMail(
  storage: DurableObjectStorage,
  env: BackupEnvironment,
  scheduledAt: string,
  nextAt: string,
  now: Date,
): Promise<void> {
  const started = performance.now();
  const current = () =>
    storage.sql
      .exec<{ scheduled_at: string }>(
        "SELECT scheduled_at FROM scheduled_tasks WHERE task = 'nightly-mail'",
      )
      .toArray()[0]?.scheduled_at === scheduledAt;
  if (!current()) return;
  let draft: ReturnType<typeof composeNightlyMail> = null;
  let code: 'E-65' | 'E-92' | null = null;
  try {
    draft = env.ENVIRONMENT === '手元' ? null : composeNightlyMail(storage.sql, now);
  } catch {
    code = 'E-92';
  }
  if (!current()) return;
  const failure = draft ? await sendMail(draft.mail, env) : null;
  if (failure) code = 'E-65';
  storage.transactionSync(() => {
    if (!current()) return;
    if (code) recordFatal(storage, code, null, 'alarm:nightly-mail');
    else if (draft) {
      storage.sql.exec(
        `UPDATE mail_state SET fatal_error_mailed_id = ?,
        backup_failure_mailed_on = CASE WHEN ? THEN ? WHEN ? THEN NULL ELSE backup_failure_mailed_on END,
        annual_task_mailed_on = CASE WHEN ? THEN ? ELSE annual_task_mailed_on END WHERE id = 1`,
        draft.maxId,
        draft.failure ? 1 : 0,
        japanDate(now),
        draft.recovery ? 1 : 0,
        draft.annual ? 1 : 0,
        japanDate(now),
      );
    }
    storage.sql.exec(
      "UPDATE scheduled_tasks SET scheduled_at = ? WHERE task = 'nightly-mail'",
      nextAt,
    );
  });
  logAlarm(
    'nightly-mail',
    code ? 'failure' : draft ? 'success' : 'skipped',
    started,
    code ? { code, ...(failure ? { failure } : {}) } : undefined,
  );
}
