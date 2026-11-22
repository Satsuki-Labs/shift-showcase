import { AppError } from '../../../shared/app-error';
import type { ErrorCode } from '../../../shared/error-codes';
import {
  APP_VERSION,
  type ErrorResponse,
  type FirstLoadResponse,
  type YearLoadResponse,
  type ResponseMetadata,
  type SaveConflict,
  type SaveConflictResponse,
  type SaveSuccess,
  type SavePreviewResponse,
} from '../../../shared/protocol';
import type {
  RequestChangeNumberResponse,
  RequestRequestsResponse,
  RequestSheetResponse,
} from '../../../shared/protocol';
import { ImportError, ImportVersionError, type MaintenanceReply } from '../maintenance/response';

export interface EntranceResult {
  body:
    | FirstLoadResponse
    | YearLoadResponse
    | number
    | MaintenanceReply
    | (ErrorResponse & {
        table?: string | null;
        line?: number;
        reason?: string;
        formatVersion?: unknown;
        schemaVersion?: unknown;
      })
    | SaveSuccess
    | SaveConflictResponse
    | SavePreviewResponse
    | RequestSheetResponse
    | RequestRequestsResponse
    | RequestChangeNumberResponse;
  status: number;
  generation: string | null;
  restoredTo?: string | null;
  result: 'success' | ErrorCode;
}
export function metadata(requestId: string, dataGeneration: string | null): ResponseMetadata {
  return { appVersion: APP_VERSION, requestId, dataGeneration };
}
export function failure(
  error: unknown,
  requestId: string,
  generation: string | null,
  restoredTo: string | null = null,
): EntranceResult {
  const appError = error instanceof AppError ? error : new AppError('E-92');
  const code = appError.code;
  const status = ['E-22', 'E-23', 'E-24'].includes(code)
    ? 401
    : ['E-25', 'E-26'].includes(code)
      ? 403
      : ['E-32', 'E-36', 'E-38', 'E-45'].includes(code)
        ? 400
        : ['E-33', 'E-34', 'E-37', 'E-42', 'E-44', 'E-46', 'E-47'].includes(code)
          ? 409
          : ['E-27', 'E-35'].includes(code)
            ? 404
            : code === 'E-82'
              ? 503
              : 500;
  return {
    body: {
      code,
      requestId,
      ...(appError.field ? { field: appError.field } : {}),
      ...(error instanceof ImportError ? error.location : {}),
      ...(error instanceof ImportVersionError
        ? { formatVersion: error.formatVersion, schemaVersion: error.schemaVersion }
        : {}),
    },
    status,
    generation,
    restoredTo,
    result: code,
  };
}
export function saveReply(
  value: SaveSuccess | SaveConflict,
  requestId: string,
  generation: string,
  restoredTo: string | null = null,
): EntranceResult {
  if ('code' in value) {
    const result = failure(new AppError('E-33'), requestId, generation, restoredTo);
    return { ...result, body: { ...value, requestId } };
  }
  return { body: value, status: 200, generation, restoredTo, result: 'success' };
}
export function respond(value: EntranceResult, requestId: string): Response {
  return Response.json(value.body, {
    status: value.status,
    headers: {
      'X-App-Version': APP_VERSION,
      'X-Data-Generation': value.generation ?? 'null',
      'X-Restored-To': value.restoredTo ?? 'null',
      'X-Request-Id': requestId,
      'Cache-Control': 'no-store',
    },
  });
}
export function operationOf(request: Request): string {
  const route = requestRoute(request);
  if (route) return `request-${route.operation}`;
  const path = new URL(request.url).pathname;
  const maintenance = /^\/api\/maintenance\/(restore-prepare|restart|restore-finish|import)$/.exec(
    path,
  );
  if (maintenance) return `maintenance-${maintenance[1]}`;
  if (path === '/api/first-load') return 'first-load';
  if (path === '/api/year-load') return 'year-load';
  if (path === '/api/period-load') return 'period-load';
  if (path === '/api/change-number') return 'change-number';
  if (path === '/api/screen-error') return 'screen-error';
  if (path === '/api/save') return 'save';
  if (path === '/api/save-preview') return 'save-preview';
  return 'unknown';
}

export function requestRoute(
  request: Request,
): { key: string; operation: 'load' | 'requests' | 'change-number' | 'save' } | null {
  const match = /^\/api\/request\/([^/]+)\/(load|requests|change-number|save)$/.exec(
    new URL(request.url).pathname,
  );
  if (!match || request.method !== (match[2] === 'save' ? 'POST' : 'GET')) return null;
  return { key: match[1], operation: match[2] as 'load' | 'requests' | 'change-number' | 'save' };
}
