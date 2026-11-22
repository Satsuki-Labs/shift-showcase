import type { PeriodStaff } from '../../../shared/period-snapshot';
import type { Sheet, XmlNode } from 'xlsx-populate/browser/xlsx-populate-no-encryption.min.js';
import type {
  AnnualRules,
  ContactNames,
  PeriodLoadResponse,
  PeriodSummary,
} from '../../../shared/protocol';
import { calendarRestDay } from '../../../shared/calendar';
import { periodDates } from '../../../shared/period';
import { historyForPeriod, splitStaffName } from '../../../shared/staff';
import { monthDay, slashDayParts, yearMonthDay } from '../format/date';
import { qualifications, shiftExcelFileName, shiftExcelKinds } from '../format/labels';
import { dailyCounts, periodRules, staffCells, tableStaff } from '../shift/model';
import { paperCell, printedCellChanged } from '../shift/printed';
import { addShiftCrosses, type CrossPosition } from './shift-cross';
import { cacheShiftFormulas } from './shift-formula-cache';

export interface ShiftSheetInput {
  site: 1 | 2;
  contactNames: ContactNames;
  period: PeriodSummary;
  periods: readonly PeriodSummary[];
  data: PeriodLoadResponse;
  staff: readonly PeriodStaff[];
  rules: AnnualRules;
  kind: 'draft' | 'initial' | 'revised' | 'backup';
  outputDate: string;
  today: string;
}
const white = 'FFFFFF';
const dayColumn = (index: number) => (index < 15 ? 4 + index * 3 : 55 + (index - 15) * 3);
const timeValue = (time: string) => {
  const [hours, minutes] = time.split(':').map(Number);
  return (hours * 60 + minutes) / 1440;
};
const clear = (
  sheet: Sheet,
  startRow: number,
  startColumn: number,
  rows: number,
  columns: number,
) => sheet.range(startRow, startColumn, startRow + rows - 1, startColumn + columns - 1).clear();

function writeHeader(
  sheet: Sheet,
  offset: number,
  input: ShiftSheetInput,
  dates: readonly string[],
) {
  for (const column of [34, 88])
    sheet
      .cell(offset + 1, column)
      .value(
        `＊初回発行以後のシフト変更は\n第１→${input.contactNames.first || '　　　　'}、第２→${input.contactNames.second || '　　　　'}までお願いします。`,
      );
  for (const column of [46, 100]) {
    sheet.range(offset + 1, column, offset + 3, column + 2).merged(false);
    sheet.range(offset + 1, column, offset + 4, column + 2).merged(true);
    sheet.cell(offset + 1, column).style({ verticalAlignment: 'bottom' });
  }
  const end = slashDayParts(input.period.end_date);
  sheet.cell(offset + 2, 3).value(Number(input.period.end_date.slice(0, 4)) - 2018);
  sheet.cell(offset + 2, 6).value(end.month);
  for (const [column, date] of [
    [13, dates[0]],
    [18, dates[14]],
    [64, dates[15]],
    [69, dates[dates.length - 1]],
  ] as const) {
    sheet.cell(offset + 2, column).value(date ? monthDay(date) : undefined);
  }
}

function writeDays(
  sheet: Sheet,
  offset: number,
  input: ShiftSheetInput,
  dates: readonly string[],
  rules: AnnualRules,
) {
  for (let index = 0; index < 31; index++) {
    const column = dayColumn(index),
      date = dates[index];
    clear(sheet, offset + 5, column, 6, 3);
    sheet.range(offset + 5, column, offset + 6, column + 2).style({ fill: white });
    if (!date) continue;
    const { weekday } = slashDayParts(date);
    sheet.cell(offset + 5, column).value(Date.parse(`${date}T00:00:00Z`) / 86400000 + 25569);
    sheet.cell(offset + 6, column).value(weekday);
    sheet
      .range(offset + 6, column, offset + 6, column + 2)
      .style({ fill: weekday === '土' ? '0070C0' : weekday === '日' ? 'FF0000' : white });
    const entries =
      input.data.buildingDays.find((day) => day.building === input.site && day.date === date)
        ?.entries ?? [];
    const events = entries.flatMap((entry) =>
      entry.kind === 'event'
        ? [entry.content + (entry.arrival_time ? ` ${entry.arrival_time}` : '')]
        : [],
    );
    const memos = entries.filter((entry) => entry.kind === 'memo').map((entry) => entry.content);
    const rest = calendarRestDay(date, rules, input.data.facilityDays);
    if (rest?.kind === 'closure') memos.push(rest.name);
    sheet
      .cell(offset + 7, column)
      .value(events.join('、') || undefined)
      .style({ shrinkToFit: true, wrapText: false });
    sheet
      .cell(offset + 8, column)
      .value(memos.join('、') || undefined)
      .style({ shrinkToFit: true, wrapText: false });
    const counts = dailyCounts(input.data, input.site, date);
    sheet.cell(offset + 9, column).value(counts.support);
    sheet.cell(offset + 10, column).value(counts.office);
  }
}

function writePeople(
  sheet: Sheet,
  input: ShiftSheetInput,
  people: readonly PeriodStaff[],
  dates: readonly string[],
  rules: AnnualRules,
): CrossPosition[] {
  const weekdayFill = sheet.cell('D11').style('fill');
  const names = people.map((person) => splitStaffName(person.name));
  const crosses: CrossPosition[] = [];
  for (let index = 0; index < 30; index++) {
    const row = 11 + (index % 15) * 3 + (index >= 15 ? 55 : 0),
      person = people[index];
    for (const column of [52, 53, 104]) sheet.cell(row, column).style({ numberFormat: ';;;@' });
    clear(sheet, row, 1, 3, 3);
    if (person) {
      const { familyName, givenName } = names[index];
      const name =
        familyName +
        (names.filter((other) => other.familyName === familyName).length > 1
          ? (Array.from(givenName)[0] ?? '')
          : '');
      sheet
        .cell(row, 2)
        .value(name)
        .style({ shrinkToFit: Array.from(name).length > 3, wrapText: false });
      const qualification = historyForPeriod(
        person.history,
        input.periods,
        input.period.start_date,
      )?.qualification;
      sheet
        .cell(row, 1)
        .value(
          qualifications.find((item) => item.value === qualification && item.value !== 'none')
            ?.label,
        );
      // The back half keeps its formula and needs the same fitting for long names.
      sheet.cell(row, 53).style({ shrinkToFit: Array.from(name).length > 3, wrapText: false });
    }
    const cells = person
      ? staffCells(person, input.period, input.periods, input.site, input.data, rules)
      : null;
    for (let day = 0; day < 31; day++) {
      const column = dayColumn(day),
        date = dates[day];
      clear(sheet, row, column, 3, 3).style({
        fill: date && slashDayParts(date).weekday !== '日' ? weekdayFill : white,
      });
      if (!person || !date) continue;
      const cell = cells!.get(date)!,
        paper = paperCell(cell, input.site);
      paper.rows.forEach((time, line) => {
        if (!time) return;
        sheet.cell(row + line, column).value(timeValue(time.start_time));
        sheet.cell(row + line, column + 2).value(timeValue(time.end_time));
        if (paper.underline === line + 1)
          sheet.cell(row + line, column + 2).style({ underline: true });
      });
      sheet
        .cell(row + 2, column)
        .value(paper.small ?? undefined)
        .style({ shrinkToFit: true, wrapText: false });
      sheet
        .cell(row + 2, column + 1)
        .value(paper.note || undefined)
        .style({ shrinkToFit: true, wrapText: false });
      if (paper.cross) crosses.push({ row, column });
      const changed = printedCellChanged(
        cell,
        person.id,
        date,
        input.site,
        input.period,
        input.data,
        input.today,
      );
      if (changed || paper.office)
        sheet
          .range(row, column, row + 2, column + 2)
          .style({ fill: changed ? 'FEE2E2' : 'FFFF00' });
    }
  }
  return crosses;
}

export async function buildShiftSheet(
  input: ShiftSheetInput,
): Promise<{ bytes: Uint8Array; fileName: string }> {
  const people = tableStaff(input.staff, input.period, input.site, input.data, input.today);
  if (people.length > 30) throw new Error('1つの事業所に31人以上は、紙の枠に入りません');
  const { default: XlsxPopulate } =
    await import('xlsx-populate/browser/xlsx-populate-no-encryption.min.js');
  const response = await fetch('/excel/shift_template.xlsx');
  if (!response.ok) throw new Error(`Excel template: ${response.status}`);
  const workbook = await XlsxPopulate.fromDataAsync(await response.arrayBuffer()),
    sheet = workbook.sheet(0);
  const dates = periodDates(input.period),
    rules = periodRules(input.rules, input.data);
  const title = input.site === 1 ? '第一事業所' : '第二事業所';
  for (const offset of [0, 55]) {
    for (const column of [1, 52]) sheet.cell(offset + 1, column).value(title);
    writeHeader(sheet, offset, input, dates);
    if (!offset || people.length > 15) {
      for (const column of [13, 64])
        sheet
          .cell(offset + 1, column)
          .value(`出力日 ${yearMonthDay(input.outputDate)}（${shiftExcelKinds[input.kind]}）`);
    }
    writeDays(sheet, offset, input, dates, rules);
  }
  for (const column of [70, 71, 72]) sheet.column(column).hidden(false);
  await addShiftCrosses(workbook, writePeople(sheet, input, people, dates, rules), input.site);
  const calc = workbook._node.children.find(
    (node): node is XmlNode => typeof node !== 'string' && node.name === 'calcPr',
  )!;
  calc.attributes.fullCalcOnLoad = 1;
  cacheShiftFormulas(sheet);
  return {
    bytes: await workbook.outputAsync({ type: 'uint8array' }),
    fileName: shiftExcelFileName(input.period.name, input.site, input.kind, input.outputDate),
  };
}
