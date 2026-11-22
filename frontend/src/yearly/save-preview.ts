import type { SavePreviewResponse } from '../../../shared/protocol';
import { facilities } from '../../../shared/calendar';
import type { SaveInput } from '../saving/types';
import { observeDataResponse } from '../app/data-generation';
import {
  handlesPreviewError,
  handlesRulePreviewError,
  previewDecision,
  rulePreviewDecision,
} from './closure-confirm';

export const previewMessages = {
  offline: 'インターネットにつながっていません。接続を確認してください。',
  error: '保存できませんでした。アプリ製作者に連絡してください。',
  input: '保存できませんでした。入力を確認してください。',
};
async function readPreview(input: SaveInput, transport: typeof fetch) {
  let response: Response;
  try {
    response = await transport('/api/save-preview', {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operation: input.operation, data: input.data }),
    });
    await observeDataResponse(response);
  } catch {
    return { kind: 'error' as const, message: previewMessages.offline };
  }
  try {
    const data = (await response.json()) as SavePreviewResponse & { code?: string };
    if (!response.ok && data.code === 'E-32')
      return { kind: 'error' as const, message: previewMessages.input };
    if (
      !response.ok ||
      !Number.isSafeInteger(data.dataChangeNumber) ||
      !Array.isArray(data.days) ||
      !Array.isArray(data.openingConflicts) ||
      !data.openingConflicts.every(
        (row) =>
          typeof row.date === 'string' &&
          facilities.includes(row.facility) &&
          ['start_time', 'end_time'].includes(row.field) &&
          typeof row.time === 'string',
      ) ||
      typeof data.appVersion !== 'string' ||
      typeof data.dataGeneration !== 'string' ||
      typeof data.requestId !== 'string' ||
      !data.days.every(
        (day) =>
          typeof day.date === 'string' &&
          [day.closed, day.opened, day.remove, day.add, day.paid_leave].every(
            (items) => Array.isArray(items) && items.every((item) => typeof item === 'string'),
          ),
      )
    ) {
      return { kind: 'error' as const, message: previewMessages.error };
    }
    return { kind: 'read' as const, data };
  } catch {
    return { kind: 'error' as const, message: previewMessages.error };
  }
}
export async function readOpeningConflictPreview(
  input: SaveInput,
  transport: typeof fetch = fetch,
) {
  const result = await readPreview(input, transport);
  return result.kind === 'error'
    ? result
    : { kind: 'conflicts' as const, rows: result.data.openingConflicts };
}
export async function readDayPreview(
  date: string,
  input: SaveInput,
  transport: typeof fetch = fetch,
) {
  const result = await readPreview(input, transport);
  if (result.kind === 'error') return result;
  try {
    return previewDecision(date, input, result.data);
  } catch {
    return { kind: 'error' as const, message: previewMessages.error };
  }
}
export function repreviewDay(
  field: string,
  date: string,
  input: SaveInput,
  transport: typeof fetch = fetch,
) {
  return handlesPreviewError(field)
    ? readDayPreview(date, input, transport)
    : Promise.resolve(undefined);
}
export async function readRulePreview(input: SaveInput, transport: typeof fetch = fetch) {
  const result = await readPreview(input, transport);
  return result.kind === 'error' ? result : rulePreviewDecision(input, result.data);
}
export function repreviewRule(field: string, input: SaveInput, transport: typeof fetch = fetch) {
  return handlesRulePreviewError(field)
    ? readRulePreview(input, transport)
    : Promise.resolve(undefined);
}
