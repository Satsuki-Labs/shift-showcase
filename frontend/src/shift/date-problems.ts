import {
  dayCoverageProblems,
  facilityCoverage,
  type CoverageInput,
} from '../../../shared/coverage';
import type { Facility } from '../../../shared/calendar';
import { dayLabel } from '../format/date';
import { periodDates } from '../../../shared/period';

type DateProblem =
  | {
      kind: 'coverage';
      facility: Facility;
      startTime: string;
      endTime: string;
      totalMissing: number;
    }
  | { kind: 'closing' };
export interface DateProblemSelection {
  date: string;
  building: 1 | 2;
}
export interface DayProblems extends DateProblemSelection {
  problems: DateProblem[];
}
export interface ClosingNotification extends DateProblemSelection {
  label: string;
}

export function periodDateProblems(
  input: Omit<CoverageInput, 'date'> & {
    period: CoverageInput['period'] & { end_date: string };
  },
): { days: DayProblems[]; closing: ClosingNotification[] } {
  const days: DayProblems[] = [],
    closing: ClosingNotification[] = [];
  for (const date of periodDates(input.period)) {
    const day = { ...input, date },
      summary = dayCoverageProblems(day);
    for (const building of [1, 2] as const) {
      const problems: DateProblem[] = [];
      for (const facility of summary.insufficientFacilities.filter((facility) =>
        building === 1
          ? facility === 'A' || facility === 'B'
          : facility === 'C' || facility === 'D',
      )) {
        const coverage = facilityCoverage(facility, day);
        const required = input.period.coverage.find((row) => row.facility === facility)!;
        if (coverage.kind !== 'checked') continue;
        for (const segment of coverage.segments.filter((segment) => !segment.sufficient)) {
          const total = Math.max(0, required.total_required - segment.total);
          problems.push({
            kind: 'coverage',
            facility,
            startTime: segment.startTime,
            endTime: segment.endTime,
            totalMissing: total,
          });
        }
      }
      if (summary.missingClosingBuildings.includes(building)) {
        problems.push({ kind: 'closing' });
        closing.push({
          date,
          building,
          label: `${dayLabel(date)}${building === 1 ? '第一' : '第二'}`,
        });
      }
      days.push({ date, building, problems });
    }
  }
  return { days, closing };
}
