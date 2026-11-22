import type { PeriodStaff } from '../../../shared/period-snapshot';
import type {
  AnnualRules,
  PeriodLoadResponse,
  PeriodSummary,
  PrintedCells,
} from '../../../shared/protocol';
import { staffCells, tableStaff, type CellView } from './model';
import { shortTime } from '../format/time';

export interface PaperCell {
  rows: [PaperTime | null, PaperTime | null];
  underline: 1 | 2 | null;
  small: string | null;
  cross: boolean;
  note: string;
  office: boolean;
}
interface PaperTime {
  start_time: string;
  end_time: string;
}

export function paperCell(cell: CellView, building: 1 | 2): PaperCell {
  const paper: PaperCell = {
    rows: [null, null],
    underline: null,
    small: null,
    cross: false,
    note: '',
    office: false,
  };
  if (cell.requestRest || cell.kind === 'blank') return paper;
  if (cell.kind === 'holiday') return { ...paper, small: cell.label.replace(/^休/, '') };
  if (cell.kind === 'closure') return { ...paper, small: '休' };
  if (cell.kind === 'paid_leave' || cell.kind === 'empty')
    return { ...paper, small: cell.kind === 'paid_leave' ? '有' : '空', cross: true };

  const roles = [...cell.topRoles, ...cell.bottomRoles].map((role) =>
    role === 'Y' ? 'Ⓨ' : role === '準備' ? '準' : role,
  );
  const order = ['主', '副', '閉', 'Ⓨ', '準', 'Ⅰ', 'Ⅱ', 'Ⅰ→Ⅱ', '抜', 'α'];
  roles.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const smallIndex = roles.findIndex((role) => role !== 'Ⅰ→Ⅱ');
  paper.small = roles[smallIndex] ?? null;
  const notes = roles.filter((_, index) => index !== smallIndex);
  const range = (start: string, end: string) =>
    `${shortTime(start).replace(/:00$/, '')}〜${shortTime(end).replace(/:00$/, '')}`;
  const groups = [building, building === 1 ? 2 : 1].map((value) =>
    cell.times
      .filter((time) => time.building === value)
      .sort((a, b) => a.start_time.localeCompare(b.start_time)),
  );
  groups.forEach((times, index) => {
    if (!times.length) return;
    const first = times[0],
      last = times[times.length - 1];
    paper.rows[index] = { start_time: first.start_time, end_time: last.end_time };
    if (times.some((time) => time.underline)) paper.underline = index === 0 ? 1 : 2;
    if (times.length === 2 && first.end_time !== last.start_time)
      notes.push(`${range(first.end_time, last.start_time)}抜`);
  });
  paper.office = cell.times.some((time) => time.is_office);
  if (paper.office && cell.times.some((time) => !time.is_office)) {
    notes.push(
      ...groups
        .flat()
        .filter((time) => time.is_office)
        .map((time) => `Ⓨ${range(time.start_time, time.end_time)}`),
    );
  }
  paper.note = notes.join(' ');
  return paper;
}

function printedCellKey(cell: CellView, building: 1 | 2): string {
  const paper = paperCell(cell, building);
  if (
    !paper.rows.some(Boolean) &&
    paper.small === null &&
    !paper.cross &&
    !paper.note &&
    !paper.office &&
    paper.underline === null
  )
    return '';
  // Only holiday numbering is excluded; all other paper content stays in the key.
  const small = paper.small?.match(/^[①-⑳㉑-㉟㊱-㊿\d]+$/) ? '公休' : paper.small;
  const rows = paper.rows
    .map((row) => (row ? row.start_time.replace(':', '') + row.end_time.replace(':', '') : ''))
    .join(',');
  return JSON.stringify([
    rows,
    paper.underline ?? 0,
    small,
    Number(paper.cross),
    paper.note,
    Number(paper.office),
  ]);
}

export function printedCells(
  staff: readonly PeriodStaff[],
  period: PeriodSummary,
  periods: readonly PeriodSummary[],
  building: 1 | 2,
  data: PeriodLoadResponse,
  rules: AnnualRules,
  today: string,
): PrintedCells {
  return Object.fromEntries(
    tableStaff(staff, period, building, data, today).map((person) => [
      person.id,
      Object.fromEntries(
        [...staffCells(person, period, periods, building, data, rules)]
          .map(([date, cell]) => [date, printedCellKey(cell, building)])
          .filter(([, key]) => key !== ''),
      ),
    ]),
  );
}

export function printedCellChanged(
  cell: CellView,
  staffId: string,
  date: string,
  building: 1 | 2,
  period: PeriodSummary,
  data: PeriodLoadResponse,
  today: string,
): boolean {
  const sheet = data.distributedSheets?.[building === 1 ? 'first' : 'second'];
  return Boolean(
    sheet &&
    period.end_date >= today &&
    printedCellKey(cell, building) !== (sheet.cells[staffId]?.[date] ?? ''),
  );
}

export function changedPrintedCellCount(
  staff: readonly PeriodStaff[],
  period: PeriodSummary,
  periods: readonly PeriodSummary[],
  building: 1 | 2,
  data: PeriodLoadResponse,
  rules: AnnualRules,
  today: string,
): number {
  return tableStaff(staff, period, building, data, today).reduce(
    (total, person) =>
      total +
      [...staffCells(person, period, periods, building, data, rules)].filter(([date, cell]) =>
        printedCellChanged(cell, person.id, date, building, period, data, today),
      ).length,
    0,
  );
}
