import { ERROR_CODES, type ErrorCode } from '../../../shared/error-codes';
import type { Role } from '../../../shared/protocol';

export function recordFatal(
  storage: DurableObjectStorage,
  code: ErrorCode,
  role: Role | null,
  operation: string,
): void {
  storage.transactionSync(() => {
    storage.sql.exec(
      'INSERT INTO fatal_errors (code, reason, occurred_at, account, operation) VALUES (?, ?, ?, ?, ?)',
      code,
      ERROR_CODES[code].identifier,
      new Date().toISOString(),
      role,
      operation,
    );
    storage.sql.exec(
      'DELETE FROM fatal_errors WHERE id NOT IN (SELECT id FROM fatal_errors ORDER BY id DESC LIMIT 100)',
    );
  });
}

export function logRequest(
  requestId: string,
  operation: string,
  role: Role | null,
  result: 'success' | ErrorCode,
  started: number,
  entrance: 'staff' | 'request' = 'staff',
): void {
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      requestId,
      entrance,
      operation,
      role,
      result,
      durationMs: Math.round((performance.now() - started) * 1000) / 1000,
    }),
  );
}

export function logAlarm(
  operation: 'close-requests' | 'clean-receipts' | 'nightly-backup' | 'nightly-mail' | 'stall-mail',
  result: 'success' | 'failure' | 'skipped',
  started: number,
  detail?: { code: ErrorCode | null; sizeBytes?: number; failure?: string },
): void {
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      entrance: 'alarm',
      operation,
      result,
      ...(detail
        ? {
            ...(detail.code ? { code: detail.code } : {}),
            ...(detail.sizeBytes !== undefined ? { sizeBytes: detail.sizeBytes } : {}),
            ...(detail.failure ? { failure: detail.failure } : {}),
          }
        : {}),
      durationMs: Math.round((performance.now() - started) * 1000) / 1000,
    }),
  );
}
