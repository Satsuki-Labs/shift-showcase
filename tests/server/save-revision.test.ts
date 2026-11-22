/// <reference types="@cloudflare/workers-types" />
/// <reference types="@cloudflare/vitest-plugin/types" />
import { SAVE_SHAPE_VERSION } from '../../shared/save-shapes';
import { env } from 'cloudflare:workers';
import { reset, runInDurableObject } from 'cloudflare:test';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import worker, { type Env } from '../../server/src/index';
import type {
  CalendarDaySaveInput,
  FirstLoadResponse,
  JsonValue,
  PeriodsChangedData,
  SaveSuccess,
  ShiftBulkChangedData,
  ShiftCellChangedData,
  ShiftCellSaveInput,
} from '../../shared/protocol';
import { findOperation } from '../../server/src/saves/operations';
import { readRevision } from '../../server/src/saves/revisions';

const origin = 'https://localhost',
  date = '2026-10-05';
const local: Env = {
  ...(env as Env),
  ENVIRONMENT: '手元',
  LOCAL_EMAIL: 'local@example.invalid',
  LOCAL_ROLE: 'first',
};
let generation: string;
function object() {
  return local.ORGANIZATION.get(local.ORGANIZATION.idFromName('organization'));
}
function setup<T>(run: (sql: SqlStorage) => T) {
  return runInDurableObject(object(), (_instance, state) => run(state.storage.sql));
}
beforeEach(async () => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-04T00:00:00Z'));
  const response = await worker.fetch(new Request(`${origin}/api/first-load`), local);
  expect(response.status).toBe(200);
  generation = ((await response.json()) as FirstLoadResponse).dataGeneration!;
  await setup((sql) => {
    const times = {
      first: { slot1: { start: '10:30', end: '16:00' }, slot2: null },
      second: { slot1: { start: '16:15', end: '19:00' }, slot2: null },
    };
    sql.exec(
      `INSERT INTO staff (id, name, sort_order, default_first_facility, default_second_facility, default_work_times, employment_status, revision)
      VALUES ('staff-1', '担当者', 0, 'A', 'C', ?, 'active', 5)`,
      JSON.stringify({ normal: times, peak: times, saturday: null }),
    );
    for (const since of ['initial', 'pending'])
      sql.exec(
        `INSERT INTO staff_history
      (staff_id, since, employment_type, qualification, quarter_hour_pay, budget)
      VALUES ('staff-1', ?, 'full_time', 'none', 250, 1000)`,
        since,
      );
    sql.exec(`INSERT INTO periods (id, name, start_date, end_date, request_deadline_date, request_url_key, revision)
      VALUES ('current', '10月', '2026-10-05', '2026-10-06', '2026-10-04', 'trial-current', 7)`);
    sql.exec('UPDATE backup_state SET data_change_number = 41 WHERE id = 1');
  });
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  await reset();
});

async function save(operation: string, data: unknown): Promise<SaveSuccess> {
  const revisions = await setup((sql) =>
    findOperation(operation)!
      .targets(data as JsonValue)
      .map((target) => {
        const { revision } = readRevision(sql, target);
        return { target, revision };
      }),
  );
  const response = await worker.fetch(
    new Request(`${origin}/api/save`, {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operationId: 'revision-save',
        operation,
        data,
        saveShapeVersion: SAVE_SHAPE_VERSION,
        dataGeneration: generation,
        revisions,
      }),
    }),
    local,
  );
  expect(response.status).toBe(200);
  const result = (await response.json()) as SaveSuccess;
  expect(result.dataChangeNumber).toBe(42);
  for (const row of result.revisions)
    if (row.revision !== null) expect(row.revision).toBe(result.dataChangeNumber);
  return result;
}
async function expectRevisions(
  result: SaveSuccess,
  queries: ReadonlyArray<readonly [string, number]>,
) {
  await setup((sql) => {
    expect(sql.exec('SELECT data_change_number FROM backup_state').one().data_change_number).toBe(
      result.dataChangeNumber,
    );
    for (const [query, count] of queries) {
      const rows = sql.exec(query).toArray();
      expect(rows).toHaveLength(count);
      for (const row of rows) expect(row.revision).toBe(result.dataChangeNumber);
    }
  });
}
function cell(day = date, notes: string | null = null): ShiftCellSaveInput {
  return {
    staff_id: 'staff-1',
    date: day,
    status: 'none',
    roles: [],
    special_care: false,
    notes,
    buildings: [
      {
        building: 1,
        slots: [{ start_time: '10:30', end_time: '16:00', facility: 'A', is_office: false }],
      },
      {
        building: 2,
        slots: [{ start_time: '16:15', end_time: '19:00', facility: 'C', is_office: false }],
      },
    ],
  };
}
function expectCellRevisions(data: ShiftCellChangedData, revision: number) {
  expect(data.dayState?.revision).toBe(revision);
  expect(data.workSlots).toHaveLength(2);
  for (const row of data.workSlots) expect(row.revision).toBe(revision);
}

test('400-2: 1マスの保存で状態・両建物の勤務・備考の更新番号が返事の番号と一致する', async () => {
  const result = await save('shift.cell.save', cell(date, '更新した備考'));
  const data = result.data as unknown as ShiftCellChangedData;
  expectCellRevisions(data, result.dataChangeNumber);
  expect(data.staff).toMatchObject({ notes: '更新した備考', revision: result.dataChangeNumber });
  await expectRevisions(result, [
    ['SELECT revision FROM day_states', 1],
    ['SELECT revision FROM work_slots', 2],
    ['SELECT revision FROM staff', 1],
  ]);
});

test('400-2: 一括入力で全日の状態と勤務の更新番号が返事の番号と一致する', async () => {
  const result = await save('shift.bulk.save', { cells: [cell(), cell('2026-10-06')] });
  const data = result.data as unknown as ShiftBulkChangedData;
  expect(data.cells).toHaveLength(2);
  for (const changed of data.cells) expectCellRevisions(changed, result.dataChangeNumber);
  await expectRevisions(result, [
    ['SELECT revision FROM day_states', 2],
    ['SELECT revision FROM work_slots', 4],
  ]);
});

test('400-2: ピリオドの保存で履歴を移したスタッフと初期入力の更新番号が返事の番号と一致する', async () => {
  const result = await save('period.create', {
    id: 'next',
    name: '次',
    start_date: '2026-10-07',
    end_date: '2026-10-08',
    request_deadline_date: null,
    coverage: [{ facility: 'A', total_required: 2 }],
  });
  const data = result.data as unknown as PeriodsChangedData;
  expect(data.periods.find((row) => row.id === 'next')?.revision).toBe(result.dataChangeNumber);
  expect(data.periods.find((row) => row.id === 'next')?.coverage).toEqual([
    { facility: 'A', total_required: 2 },
  ]);
  const loaded = await worker.fetch(new Request(`${origin}/api/first-load`), local);
  const firstLoad = (await loaded.json()) as FirstLoadResponse;
  expect(firstLoad.periods.find((row) => row.id === 'next')?.coverage).toEqual([
    { facility: 'A', total_required: 2 },
  ]);
  expect(data.staff[0].revision).toBe(result.dataChangeNumber);
  await expectRevisions(result, [
    ["SELECT revision FROM periods WHERE id = 'next'", 1],
    ['SELECT revision FROM staff', 1],
    ['SELECT revision FROM day_states', 2],
    ['SELECT revision FROM work_slots', 4],
  ]);
});

test('400-2: 締め切りでピリオド・希望・状態・勤務の更新番号が返事の番号と一致する', async () => {
  await setup((sql) => {
    sql.exec("UPDATE staff_history SET employment_type = 'casual'");
    sql.exec(
      `INSERT INTO daily_requests (staff_id, date, kind, start_time, end_time, revision)
      VALUES ('staff-1', ?, 'available', '10:00', '12:00', 9)`,
      date,
    );
    sql.exec(
      `INSERT INTO day_states (staff_id, date, status, last_changed_by, last_changed_at, revision)
      VALUES ('staff-1', ?, 'none', 'first', 'before', 10)`,
      date,
    );
    sql.exec(
      `INSERT INTO work_slots (staff_id, date, building, first_start_time, first_end_time, first_facility,
      last_changed_by, last_changed_at, revision) VALUES ('staff-1', ?, 1, '10:30', '16:00', 'A', 'first', 'before', 11)`,
      date,
    );
  });
  const result = await save('period.requests.close', { id: 'current' });
  expect((result.data as unknown as PeriodsChangedData).periods[0].revision).toBe(
    result.dataChangeNumber,
  );
  await expectRevisions(result, [
    ['SELECT revision FROM periods', 1],
    ['SELECT revision FROM daily_requests', 1],
    ['SELECT revision FROM day_states', 1],
    ['SELECT revision FROM work_slots', 1],
  ]);
});

test('400-2: 年間予定の日の保存で営業の行と復元した勤務の更新番号が返事の番号と一致する', async () => {
  await setup((sql) => {
    sql.exec(
      "INSERT INTO facility_days (facility, date, is_open, revision) VALUES ('A', ?, 0, 12), ('B', ?, 0, 13)",
      date,
      date,
    );
  });
  const input: CalendarDaySaveInput = {
    date,
    confirmed: 41,
    buildings: [
      {
        building: 1,
        event: null,
        memo: '営業',
        facilities: [
          { facility: 'A', is_open: true, start_time: '13:30', end_time: '19:00' },
          { facility: 'B', is_open: false, start_time: null, end_time: null },
        ],
      },
    ],
  };
  const result = await save('calendar.day.save', input);
  await expectRevisions(result, [
    ['SELECT revision FROM building_days', 1],
    ['SELECT revision FROM facility_days', 2],
    ['SELECT revision FROM day_states', 1],
    ['SELECT revision FROM work_slots', 1],
  ]);
});
