import { facilities, resolvedDayOpening, type Facility } from './calendar';
import { holidayName } from './holidays';
import type {
  AnnualRules,
  PeriodCoverage,
  PeriodLoadResponse,
  PeriodSummary,
  Staff,
} from './protocol';

export interface CoverageSegment {
  startTime: string;
  endTime: string;
  total: number;
  sufficient: boolean;
}
type FacilityCoverage =
  | { kind: 'closed' | 'unknown' | 'not-configured' }
  | { kind: 'checked'; segments: CoverageSegment[] };
export interface CoverageInput {
  date: string;
  period: Pick<PeriodSummary, 'start_date' | 'coverage'>;
  periods: readonly Pick<PeriodSummary, 'id' | 'start_date'>[];
  staff: readonly Pick<Staff, 'id' | 'history'>[];
  rules: AnnualRules;
  data: Pick<PeriodLoadResponse, 'facilityDays' | 'buildingDays' | 'workSlots' | 'dayStates'>;
}

export function coverageShortage(
  required: Pick<PeriodCoverage, 'total_required'>,
  segment: Pick<CoverageSegment, 'total'>,
): number {
  return Math.max(0, required.total_required - segment.total);
}

export function facilityCoverage(facility: Facility, input: CoverageInput): FacilityCoverage {
  const { date, period, rules, data } = input;
  const opening = resolvedDayOpening(date, facility, data, rules);
  if (!opening) return { kind: 'unknown' };
  if (!opening.isOpen) return { kind: 'closed' };
  const required = period.coverage.find((row) => row.facility === facility);
  if (!required) return { kind: 'not-configured' };

  const excluded = new Set(
    data.dayStates
      .filter((row) => row.date === date && row.roles.includes('alpha'))
      .map((row) => row.staff_id),
  );
  const slots = data.workSlots
    .filter((row) => row.date === date && !excluded.has(row.staff_id))
    .flatMap((row) => {
      return row.slots
        .filter((slot) => slot.facility === facility && !slot.is_office)
        .map((slot) => ({
          staffId: row.staff_id,
          start: slot.start_time > opening.startTime ? slot.start_time : opening.startTime,
          end: slot.end_time < opening.endTime ? slot.end_time : opening.endTime,
        }))
        .filter((slot) => slot.start < slot.end);
    });
  const boundaries = [
    ...new Set([
      opening.startTime,
      opening.endTime,
      ...slots.flatMap((slot) => [slot.start, slot.end]),
    ]),
  ].sort();
  const segments: CoverageSegment[] = [];
  for (let index = 0; index < boundaries.length - 1; index++) {
    const startTime = boundaries[index],
      endTime = boundaries[index + 1];
    const present = new Set(
      slots
        .filter((slot) => slot.start <= startTime && startTime < slot.end)
        .map((slot) => slot.staffId),
    );
    const total = present.size;
    const previous = segments[segments.length - 1];
    // A handover or overlapping slots do not create a boundary unless the counts change.
    if (previous && previous.total === total) previous.endTime = endTime;
    else
      segments.push({
        startTime,
        endTime,
        total,
        sufficient: total >= required.total_required,
      });
  }
  return { kind: 'checked', segments };
}

function missingClosingBuildings(
  date: string,
  data: Pick<PeriodLoadResponse, 'workSlots' | 'dayStates'>,
): (1 | 2)[] {
  if (new Date(`${date}T00:00:00Z`).getUTCDay() === 0 || holidayName(date) !== undefined) return [];
  const closing = new Set(
    data.dayStates
      .filter((row) => row.date === date && row.roles.includes('closing'))
      .map((row) => row.staff_id),
  );
  return ([1, 2] as const).filter((building) => {
    const work = data.workSlots.filter(
      (row) => row.date === date && row.building === building && row.slots.length > 0,
    );
    return work.length > 0 && !work.some((row) => closing.has(row.staff_id));
  });
}

export function dayCoverageProblems(input: CoverageInput): {
  insufficientFacilities: Facility[];
  missingClosingBuildings: (1 | 2)[];
} {
  return {
    insufficientFacilities: facilities.filter((facility) => {
      const result = facilityCoverage(facility, input);
      return result.kind === 'checked' && result.segments.some((segment) => !segment.sufficient);
    }),
    missingClosingBuildings: missingClosingBuildings(input.date, input.data),
  };
}
