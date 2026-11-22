import type {
  PeriodCoverage,
  PeriodSaveInput,
  PeriodSummary,
  RequestSheetResponse,
} from '../../../shared/protocol';
import { facilities, type Facility } from '../../../shared/calendar';
import { addDays, japanDate, japanDateTime } from '../../../shared/date';
import { MAX_COVERAGE_REQUIRED, MAX_PERIOD_DAYS } from '../../../shared/limits';
import { monthDay, dayLabel } from '../format/date';

export { addDays } from '../../../shared/date';
export { containsToday } from '../../../shared/period';

export { facilities, type Facility } from '../../../shared/calendar';
export interface PeriodForm {
  name: string;
  startDate: string | null;
  endDate: string | null;
  deadline: string | null;
  coverage: Record<Facility, { total: string }>;
}
const dateOf = (date: string) => new Date(`${date}T00:00:00Z`);
export const dayCount = (start: string, end: string) =>
  Math.round((dateOf(end).getTime() - dateOf(start).getTime()) / 86_400_000) + 1;
function nextMonth(date: string) {
  const [year, month, day] = date.split('-').map(Number);
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(day, last))).toISOString().slice(0, 10);
}
export function previousPeriod(periods: PeriodSummary[], startDate: string | null, id?: string) {
  return periods
    .filter((period) => period.id !== id && (!startDate || period.end_date < startDate))
    .sort((a, b) => b.end_date.localeCompare(a.end_date))[0];
}
export function initialForm(periods: PeriodSummary[], period?: PeriodSummary): PeriodForm {
  const last = previousPeriod(periods, null),
    startDate = period?.start_date ?? (last ? addDays(last.end_date, 1) : null);
  const source = period?.coverage ?? last?.coverage ?? [];
  return {
    name: period?.name ?? '',
    startDate,
    endDate: period?.end_date ?? (startDate ? addDays(nextMonth(startDate), -1) : null),
    deadline: period?.request_deadline_date ?? null,
    coverage: Object.fromEntries(
      facilities.map((facility) => {
        const row = source.find((item) => item.facility === facility);
        return [
          facility,
          {
            total: row ? String(row.total_required) : '',
          },
        ];
      }),
    ) as PeriodForm['coverage'],
  };
}
function overlappingPeriod(
  periods: PeriodSummary[],
  startDate: string | null,
  endDate: string | null,
  id?: string,
) {
  if (!startDate || !endDate || endDate < startDate) return;
  return periods
    .filter(
      (period) => period.id !== id && period.start_date <= endDate && startDate <= period.end_date,
    )
    .sort((a, b) => a.start_date.localeCompare(b.start_date))[0];
}
export function rangeProblem(form: PeriodForm, periods: PeriodSummary[], id?: string) {
  if (form.startDate && form.endDate && form.endDate < form.startDate)
    return '終了日が開始日より前になっています';
  if (form.startDate && form.endDate && dayCount(form.startDate, form.endDate) > MAX_PERIOD_DAYS)
    return `期間は${MAX_PERIOD_DAYS}日までにしてください。`;
  const overlap = overlappingPeriod(periods, form.startDate, form.endDate, id);
  return overlap
    ? `「${overlap.name}」（${monthDay(overlap.start_date)}〜${monthDay(overlap.end_date)}）と一部重複しています`
    : null;
}
export function deadlineProblem(form: PeriodForm) {
  return form.deadline && form.endDate && form.deadline > form.endDate
    ? '締め切りは、ピリオドの終わりの日までです'
    : null;
}
const integer = (value: string) => /^\d+$/.test(value) && Number.isSafeInteger(Number(value));
export function coverageProblems({ total }: PeriodForm['coverage'][Facility]) {
  const problem = (value: string) =>
    value !== '' && !integer(value)
      ? '人数は、0以上の整数で入れてください'
      : value !== '' && Number(value) > MAX_COVERAGE_REQUIRED
        ? `人数は${MAX_COVERAGE_REQUIRED}人までにしてください。`
        : null;
  return {
    total: problem(total),
  };
}
export function canSave(form: PeriodForm, periods: PeriodSummary[], id?: string) {
  return Boolean(
    form.name.trim() &&
    form.name.trim().length <= 20 &&
    form.startDate &&
    form.endDate &&
    !rangeProblem(form, periods, id) &&
    !deadlineProblem(form) &&
    facilities.every((facility) => {
      const { total } = form.coverage[facility];
      return (
        total === '' ||
        (integer(total) && !Object.values(coverageProblems({ total })).some(Boolean))
      );
    }),
  );
}
export function periodInput(id: string, form: PeriodForm): PeriodSaveInput {
  const coverage: PeriodCoverage[] = facilities
    .filter((facility) => form.coverage[facility].total !== '')
    .map((facility) => ({
      facility,
      total_required: Number(form.coverage[facility].total),
    }));
  return {
    id,
    name: form.name.trim(),
    start_date: form.startDate!,
    end_date: form.endDate!,
    request_deadline_date: form.deadline,
    coverage,
  };
}
function removedDays(period: PeriodSummary, startDate: string, endDate: string) {
  const ranges: Array<{ start: string; end: string }> = [];
  if (startDate > period.start_date)
    ranges.push({
      start: period.start_date,
      end: addDays(startDate, -1) < period.end_date ? addDays(startDate, -1) : period.end_date,
    });
  if (endDate < period.end_date)
    ranges.push({
      start: addDays(endDate, 1) > period.start_date ? addDays(endDate, 1) : period.start_date,
      end: period.end_date,
    });
  return ranges;
}
export function shorteningMessage(period: PeriodSummary, startDate: string, endDate: string) {
  const ranges = removedDays(period, startDate, endDate);
  if (!ranges.length) return null;
  return `${ranges.map((range) => `${monthDay(range.start)}〜${monthDay(range.end)}`).join('、')}（${ranges.reduce((sum, range) => sum + dayCount(range.start, range.end), 0)}日分）の勤務と希望が消えます。元に戻せません。`;
}
export function requestState(period: PeriodSummary | undefined, today: string) {
  if (!period?.request_deadline_date) return 'none';
  if (!period.requests_closed_at && period.request_deadline_date >= today) return 'open';
  return period.has_request_submissions ? 'closed-with-submissions' : 'closed-empty';
}
export function shouldOpenUrl(
  before: PeriodSummary | undefined,
  after: PeriodSummary,
  today: string,
) {
  const previous = requestState(before, today);
  return (
    requestState(after, today) === 'open' && (previous === 'none' || previous === 'closed-empty')
  );
}
export function deadlineHint(
  period: PeriodSummary | undefined,
  deadline: string | null,
  today: string,
) {
  const state = requestState(period, today);
  if (state === 'none')
    return deadline
      ? `${period ? '保存すると' : '作ると'}、希望の受付が始まります`
      : '締め切りを入れると、希望の受付が始まります';
  if (state === 'open') return '';
  if (state === 'closed-with-submissions') return '締め切った後は、変えられません';
  return deadline !== period!.request_deadline_date
    ? '保存すると、もう一度、希望の受付が始まります'
    : '誰も提出しないまま締め切りました。入れ直すと、受付をやり直せます';
}
export function requestClosedDate(period: PeriodSummary) {
  return period.requests_closed_at
    ? japanDate(new Date(period.requests_closed_at))
    : period.request_deadline_date!;
}
export function requestClosedLabel(period: PeriodSummary) {
  if (!period.requests_closed_at)
    return `${dayLabel(period.request_deadline_date!)}の24時に締め切りました`;
  const time = japanDateTime(new Date(period.requests_closed_at));
  return `${dayLabel(requestClosedDate(period))}の${time.getUTCHours()}時${time.getUTCMinutes()}分に締め切りました`;
}
export function unsubmittedRequestStaff(
  sheet: Pick<RequestSheetResponse, 'staff' | 'dailyRequests' | 'noRequests'>,
) {
  const submitted = new Set(
    [...sheet.dailyRequests, ...sheet.noRequests].map((item) => item.staff_id),
  );
  return sheet.staff
    .filter((person) => !submitted.has(person.id))
    .map((person) => ({ id: person.id, name: person.name }));
}
export function requestClosedMessage(period: Pick<PeriodSummary, 'has_request_submissions'>) {
  return period.has_request_submissions
    ? {
        title: ['締め切り後、スタッフはシフト希望を', '提出できません。'],
        detail: '締め切り後変更が必要な場合、\nスタッフから直接聞いてシフトを直してください。',
      }
    : {
        title: ['誰も提出しないまま、締め切りました。'],
        detail: 'ピリオド管理の「編集」で締め切りを入れ直すと、\nもう一度、受付を始められます。',
      };
}
