import type {
  AnnualRules,
  BuildingEntry,
  CalendarDaySaveInput,
  CalendarDaysSaveInput,
  CalendarRows,
} from '../../../shared/protocol';
import type { SaveInput } from '../saving/types';
import { daySaveInputForBuildings, initialDay, type DayBuilding } from './day-model';
import { openingConflicts } from '../../../shared/calendar';

export const buildingChoices = ['第一', '第二', '両方'] as const;
export type BuildingChoice = (typeof buildingChoices)[number];
export interface EventInput {
  date: string;
  building: BuildingChoice;
  event: string;
  arrival: string;
  memo: string;
}
export interface PlannedEvent extends EventInput {
  id: number;
}
export function buildingNumbers(choice: BuildingChoice): Array<1 | 2> {
  return choice === '両方' ? [1, 2] : [choice === '第一' ? 1 : 2];
}
export function currentEntries(data: CalendarRows, date: string, choice: BuildingChoice) {
  return buildingNumbers(choice).map((building) => {
    const entries = data.buildingDays.find(
      (row) => row.date === date && row.building === building,
    )?.entries;
    const event = entries?.find((row) => row.kind === 'event');
    return {
      event: event?.content ?? '',
      arrival: event?.kind === 'event' ? (event.arrival_time ?? '') : '',
      memo: entries?.find((row) => row.kind === 'memo')?.content ?? '',
    };
  });
}
export function canAddEvent(
  input: EventInput,
  data: CalendarRows,
  pending: EventInput[] = [],
): boolean {
  const problems = eventInputProblems([...pending, input], data);
  return (
    Boolean(input.event.trim() || input.memo.trim() || input.arrival) &&
    !problems.event &&
    !problems.memo
  );
}
function append(current: string, added: string): string {
  const name = added.trim();
  return !name || current.split('、').includes(name)
    ? current
    : current
      ? `${current}、${name}`
      : name;
}
export function eventInputProblems(inputs: EventInput[], data: CalendarRows) {
  const entries = new Map<string, { event: string; memo: string; arrival: string }>();
  for (const input of inputs)
    for (const building of buildingNumbers(input.building)) {
      const key = `${input.date}:${building}`;
      const current =
        entries.get(key) ?? currentEntries(data, input.date, building === 1 ? '第一' : '第二')[0];
      entries.set(key, {
        event: append(current.event, input.event),
        memo: append(current.memo, input.memo),
        arrival: input.arrival || current.arrival,
      });
    }
  const rows = [...entries.values()];
  return {
    event: rows.some((row) => row.event.length > 100)
      ? 'この日の行事は、合わせて100字までにしてください。'
      : rows.some((row) => row.arrival && !row.event.trim())
        ? '行事を入れてください。'
        : '',
    memo: rows.some((row) => row.memo.length > 100)
      ? 'この日のメモは、合わせて100字までにしてください。'
      : '',
  };
}
/** Input order is the order in which entries were queued, followed by the current fields. */
export function eventSaveInput(
  inputs: EventInput[],
  data: CalendarRows,
  rules: AnnualRules,
): SaveInput {
  const days = new Map<string, Map<1 | 2, DayBuilding>>();
  for (const input of inputs) {
    let groups = days.get(input.date);
    if (!groups) {
      groups = new Map();
      days.set(input.date, groups);
    }
    for (const building of buildingNumbers(input.building)) {
      const group =
        groups.get(building) ??
        initialDay(input.date, data, rules).find((row) => row.building === building)!;
      const arrival = input.arrival || group.arrival;
      groups.set(building, {
        ...group,
        event: append(group.event, input.event),
        memo: append(group.memo, input.memo),
        arrival,
      });
    }
  }
  const requests = [...days].map(([date, groups]) =>
    daySaveInputForBuildings(date, [...groups.values()], data),
  );
  const input: CalendarDaysSaveInput = {
    confirmed: null,
    days: requests.map((row) => {
      const { confirmed: _confirmed, ...day } = row.data as unknown as CalendarDaySaveInput;
      return day;
    }),
  };
  return {
    operation: 'calendar.days.save',
    data: input as unknown as SaveInput['data'],
    revisions: requests.flatMap((row) => row.revisions),
    label: `行事とメモ ${inputs.length}件`,
  };
}

export function eventOpeningConflicts(
  inputs: EventInput[],
  data: CalendarRows,
  rules: AnnualRules,
) {
  if (!inputs.length) return [];
  const input = eventSaveInput(inputs, data, rules).data as unknown as CalendarDaysSaveInput;
  const rows: CalendarRows = {
    facilityDays: data.facilityDays,
    buildingDays: [...data.buildingDays],
  };
  for (const day of input.days)
    for (const group of day.buildings) {
      rows.buildingDays = rows.buildingDays.filter(
        (row) => row.date !== day.date || row.building !== group.building,
      );
      rows.buildingDays.push({
        date: day.date,
        building: group.building,
        revision: 1,
        entries: group.event ? [{ kind: 'event', ...group.event }] : [],
      });
    }
  const dates = new Set(input.days.map((day) => day.date));
  return openingConflicts(rows, rules).filter((row) => dates.has(row.date));
}

export interface EventListRow {
  date: string;
  kind: BuildingEntry['kind'];
  buildings: Array<1 | 2>;
  content: string;
  arrival: string | null;
}
export function eventListRows(data: CalendarRows): EventListRow[] {
  const rows: EventListRow[] = [];
  for (const building of data.buildingDays)
    for (const entry of building.entries) {
      const arrival = entry.kind === 'event' ? entry.arrival_time : null;
      const same = rows.find(
        (row) =>
          row.date === building.date &&
          row.kind === entry.kind &&
          row.content === entry.content &&
          row.arrival === arrival,
      );
      if (same) same.buildings.push(building.building);
      else
        rows.push({
          date: building.date,
          kind: entry.kind,
          buildings: [building.building],
          content: entry.content,
          arrival,
        });
    }
  return rows.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      (a.kind === b.kind ? 0 : a.kind === 'event' ? -1 : 1) ||
      (a.buildings.length === 2 ? 0 : a.buildings[0]) -
        (b.buildings.length === 2 ? 0 : b.buildings[0]),
  );
}
