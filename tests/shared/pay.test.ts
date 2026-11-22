import { expect, test } from 'vitest';
import { periodPay, workMinutes, type PeriodPayInput } from '../../shared/pay';
import type { DayState, StaffHistory, WorkSlot, WorkSlotTime } from '../../shared/protocol';

function person(id: string, values: Partial<StaffHistory> = {}): PeriodPayInput['staff'][number] {
  return {
    id,
    history: [
      {
        staff_id: id,
        since: 'initial',
        quarter_hour_pay: 301,
        employment_type: 'part_time',
        qualification: 'none',
        budget: 10000,
        ...values,
      },
    ],
  };
}
function slot(
  start: string,
  end: string,
  facility: WorkSlotTime['facility'] = 'A',
  office = false,
): WorkSlotTime {
  return { start_time: start, end_time: end, facility, is_office: office };
}
function work(id: string, date: string, slots: WorkSlot['slots'], building: 1 | 2 = 1): WorkSlot {
  return {
    staff_id: id,
    date,
    building,
    slots,
    last_changed_by: 'first',
    last_changed_at: `${date}T00:00:00Z`,
    revision: 1,
  };
}
function state(id: string, date: string, status: DayState['status'] = 'paid_leave'): DayState {
  return {
    staff_id: id,
    date,
    status,
    roles: [],
    special_care: false,
    last_changed_by: 'first',
    last_changed_at: `${date}T00:00:00Z`,
    revision: 1,
  };
}
function input(staff: PeriodPayInput['staff'] = [person('one')]): PeriodPayInput {
  return {
    period: { start_date: '2026-10-16', end_date: '2026-11-15' },
    periods: [
      { id: 'current', start_date: '2026-10-16' },
      { id: 'next', start_date: '2026-11-16' },
    ],
    staff,
    data: { dayStates: [], workSlots: [] },
  };
}

test('081-1: 1分単位で全施設・両枠・事務を足し、休業の日も勤務1日として日ごとに四捨五入する', () => {
  const data = input();
  const first = work('one', '2026-10-18', [slot('13:10', '14:00'), slot('14:15', '15:16', 'B')]);
  const second = work(
    'one',
    '2026-10-18',
    [slot('15:20', '16:02', 'C', true), slot('16:05', '18:00', 'D')],
    2,
  );
  const minute = work('one', '2026-10-16', [slot('13:10', '18:00')]);
  data.data.workSlots = [first, second, minute];
  data.data.dayStates = [state('one', '2026-10-19', 'none'), state('one', '2026-10-20', 'empty')];
  expect(workMinutes([first, second])).toBe(268);
  expect(periodPay(data).people[0]).toEqual({
    staff_id: 'one',
    employment_type: 'part_time',
    quarter_hour_pay: 301,
    budget: 10000,
    workDays: 2,
    paidLeaveDays: 0,
    workMinutes: 558,
    amount: 11197,
    over: 1197,
    days: [
      { date: '2026-10-16', kind: 'work', minutes: 290, amount: 5819, work: [minute] },
      { date: '2026-10-18', kind: 'work', minutes: 268, amount: 5378, work: [first, second] },
    ],
  });
});

test('081-2: 常勤の有給は480分で、勤務の日数と時間には入れず、有給の日数と給与に足す', () => {
  const data = input([person('one', { employment_type: 'full_time' })]);
  data.data.workSlots = [work('one', '2026-10-16', [slot('13:10', '18:00')])];
  data.data.dayStates = [state('one', '2026-10-17')];
  const result = periodPay(data).people[0];
  expect(result).toMatchObject({
    workDays: 1,
    paidLeaveDays: 1,
    workMinutes: 290,
    amount: 15451,
    over: 5451,
  });
  expect(result.days[1]).toEqual({
    date: '2026-10-17',
    kind: 'paid_leave',
    minutes: 480,
    amount: 9632,
  });
});

test('081-3: 非常勤・アルバイトの有給は期間内の勤務日の平均を丸めずに使い、期間外は除く', () => {
  const data = input([person('part'), person('casual', { employment_type: 'casual' })]);
  for (const id of ['part', 'casual']) {
    data.data.workSlots.push(
      work(id, '2026-10-16', [slot('13:10', '18:00')]),
      work(id, '2026-11-15', [slot('13:09', '16:00')]),
      work(id, '2026-11-15', [slot('16:00', '18:00', 'C')], 2),
      work(id, '2026-10-15', [slot('08:00', '18:00')]),
      work(id, '2026-11-16', [slot('08:00', '18:00')]),
    );
    data.data.dayStates.push(
      state(id, '2026-10-17'),
      state(id, '2026-10-15'),
      state(id, '2026-11-16'),
    );
  }
  for (const result of periodPay(data).people) {
    expect(result).toMatchObject({
      workDays: 2,
      paidLeaveDays: 1,
      workMinutes: 581,
      amount: 17487,
    });
    expect(result.days.map((day) => day.date)).toEqual(['2026-10-16', '2026-10-17', '2026-11-15']);
    expect(result.days[1]).toEqual({
      date: '2026-10-17',
      kind: 'paid_leave',
      minutes: 291,
      amount: 5829,
    });
  }
});

test('081-4: 勤務のない非常勤の有給は0円とnoAverageを返し、ほかの日と人は計算を続ける', () => {
  const data = input([person('absent'), person('working')]);
  data.data.dayStates = [
    state('absent', '2026-10-17'),
    state('absent', '2026-10-18'),
    state('working', '2026-10-18'),
  ];
  data.data.workSlots = [
    work('absent', '2026-10-15', [slot('08:00', '18:00')]),
    work('working', '2026-10-16', [slot('13:10', '18:00')]),
  ];
  const result = periodPay(data);
  expect(result.people[0]).toMatchObject({
    workDays: 0,
    paidLeaveDays: 2,
    workMinutes: 0,
    amount: 0,
    days: [
      { date: '2026-10-17', kind: 'paid_leave', minutes: 0, amount: 0, noAverage: true },
      { date: '2026-10-18', kind: 'paid_leave', minutes: 0, amount: 0, noAverage: true },
    ],
  });
  expect(result.people[1]).toMatchObject({
    workDays: 1,
    paidLeaveDays: 1,
    workMinutes: 290,
    amount: 11638,
  });
  expect(result.people[1].days[1]).toEqual({
    date: '2026-10-18',
    kind: 'paid_leave',
    minutes: 290,
    amount: 5819,
  });
});

test('081-5: 15分給・雇用区分・予算は対象のピリオドの履歴を使う', () => {
  const staff = person('one', { quarter_hour_pay: 100, employment_type: 'casual', budget: 0 });
  staff.history.push(
    {
      ...staff.history[0],
      since: 'current',
      quarter_hour_pay: 302,
      employment_type: 'full_time',
      budget: 9000,
    },
    {
      ...staff.history[0],
      since: 'next',
      quarter_hour_pay: 500,
      employment_type: 'part_time',
      budget: 50000,
    },
  );
  const data = input([staff]);
  data.data.dayStates = [state('one', '2026-10-16')];
  const result = periodPay(data);
  expect(result.people[0]).toEqual({
    staff_id: 'one',
    employment_type: 'full_time',
    quarter_hour_pay: 302,
    budget: 9000,
    workDays: 0,
    paidLeaveDays: 1,
    workMinutes: 0,
    amount: 9664,
    over: 664,
    days: [{ date: '2026-10-16', kind: 'paid_leave', minutes: 480, amount: 9664 }],
  });
});

test('081-6: 155-2: 人の順序を保ち、全体に人の行を足し、超過は合計の後で求める', () => {
  const data = input([
    person('d', { budget: 5 }),
    person('b', { budget: 50 }),
    person('c', { budget: 50 }),
    person('a', { budget: 5 }),
  ]);
  data.data.workSlots = data.staff.flatMap((staff) => [
    work(staff.id, '2026-10-16', [slot('13:00', '13:01', 'A')]),
    work(staff.id, '2026-10-17', [slot('13:00', '13:01', 'A')]),
  ]);
  const result = periodPay(data);
  expect(result.people.map((staff) => [staff.staff_id, staff.amount, staff.over])).toEqual([
    ['d', 40, 35],
    ['b', 40, 0],
    ['c', 40, 0],
    ['a', 40, 35],
  ]);
  expect(Object.keys(result)).toEqual(['people', 'all']);
  expect(result.people.every((person) => !('accounting_facility' in person))).toBe(true);
  expect(result.all).toEqual({ amount: 160, budget: 110, over: 50, workMinutes: 8 });
  data.staff = data.staff.map((staff) => ({
    ...staff,
    history: [{ ...staff.history[0], budget: 40 }],
  }));
  const withinBudget = periodPay(data);
  expect(withinBudget.people.map((staff) => staff.over)).toEqual([0, 0, 0, 0]);
  expect(withinBudget.all).toEqual({ amount: 160, budget: 160, over: 0, workMinutes: 8 });
});

test('244-1: 全体の勤務時間は両事業所の実際の勤務だけを人ごとに足し、有給と期間外を含めない', () => {
  const data = input([person('both', { employment_type: 'full_time' }), person('other')]);
  data.data.workSlots = [
    work('both', '2026-10-16', [slot('09:00', '11:00')]),
    work('both', '2026-10-16', [slot('13:00', '16:00', 'C')], 2),
    work('other', '2026-10-17', [slot('10:00', '11:15', 'B', true)]),
    work('both', '2026-11-16', [slot('09:00', '19:00')]),
  ];
  data.data.dayStates = [state('both', '2026-10-18'), state('other', '2026-10-18')];
  const result = periodPay(data);
  expect(result.people.map((person) => person.workMinutes)).toEqual([300, 75]);
  expect(result.all.workMinutes).toBe(375);
  expect(periodPay({ ...data, staff: [] }).all.workMinutes).toBe(0);
});
