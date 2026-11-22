import { memo, type ReactNode } from 'react';
import type { PeriodStaff } from '../../../shared/period-snapshot';
import { Skeleton } from '../parts/Skeleton';
import { ShiftCell } from './ShiftCell';
import { RequestCell } from './RequestCell';
import type { CellView, RequestCellView } from './model';

export interface ShiftPersonDay {
  date: string;
  color: string;
  cell: CellView | null;
  request: RequestCellView | null;
  changed: boolean;
}
export function focusableShiftDates(
  days: readonly ShiftPersonDay[],
  requestView: boolean,
): string[] {
  return days
    .filter(
      (day) =>
        day.cell &&
        (!requestView ||
          (day.request && day.request.kind !== 'blank' && day.request.kind !== 'closure')),
    )
    .map((day) => day.date);
}
const PersonCell = memo(function PersonCell({
  day,
  person,
  building,
  requestView,
  openCell,
}: {
  day: ShiftPersonDay;
  person: PeriodStaff;
  building: 1 | 2;
  requestView: boolean;
  openCell: (person: PeriodStaff, date: string, building: 1 | 2) => void;
}) {
  return (
    <td className={day.color} data-shift-date={day.date}>
      {!day.cell ? (
        <div className="shift-skeleton-cell">
          <Skeleton width="78%" />
          <Skeleton width="40%" />
        </div>
      ) : requestView ? (
        <RequestCell
          cell={day.request!}
          building={building}
          open={() => openCell(person, day.date, building)}
        />
      ) : (
        <ShiftCell
          cell={day.cell}
          building={building}
          changed={day.changed}
          open={() => openCell(person, day.date, building)}
        />
      )}
    </td>
  );
});

export function ShiftPersonRow({
  person,
  days,
  focusDates,
  start,
  end,
  building,
  requestView,
  name,
  focusCell,
  openCell,
}: {
  person: PeriodStaff;
  days: readonly ShiftPersonDay[];
  focusDates: readonly string[];
  start: number;
  end: number;
  building: 1 | 2;
  requestView: boolean;
  name: ReactNode;
  focusCell: (personId: string, date: string) => void;
  openCell: (person: PeriodStaff, date: string, building: 1 | 2) => void;
}) {
  const bridge = (hidden: readonly ShiftPersonDay[]) => {
    const targets = hidden.filter((day) => focusDates.includes(day.date));
    if (!targets.length) return null;
    return (
      <span
        className="shift-focus-bridge"
        tabIndex={0}
        onFocus={(event) => {
          const from = event.relatedTarget as Node | null;
          const forward =
            !from ||
            Boolean(
              from.compareDocumentPosition(event.currentTarget) & Node.DOCUMENT_POSITION_FOLLOWING,
            );
          focusCell(person.id, targets[forward ? 0 : targets.length - 1].date);
        }}
      />
    );
  };
  return (
    <tr className="shift-person-row" data-shift-person={person.id}>
      {name}
      {start > 0 && (
        <td key="before" colSpan={start}>
          {bridge(days.slice(0, start))}
        </td>
      )}
      {days.slice(start, end).map((day) => (
        <PersonCell
          key={day.date}
          day={day}
          person={person}
          building={building}
          requestView={requestView}
          openCell={openCell}
        />
      ))}
      {end < days.length && (
        <td key="after" colSpan={days.length - end}>
          {bridge(days.slice(end))}
        </td>
      )}
    </tr>
  );
}
