import { AppError } from '../../../shared/app-error';
import { ERROR_CODES } from '../../../shared/error-codes';
import type { SaveResponse } from '../../../shared/protocol';

// Checks the response envelope, never the business input being saved.
export function readSaveResponse(value: unknown): SaveResponse {
  if (!value || typeof value !== 'object') throw new AppError('E-73');
  const body = value as Record<string, unknown>;
  if (body.ok === true) {
    if (
      !Array.isArray(body.revisions) ||
      !Object.prototype.hasOwnProperty.call(body, 'data') ||
      !Number.isSafeInteger(body.dataChangeNumber) ||
      (body.dataChangeNumber as number) < 1
    )
      throw new AppError('E-73');
  } else {
    if (
      typeof body.code !== 'string' ||
      !Object.prototype.hasOwnProperty.call(ERROR_CODES, body.code) ||
      typeof body.requestId !== 'string'
    )
      throw new AppError('E-73');
    if (body.code === 'E-32' && typeof body.field !== 'string') throw new AppError('E-73');
    if (body.code === 'E-33' && !Array.isArray(body.conflicts)) throw new AppError('E-73');
  }
  return body as unknown as SaveResponse;
}
