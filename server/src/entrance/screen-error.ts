import { AppError } from '../../../shared/app-error';
import { ERROR_CODES, type ErrorCode } from '../../../shared/error-codes';
import type { Role } from '../../../shared/protocol';
import { recordFatal } from './records';
import { readInputJson } from './body';

export async function receiveScreenError(
  request: Request,
  storage: DurableObjectStorage,
  role: Role,
): Promise<void> {
  const body = await readInputJson(request);
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new AppError('E-36');
  const input = body as Record<string, unknown>;
  if (
    Object.keys(input).length !== 2 ||
    typeof input.code !== 'string' ||
    !Object.hasOwn(ERROR_CODES, input.code) ||
    typeof input.screen !== 'string' ||
    !/^[a-zA-Z0-9_./-]{1,80}$/.test(input.screen)
  )
    throw new AppError('E-36');
  recordFatal(storage, input.code as ErrorCode, role, input.screen);
}
