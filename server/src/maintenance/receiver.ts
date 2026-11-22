import { AppError } from '../../../shared/app-error';
import type { Identity } from '../../../shared/protocol';
import { readInputJson } from '../entrance/body';
import { prepareRestore, finishRestore } from './restore';
import { receiveImport } from './import';
import type { MaintenanceReply } from './response';

export async function receiveMaintenance(
  request: Request,
  ctx: DurableObjectState,
  identity: Identity,
  operation: string,
): Promise<MaintenanceReply> {
  if (identity.role !== 'maintenance' || request.method !== 'POST') throw new AppError('E-35');
  if (operation === 'maintenance-import') return receiveImport(request, ctx.storage);
  const value = await readInputJson(request);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AppError('E-36');
  const input = value as Record<string, unknown>;
  if (operation === 'maintenance-restore-prepare') return prepareRestore(ctx.storage, input);
  if (operation === 'maintenance-restore-finish') return finishRestore(ctx.storage, input);
  if (operation === 'maintenance-restart') {
    ctx.abort();
    return { ok: true };
  }
  throw new AppError('E-35');
}
