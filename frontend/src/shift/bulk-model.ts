import { allFacilitiesClosed, calendarRestDay } from '../../../shared/calendar';
import { holidayName } from '../../../shared/holidays';
import type {
  CurrentRevision,
  ShiftBulkSaveInput,
  ShiftCellChangedData,
  ShiftCellSaveInput,
} from '../../../shared/protocol';
import type { SaveInput } from '../saving/types';
import {
  cellSave,
  changeCellWork,
  defaultDayKind,
  defaultsForKind,
  hasTime,
  makeInput,
  slotProblem,
  storedCell,
  times,
  type CellContext,
  type CellForm,
  type DefaultDayKind,
} from './cell-model';
import { requestDayMark } from './model';
import { shortTime } from '../format/time';
import { monthDay, slashMonthDay } from '../format/date';
import { periodDates } from '../../../shared/period';
import { applyCellData } from '../../../shared/period';
import { MOVEMENT_ROLES, roleFitsWork, suggestedMovementRole } from '../../../shared/staff';
import { workBuildings } from './cell-model';
import { closedFacilityDays } from './closed-facility';

export const bulkDefaultKindLabels: Record<DefaultDayKind, string> = {
  normal: '平日',
  peak: '繁忙期',
  saturday: '土曜',
};

export type BulkContext = Omit<CellContext, 'date' | 'building'>;
export type BulkTarget = 1 | 2;
export type BulkOperation = 'insert' | 'cancel';
export type BulkMode = 'both' | 'time' | 'roles';
export interface BulkDraft {
  kind: DefaultDayKind;
  slots: CellForm['slots'];
  roles: CellForm['roles'];
  manualMovement?: boolean;
}
export interface BulkOptions {
  target: BulkTarget;
  operation: BulkOperation;
  mode: BulkMode;
  selected: readonly string[];
  draft: BulkDraft;
  roleSelection: CellForm['roles'];
  specialCare: boolean;
  excludedDates?: readonly string[];
}
export type BulkKind = 'add' | 'replace' | 'cancel' | 'same';
export interface BulkDay {
  date: string;
  kind: BulkKind;
  before: CellForm;
  after: CellForm;
  input: SaveInput | null;
  excluded?: boolean;
}
export interface BulkGroup {
  kind: BulkKind;
  before: CellForm;
  after: CellForm;
  dates: string[];
  excluded?: boolean;
}
export interface BulkPreview {
  days: BulkDay[];
  groups: BulkGroup[];
  input: SaveInput | null;
}
export interface BulkCalendarDay {
  closed: boolean;
  status: CellForm['status'];
  buildings: (1 | 2)[];
  selectable: boolean;
}
const contextAt = (context: BulkContext, date: string): CellContext => ({
  ...context,
  date,
  building: 1,
});
export const bulkInputTarget = (
  options: Pick<BulkOptions, 'target' | 'operation' | 'mode' | 'draft'>,
): BulkTarget =>
  options.operation === 'insert' && options.mode !== 'roles' && options.draft.kind === 'saturday'
    ? 1
    : options.target;
export const bulkMovement = (context: BulkContext, target: BulkTarget, kind: DefaultDayKind) =>
  suggestedMovementRole(context.person, false, [kind === 'saturday' ? 1 : target]);
export function bulkDefaults(
  context: BulkContext,
  target: BulkTarget,
  kind: DefaultDayKind = 'normal',
): BulkDraft {
  const cell = contextAt(context, context.period.start_date),
    stored = storedCell(cell);
  const form = {
    ...stored,
    slots: stored.slots.map((slot) => ({
      ...slot,
      facility: (slot.building === 1
        ? (context.person.default_first_facility ?? 'A')
        : (context.person.default_second_facility ?? 'C')) as typeof slot.facility,
    })),
  };
  const building = kind === 'saturday' ? 1 : target;
  const slots = defaultsForKind(cell, form, kind).slots.map((slot) => ({
    ...slot,
    ...(kind === 'saturday' && slot.building === 1 ? { facility: 'A' as const } : {}),
    ...(slot.building !== building ? { start_time: '', end_time: '', is_office: false } : {}),
  }));
  const movement = kind === 'saturday' ? null : bulkMovement(context, target, kind);
  return { kind, roles: [...context.person.default_roles, ...(movement ? [movement] : [])], slots };
}
export function bulkIsDefault(draft: BulkDraft, initial: BulkDraft): boolean {
  return (
    draft.roles.length === initial.roles.length &&
    draft.roles.every((role) => initial.roles.includes(role)) &&
    Boolean(draft.manualMovement) === Boolean(initial.manualMovement) &&
    draft.kind === initial.kind &&
    draft.slots.every((slot, index) => {
      const other = initial.slots[index];
      return (
        slot.start_time === other.start_time &&
        slot.end_time === other.end_time &&
        slot.is_office === other.is_office &&
        slot.facility === other.facility
      );
    })
  );
}
export function bulkRefreshDraft(
  context: BulkContext,
  target: BulkTarget,
  draft: BulkDraft,
  initial: BulkDraft,
): BulkDraft {
  const fresh = bulkDefaults(context, target, draft.kind);
  if (bulkIsDefault(draft, initial)) return fresh;
  return draft;
}
export function bulkDateNumber(date: string, firstDate: string): string {
  return `${date === firstDate || date.endsWith('-01') ? `${Number(date.slice(5, 7))}/` : ''}${Number(date.slice(8))}`;
}
export function bulkDefaultKinds(context: BulkContext): DefaultDayKind[] {
  const calendar = bulkCalendarDays(context, { target: 1, operation: 'insert', mode: 'both' });
  const available = new Set(
    [...calendar]
      .filter(([, day]) => day.selectable)
      .map(([date]) => defaultDayKind({ date, rules: context.rules })),
  );
  return (['normal', 'peak', 'saturday'] as const).filter((kind) => available.has(kind));
}
export function bulkBlockedDates(context: BulkContext): Set<string> {
  return new Set(
    periodDates(context.period).filter(
      (date) =>
        new Date(`${date}T00:00:00Z`).getUTCDay() === 0 ||
        holidayName(date) ||
        allFacilitiesClosed(date, context.rules, context.data.facilityDays),
    ),
  );
}
export function bulkCalendarDays(
  context: BulkContext,
  options: Pick<BulkOptions, 'target' | 'operation' | 'mode'>,
): Map<string, BulkCalendarDay> {
  const blocked = bulkBlockedDates(context);
  return new Map(
    periodDates(context.period).map((date) => {
      const form = storedCell(contextAt(context, date)),
        closed = blocked.has(date);
      const buildings: BulkTarget[] = form.slots.some(
        (slot) => slot.building === options.target && hasTime(slot),
      )
        ? [options.target]
        : [];
      const selectable =
        !closed &&
        form.status !== 'paid_leave' &&
        (options.operation === 'cancel' || options.mode === 'roles'
          ? form.status === 'none' && buildings.length > 0
          : true);
      return [date, { closed, status: form.status, buildings, selectable }];
    }),
  );
}
export function bulkSelection(
  selected: readonly string[],
  calendar: ReadonlyMap<string, BulkCalendarDay>,
): string[] {
  return selected.filter((date) => calendar.get(date)?.selectable);
}
export function bulkUnavailableReason(
  date: string,
  day: BulkCalendarDay,
  operation: BulkOperation,
  mode: BulkMode,
  context?: BulkContext,
): string | null {
  const label = `${monthDay(date)}は、`;
  if (day.closed) {
    const holiday = holidayName(date);
    if (holiday) return `${label}祝日（${holiday}）のため選べません。`;
    if (new Date(`${date}T00:00:00Z`).getUTCDay() === 0) return `${label}日曜日のため選べません。`;
    const rest = context ? calendarRestDay(date, context.rules, context.data.facilityDays) : null;
    return `${label}休業日${rest?.kind === 'closure' && rest.name ? `（${rest.name}）` : ''}のため選べません。`;
  }
  if (day.selectable) return null;
  if (day.status === 'paid_leave') return `${label}有給のため選べません。`;
  if (operation === 'cancel') return `${label}取り消す勤務が無いため選べません。`;
  if (mode === 'roles') return `${label}役割を付ける勤務が無いため選べません。`;
  return null;
}
export function bulkProblems(options: BulkOptions): (string | null)[] {
  return options.operation === 'insert' && options.mode !== 'roles'
    ? options.draft.slots.map((slot) => slotProblem(slot, options.draft.slots))
    : [];
}
export function bulkClosedFacilities(
  context: BulkContext,
  options: BulkOptions,
  days: readonly BulkDay[] = bulkPreview(context, options).days,
) {
  if (options.operation !== 'insert' || options.mode === 'roles') return [];
  return closedFacilityDays(
    context,
    days.flatMap((day) => {
      if (!day.input || day.excluded) return [];
      const input = day.input.data as unknown as ShiftCellSaveInput;
      return [
        {
          date: day.date,
          slots: input.status === 'none' ? input.buildings.flatMap((row) => row.slots) : [],
        },
      ];
    }),
  );
}
export function bulkAttention(
  context: BulkContext,
  options: BulkOptions,
  group: BulkGroup,
): { lines: string[]; dates: string[] } {
  if (group.excluded || group.kind === 'same') return { lines: [], dates: [] };
  const target = bulkInputTarget(options),
    lines: string[] = [];
  const previous = group.before.slots.filter((slot) => slot.building === target && hasTime(slot));
  if (options.operation === 'insert' && options.mode !== 'roles' && previous.length) {
    const times = previous
      .map((slot) => `${shortTime(slot.start_time)}〜${shortTime(slot.end_time)}`)
      .join('、');
    lines.push(`前の勤務（${times}）は、消えます`);
  }
  const requested = group.dates.filter((date) =>
    requestDayMark(
      context.person,
      context.period,
      context.periods,
      date,
      target,
      context.data,
      context.rules,
    ),
  );
  if (requested.length) {
    lines.push(`希望から入った日が、${requested.length}日含まれます`);
  }
  return { lines, dates: requested.map((date) => slashMonthDay(date)) };
}
function displayKey(form: CellForm, target: BulkTarget) {
  return JSON.stringify([
    form.status,
    times(form, target),
    [...form.roles].sort(),
    form.specialCare,
  ]);
}
function bundle(context: BulkContext, inputs: readonly SaveInput[]): SaveInput | null {
  if (!inputs.length) return null;
  return {
    operation: 'shift.bulk.save',
    data: { cells: inputs.map((input) => input.data) },
    revisions: inputs.flatMap((input) => input.revisions),
    label: `${context.person.name} ／ 一括入力 ${inputs.length}日間`,
  };
}
export function bulkPreview(context: BulkContext, options: BulkOptions): BulkPreview {
  const blocked = bulkBlockedDates(context),
    selected = new Set(options.selected),
    target = bulkInputTarget(options);
  const days: BulkDay[] = periodDates(context.period)
    .filter((date) => selected.has(date) && !blocked.has(date))
    .map((date) => {
      const cell = contextAt(context, date),
        before = storedCell(cell);
      const same: BulkDay = { date, kind: 'same', before, after: before, input: null };
      if (before.status === 'paid_leave') return same;
      const existing = before.slots.filter((slot) => hasTime(slot) && slot.building === target);
      let after: CellForm, kind: BulkKind;
      if (options.mode === 'roles') {
        if (before.status !== 'none' || !existing.length) return same;
        const selected = options.roleSelection;
        const roles =
          options.operation === 'cancel'
            ? before.roles.filter((role) => !selected.includes(role))
            : [
                ...before.roles.filter(
                  (role) =>
                    !selected.includes(role) &&
                    !(role === 'lead' && selected.includes('deputy')) &&
                    !(role === 'deputy' && selected.includes('lead')),
                ),
                ...selected,
              ];
        const specialCare =
          before.specialCare || (options.operation === 'insert' && options.specialCare);
        after = { ...before, roles, specialCare };
        kind = options.operation === 'cancel' ? 'cancel' : 'replace';
      } else if (options.operation === 'cancel') {
        if (before.status !== 'none' || !existing.length) return same;
        after = {
          ...before,
          slots: before.slots.map((slot) =>
            slot.building === target
              ? { ...slot, start_time: '', end_time: '', is_office: false }
              : slot,
          ),
        };
        if (!after.slots.some(hasTime)) after = { ...after, roles: [], specialCare: false };
        kind = 'cancel';
      } else {
        if (bulkProblems(options).some(Boolean)) return same;
        const source = options.draft;
        const incoming = source.slots.filter((slot) => slot.building === target && hasTime(slot));
        if (!incoming.length) return same;
        const replaced = new Set(incoming.map((slot) => slot.building));
        const retained = before.slots.filter(
          (slot) => !replaced.has(slot.building) && hasTime(slot),
        );
        if (
          incoming.some((slot) =>
            retained.some(
              (other) => slot.start_time < other.end_time && other.start_time < slot.end_time,
            ),
          )
        )
          return same;
        after = {
          ...before,
          status: 'none',
          roles: options.mode === 'time' ? [...before.roles] : [...source.roles],
          specialCare: before.slots.some(hasTime) && before.specialCare,
          slots: before.slots.map((slot) =>
            replaced.has(slot.building)
              ? {
                  ...slot,
                  ...source.slots.find((other) => other.id === slot.id),
                  ...(options.mode === 'time'
                    ? {
                        facility: hasTime(slot)
                          ? slot.facility
                          : source.slots.find((other) => other.id === slot.id)!.facility,
                        is_office:
                          hasTime(source.slots.find((other) => other.id === slot.id)!) &&
                          slot.is_office,
                      }
                    : {}),
                }
              : slot,
          ),
        };
        if (options.mode === 'time') after = changeCellWork(cell, before, after);
        kind = before.status !== 'none' || existing.length ? 'replace' : 'add';
      }
      const saturday = new Date(`${date}T00:00:00Z`).getUTCDay() === 6;
      after.roles = after.roles.filter(
        (role) =>
          roleFitsWork(role, workBuildings(after)) &&
          !(
            options.operation === 'insert' &&
            options.mode === 'both' &&
            saturday &&
            !options.draft.manualMovement &&
            MOVEMENT_ROLES.some((value) => value === role)
          ),
      );
      // Role order is not a change to the day's roles.
      if (JSON.stringify([...after.roles].sort()) === JSON.stringify([...before.roles].sort()))
        after.roles = before.roles;
      const input = cellSave(cell, after, before, false);
      if (input && options.excludedDates?.includes(date))
        return { date, kind, before, after, input: null, excluded: true };
      return input ? { date, kind, before, after, input } : same;
    });
  const grouped = new Map<string, BulkGroup>();
  for (const day of days) {
    const key = JSON.stringify([
      day.kind,
      displayKey(day.before, target),
      displayKey(day.after, target),
      Boolean(day.excluded),
    ]);
    const group = grouped.get(key);
    if (group) group.dates.push(day.date);
    else
      grouped.set(key, {
        kind: day.kind,
        before: day.before,
        after: day.after,
        dates: [day.date],
        excluded: day.excluded,
      });
  }
  const order: BulkKind[] = ['add', 'replace', 'cancel', 'same'];
  return {
    days,
    groups: [...grouped.values()].sort(
      (a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || b.dates.length - a.dates.length,
    ),
    input: bundle(
      context,
      days.flatMap((day) => (day.input ? [day.input] : [])),
    ),
  };
}
export function bulkUndo(
  context: BulkContext,
  preview: BulkPreview,
  saved: readonly ShiftCellChangedData[],
): SaveInput | null {
  const data = saved.reduce(applyCellData, context.data);
  return bundle(
    context,
    preview.days
      .filter((day) => day.input)
      .map((day) => {
        const form = day.before;
        const input: ShiftCellSaveInput = {
          staff_id: context.person.id,
          date: day.date,
          status: form.status ?? 'none',
          roles: [...form.roles],
          special_care: form.specialCare,
          notes: null,
          buildings:
            form.status === 'none'
              ? ([1, 2] as const).map((building) => ({
                  building,
                  slots: times(form, building) as ShiftCellSaveInput['buildings'][number]['slots'],
                }))
              : [],
        };
        return makeInput(
          contextAt({ ...context, data }, day.date),
          'shift.cell.save',
          input,
          [1, 2],
          [],
        );
      }),
  );
}
export function excludeBulkConflicts(
  input: SaveInput,
  conflicts: readonly CurrentRevision[],
): { input: SaveInput | null; dates: string[] } {
  const dates = [
    ...new Set(conflicts.flatMap((row) => ('date' in row.target ? [row.target.date] : []))),
  ].sort();
  const cells = (input.data as unknown as ShiftBulkSaveInput).cells.filter(
    (cell) => !dates.includes(cell.date),
  );
  return {
    dates,
    input: cells.length
      ? {
          ...input,
          data: { cells } as unknown as SaveInput['data'],
          revisions: input.revisions.filter(
            (row) => !('date' in row.target) || !dates.includes(row.target.date),
          ),
          label: `${input.label.split(' ／ ')[0]} ／ 一括入力 ${cells.length}日間`,
        }
      : null,
  };
}
