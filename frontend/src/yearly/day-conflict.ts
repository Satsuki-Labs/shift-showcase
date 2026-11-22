import type { CalendarRows, CurrentRevision } from '../../../shared/protocol';
import { shortTime } from '../format/time';
import { conflictRows, type ConflictField } from '../parts/save-conflict';
import type { DayBuilding } from './day-model';

export function dayConflictRows(yours: readonly DayBuilding[], theirs: readonly DayBuilding[]) {
  const fields = (groups: readonly DayBuilding[]) =>
    groups.flatMap((group) => {
      const site = group.building === 1 ? '第一' : '第二';
      return [
        { label: `${site}の行事`, value: group.event },
        {
          label: `${site}の\n受付開始時刻`,
          value: group.arrival ? [shortTime(group.arrival)] : ['なし'],
        },
        { label: `${site}のメモ`, value: group.memo },
        ...group.facilities.flatMap((row) => [
          { label: `${site} ${row.facility}\n営業と締め`, value: [row.is_open ? '営業' : '休業'] },
          {
            label: `${site} ${row.facility}\n営業時間`,
            value: row.is_open
              ? [shortTime(row.start_time), '〜', shortTime(row.end_time)]
              : ['なし'],
          },
        ]),
      ];
    });
  const right = fields(theirs);
  return conflictRows(
    fields(yours).map(
      (row) =>
        ({
          label: row.label,
          yours: row.value,
          theirs: right.find((other) => other.label === row.label)!.value,
        }) satisfies ConflictField,
    ),
  );
}
export function dayConflictRevisions(
  current: CalendarRows,
  conflicts: readonly CurrentRevision[],
): CurrentRevision[] {
  return conflicts.map((row) => {
    const target = row.target;
    const revision =
      target.unit === 'building-day'
        ? (current.buildingDays.find(
            (item) => item.building === target.building && item.date === target.date,
          )?.revision ?? null)
        : target.unit === 'facility-day'
          ? (current.facilityDays.find(
              (item) => item.facility === target.facility && item.date === target.date,
            )?.revision ?? null)
          : row.revision;
    return { ...row, revision };
  });
}
export function retainedDay(
  yours: readonly DayBuilding[],
  theirs: readonly DayBuilding[],
): DayBuilding[] {
  return yours.map((group) => ({
    ...group,
    facilities: group.facilities.map((row) => {
      const other = theirs
        .find((item) => item.building === group.building)!
        .facilities.find((item) => item.facility === row.facility)!;
      return {
        ...row,
        edited: {
          ...row.edited,
          ...(row.start_time !== other.start_time ? { start_time: true as const } : {}),
          ...(row.end_time !== other.end_time ? { end_time: true as const } : {}),
        },
      };
    }),
  }));
}
