import { resolvedDayOpening, type Facility } from '../../../shared/calendar';
import type { WorkSlotTime } from '../../../shared/protocol';
import { hasTime, type CellContext } from './cell-model';

export interface ClosedFacilityDay {
  date: string;
  facilities: Facility[];
}
export function closedFacilityDays(
  context: Pick<CellContext, 'data' | 'rules'>,
  days: readonly { date: string; slots: readonly WorkSlotTime[] }[],
): ClosedFacilityDay[] {
  return days.flatMap(({ date, slots }) => {
    const facilities = [...new Set(slots.filter(hasTime).map((slot) => slot.facility))]
      .filter(
        (facility) =>
          resolvedDayOpening(date, facility, context.data, context.rules)?.isOpen === false,
      )
      .sort();
    return facilities.length ? [{ date, facilities }] : [];
  });
}
