import type { Env } from '../index';
import type { BackupFile } from './file';
import { postGas } from '../mail/transport';

export type BackupEnvironment = Pick<Env, 'ENVIRONMENT' | 'BACKUP_GAS_URL' | 'BACKUP_GAS_TOKEN'>;
export type BackupFailure = 'E-52' | 'E-62' | 'E-63' | 'E-64' | 'E-92';

export function validBackupSettings(env: BackupEnvironment): boolean {
  return (
    typeof env.BACKUP_GAS_URL === 'string' &&
    /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(env.BACKUP_GAS_URL) &&
    typeof env.BACKUP_GAS_TOKEN === 'string' &&
    /^[A-Za-z0-9_-]{43}$/.test(env.BACKUP_GAS_TOKEN)
  );
}

export function backupBody(file: BackupFile, token: string): string {
  const bytes = new Uint8Array(file.compressedBytes);
  let offset = 0;
  for (const chunk of file.chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  // Encode aligned slices so no large binary string or argument list is needed.
  const parts: string[] = [];
  for (let start = 0; start < bytes.length; start += 24576) {
    parts.push(btoa(String.fromCharCode(...bytes.subarray(start, start + 24576))));
  }
  return JSON.stringify({
    version: 1,
    kind: 'backup',
    token,
    key: file.key,
    createdAt: file.createdAt,
    data: parts.join(''),
  });
}

export async function sendBackup(
  file: BackupFile,
  env: BackupEnvironment,
): Promise<BackupFailure | null> {
  const response = await postGas(env.BACKUP_GAS_URL!, backupBody(file, env.BACKUP_GAS_TOKEN!));
  if (response.kind !== 'answer' || !response.value || typeof response.value !== 'object')
    return 'E-64';
  const result = response.value as { ok?: unknown; status?: unknown; code?: unknown };
  if (result.ok === true && (result.status === 'saved' || result.status === 'duplicate'))
    return null;
  if (result.ok === false && result.code === 'rejected') return 'E-62';
  if (result.ok === false && result.code === 'quota') return 'E-63';
  return 'E-64';
}
