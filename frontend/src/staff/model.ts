import type { JsonValue, Staff, StaffHistory } from '../../../shared/protocol';
import type { DefaultWorkTimes, DefaultWorkSlot, DefaultStaffRole } from '../../../shared/staff';
import {
  staffAssignments,
  japanToday,
  joinStaffName,
  orderedWorkPair,
  splitStaffName,
  workSlotsOverlap,
} from '../../../shared/staff';
import {
  MAX_PERIOD_BUDGET,
  MAX_QUARTER_HOUR_PAY,
  MAX_STAFF_NAME_LENGTH,
} from '../../../shared/limits';
import type { SaveInput } from '../saving/types';
import { yen } from '../format/number';

export interface StaffForm {
  familyName: string;
  givenName: string;
  notes: string;
  firstFacility: string | null;
  secondFacility: string | null;
  employmentType: StaffHistory['employment_type'];
  qualification: StaffHistory['qualification'];
  pay: string;
  budget: string;
  workTimes: DefaultWorkTimes;
  roles: DefaultStaffRole[];
  employmentStatus: Staff['employment_status'];
  leaveStart: string | null;
  leaveEnd: string | null;
  retirementDate: string | null;
}
export function amountProblems(form: Pick<StaffForm, 'pay' | 'budget'>) {
  return {
    pay:
      Number(form.pay) > MAX_QUARTER_HOUR_PAY
        ? `15分給は${yen(MAX_QUARTER_HOUR_PAY)}までにしてください。`
        : null,
    budget:
      Number(form.budget) > MAX_PERIOD_BUDGET
        ? `予算は${yen(MAX_PERIOD_BUDGET)}までにしてください。`
        : null,
  };
}
export function validStaffAmounts(form: Pick<StaffForm, 'pay' | 'budget'>) {
  return (
    /^\d+$/.test(form.pay) &&
    Number.isSafeInteger(Number(form.pay)) &&
    Number(form.budget) >= 0 &&
    form.budget !== '' &&
    Number.isFinite(Number(form.budget)) &&
    !Object.values(amountProblems(form)).some(Boolean)
  );
}
export function hasRequiredStaffName(form: StaffForm): boolean {
  return Boolean(form.familyName.trim() && form.givenName.trim());
}
export function cleanStaffNamePart(value: string, otherName: string, composing = false): string {
  if (composing) return value;
  const limit = Math.max(0, MAX_STAFF_NAME_LENGTH - otherName.length - (otherName ? 1 : 0));
  return value.replace(/[ \u3000]/g, '').slice(0, limit);
}
function emptyWorkTimes(): DefaultWorkTimes {
  return {
    normal: { first: { slot1: null, slot2: null }, second: { slot1: null, slot2: null } },
    peak: { first: { slot1: null, slot2: null }, second: { slot1: null, slot2: null } },
    saturday: null,
  };
}
export type WorkKind = keyof DefaultWorkTimes;
export type WorkSlot = '第一 1回目' | '第一 2回目' | '第二 1回目' | '第二 2回目';
export const workKinds = ['平日', '繁忙期', '土曜'] as const;
export const kindKeys: Record<(typeof workKinds)[number], WorkKind> = {
  平日: 'normal',
  繁忙期: 'peak',
  土曜: 'saturday',
};
export function workSlots(
  person: Pick<Staff, 'default_first_facility' | 'default_second_facility'>,
): WorkSlot[] {
  const { first, second } = staffAssignments(person);
  return [
    ...(first ? (['第一 1回目', '第一 2回目'] as const) : []),
    ...(second ? (['第二 1回目', '第二 2回目'] as const) : []),
  ];
}
export function formAssignments(form: Pick<StaffForm, 'firstFacility' | 'secondFacility'>) {
  return {
    default_first_facility: form.firstFacility,
    default_second_facility: form.secondFacility,
  };
}
function slotKeys(slot: WorkSlot) {
  return {
    site: slot.startsWith('第一') ? ('first' as const) : ('second' as const),
    slot: slot.endsWith('1回目') ? ('slot1' as const) : ('slot2' as const),
  };
}
export function getWorkSlot(
  times: DefaultWorkTimes,
  kind: WorkKind,
  slot: WorkSlot,
): DefaultWorkSlot {
  const keys = slotKeys(slot);
  return (
    (kind === 'saturday' ? times.saturday : times[kind][keys.site][keys.slot]) ?? {
      start: '',
      end: '',
    }
  );
}
export function setWorkSlot(
  times: DefaultWorkTimes,
  kind: WorkKind,
  slot: WorkSlot,
  value: DefaultWorkSlot,
): DefaultWorkTimes {
  if (kind === 'saturday') return { ...times, saturday: value };
  const keys = slotKeys(slot);
  return {
    ...times,
    [kind]: { ...times[kind], [keys.site]: { ...times[kind][keys.site], [keys.slot]: value } },
  };
}
export type WorkProblem = 'missing_time' | 'invalid_order' | 'overlap' | 'building_overlap';
export function workProblem(
  times: DefaultWorkTimes,
  kind: WorkKind,
  slot: WorkSlot,
  person: Pick<Staff, 'default_first_facility' | 'default_second_facility'>,
): WorkProblem | null {
  const value = getWorkSlot(times, kind, slot);
  if (!value.start && !value.end) return null;
  const valid = (time: string) =>
    /^\d{2}:[0-5]\d$/.test(time) && time >= '07:00' && time <= '22:00';
  if (!valid(value.start) || !valid(value.end)) return 'missing_time';
  if (value.end <= value.start) return 'invalid_order';
  if (kind !== 'saturday') {
    const keys = slotKeys(slot);
    const other = times[kind][keys.site][keys.slot === 'slot1' ? 'slot2' : 'slot1'];
    if (
      other &&
      valid(other.start) &&
      valid(other.end) &&
      other.end > other.start &&
      workSlotsOverlap(value, other)
    )
      return 'overlap';
    if (
      staffAssignments(person).first &&
      staffAssignments(person).second &&
      Object.values(times[kind][keys.site === 'first' ? 'second' : 'first']).some(
        (other) =>
          other &&
          valid(other.start) &&
          valid(other.end) &&
          other.end > other.start &&
          workSlotsOverlap(value, other),
      )
    )
      return 'building_overlap';
  }
  return null;
}
export function hasWorkProblems(
  times: DefaultWorkTimes,
  person: Pick<Staff, 'default_first_facility' | 'default_second_facility'>,
): boolean {
  return (
    workProblem(times, 'saturday', workSlots(person)[0], person) !== null ||
    (['normal', 'peak'] as const).some((kind) =>
      workSlots(person).some((slot) => workProblem(times, kind, slot, person) !== null),
    )
  );
}
export function latestHistory(staff: Staff): StaffHistory {
  return staff.history[staff.history.length - 1];
}
export type StatusProblem = 'missing_date' | 'end_before_start';
export function statusProblem(form: StaffForm): StatusProblem | null {
  if (form.employmentStatus === 'retired' && !form.retirementDate) return 'missing_date';
  if (form.employmentStatus === 'leave') {
    if (!form.leaveStart) return 'missing_date';
    if (form.leaveEnd && form.leaveEnd < form.leaveStart) return 'end_before_start';
  }
  return null;
}
export function initialForm(staff?: Staff): StaffForm {
  if (!staff)
    return {
      familyName: '',
      givenName: '',
      notes: '',
      firstFacility: 'A',
      secondFacility: null,
      employmentType: 'full_time',
      qualification: 'none',
      pay: '',
      budget: '',
      workTimes: emptyWorkTimes(),
      roles: [],
      employmentStatus: 'active',
      leaveStart: null,
      leaveEnd: null,
      retirementDate: null,
    };
  const history = latestHistory(staff);
  const employmentStatus =
    staff.employment_status === 'leave' &&
    staff.leave_expected_end_date !== null &&
    staff.leave_expected_end_date < japanToday()
      ? 'active'
      : staff.employment_status;
  return {
    ...splitStaffName(staff.name),
    notes: staff.notes,
    firstFacility: staff.default_first_facility,
    secondFacility: staff.default_second_facility,
    employmentType: history.employment_type,
    qualification: history.qualification,
    pay: String(history.quarter_hour_pay),
    budget: String(history.budget),
    workTimes: structuredClone(staff.default_work_times),
    roles: [...staff.default_roles],
    employmentStatus,
    leaveStart: staff.leave_start_date,
    leaveEnd: staff.leave_expected_end_date,
    retirementDate: staff.retirement_date,
  };
}
export function historyValues(form: StaffForm) {
  return {
    quarter_hour_pay: Number(form.pay),
    employment_type: form.employmentType,
    qualification: form.qualification,
    budget: Number(form.budget),
  };
}
export type HistoryField = keyof ReturnType<typeof historyValues>;
export type SinceSelections = Partial<Record<HistoryField, string>>;
export function historyChanges(
  form: StaffForm,
  original?: Staff,
  kept: readonly HistoryField[] = [],
): HistoryField[] {
  const values = historyValues(form),
    previous = original && latestHistory(original);
  return (Object.keys(values) as HistoryField[]).filter(
    (field) => !previous || previous[field] !== values[field] || kept.includes(field),
  );
}
export function saveInput(
  id: string,
  form: StaffForm,
  original?: Staff,
  since: SinceSelections = {},
  kept: readonly HistoryField[] = [],
): SaveInput {
  const name = joinStaffName(form.familyName, form.givenName);
  const values = historyValues(form);
  const history: Record<string, { value: string | number; period_id?: string }> = {};
  for (const key of historyChanges(form, original, kept)) {
    history[key] = {
      value: values[key],
      ...(original && since[key] ? { period_id: since[key] } : {}),
    };
  }
  const cleanSlot = (value: DefaultWorkSlot | null) => (value?.start || value?.end ? value : null);
  const cleanKind = (kind: 'normal' | 'peak') =>
    Object.fromEntries(
      (['first', 'second'] as const).map((site) => [
        site,
        !staffAssignments(formAssignments(form))[site]
          ? { slot1: null, slot2: null }
          : orderedWorkPair({
              slot1: cleanSlot(form.workTimes[kind][site].slot1),
              slot2: cleanSlot(form.workTimes[kind][site].slot2),
            }),
      ]),
    );
  const staff = {
    id,
    name,
    notes: form.notes,
    default_first_facility: form.firstFacility,
    default_second_facility: form.secondFacility,
    default_work_times: {
      normal: cleanKind('normal'),
      peak: cleanKind('peak'),
      saturday: cleanSlot(form.workTimes.saturday),
    },
    default_roles: form.roles,
    employment_status: form.employmentStatus,
    leave_start_date: form.employmentStatus === 'leave' ? form.leaveStart : null,
    leave_expected_end_date: form.employmentStatus === 'leave' ? form.leaveEnd : null,
    retirement_date: form.employmentStatus === 'retired' ? form.retirementDate : null,
  };
  return {
    operation: 'staff.save',
    revisions: [{ target: { unit: 'staff', id }, revision: original?.revision ?? null }],
    data: { staff, history } as unknown as JsonValue,
    label: `${name.trim()}さん`,
  };
}
