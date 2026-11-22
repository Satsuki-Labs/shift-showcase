import { AppError } from '../../../shared/app-error';
import type { ResponseMetadata, SavePreviewResponse } from '../../../shared/protocol';
import { prepareCalendarChange } from './calendar';
import { readInputJson } from '../entrance/body';

export async function readSavePreview(
  request: Request,
  storage: DurableObjectStorage,
  metadata: ResponseMetadata,
): Promise<SavePreviewResponse> {
  const raw = await readInputJson(request);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new AppError('E-36');
  const input = raw as Record<string, unknown>;
  if (
    Object.keys(input).length !== 2 ||
    !Object.hasOwn(input, 'data') ||
    !Object.hasOwn(input, 'operation')
  )
    throw new AppError('E-36');
  if (typeof input.operation !== 'string') throw new AppError('E-32', 'operation');
  const prepared = prepareCalendarChange(storage.sql, input.operation, input.data, true);
  const dataChangeNumber = storage.sql
    .exec<{ data_change_number: number }>(
      'SELECT data_change_number FROM backup_state WHERE id = 1',
    )
    .one().data_change_number;
  const days = prepared.plans
    .filter((plan) => plan.remove.length || plan.add.length || plan.paid_leave.length)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(({ date, closed, opened, remove, add, paid_leave }) => ({
      date,
      closed,
      opened,
      remove,
      add,
      paid_leave,
    }));
  return { ...metadata, dataChangeNumber, days, openingConflicts: prepared.openingConflicts };
}
