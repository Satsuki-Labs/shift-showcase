import { resolvedDayOpening, type Facility } from '../../../shared/calendar';
import type { AnnualRules, CalendarRows, PeriodSummary } from '../../../shared/protocol';
import type { CellTime, CellView } from './model';
import { cellSave, initialCell, updateSlot, type CellContext, type SlotDraft } from './cell-model';

export type ShiftView = '一覧' | '日別' | '希望';
export interface DailySelection {
  periodId: string;
  date: string;
}
export const dailyStart = 7 * 60;
export const dailyHourWidth = 108;
export const dailyInset = dailyHourWidth;
const dailyEndInset = 29;
export const dailyNameWidth = 144;
export const dailyLaneWidth = dailyInset + 15 * dailyHourWidth + dailyEndInset;
export function initialDailyDate(
  period: Pick<PeriodSummary, 'start_date' | 'end_date'>,
  today: string,
): string {
  return period.start_date <= today && today <= period.end_date ? today : period.start_date;
}
function minutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}
export function dailyPosition(time: string): number {
  return ((minutes(time) - dailyStart) * dailyHourWidth) / 60;
}
export function dailyRange(start: string, end: string): { left: number; width: number } {
  const left = Math.max(0, Math.min(dailyPosition(start), dailyPosition('22:00')));
  const right = Math.max(left, Math.min(dailyPosition(end), dailyPosition('22:00')));
  return { left: dailyInset + left, width: right - left };
}
export function dailyScrollPosition(
  building: 1 | 2,
  date: string,
  data: CalendarRows,
  rules: AnnualRules,
): number {
  const facilities: Facility[] = building === 1 ? ['A', 'B'] : ['C', 'D'];
  const starts = facilities.flatMap((facility) => {
    const opening = resolvedDayOpening(date, facility, data, rules);
    return opening?.isOpen && opening.startTime ? [minutes(opening.startTime)] : [];
  });
  return (
    Math.max(0, starts.length ? Math.floor((Math.min(...starts) - dailyStart) / 60) - 1 : 0) *
    dailyHourWidth
  );
}
export interface DailyBand extends CellTime {
  id: number;
  roles: string[];
  otherEdit?: CellView['otherEdit'];
}
export function dailyBands(
  cell: CellView,
  buildingCells: ReadonlyMap<1 | 2, CellView>,
): DailyBand[] {
  const times = cell.times
    .map((time) => ({
      ...time,
      id:
        (time.building - 1) * 2 +
        cell.times.filter((row) => row.building === time.building).indexOf(time),
    }))
    .sort((a, b) => a.start_time.localeCompare(b.start_time) || a.building - b.building);
  return times.map((time, index) => ({
    ...time,
    roles: [
      ...(index === 0
        ? [...cell.topRoles, ...cell.bottomRoles.filter((role) => role !== 'Y')]
        : []),
      ...(time.is_office ? ['Y'] : []),
    ],
    otherEdit:
      times.findIndex((row) => row.building === time.building) === index
        ? buildingCells.get(time.building)?.otherEdit
        : undefined,
  }));
}

export function dailyDragSave(context: CellContext, slots: readonly SlotDraft[]) {
  const initial = initialCell(context).form;
  const form = slots.reduce(
    (next, slot) =>
      updateSlot(next, slot.id, { start_time: slot.start_time, end_time: slot.end_time }),
    initial,
  );
  return cellSave(context, form, initial, false);
}

export function dailyPreview(
  data: CellContext['data'],
  context: CellContext,
  slots: readonly SlotDraft[],
): CellContext['data'] {
  if (data.periodId !== context.period.id) return data;
  return {
    ...data,
    workSlots: data.workSlots.map((row) =>
      row.staff_id !== context.person.id || row.date !== context.date
        ? row
        : {
            ...row,
            slots: row.slots.map((slot, index) => {
              const next = slots.find((next) => next.id === (row.building - 1) * 2 + index)!;
              return { ...slot, start_time: next.start_time, end_time: next.end_time };
            }) as typeof row.slots,
          },
    ),
  };
}
