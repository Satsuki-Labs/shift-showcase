import type { PeriodStaff } from '../../../shared/period-snapshot';
import type { Sheet, XmlNode } from 'xlsx-populate/browser/xlsx-populate-no-encryption.min.js';
import {
  payStaff,
  periodPay,
  workMinutes,
  type PayTotals,
  type PersonPay,
} from '../../../shared/pay';
import { periodDates } from '../../../shared/period';
import { historyForPeriod } from '../../../shared/staff';
import type { PeriodLoadResponse, PeriodSummary, Staff } from '../../../shared/protocol';
import { dayLabel, monthDay, yearMonthDay } from '../format/date';
import { employmentTypes, payExcelFileName, qualifications } from '../format/labels';
import { shortTime } from '../format/time';

// Excelの紙の色。画面の指定ではない。
const paper = {
  navy: '2F4A6D',
  sand: 'EFE9DF',
  line: 'C9C2B6',
  text: '2B2A28',
  sub: '5A554E',
  white: 'FFFFFF',
  total: 'F6F3EE',
  alternate: 'FBFAF8',
  warn: 'FAD5A5',
  warnText: '5C3200',
  paid: 'CFE3D5',
  office: 'F2D675',
};
const formats = {
  money: '#,##0',
  difference: '#,##0;"−"#,##0;0',
  time: '[h]"時間"mm"分"',
  days: '0"日"',
  ratio: '0.0%',
};
const payNote = '給与見込み（15分給×勤務時間）。賞与・手当・社会保険などは含まれていません。';
export type PaySheetTarget = 'all' | { staffId: string };
export interface PaySheetInput {
  staff: readonly Staff[];
  period: PeriodSummary;
  periods: readonly PeriodSummary[];
  data: PeriodLoadResponse;
  today: string;
  outputDate: string;
  target: PaySheetTarget;
}
type Person = {
  staff: PeriodStaff;
  pay: PersonPay;
  qualification: string;
  employment: string;
  office: number;
};
const noAverage = (person: Person) =>
  person.pay.days.some((day) => day.kind === 'paid_leave' && day.noAverage);
const duration = (minutes: number) => minutes / 1440;

function merged(
  sheet: Sheet,
  row: number,
  start: number,
  end: number,
  text: string,
  style: Record<string, unknown> = {},
) {
  sheet
    .range(row, start, row, end)
    .merged(true)
    .style({ fontSize: 10, fontColor: paper.text, ...style });
  sheet.cell(row, start).value(text);
}
function tableRow(
  sheet: Sheet,
  row: number,
  start: number,
  values: (string | number)[],
  style: Record<string, unknown> = {},
) {
  sheet
    .range(row, start, row, start + values.length - 1)
    .value([values])
    .style({
      border: { style: 'thin', color: paper.line },
      fontSize: 10,
      fontColor: paper.text,
      horizontalAlignment: 'right',
      ...style,
    });
  sheet.row(row).height(22);
}
function heading(sheet: Sheet, row: number, start: number, labels: string[]) {
  tableRow(sheet, row, start, labels, {
    fill: paper.sand,
    bold: true,
    horizontalAlignment: 'center',
    wrapText: true,
  });
  sheet.row(row).height(30);
}
function money(sheet: Sheet, row: number, columns: number[], difference?: number) {
  for (const column of columns)
    sheet
      .cell(row, column)
      .style({ numberFormat: column === difference ? formats.difference : formats.money });
}
function initialize(
  sheet: Sheet,
  widths: number[],
  title: string,
  input: PaySheetInput,
  landscape: boolean,
) {
  const last = widths.length;
  widths.forEach((width, index) => sheet.column(index + 1).width(width));
  merged(sheet, 1, 1, last - 2, title, { fontSize: 16, bold: true, fontColor: paper.navy });
  merged(sheet, 1, last - 1, last, `出力日 ${yearMonthDay(input.outputDate)}`, {
    fontSize: 9,
    fontColor: paper.sub,
    horizontalAlignment: 'right',
  });
  sheet.range(1, 1, 1, last).style({ bottomBorder: { style: 'medium', color: paper.navy } });
  sheet.row(1).height(32);
  merged(
    sheet,
    2,
    1,
    last,
    `${input.period.name}　${yearMonthDay(input.period.start_date)}〜${input.period.start_date.slice(0, 4) === input.period.end_date.slice(0, 4) ? monthDay(input.period.end_date) : yearMonthDay(input.period.end_date)}（${periodDates(input.period).length}日間）`,
    { bold: true, fontSize: 11 },
  );
  sheet.row(2).height(25);
  merged(sheet, 3, 1, last, payNote, { fontColor: paper.sub, fontSize: 9, wrapText: true });
  sheet.row(3).height(30);
  sheet
    .pageMarginsPreset('normal')
    .pageMargins('left', 0.3)
    .pageMargins('right', 0.3)
    .pageMargins('top', 0.4)
    .pageMargins('bottom', 0.5)
    .pageMargins('footer', 0.2);
  sheet.printOptions('gridLines', false);
  // xlsx-populate 1.21.0 has no public page setup or footer API.
  const props = sheet._node.children.find(
    (node): node is XmlNode => typeof node !== 'string' && node.name === 'sheetPr',
  )!;
  props.children.push({ name: 'pageSetUpPr', attributes: { fitToPage: 1 }, children: [] });
  sheet._node.children = sheet._node.children.filter(
    (node) => typeof node === 'string' || !['pageSetup', 'headerFooter'].includes(node.name),
  );
  sheet._node.children.push(
    {
      name: 'pageSetup',
      attributes: {
        paperSize: 9,
        orientation: landscape ? 'landscape' : 'portrait',
        fitToWidth: 1,
        fitToHeight: 0,
      },
      children: [],
    },
    {
      name: 'headerFooter',
      attributes: {},
      children: [
        {
          name: 'oddFooter',
          attributes: {},
          children: [
            `&L&"游ゴシック,Regular"&8テスト事業所 シフト管理　${title.replace(/&/g, '&&')}（${input.period.name.replace(/&/g, '&&')}）&R&P / &N`,
          ],
        },
      ],
    },
  );
}
function finish(sheet: Sheet, lastRow: number, columns: number, repeat?: number) {
  sheet
    .range(1, 1, lastRow, columns)
    .style({ fontFamily: '游ゴシック', verticalAlignment: 'center' });
  sheet.definedName(
    '_xlnm.Print_Area',
    `'${sheet.name()}'!$A$1:$${String.fromCharCode(64 + columns)}$${lastRow}`,
  );
  if (repeat) sheet.definedName('_xlnm.Print_Titles', `'${sheet.name()}'!$${repeat}:$${repeat}`);
}
function missingNotes(
  sheet: Sheet,
  row: number,
  people: readonly Person[],
  columns: number,
): number {
  for (const person of people.filter(noAverage)) {
    merged(
      sheet,
      row,
      1,
      columns,
      `${person.staff.name}：このピリオドに勤務が無いため、有給の金額は入っていません`,
      { wrapText: true, fontColor: paper.sub },
    );
    sheet.row(row++).height(28);
  }
  return row;
}
function personValues(person: Person): (string | number)[] {
  const { pay } = person;
  return [
    person.employment,
    person.qualification,
    pay.quarter_hour_pay,
    pay.workDays,
    pay.paidLeaveDays,
    duration(pay.workMinutes),
    duration(person.office),
    pay.amount,
  ];
}
function personNumbers(sheet: Sheet, row: number, start: number) {
  money(sheet, row, [start + 2, start + 7]);
  for (const column of [start + 3, start + 4])
    sheet.cell(row, column).style({ numberFormat: formats.days });
  for (const column of [start + 5, start + 6])
    sheet.cell(row, column).style({ numberFormat: formats.time });
}
function summary(sheet: Sheet, people: Person[], input: PaySheetInput, all: PayTotals) {
  initialize(sheet, [22, 12, 11, 11, 8, 8, 12, 14, 15, 15, 15], '給与見込みの集計', input, true);
  merged(sheet, 5, 1, 5, '合計', { bold: true, fontColor: paper.navy });
  heading(sheet, 6, 1, ['', '給与見込み', '予算', '予算との差', '予算に対して']);
  heading(sheet, 6, 7, ['勤務時間']);
  const { amount, budget } = all;
  tableRow(sheet, 7, 1, ['全体', amount, budget, budget - amount, budget ? amount / budget : '―']);
  tableRow(sheet, 7, 7, [duration(all.workMinutes)], { numberFormat: formats.time });
  sheet.cell(7, 1).style({ bold: true, horizontalAlignment: 'left' });
  money(sheet, 7, [2, 3, 4], 4);
  sheet.cell(7, 5).style({ numberFormat: formats.ratio });
  merged(sheet, 9, 1, 11, '人ごと', { bold: true, fontColor: paper.navy });
  heading(sheet, 10, 1, [
    '氏名',
    '雇用区分',
    '資格',
    '15分給',
    '出勤',
    '有給',
    '勤務時間',
    'うち事務（Y）',
    '給与見込み',
    '予算',
    '予算との差',
  ]);
  let row = 11;
  people.forEach((person, index) => {
    tableRow(
      sheet,
      row,
      1,
      [
        person.staff.name,
        ...personValues(person),
        person.pay.budget,
        person.pay.budget - person.pay.amount,
      ],
      { fill: index % 2 ? paper.alternate : paper.white },
    );
    sheet.cell(row, 1).style({ bold: true, horizontalAlignment: 'left' });
    sheet.range(row, 2, row, 3).style({ horizontalAlignment: 'center' });
    personNumbers(sheet, row, 2);
    money(sheet, row, [10, 11], 11);
    if (person.pay.over > 0)
      sheet.cell(row, 11).style({ fill: paper.warn, fontColor: paper.warnText, bold: true });
    row++;
  });
  row = missingNotes(sheet, row + 1, people, 11);
  sheet.cell(row, 1).value('■').style({ fill: paper.warn, fontColor: paper.warnText });
  merged(sheet, row, 2, 6, '予算を超えた人の「予算との差」');
  finish(sheet, row, 11, 10);
}

function details(
  sheet: Sheet,
  row: number,
  person: Person,
  columns: number,
  band: boolean,
): number {
  const spans =
    columns === 8
      ? [
          [1, 2],
          [3, 3],
          [4, 4],
          [5, 5],
          [6, 7],
          [8, 8],
        ]
      : [
          [1, 1],
          [2, 2],
          [3, 3],
          [4, 4],
          [5, 5],
          [6, 6],
        ];
  const write = (values: (string | number)[], style: Record<string, unknown> = {}) => {
    spans.forEach(([start, end], index) => {
      if (start !== end) sheet.range(row, start, row, end).merged(true);
      sheet.range(row, start, row, end).style({
        border: { style: 'thin', color: paper.line },
        fontSize: 10,
        fontColor: paper.text,
        horizontalAlignment: index >= 4 ? 'right' : 'left',
        ...style,
      });
      sheet.cell(row, start).value(values[index]);
    });
    sheet.row(row).height(23);
  };
  if (band) {
    merged(
      sheet,
      row,
      1,
      columns,
      `${person.staff.name}　${person.employment}・${person.qualification}・15分給${person.pay.quarter_hour_pay}円`,
      { fill: paper.navy, fontColor: paper.white, bold: true },
    );
    sheet.row(row++).height(28);
  }
  write(['日付', '施設', '時刻', '事務', '時間', '金額'], {
    fill: paper.sand,
    bold: true,
    horizontalAlignment: 'center',
  });
  row++;
  person.pay.days.forEach((day, dayIndex) => {
    const background = dayIndex % 2 ? paper.alternate : paper.white;
    if (day.kind === 'paid_leave') {
      write(
        [
          dayLabel(day.date),
          '',
          '',
          '',
          day.noAverage ? '―' : duration(day.minutes),
          day.noAverage ? '―' : day.amount,
        ],
        { fill: background },
      );
      for (const [start, end] of spans.slice(1, 4))
        if (start !== end) sheet.range(row, start, row, end).merged(false);
      merged(sheet, row, spans[1][0], spans[3][1], '有給', {
        fill: paper.paid,
        bold: true,
        horizontalAlignment: 'center',
      });
      sheet.cell(row, spans[4][0]).style({ numberFormat: formats.time });
      sheet.cell(row, spans[5][0]).style({ numberFormat: formats.money });
      row++;
    } else {
      const slots = day.work
        .flatMap((work) =>
          work.slots.map((slot) => ({ slot, minutes: workMinutes([{ ...work, slots: [slot] }]) })),
        )
        .sort((a, b) => a.slot.start_time.localeCompare(b.slot.start_time));
      let allocated = 0;
      slots.forEach(({ slot, minutes }, index) => {
        const amount =
          index === slots.length - 1
            ? day.amount - allocated
            : Math.round((minutes * person.pay.quarter_hour_pay) / 15);
        allocated += amount;
        write(
          [
            index ? '' : dayLabel(day.date),
            slot.facility,
            `${shortTime(slot.start_time.slice(0, 5))}〜${shortTime(slot.end_time.slice(0, 5))}`,
            slot.is_office ? 'Y' : '',
            duration(minutes),
            amount,
          ],
          { fill: background },
        );
        sheet.cell(row, spans[1][0]).style({ horizontalAlignment: 'center' });
        sheet.cell(row, spans[3][0]).style({
          horizontalAlignment: 'center',
          ...(slot.is_office ? { fill: paper.office, bold: true } : {}),
        });
        sheet.cell(row, spans[4][0]).style({ numberFormat: formats.time });
        sheet.cell(row, spans[5][0]).style({ numberFormat: formats.money });
        row++;
      });
    }
  });
  write(
    [
      '',
      '',
      '',
      '',
      duration(person.pay.days.reduce((total, day) => total + day.minutes, 0)),
      person.pay.amount,
    ],
    { fill: paper.total, bold: true },
  );
  for (const [start, end] of spans.slice(0, 4))
    if (start !== end) sheet.range(row, start, row, end).merged(false);
  merged(sheet, row, 1, spans[3][1], '合計（有給を含む）');
  sheet.cell(row, spans[4][0]).style({ numberFormat: formats.time });
  sheet.cell(row, spans[5][0]).style({ numberFormat: formats.money });
  return row + 2;
}

/** The library is loaded only by an explicit export action. */
export async function buildPaySheet(
  input: PaySheetInput,
): Promise<{ bytes: Uint8Array; fileName: string }> {
  const staff = payStaff(input.staff, input.period, input.data, input.today);
  const result = periodPay({ ...input, staff });
  const target = input.target;
  const people = result.people
    .filter((pay) => (typeof target === 'object' ? pay.staff_id === target.staffId : true))
    .map((pay): Person => {
      const person = staff.find((person) => person.id === pay.staff_id)!,
        history = historyForPeriod(person.history, input.periods, input.period.start_date)!;
      const office = pay.days.reduce(
        (total, day) =>
          total +
          (day.kind === 'work'
            ? workMinutes(
                day.work.flatMap((work) =>
                  work.slots
                    .filter((slot) => slot.is_office)
                    .map((slot) => ({ ...work, slots: [slot] as [typeof slot] })),
                ),
              )
            : 0),
        0,
      );
      return {
        staff: person,
        pay,
        office,
        employment: employmentTypes.find((row) => row.value === pay.employment_type)!.label,
        qualification: qualifications.find((row) => row.value === history.qualification)!.label,
      };
    });
  const { default: XlsxPopulate } =
    await import('xlsx-populate/browser/xlsx-populate-no-encryption.min.js');
  const workbook = await XlsxPopulate.fromBlankAsync();
  if (typeof target === 'object') {
    const person = people[0];
    if (!person) throw new Error('出力するスタッフがいません');
    const sheet = workbook.sheet(0).name('給与見込み');
    initialize(
      sheet,
      [13, 11, 12, 21, 9, 12, 14, 16],
      `給与見込み　${person.staff.name}`,
      input,
      false,
    );
    heading(sheet, 5, 1, [
      '雇用区分',
      '資格',
      '15分給',
      '出勤',
      '有給',
      '勤務時間',
      'うち事務（Y）',
      '給与見込み',
    ]);
    tableRow(sheet, 6, 1, personValues(person));
    personNumbers(sheet, 6, 1);
    const row = missingNotes(sheet, 8, people, 8);
    const end = details(sheet, row + 1, person, 8, false);
    finish(sheet, end - 2, 8);
  } else {
    summary(workbook.sheet(0).name('集計'), people, input, result.all);
    const sheet = workbook.addSheet('日ごとの内訳');
    // xlsx-populate 1.21.0 does not register sheets added after loading the blank workbook.
    const contentTypes = workbook as typeof workbook & {
      _contentTypes: { add(partName: string, contentType: string): unknown };
    };
    contentTypes._contentTypes.add(
      '/xl/worksheets/sheet2.xml',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml',
    );
    initialize(sheet, [26, 9, 25, 9, 14, 16], '日ごとの内訳', input, false);
    let row = 5;
    for (const person of people) row = details(sheet, row, person, 6, true);
    finish(sheet, Math.max(3, row - 2), 6);
  }
  return {
    bytes: await workbook.outputAsync({ type: 'uint8array' }),
    fileName: payExcelFileName(
      input.period.name,
      typeof target === 'object' ? people[0].staff.name : '全体',
      input.outputDate,
    ),
  };
}
