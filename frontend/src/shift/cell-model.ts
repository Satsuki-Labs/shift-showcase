import type { PeriodStaff } from '../../../shared/period-snapshot';
import { staffAssignments } from '../../../shared/staff';
import type {
  AnnualRules,
  CurrentRevision,
  DayState,
  PeriodLoadResponse,
  PeriodSummary,
  ReplacedShift,
  Revision,
  Role,
  ShiftCellChangedData,
  ShiftCellSaveInput,
  WorkSlotTime,
} from '../../../shared/protocol';
import type { DayRole } from '../../../shared/staff';
import {
  historyForPeriod,
  MOVEMENT_ROLES,
  requestedWorkAssignment,
  suggestedMovementRole,
} from '../../../shared/staff';
import { allFacilitiesClosed } from '../../../shared/calendar';
import type { SaveInput } from '../saving/types';
import { requestOverlap, staffCells } from './model';
import { shortTime } from '../format/time';
import { dayLabel } from '../format/date';

export const slotNames = ['第一 1回目', '第一 2回目', '第二 1回目', '第二 2回目'] as const;
export interface SlotDraft extends WorkSlotTime {
  id: number;
  building: 1 | 2;
}
export interface CellForm {
  status: DayState['status'] | null;
  slots: SlotDraft[];
  roles: DayRole[];
  specialCare: boolean;
  notes: string;
}
export interface CellContext {
  person: PeriodStaff;
  period: PeriodSummary;
  periods: readonly PeriodSummary[];
  date: string;
  building: 1 | 2;
  data: PeriodLoadResponse;
  rules: AnnualRules;
}
export function requestBanner(context: CellContext): {
  title: string;
  request: string;
  before?: string;
  memo: string | null;
  replaced: ReplacedShift | null;
  overlap?: string;
  canInsert?: boolean;
} | null {
  const { person, period, periods, date, data } = context;
  const request = data.dailyRequests.find((row) => row.staff_id === person.id && row.date === date);
  if (!request) return null;
  const from = request.start_time && shortTime(request.start_time),
    to = request.end_time && shortTime(request.end_time);
  const descriptions = {
    unavailable: ['終日 入れない', '終日 入れない'],
    am_unavailable: ['午前は入れない', '午前 入れない（12:00まで）'],
    pm_unavailable: ['午後は入れない', '午後 入れない（12:00から）'],
    time_unavailable: to
      ? [`${from}〜${to}は入れない`, `${from}〜${to} 入れない`]
      : [`${from}から入れない`, `${from}から 入れない`],
    available: ['入れる', `${from}〜${to} 入れる`],
  }[request.kind];
  const banner = {
    title: `${descriptions[0]}、という希望が出ています`,
    request: descriptions[1],
    memo: request.memo,
    replaced: null,
  };
  if (!period.requests_closed_at) return banner;
  const state = data.dayStates.find((row) => row.staff_id === person.id && row.date === date);
  const available = request.kind === 'available';
  const requestedWork = data.workSlots.some(
    (row) => row.staff_id === person.id && row.date === date && row.last_changed_by === 'request',
  );
  if (
    request.replaced_shift &&
    (available ? requestedWork : state?.last_changed_by === 'request')
  ) {
    const replaced = request.replaced_shift;
    const before =
      [...replaced.buildings]
        .sort((a, b) => a.building - b.building)
        .flatMap((row) =>
          [...row.slots]
            .sort((a, b) => a.start_time.localeCompare(b.start_time))
            .map(
              (slot) =>
                `${shortTime(slot.start_time)}〜${shortTime(slot.end_time)}　${row.building === 1 ? '第一' : '第二'} ${slot.facility}`,
            ),
        )
        .join('、') || (replaced.status === 'paid_leave' ? '有給' : '空');
    return {
      ...banner,
      title: available
        ? '希望で、勤務が入りました'
        : historyForPeriod(person.history, periods, period.start_date)?.employment_type ===
            'full_time'
          ? '希望で、有給になりました'
          : '希望で、勤務が外されました',
      before,
      replaced,
    };
  }
  if (available && requestedWork) return { ...banner, title: '希望で、勤務が入りました' };
  const overlap = requestOverlap(request, data.workSlots);
  const canInsert =
    available &&
    historyForPeriod(person.history, periods, period.start_date)?.employment_type === 'casual' &&
    !data.workSlots.some((row) => row.staff_id === person.id && row.date === date);
  return { ...banner, ...(overlap ? { overlap } : {}), ...(canInsert ? { canInsert: true } : {}) };
}
export function insertRequestedWork(context: CellContext, form: CellForm): CellForm {
  const request = context.data.dailyRequests.find(
    (row) =>
      row.staff_id === context.person.id && row.date === context.date && row.kind === 'available',
  )!;
  const assignment = requestedWorkAssignment(context.date, context.person),
    { building } = assignment;
  const facility = assignment.facility ?? (building === 1 ? 'A' : 'C');
  return {
    ...form,
    status: 'none',
    roles: [...context.person.default_roles],
    specialCare: false,
    slots: form.slots.map((slot) => ({
      ...slot,
      start_time: '',
      end_time: '',
      is_office: false,
      ...(slot.id === (building === 1 ? 0 : 2)
        ? { start_time: request.start_time!, end_time: request.end_time!, facility }
        : {}),
    })),
  };
}
export function restoreRequestedShift(form: CellForm, replaced: ReplacedShift): CellForm {
  return {
    ...form,
    status: replaced.status,
    roles: [...replaced.roles] as DayRole[],
    specialCare: replaced.special_care,
    slots: form.slots.map((slot) => ({
      ...slot,
      start_time: '',
      end_time: '',
      is_office: false,
      ...replaced.buildings.find((row) => row.building === slot.building)?.slots[slot.id % 2],
    })),
  };
}
export function hasTime(slot: Pick<SlotDraft, 'start_time' | 'end_time'>) {
  return Boolean(slot.start_time && slot.end_time);
}
export type DefaultDayKind = 'normal' | 'peak' | 'saturday';
export function defaultDayKind({
  date,
  rules,
}: Pick<CellContext, 'date' | 'rules'>): DefaultDayKind {
  if (new Date(`${date}T00:00:00Z`).getUTCDay() === 6) return 'saturday';
  return rules.peaks.some((row) => row.start_date <= date && date <= row.end_date)
    ? 'peak'
    : 'normal';
}
export function defaults(context: CellContext, form: CellForm): CellForm {
  return defaultsForKind(context, form, defaultDayKind(context));
}
export function defaultsForKind(
  context: CellContext,
  form: CellForm,
  kind: DefaultDayKind,
): CellForm {
  const { person } = context;
  const slots = form.slots.map((slot) => ({
    ...slot,
    start_time: '',
    end_time: '',
    is_office: false,
  }));
  if (kind === 'saturday') {
    const time = person.default_work_times.saturday;
    if (time)
      Object.assign(slots[0], { start_time: time.start, end_time: time.end, facility: 'A' });
  } else {
    for (const [site, offset] of [
      ['first', 0],
      ['second', 2],
    ] as const) {
      if (!staffAssignments(person)[site]) continue;
      const pair = person.default_work_times[kind][site];
      [pair.slot1, pair.slot2].forEach((time, i) => {
        if (time) Object.assign(slots[offset + i], { start_time: time.start, end_time: time.end });
      });
    }
  }
  return {
    ...form,
    slots,
    roles: slots.some(hasTime) ? [...person.default_roles] : [],
    specialCare: false,
  };
}
export function storedCell(context: CellContext): CellForm {
  const { person, date, data } = context;
  const state = data.dayStates.find((row) => row.staff_id === person.id && row.date === date);
  const work = data.workSlots.filter((row) => row.staff_id === person.id && row.date === date);
  const form: CellForm = {
    status: state?.status === 'paid_leave' || state?.status === 'empty' ? state.status : 'none',
    slots: Array.from({ length: 4 }, (_, id) => {
      const building = id < 2 ? 1 : 2;
      return {
        id,
        building,
        start_time: '',
        end_time: '',
        is_office: false,
        facility: (building === 1
          ? (person.default_first_facility ?? 'A')
          : (person.default_second_facility ?? 'C')) as WorkSlotTime['facility'],
        ...work.find((row) => row.building === building)?.slots[id % 2],
      };
    }),
    roles: [...(state?.roles ?? [])] as DayRole[],
    specialCare: state?.special_care ?? false,
    notes: person.notes,
  };
  return form;
}
export function initialCell(context: CellContext): { form: CellForm; seeded: boolean } {
  const form = storedCell(context);
  const work = context.data.workSlots.filter(
    (row) => row.staff_id === context.person.id && row.date === context.date,
  );
  const kind = staffCells(
    context.person,
    context.period,
    context.periods,
    context.building,
    context.data,
    context.rules,
  ).get(context.date)?.kind;
  if (kind === 'holiday' || kind === 'closure')
    return { form: { ...form, status: null }, seeded: false };
  if (
    !work.length &&
    form.status === 'none' &&
    !allFacilitiesClosed(context.date, context.rules, context.data.facilityDays)
  ) {
    const filled = defaults(context, form);
    return { form: filled, seeded: filled.slots.some(hasTime) };
  }
  return { form, seeded: false };
}
export function orderSlots(slots: readonly SlotDraft[]): SlotDraft[] {
  return [1, 2].flatMap((building) =>
    [...slots.filter((slot) => slot.building === building)].sort((a, b) =>
      !a.start_time && !a.end_time
        ? 1
        : !b.start_time && !b.end_time
          ? -1
          : a.start_time.localeCompare(b.start_time),
    ),
  );
}
export const slotOverlapProblem = (index: number) => `${slotNames[index]}と時間が重なっています`;
export function slotProblem(slot: SlotDraft, slots: readonly SlotDraft[]): string | null {
  if (slots.every((row) => !row.start_time && !row.end_time)) return '出勤と退勤を入れてください。';
  if (Boolean(slot.start_time) !== Boolean(slot.end_time))
    return '出勤と退勤の両方を入れてください';
  if (!hasTime(slot)) return null;
  if (slot.end_time <= slot.start_time) return '退勤は、出勤より後の時刻にしてください。';
  const index = slots.findIndex(
    (other) =>
      other.id !== slot.id &&
      hasTime(other) &&
      slot.start_time < other.end_time &&
      other.start_time < slot.end_time,
  );
  return index < 0 ? null : slotOverlapProblem(index);
}
export function workBuildings(form: CellForm): (1 | 2)[] {
  return form.status === 'none'
    ? ([1, 2] as const).filter((building) =>
        form.slots.some((slot) => slot.building === building && hasTime(slot)),
      )
    : [];
}
export function movement(form: CellForm): string | null {
  return workBuildings(form).length === 2 ? 'Ⅰ→Ⅱ' : null;
}
export function changeCellWork(context: CellContext, before: CellForm, after: CellForm): CellForm {
  const buildings = workBuildings(after);
  if (JSON.stringify(workBuildings(before)) === JSON.stringify(buildings)) return after;
  const suggested = suggestedMovementRole(
    context.person,
    new Date(`${context.date}T00:00:00Z`).getUTCDay() === 6,
    buildings,
  );
  return {
    ...after,
    roles: [
      ...after.roles.filter((role) => !MOVEMENT_ROLES.some((value) => value === role)),
      ...(suggested ? [suggested] : []),
    ],
  };
}
export function toggleOffice<T extends { slots: SlotDraft[] }>(form: T): T {
  const enabled = form.slots.some((slot) => hasTime(slot) && slot.is_office);
  const earliest = [...form.slots]
    .filter(hasTime)
    .sort((a, b) => a.start_time.localeCompare(b.start_time))[0];
  return {
    ...form,
    slots: form.slots.map((slot) => ({ ...slot, is_office: !enabled && slot.id === earliest?.id })),
  };
}
export function chooseOffice<T extends { slots: SlotDraft[] }>(form: T, id: number): T {
  const row = form.slots.find((slot) => slot.id === id)!;
  if (row.is_office && form.slots.filter((slot) => hasTime(slot) && slot.is_office).length === 1)
    return form;
  return {
    ...form,
    slots: form.slots.map((slot) =>
      slot.id === id ? { ...slot, is_office: !slot.is_office } : slot,
    ),
  };
}
export function updateSlot(form: CellForm, id: number, change: Partial<WorkSlotTime>): CellForm {
  let slots = form.slots.map((slot) => (slot.id === id ? { ...slot, ...change } : slot));
  slots = slots.map((slot) =>
    !slot.start_time && !slot.end_time ? { ...slot, is_office: false } : slot,
  );
  return { ...form, slots, ...(slots.some(hasTime) ? {} : { roles: [], specialCare: false }) };
}
export function times(form: CellForm, building: 1 | 2): WorkSlotTime[] {
  return orderSlots(form.slots)
    .filter((slot) => slot.building === building && hasTime(slot))
    .map(({ start_time, end_time, facility, is_office }) => ({
      start_time,
      end_time,
      facility,
      is_office,
    }));
}
export function cellChanged(form: CellForm, initial: CellForm, seeded: boolean) {
  return seeded || JSON.stringify(form) !== JSON.stringify(initial);
}
export function cellSave(
  context: CellContext,
  form: CellForm,
  initial: CellForm,
  seeded: boolean,
  conflicts: readonly CurrentRevision[] = [],
  acceptOtherEdit = false,
): SaveInput | null {
  if (
    !conflicts.length &&
    !cellChanged(form, initial, seeded) &&
    (!acceptOtherEdit || form.status === null)
  )
    return null;
  const { person, date, data } = context;
  const status = form.status ?? 'none';
  const buildings: ShiftCellSaveInput['buildings'] =
    status === 'none'
      ? ([1, 2] as const).flatMap((building) => {
          const slots = times(form, building),
            before =
              data.workSlots.find(
                (row) =>
                  row.staff_id === person.id && row.date === date && row.building === building,
              )?.slots ?? [];
          return JSON.stringify(slots) === JSON.stringify(before)
            ? []
            : [{ building, slots: slots as ShiftCellSaveInput['buildings'][number]['slots'] }];
        })
      : [];
  const working = status === 'none' && form.slots.some(hasTime);
  const input: ShiftCellSaveInput = {
    staff_id: person.id,
    date,
    status,
    buildings,
    roles: working ? form.roles : [],
    special_care: working && form.specialCare,
    notes: form.notes === person.notes ? null : form.notes,
  };
  return makeInput(
    context,
    'shift.cell.save',
    input,
    status === 'none' ? buildings.map((row) => row.building) : [1, 2],
    conflicts,
  );
}
export function makeInput(
  context: CellContext,
  operation: string,
  input: object,
  groups: readonly (1 | 2)[],
  conflicts: readonly CurrentRevision[],
): SaveInput {
  const { person, date, data } = context;
  const revisions: Revision[] = [
    {
      target: { unit: 'day-state', staffId: person.id, date },
      revision:
        data.dayStates.find((row) => row.staff_id === person.id && row.date === date)?.revision ??
        null,
    },
    ...groups.map((building) => ({
      target: { unit: 'work-slot' as const, staffId: person.id, date, building },
      revision:
        data.workSlots.find(
          (row) => row.staff_id === person.id && row.date === date && row.building === building,
        )?.revision ?? null,
    })),
  ];
  if ('notes' in input && input.notes !== null)
    revisions.push({ target: { unit: 'staff', id: person.id }, revision: person.revision });
  return {
    operation,
    data: input as SaveInput['data'],
    revisions: revisions.map((row) => {
      const current = conflicts.find(
        (other) => JSON.stringify(other.target) === JSON.stringify(row.target),
      );
      return { ...row, revision: current ? current.revision : row.revision };
    }),
    label: `${person.name} ／ ${dayLabel(date)}`,
  };
}
export function cellCancel(
  context: CellContext,
  conflicts: readonly CurrentRevision[] = [],
): SaveInput | null {
  const { person, date, building, data } = context;
  if (
    data.workSlots.some(
      (row) => row.staff_id === person.id && row.date === date && row.building === building,
    )
  )
    return makeInput(
      context,
      'shift.cell.cancel',
      { staff_id: person.id, date, building },
      [building],
      conflicts,
    );
  const status = data.dayStates.find(
    (row) => row.staff_id === person.id && row.date === date,
  )?.status;
  if (status !== 'paid_leave' && status !== 'empty') return null;
  return makeInput(
    context,
    'shift.cell.save',
    {
      staff_id: person.id,
      date,
      status: 'none',
      buildings: [],
      roles: [],
      special_care: false,
      notes: null,
    },
    [],
    conflicts,
  );
}
export function otherConfirmation(
  context: CellContext,
  input: SaveInput,
  role: Role,
): {
  title: string;
  message: string;
  building: 1 | 2;
  beforeSlots: readonly WorkSlotTime[];
  afterSlots: readonly WorkSlotTime[];
} | null {
  if (role === 'maintenance') return null;
  const other = role === 'first' ? 2 : 1,
    name = other === 1 ? '第一' : '第二';
  const sent = input.data as unknown as ShiftCellSaveInput & { building?: 1 | 2 };
  const before = context.data.workSlots.find(
    (row) =>
      row.staff_id === context.person.id && row.date === context.date && row.building === other,
  );
  const changed =
    input.operation === 'shift.cell.cancel'
      ? sent.building === other
      : sent.status !== 'none'
        ? Boolean(before)
        : sent.buildings.some((row) => row.building === other);
  if (!changed) return null;
  const after =
    input.operation === 'shift.cell.cancel' || sent.status !== 'none'
      ? []
      : (sent.buildings.find((row) => row.building === other)?.slots ?? []);
  const beforeSlots = [...(before?.slots ?? [])].sort((a, b) =>
    a.start_time.localeCompare(b.start_time),
  );
  const afterSlots = [...after].sort((a, b) => a.start_time.localeCompare(b.start_time));
  const labels = { paid_leave: '有給', empty: '空', none: '勤務' };
  return {
    title: `${name}のシフトを書き換えますか？`,
    message:
      sent.status && sent.status !== 'none' && before
        ? `${name}のシフト（${before.slots.map((row) => `${shortTime(row.start_time)}〜${shortTime(row.end_time)}`).join('、')}）を消して${labels[sent.status]}にしますが、よろしいですか。`
        : `${name}のシフトを書き換えますが、よろしいですか。`,
    building: other,
    beforeSlots,
    afterSlots,
  };
}
