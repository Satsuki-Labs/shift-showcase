import { validBackupSettings, type BackupEnvironment } from '../backup/send';
import { postGas } from './transport';
import type { Mail } from './compose';

// Only these fixed classifications may reach the log; never log a GAS response.
export async function sendMail(mail: Mail, env: BackupEnvironment): Promise<string | null> {
  if (!validBackupSettings(env)) return 'config';
  const result = await postGas(
    env.BACKUP_GAS_URL!,
    JSON.stringify({
      version: 1,
      kind: 'mail',
      token: env.BACKUP_GAS_TOKEN,
      subject: mail.subject,
      body: mail.body,
    }),
  );
  if (result.kind !== 'answer') return result.kind;
  if (result.value && typeof result.value === 'object') {
    const answer = result.value as { ok?: unknown; status?: unknown; code?: unknown };
    if (answer.ok === true && answer.status === 'sent') return null;
    if (answer.ok === false && ['rejected', 'quota', 'temporary'].includes(String(answer.code)))
      return String(answer.code);
  }
  return 'unreadable';
}
