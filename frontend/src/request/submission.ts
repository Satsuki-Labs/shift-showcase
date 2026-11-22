import type {
  RequestSheetDailyRequest,
  RequestSheetResponse,
  SaveRequest,
} from '../../../shared/protocol';
import { SAVE_SHAPE_VERSION } from '../../../shared/save-shapes';
import { weekdays } from './model';

export type RequestDraft = {
  kind: RequestSheetDailyRequest['kind'] | null;
  from: string;
  to: string;
  memo: string;
};
export type RequestOperation =
  'request.day.save' | 'request.day.delete' | 'request.none.set' | 'request.none.clear';
export const uncertainMessage = '届いたか確かめられませんでした。';
export const conflictMessage =
  'ほかの画面で、先に変更されていました。今の内容を見て、もう一度出してください。';

export function normalizeTime(text: string): string {
  return text.replace(/[０-９：]/g, (character) =>
    String.fromCharCode(character.charCodeAt(0) - 0xfee0),
  );
}

export function formatTime(text: string): string | null {
  text = normalizeTime(text);
  if (!/^(?:\d{1,4}|\d{1,2}:\d{2})$/.test(text)) return text === '' ? '' : null;
  const digits = text.replace(':', '');
  const hour = text.includes(':')
    ? Number(text.split(':')[0])
    : digits.length <= 2
      ? Number(digits)
      : Number(digits.slice(0, -2));
  const minute = text.includes(':')
    ? Number(text.split(':')[1])
    : digits.length <= 2
      ? 0
      : Number(digits.slice(-2));
  return hour > 23 || minute > 59 ? null : `${hour}:${String(minute).padStart(2, '0')}`;
}

function timeForSave(text: string): string | null {
  const time = formatTime(text);
  return time ? time.padStart(5, '0') : null;
}

export function draftStatus(draft: RequestDraft) {
  const needsTime = draft.kind === 'time_unavailable' || draft.kind === 'available';
  const from = timeForSave(draft.from),
    to = timeForSave(draft.to);
  const problem = !needsTime
    ? ''
    : formatTime(draft.from) === null || formatTime(draft.to) === null
      ? '時刻の形が違います　例：1800 → 18:00'
      : !from && !to
        ? '入れる時間を入れてください。'
        : draft.kind === 'available' &&
            ((from && (from < '07:00' || from > '22:00')) || (to && (to < '07:00' || to > '22:00')))
          ? '7:00〜22:00の間で入れてください'
          : from && to && from >= to
            ? '入れた時間を見直してください'
            : '';
  return {
    problem,
    canSubmit: Boolean(draft.kind) && (!needsTime || Boolean(from && to && !problem)),
  };
}

export function buildRequest(
  sheet: RequestSheetResponse,
  staffId: string,
  operation: RequestOperation,
  operationId: string,
  date?: string,
  draft?: RequestDraft,
): SaveRequest {
  if (!sheet.dataGeneration) throw new Error('Missing data generation');
  const day = sheet.dailyRequests.find((row) => row.staff_id === staffId && row.date === date);
  const none = sheet.noRequests.find(
    (row) => row.staff_id === staffId && row.period_id === sheet.period.id,
  );
  const dayRevision = {
    target: { unit: 'daily-request' as const, staffId, date: date! },
    revision: day?.revision ?? null,
  };
  const noneRevision = {
    target: { unit: 'no-request' as const, staffId, periodId: sheet.period.id },
    revision: none?.revision ?? null,
  };
  let data: SaveRequest['data'] = { staff_id: staffId };
  if (operation === 'request.day.save') {
    if (!date || !draft || !draftStatus(draft).canSubmit) throw new Error('Invalid request draft');
    const needsTime = draft.kind === 'time_unavailable' || draft.kind === 'available';
    data = {
      staff_id: staffId,
      date,
      kind: draft.kind,
      start_time: needsTime ? timeForSave(draft.from) : null,
      end_time: needsTime ? timeForSave(draft.to) : null,
      ...(draft.memo.trim() ? { memo: draft.memo.trim() } : {}),
    };
  } else if (operation === 'request.day.delete') {
    if (!date) throw new Error('Missing request date');
    data = { staff_id: staffId, date };
  }
  return {
    operationId,
    operation,
    dataGeneration: sheet.dataGeneration,
    saveShapeVersion: SAVE_SHAPE_VERSION,
    data,
    revisions:
      operation === 'request.day.save'
        ? [dayRevision, noneRevision]
        : operation === 'request.day.delete'
          ? [dayRevision]
          : [noneRevision],
  };
}

// 接続失敗では受付済みか分からないので、同じ中身の再送には同じ操作番号を使う。
export function retryRequest(previous: SaveRequest | undefined, next: SaveRequest): SaveRequest {
  return previous &&
    previous.operation === next.operation &&
    JSON.stringify(previous.data) === JSON.stringify(next.data)
    ? previous
    : next;
}

// メモの本文は返らないため、公開される内容と更新番号で、届いた希望を確かめる。
export function requestWasApplied(sheet: RequestSheetResponse, request: SaveRequest): boolean {
  if (sheet.dataGeneration !== request.dataGeneration) return false;
  const data = request.data as {
    staff_id: string;
    date?: string;
    kind?: string;
    start_time?: string | null;
    end_time?: string | null;
    memo?: string;
  };
  const day = sheet.dailyRequests.find(
    (row) => row.staff_id === data.staff_id && row.date === data.date,
  );
  const none = sheet.noRequests.find(
    (row) => row.staff_id === data.staff_id && row.period_id === sheet.period.id,
  );
  const revision = request.revisions[0]?.revision;
  if (request.operation === 'request.day.delete') return revision != null && !day;
  if (request.operation === 'request.none.clear') return revision != null && !none;
  if (request.operation === 'request.none.set') return Boolean(none && none.revision !== revision);
  return Boolean(
    day &&
    day.revision !== revision &&
    day.kind === data.kind &&
    day.start_time === data.start_time &&
    day.end_time === data.end_time &&
    (!data.memo || day.has_memo),
  );
}

export function noRequestState(
  sheet: RequestSheetResponse,
  staffId: string,
): 'empty' | 'submitted' | 'disabled' {
  if (sheet.dailyRequests.some((row) => row.staff_id === staffId)) return 'disabled';
  return sheet.noRequests.some(
    (row) => row.staff_id === staffId && row.period_id === sheet.period.id,
  )
    ? 'submitted'
    : 'empty';
}

export function dayTitle(date: string): string {
  const day = new Date(`${date}T00:00:00Z`);
  return `${day.getUTCMonth() + 1}月${day.getUTCDate()}日（${weekdays[day.getUTCDay()]}）`;
}

export function submissionDetail(date: string, draft: RequestDraft): string {
  const labels = { unavailable: '終日', am_unavailable: '午前', pm_unavailable: '午後' };
  const time = draft.kind === 'time_unavailable' || draft.kind === 'available';
  const label = time
    ? `${formatTime(draft.from)}〜${formatTime(draft.to)}`
    : labels[draft.kind as keyof typeof labels];
  return `${dayTitle(date)}　${label} ${draft.kind === 'available' ? '入れる' : '入れない'}`;
}
