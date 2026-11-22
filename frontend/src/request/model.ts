import type { RequestSheetDailyRequest, RequestSheetStaff } from '../../../shared/protocol';
import { japanToday, staffFamilyName } from '../../../shared/staff';

export const rememberedStaffKey = 'shift-request-staff-id';
export const unavailableKinds = [
  'unavailable',
  'am_unavailable',
  'pm_unavailable',
  'time_unavailable',
] as const;
export type LoadFailure = 'badurl' | 'loaderr';

export function deadlineStatus(deadline: string, closed: boolean, today = japanToday()) {
  if (closed) return { kind: 'closed', text: '締め切りました' } as const;
  const days = Math.round(
    (Date.parse(`${deadline}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000,
  );
  return {
    kind: days >= 8 ? 'calm' : days >= 3 ? 'soon' : 'last',
    text: days <= 0 ? '今日まで' : `あと${days}日`,
  };
}

export function rememberedStaff(
  staff: RequestSheetStaff[],
  id: string | null,
): RequestSheetStaff | undefined {
  return staff.find((person) => person.id === id);
}

export function loadFailure(error: unknown): LoadFailure {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'E-27'
    ? 'badurl'
    : 'loaderr';
}

export function timeFrom(time: string | null): string {
  if (!time) return '';
  const [hour, minute] = time.split(':');
  return minute === '00' ? `${Number(hour)}時〜` : `${Number(hour)}:${minute}〜`;
}

export function requestKey(request: RequestSheetDailyRequest): string {
  return `${request.date}/${request.staff_id}/${request.kind}`;
}

export function otherRequests(
  requests: RequestSheetDailyRequest[],
  staff: RequestSheetStaff[],
  me: string,
  date: string,
) {
  const people = new Map(
    staff
      .filter((person) => person.id !== me && person.employment_type !== 'casual')
      .map((person) => [person.id, person]),
  );
  return unavailableKinds.flatMap((kind) => {
    const names = requests
      .filter(
        (request) => request.date === date && request.kind === kind && people.has(request.staff_id),
      )
      .map((request) => ({
        key: requestKey(request),
        name: staffFamilyName(people.get(request.staff_id)!.name),
        time: kind === 'time_unavailable' ? timeFrom(request.start_time) : '',
      }));
    return names.length ? [{ kind, names }] : [];
  });
}

export const weekdays = '日月火水木金土';
