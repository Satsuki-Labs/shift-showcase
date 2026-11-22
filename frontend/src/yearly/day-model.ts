import { resolvedDayOpening, type Facility } from '../../../shared/calendar';
import type {
  AnnualRules,
  CalendarDaySaveInput,
  CalendarRows,
  CurrentRevision,
  Revision,
} from '../../../shared/protocol';
import type { SaveInput } from '../saving/types';
import { dayLabel } from '../format/date';

export interface DayFacility {
  facility: Facility;
  is_open: boolean;
  start_time: string;
  end_time: string;
  edited?: Partial<Record<'start_time' | 'end_time', true>>;
}
export interface DayBuilding {
  building: 1 | 2;
  event: string;
  arrival: string;
  memo: string;
  facilities: DayFacility[];
}
export function initialDay(date: string, data: CalendarRows, rules: AnnualRules): DayBuilding[] {
  return ([1, 2] as const).map((building) => {
    const entries = data.buildingDays.find(
      (row) => row.date === date && row.building === building,
    )?.entries;
    const event = entries?.find((row) => row.kind === 'event');
    const memo = entries?.find((row) => row.kind === 'memo');
    const arrival = event?.kind === 'event' ? (event.arrival_time ?? '') : '';
    return {
      building,
      event: event?.content ?? '',
      arrival,
      memo: memo?.content ?? '',
      facilities: (building === 1 ? (['A', 'B'] as const) : (['C', 'D'] as const)).map(
        (facility) => {
          const opening = resolvedDayOpening(date, facility, data, rules)!;
          return {
            facility,
            is_open: opening.isOpen,
            start_time: opening.startTime,
            end_time: opening.endTime,
          };
        },
      ),
    };
  });
}
export function facilityProblem(row: DayFacility): string | null {
  if (!row.is_open) return null;
  return row.start_time && row.end_time && row.end_time <= row.start_time
    ? '営業の開始が締めより後になっています'
    : null;
}
export function openingProblem(rows: readonly DayFacility[]): string | null {
  const problems = rows.filter(facilityProblem);
  return problems.length
    ? `${problems.map((row) => row.facility).join('・')}の${facilityProblem(problems[0])}`
    : null;
}
export function eventProblem(row: DayBuilding): boolean {
  return Boolean(row.arrival) && !row.event.trim();
}
export function changeDayTime(
  row: DayFacility,
  field: 'start_time' | 'end_time',
  value: string,
): DayFacility {
  return value === row[field]
    ? row
    : { ...row, [field]: value, edited: { ...row.edited, [field]: true } };
}
export function changeArrival(
  date: string,
  group: DayBuilding,
  arrival: string,
  data: CalendarRows,
  rules: AnnualRules,
): DayBuilding {
  const rows: CalendarRows = {
    facilityDays: data.facilityDays,
    buildingDays: [
      {
        building: group.building,
        date,
        revision: 1,
        entries: [{ kind: 'event', content: group.event, arrival_time: arrival || null }],
      },
    ],
  };
  return {
    ...group,
    arrival,
    facilities: group.facilities.map((row) => {
      const opening = resolvedDayOpening(date, row.facility, rows, rules)!;
      return {
        ...row,
        start_time: row.edited?.start_time ? row.start_time : opening.startTime,
        end_time: row.edited?.end_time ? row.end_time : opening.endTime,
      };
    }),
  };
}
export function daySaveInput(
  date: string,
  form: DayBuilding[],
  initial: DayBuilding[],
  data: CalendarRows,
  conflicts: CurrentRevision[],
): SaveInput {
  const changed = form.filter(
    (group) =>
      JSON.stringify(group) !==
      JSON.stringify(initial.find((row) => row.building === group.building)),
  );
  const groups = changed.length ? changed : form;
  return daySaveInputForBuildings(date, groups, data, conflicts, initial);
}
export function dayDeleteMessage(initial: readonly DayBuilding[]): string {
  const items: string[] = [];
  for (const group of initial)
    for (const kind of ['event', 'memo'] as const) {
      const content = group[kind];
      if (!content) continue;
      const same = initial.find(
        (other) => other.building !== group.building && other[kind] === content,
      );
      if (same && same.building < group.building) continue;
      const building = same ? '' : group.building === 1 ? '第一の' : '第二の';
      items.push(`${building}${kind === 'event' ? '行事' : 'メモ'}「${content}」`);
    }
  return `${items.join('、')}を削除します。`;
}
export function dayDeleteInput(
  date: string,
  initial: readonly DayBuilding[],
  _rules: AnnualRules,
  data: CalendarRows,
  conflicts: CurrentRevision[] = [],
): SaveInput {
  const groups = initial.map((group) => ({ ...group, event: '', memo: '', arrival: '' }));
  return daySaveInputForBuildings(date, groups, data, conflicts);
}
export function daySaveInputForBuildings(
  date: string,
  groups: DayBuilding[],
  data: CalendarRows,
  conflicts: CurrentRevision[] = [],
  initial?: readonly DayBuilding[],
): SaveInput {
  const revisions: Revision[] = groups
    .flatMap((group) => [
      {
        target: { unit: 'building-day', building: group.building, date } as const,
        revision:
          data.buildingDays.find((row) => row.building === group.building && row.date === date)
            ?.revision ?? null,
      },
      ...group.facilities.map((row) => ({
        target: { unit: 'facility-day', facility: row.facility, date } as const,
        revision:
          data.facilityDays.find((saved) => saved.facility === row.facility && saved.date === date)
            ?.revision ?? null,
      })),
    ])
    .map((row) => {
      const target = row.target;
      const conflict = conflicts.find(
        ({ target: other }) =>
          (target.unit === 'building-day' &&
            other.unit === 'building-day' &&
            target.date === other.date &&
            target.building === other.building) ||
          (target.unit === 'facility-day' &&
            other.unit === 'facility-day' &&
            target.date === other.date &&
            target.facility === other.facility),
      );
      return conflict ? { target: row.target, revision: conflict.revision } : row;
    });
  const input: CalendarDaySaveInput = {
    date,
    confirmed: null,
    buildings: groups.map((group) => ({
      building: group.building,
      event: group.event.trim()
        ? { content: group.event.trim(), arrival_time: group.arrival || null }
        : null,
      memo: group.memo.trim() || null,
      facilities: group.facilities.map((row) => ({
        facility: row.facility,
        is_open:
          initial &&
          row.is_open !==
            initial
              .find((item) => item.building === group.building)
              ?.facilities.find((item) => item.facility === row.facility)?.is_open
            ? row.is_open
            : null,
        start_time: initial && row.edited?.start_time ? row.start_time : null,
        end_time: initial && row.edited?.end_time ? row.end_time : null,
      })),
    })),
  };
  return {
    operation: 'calendar.day.save',
    revisions,
    data: input as unknown as SaveInput['data'],
    label: dayLabel(date),
  };
}
