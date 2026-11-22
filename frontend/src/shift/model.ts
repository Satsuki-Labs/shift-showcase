import type { PeriodStaff } from '../../../shared/period-snapshot';
import { calendarRestDay } from '../../../shared/calendar';
import { holidayLabels, paidLeaveLabels } from '../../../shared/leave';
import type {
  AnnualRules,
  DailyRequest,
  DayState,
  PeriodLoadResponse,
  PeriodSummary,
  Role,
  WorkSlot,
  WorkSlotTime,
} from '../../../shared/protocol';
import { staffAssignments, currentEmploymentStatus, historyForPeriod } from '../../../shared/staff';
import { shortTime } from '../format/time';
import { periodDates, periodStaff } from '../../../shared/period';
import { changedByLabels, workRoleLabels } from '../format/labels';

export function requestOverlap(request: DailyRequest, work: readonly WorkSlot[]): string | null {
  if (request.kind === 'available') return null;
  const start =
    request.kind === 'pm_unavailable'
      ? '12:00'
      : request.kind === 'time_unavailable'
        ? request.start_time!
        : '00:00';
  const end =
    request.kind === 'am_unavailable'
      ? '12:00'
      : request.kind === 'time_unavailable'
        ? (request.end_time ?? '24:00')
        : '24:00';
  const slots = work
    .filter((row) => row.staff_id === request.staff_id && row.date === request.date)
    .flatMap((row) => row.slots)
    .filter((slot) => slot.start_time < end && start < slot.end_time)
    .sort((a, b) => a.start_time.localeCompare(b.start_time));
  if (!slots.length) return null;
  const prefix = {
    unavailable: '勤務',
    am_unavailable: '午前に勤務',
    pm_unavailable: '午後に勤務',
    time_unavailable: 'その時間に勤務',
  }[request.kind];
  return `${prefix}が入っています（${slots.map((slot) => `${shortTime(slot.start_time)}〜${shortTime(slot.end_time)}`).join('、')}）`;
}
export function periodRules(rules: AnnualRules, data: PeriodLoadResponse): AnnualRules {
  return data.snapshot ? { ...rules, annualClosures: data.snapshot.annualClosures } : rules;
}
export function loadingTableStaff(
  staff: readonly PeriodStaff[],
  period: PeriodSummary,
  building: 1 | 2,
  today: string,
): PeriodStaff[] {
  const asOf = today < period.end_date ? today : period.end_date;
  return staff
    .filter(
      (person) =>
        staffAssignments(person)[building === 1 ? 'first' : 'second'] &&
        currentEmploymentStatus(person, asOf) === 'active',
    )
    .sort((a, b) => a.sort_order - b.sort_order);
}
export function tableStaff(
  staff: readonly PeriodStaff[],
  period: PeriodSummary,
  building: 1 | 2,
  data: PeriodLoadResponse,
  today: string,
): PeriodStaff[] {
  const belongs = (person: PeriodStaff) =>
    staffAssignments(person)[building === 1 ? 'first' : 'second'];
  const inPeriod = (date: string) => period.start_date <= date && date <= period.end_date;
  const asOf = today < period.end_date ? today : period.end_date;
  return periodStaff(staff, period, data)
    .filter((person) => {
      const active = currentEmploymentStatus(person, asOf) === 'active';
      return (
        data.workSlots.some(
          (row) => row.staff_id === person.id && row.building === building && inPeriod(row.date),
        ) ||
        (belongs(person) &&
          (active ||
            data.dayStates.some(
              (row) =>
                row.staff_id === person.id &&
                inPeriod(row.date) &&
                (row.status === 'paid_leave' || row.status === 'empty'),
            )))
      );
    })
    .sort((a, b) => a.sort_order - b.sort_order);
}
export function dailyCounts(
  data: PeriodLoadResponse,
  building: 1 | 2,
  date: string,
): { support: number; office: number } {
  const support = new Set<string>(),
    office = new Set<string>();
  data.workSlots
    .filter((row) => row.building === building && row.date === date)
    .forEach((row) => {
      if (row.slots.some((slot) => !slot.is_office)) support.add(row.staff_id);
      if (row.slots.some((slot) => slot.is_office)) office.add(row.staff_id);
    });
  return { support: support.size, office: office.size };
}

export interface CellTime extends WorkSlotTime {
  building: 1 | 2;
  other: boolean;
  underline: boolean;
}
function otherEditText(by: Role, at: string) {
  const who = changedByLabels[by];
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(new Date(at));
  const date = `${parts.find((part) => part.type === 'month')!.value}/${parts.find((part) => part.type === 'day')!.value}`;
  return { who, date, text: `${who}が${date}に変更` };
}
export function otherEditMark(
  staffId: string,
  date: string,
  building: 1 | 2,
  role: Role,
  data: PeriodLoadResponse,
) {
  if (role === 'maintenance' || building !== (role === 'first' ? 1 : 2)) return undefined;
  const rows = [
    ...data.dayStates,
    ...data.workSlots.filter((row) => row.building === building),
  ].filter((row) => row.staff_id === staffId && row.date === date);
  const latest = rows.reduce<(typeof rows)[number] | undefined>(
    (last, row) =>
      !last || Date.parse(row.last_changed_at) > Date.parse(last.last_changed_at) ? row : last,
    undefined,
  );
  if (
    !latest ||
    latest.last_changed_by === role ||
    latest.last_changed_by === 'initial' ||
    latest.last_changed_by === 'request'
  )
    return undefined;
  return otherEditText(latest.last_changed_by as Role, latest.last_changed_at);
}
export interface CellView {
  kind: 'work' | 'other' | 'holiday' | 'closure' | 'paid_leave' | 'empty' | 'blank';
  label: string;
  times: CellTime[];
  topRoles: string[];
  bottomRoles: string[];
  otherEdit?: ReturnType<typeof otherEditText>;
  requestMark?: boolean;
  requestRest?: boolean;
}
export interface RequestCellView {
  kind: DailyRequest['kind'] | 'blank' | 'closure';
  label: string;
  workTime: string | null;
  overlap: boolean;
  memo: string | null;
}
export function requestCellView(
  cell: CellView,
  staffId: string,
  date: string,
  period: PeriodSummary,
  data: PeriodLoadResponse,
): RequestCellView {
  const empty: RequestCellView = {
    kind: 'blank',
    label: '',
    workTime: null,
    overlap: false,
    memo: null,
  };
  if (cell.kind === 'closure') return { ...empty, kind: 'closure', label: cell.label };
  const request = period.request_deadline_date
    ? data.dailyRequests.find((row) => row.staff_id === staffId && row.date === date)
    : undefined;
  if (!request) return empty;
  const slots = data.workSlots
    .filter((row) => row.staff_id === staffId && row.date === date)
    .flatMap((row) => row.slots);
  const workTime = slots.length
    ? `${slots.map((slot) => slot.start_time).sort()[0]}〜${
        slots
          .map((slot) => slot.end_time)
          .sort()
          .slice(-1)[0]
      }`
    : null;
  const label =
    request.kind === 'unavailable'
      ? '休み希望'
      : request.kind === 'am_unavailable'
        ? '午前✘'
        : request.kind === 'pm_unavailable'
          ? '午後✘'
          : request.kind === 'available'
            ? `${request.start_time}〜${request.end_time}`
            : `${request.start_time}〜${request.end_time ? `\n${request.end_time}` : ''}✘`;
  return {
    kind: request.kind,
    label,
    workTime,
    overlap: Boolean(period.requests_closed_at && requestOverlap(request, data.workSlots)),
    memo: request.memo,
  };
}
export function requestSubmissionLabel(
  staffId: string,
  period: PeriodSummary,
  data: PeriodLoadResponse,
): '未提出' | '希望なし' | null {
  if (!data.requestStaffIds.includes(staffId)) return null;
  if (data.noRequests.some((row) => row.staff_id === staffId)) return '希望なし';
  return data.dailyRequests.some(
    (row) =>
      row.staff_id === staffId && period.start_date <= row.date && row.date <= period.end_date,
  )
    ? null
    : '未提出';
}
export function requestViewNotice(period: PeriodSummary): string | null {
  if (period.requests_closed_at) return null;
  if (!period.request_deadline_date) return '希望の締め切りが、まだ入っていません。';
  const deadline = `${Number(period.request_deadline_date.slice(5, 7))}月${Number(period.request_deadline_date.slice(8))}日`;
  return `受付中です（締め切り ${deadline}）。今までに提出された希望です。締め切ると、一覧に入ります。`;
}
function unavailableRest(
  person: PeriodStaff,
  period: PeriodSummary,
  periods: readonly PeriodSummary[],
  date: string,
  data: PeriodLoadResponse,
  rules: AnnualRules,
): boolean {
  return (
    Boolean(period.requests_closed_at) &&
    historyForPeriod(person.history, periods, period.start_date)?.employment_type === 'part_time' &&
    data.dailyRequests.some(
      (row) => row.staff_id === person.id && row.date === date && row.kind === 'unavailable',
    ) &&
    !data.workSlots.some((row) => row.staff_id === person.id && row.date === date) &&
    (data.dayStates.find((row) => row.staff_id === person.id && row.date === date)?.status ??
      'none') === 'none' &&
    calendarRestDay(date, rules, data.facilityDays)?.kind !== 'closure'
  );
}
export function requestDayMark(
  person: PeriodStaff,
  period: PeriodSummary,
  periods: readonly PeriodSummary[],
  date: string,
  building: 1 | 2,
  data: PeriodLoadResponse,
  rules: AnnualRules,
): boolean {
  const own = data.workSlots.find(
    (row) => row.staff_id === person.id && row.date === date && row.building === building,
  );
  const state = data.dayStates.find((row) => row.staff_id === person.id && row.date === date);
  return (
    own?.last_changed_by === 'request' ||
    unavailableRest(person, period, periods, date, data, rules) ||
    (historyForPeriod(person.history, periods, period.start_date)?.employment_type ===
      'full_time' &&
      state?.status === 'paid_leave' &&
      state.last_changed_by === 'request')
  );
}
export function cellDisplay(cell: CellView): {
  times: CellTime[];
  bottomRoles: string[];
  title?: string;
} {
  const widths: Record<string, number> = {
    主: 25,
    副: 25,
    閉: 25,
    準備: 55,
    Y: 25,
    Ⅰ: 25,
    Ⅱ: 25,
    'Ⅰ→Ⅱ': 55,
    抜: 25,
    α: 25,
    '…': 25,
  };
  const rowWidth = (roles: string[]) =>
    roles.reduce((total, role) => total + widths[role], 0) + Math.max(0, roles.length - 1) * 4;
  const bottomRoles = [...cell.bottomRoles];
  const markWidth = (Number(Boolean(cell.otherEdit)) + Number(Boolean(cell.requestMark))) * 30;
  const width = 114 - markWidth;
  while (rowWidth(bottomRoles) > width) bottomRoles.pop();
  const hiddenRoles = bottomRoles.length < cell.bottomRoles.length;
  const twoRows =
    cell.topRoles.length > 0 &&
    (bottomRoles.length > 0 ||
      cell.times.length > 3 ||
      hiddenRoles ||
      (markWidth > 0 && rowWidth(cell.topRoles) + markWidth > 114));
  const timeLimit = twoRows ? 2 : 3;
  const hidden = cell.times.length > timeLimit || hiddenRoles;
  if (hidden) {
    while (rowWidth([...bottomRoles, '…']) > width) bottomRoles.pop();
    bottomRoles.push('…');
  }
  const details = hidden
    ? cell.times
        .map(
          (time) =>
            `${time.other ? (time.building === 1 ? '第一 ' : '第二 ') : ''}${shortTime(time.start_time)}–${shortTime(time.end_time)}${time.is_office ? '（事務）' : ''}`,
        )
        .join('、') + `　役割：${[...cell.topRoles, ...cell.bottomRoles].join('、')}`
    : undefined;
  return {
    times: cell.times.slice(0, timeLimit),
    bottomRoles,
    title:
      [cell.kind === 'closure' ? cell.label : undefined, details, cell.otherEdit?.text]
        .filter(Boolean)
        .join('　') || undefined,
  };
}
export function staffCells(
  person: PeriodStaff,
  period: PeriodSummary,
  periods: readonly PeriodSummary[],
  building: 1 | 2,
  data: PeriodLoadResponse,
  rules: AnnualRules,
  role: Role = 'maintenance',
): Map<string, CellView> {
  const dates = periodDates(period);
  const states = new Map(
    data.dayStates.filter((row) => row.staff_id === person.id).map((row) => [row.date, row]),
  );
  const work = data.workSlots.filter((row) => row.staff_id === person.id);
  const history = historyForPeriod(person.history, periods, period.start_date);
  if (!history) throw new Error('Staff history is missing');
  const restDays = new Map(
    dates.map((date) => [date, calendarRestDay(date, rules, data.facilityDays)]),
  );
  const restDay = (date: string, state: DayState | undefined) =>
    history.employment_type === 'full_time' &&
    !work.some((row) => row.date === date) &&
    state?.status !== 'paid_leave' &&
    state?.status !== 'empty'
      ? restDays.get(date)
      : null;
  const holidays = new Map(
    holidayLabels(
      dates.filter((date) => restDay(date, states.get(date))?.kind === 'holiday'),
      period,
    ).map((row) => [row.date, row.label]),
  );
  const paidDates = new Set([
    ...data.paidLeaveDates.filter((row) => row.staff_id === person.id).map((row) => row.date),
    ...data.dayStates
      .filter((row) => row.staff_id === person.id && row.status === 'paid_leave')
      .map((row) => row.date),
  ]);
  const paid = new Map(paidLeaveLabels([...paidDates]).map((row) => [row.date, row.label]));
  return new Map(
    dates.map((date) => {
      const state = states.get(date),
        todayWork = work.filter((row) => row.date === date);
      const own = todayWork.find((row) => row.building === building),
        other = todayWork.find((row) => row.building !== building);
      const lastEnd = todayWork
        .flatMap((row) => row.slots.map((slot) => slot.end_time))
        .sort()
        .slice(-1)[0];
      const times: CellTime[] = [own, other].flatMap((row) =>
        row
          ? row.slots.map((slot) => ({
              ...slot,
              building: row.building,
              other: row.building !== building,
              underline: Boolean(state?.special_care && slot.end_time === lastEnd),
            }))
          : [],
      );
      const { topRoles, bottomRoles } = workRoleLabels(state, todayWork);
      const rest = restDay(date, state);
      const kind: CellView['kind'] = own
        ? 'work'
        : other
          ? 'other'
          : state?.status === 'paid_leave'
            ? 'paid_leave'
            : state?.status === 'empty'
              ? 'empty'
              : (rest?.kind ?? 'blank');
      const requestRest = unavailableRest(person, period, periods, date, data, rules);
      const requestMark =
        !period[building === 1 ? 'first_published_at' : 'second_published_at'] &&
        requestDayMark(person, period, periods, date, building, data, rules);
      return [
        date,
        {
          kind,
          times,
          topRoles,
          bottomRoles,
          requestRest,
          requestMark,
          otherEdit: otherEditMark(person.id, date, building, role, data),
          label:
            kind === 'holiday'
              ? holidays.get(date)!
              : kind === 'closure' && rest?.kind === 'closure'
                ? rest.name
                : kind === 'paid_leave'
                  ? paid.get(date)!
                  : kind === 'empty'
                    ? '空'
                    : '',
        },
      ];
    }),
  );
}
