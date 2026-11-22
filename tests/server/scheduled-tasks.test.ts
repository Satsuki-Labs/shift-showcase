/// <reference types="@cloudflare/workers-types" />
/// <reference types="@cloudflare/vitest-plugin/types" />
import { SAVE_SHAPE_VERSION } from '../../shared/save-shapes';
import { env } from 'cloudflare:workers';
import {
  abortAllDurableObjects,
  reset,
  runDurableObjectAlarm,
  runInDurableObject,
} from 'cloudflare:test';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import worker, { type Env } from '../../server/src/index';
import type { PeriodSaveInput, SaveSuccess } from '../../shared/protocol';

const origin = 'https://localhost';
const local: Env = {
  ...(env as Env),
  ENVIRONMENT: '手元',
  LOCAL_EMAIL: 'local@example.invalid',
  LOCAL_ROLE: 'first',
};
const now = '2026-10-20T14:00:00.000Z'; // 日本の10月20日23時。
const closeTime = '2026-10-20T15:00:00.000Z';
const cleanupTime = '2026-10-20T18:00:00.000Z';
let generation: string, serial: number, revision: number | null;
function object() {
  return local.ORGANIZATION.get(local.ORGANIZATION.idFromName('organization'));
}
function input(deadline: string | null = '2026-10-20'): PeriodSaveInput {
  return {
    id: 'period',
    name: '11月前半',
    start_date: '2026-11-01',
    end_date: '2026-11-15',
    request_deadline_date: deadline,
    coverage: [],
  };
}
function setup(write: (sql: SqlStorage) => void) {
  return runInDurableObject(object(), (_instance, state) => {
    write(state.storage.sql);
  });
}
async function save(
  operation: string,
  data: PeriodSaveInput | { id: string } = { id: 'period' },
): Promise<SaveSuccess> {
  const response = await worker.fetch(
    new Request(`${origin}/api/save`, {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operationId: `scheduled-${++serial}`,
        operation,
        data,
        saveShapeVersion: SAVE_SHAPE_VERSION,
        dataGeneration: generation,
        revisions: [{ target: { unit: 'period', id: 'period' }, revision }],
      }),
    }),
    local,
  );
  expect(response.status).toBe(200);
  const result = (await response.json()) as SaveSuccess;
  expect(result.ok).toBe(true);
  revision = result.revisions[0].revision;
  return result;
}
function snapshot() {
  return runInDurableObject(object(), async (_instance, state) => ({
    tasks: state.storage.sql
      .exec<{ task: string; scheduled_at: string }>(
        'SELECT * FROM scheduled_tasks ORDER BY scheduled_at, task',
      )
      .toArray(),
    alarm: await state.storage.getAlarm(),
    period: state.storage.sql
      .exec('SELECT requests_closed_at, revision FROM periods WHERE id = ?', 'period')
      .toArray()[0],
    days: state.storage.sql
      .exec('SELECT staff_id, date, status, revision FROM day_states ORDER BY date, staff_id')
      .toArray(),
    number: state.storage.sql.exec('SELECT data_change_number FROM backup_state WHERE id = 1').one()
      .data_change_number,
    receipts: state.storage.sql
      .exec('SELECT operation_id FROM operation_receipts ORDER BY operation_id')
      .toArray(),
  }));
}
beforeEach(async () => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  // Discover storage before freezing Date, without scheduling past alarms in workerd.
  const probe = local.ORGANIZATION.get(local.ORGANIZATION.idFromName('alarm-storage'));
  await runInDurableObject(probe, async (_instance, state) => {
    await state.storage.deleteAlarm();
    const prototype: DurableObjectStorage = Object.getPrototypeOf(state.storage);
    let alarm: number | null = null;
    // The single organization keeps its alarm here, including across object restarts.
    // Prototype mocks cover constructor calls and saves sent through worker.fetch.
    vi.spyOn(prototype, 'setAlarm').mockImplementation(async (time) => {
      alarm = typeof time === 'number' ? time : time.getTime();
    });
    vi.spyOn(prototype, 'getAlarm').mockImplementation(async () => alarm);
    vi.spyOn(prototype, 'deleteAlarm').mockImplementation(async () => {
      alarm = null;
    });
  });
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(now));
  serial = 0;
  revision = null;
  generation = await runInDurableObject(
    object(),
    (_instance, state) =>
      state.storage.sql.exec<{ generation: string }>('SELECT generation FROM data_version').one()
        .generation,
  );
});
afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await reset();
});

test('073-1: 作成・締め切り変更で予定とアラームを合わせ、期限の解除・削除で予定を消す', async () => {
  await save('period.create', input());
  let value = await snapshot();
  expect(value.tasks).toContainEqual({ task: 'close-requests:period', scheduled_at: closeTime });
  expect(value.alarm).toBe(Date.parse(closeTime));
  await save('period.update', input('2026-10-19'));
  value = await snapshot();
  expect(value.tasks).toContainEqual({
    task: 'close-requests:period',
    scheduled_at: '2026-10-19T15:00:00.000Z',
  });
  expect(value.alarm).toBe(Date.parse('2026-10-19T15:00:00.000Z'));
  await save('period.update', input(null));
  value = await snapshot();
  expect(value.tasks).toEqual([
    { task: 'clean-receipts', scheduled_at: cleanupTime },
    { task: 'nightly-backup', scheduled_at: cleanupTime },
    { task: 'nightly-mail', scheduled_at: cleanupTime },
  ]);
  expect(value.alarm).toBe(Date.parse(cleanupTime));
  await save('period.update', input());
  await save('period.delete');
  value = await snapshot();
  expect(value.tasks).toEqual([
    { task: 'clean-receipts', scheduled_at: cleanupTime },
    { task: 'nightly-backup', scheduled_at: cleanupTime },
    { task: 'nightly-mail', scheduled_at: cleanupTime },
  ]);
  expect(value.alarm).toBe(Date.parse(cleanupTime));
});

test('073-2: 期限後のアラームで受付を閉じ、常勤の平日の終日希望を有給にして変更番号を1つ進める', async () => {
  const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  await save('period.create', input());
  await setup((sql) => {
    sql.exec(
      "INSERT INTO staff (id, name, sort_order, default_first_facility, default_second_facility, employment_status) VALUES ('full', '常勤', 0, 'A', 'C', 'active')",
    );
    sql.exec(
      "INSERT INTO staff_history (staff_id, since, employment_type, qualification, quarter_hour_pay, budget) VALUES ('full', 'initial', 'full_time', 'none', 250, 1000)",
    );
    sql.exec(`INSERT INTO opening_rules (fiscal_year, facility, normal_start_time, normal_end_time,
      peak_start_time, peak_end_time, saturday_start_time, saturday_end_time, arrival_end_mode, arrival_end_time)
      SELECT 2026, value, '09:00', '18:00', '09:00', '18:00', '09:00', '18:00', 'fixed_time', '18:00'
      FROM json_each('["A","B","C","D"]')`);
    sql.exec(
      "INSERT INTO daily_requests (staff_id, date, kind, memo) VALUES ('full', '2026-11-02', 'unavailable', '')",
    );
  });
  const before = await snapshot();
  vi.setSystemTime(new Date(closeTime));
  expect(await runDurableObjectAlarm(object())).toBe(true);
  const after = await snapshot();
  expect(after.period).toEqual({
    requests_closed_at: closeTime,
    revision: Number(before.number) + 1,
  });
  expect(after.days).toEqual([
    {
      staff_id: 'full',
      date: '2026-11-02',
      status: 'paid_leave',
      revision: Number(before.number) + 1,
    },
  ]);
  expect(after.number).toBe(Number(before.number) + 1);
  expect(after.tasks).toEqual([
    { task: 'clean-receipts', scheduled_at: cleanupTime },
    { task: 'nightly-backup', scheduled_at: cleanupTime },
    { task: 'nightly-mail', scheduled_at: cleanupTime },
  ]);
  expect(after.alarm).toBe(Date.parse(cleanupTime));
  const logs = logSpy.mock.calls
    .map(([line]) => JSON.parse(String(line)))
    .filter((row) => row.entrance === 'alarm');
  expect(logs).toEqual([
    {
      timestamp: closeTime,
      entrance: 'alarm',
      operation: 'close-requests',
      result: 'success',
      durationMs: expect.any(Number),
    },
  ]);
});

test('135-3: 1件目の締め切りが失敗しても2件目と掃除を行い、失敗は1時間後の予定とE-92に残る', async () => {
  const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  await save('period.create', input());
  await setup((sql) => {
    sql.exec(`INSERT INTO periods (id, name, start_date, end_date, request_deadline_date, request_url_key)
      VALUES ('period-2', '11月後半', '2026-11-16', '2026-11-30', '2026-10-20', 'test-period-2')`);
    sql.exec(
      'INSERT INTO scheduled_tasks (task, scheduled_at) VALUES (?, ?)',
      'close-requests:period-2',
      closeTime,
    );
    sql.exec(`INSERT INTO staff (id, name, sort_order, default_first_facility, default_second_facility, employment_status) VALUES
      ('broken', '履歴なし', 0, 'A', 'C', 'active'), ('full', '常勤', 1, 'A', 'C', 'active')`);
    sql.exec(
      `INSERT INTO staff_history (staff_id, since, employment_type, qualification, quarter_hour_pay, budget) VALUES ('full', 'initial', 'full_time', 'none', 250, 1000)`,
    );
    sql.exec(`INSERT INTO opening_rules (fiscal_year, facility, normal_start_time, normal_end_time,
      peak_start_time, peak_end_time, saturday_start_time, saturday_end_time, arrival_end_mode, arrival_end_time)
      SELECT 2026, value, '09:00', '18:00', '09:00', '18:00', '09:00', '18:00', 'fixed_time', '18:00'
      FROM json_each('["A","B","C","D"]')`);
    sql.exec(`INSERT INTO daily_requests (staff_id, date, kind)
      VALUES ('broken', '2026-11-02', 'unavailable'), ('full', '2026-11-16', 'unavailable')`);
    for (const days of [91, 89])
      sql.exec(
        'INSERT INTO operation_receipts (operation_id, content_summary, result, received_at) VALUES (?, ?, ?, ?)',
        `receipt-${days}`,
        'summary',
        '{}',
        new Date(Date.parse(cleanupTime) - days * 24 * 60 * 60 * 1000).toISOString(),
      );
  });
  const before = await snapshot();
  vi.setSystemTime(new Date(cleanupTime));
  expect(await runDurableObjectAlarm(object())).toBe(true);
  const after = await snapshot();
  const retryTime = '2026-10-20T19:00:00.000Z';
  expect(after.period).toEqual(before.period);
  expect(after.number).toBe(Number(before.number) + 1);
  expect(after.days).toEqual([
    {
      staff_id: 'full',
      date: '2026-11-16',
      status: 'paid_leave',
      revision: Number(before.number) + 1,
    },
  ]);
  expect(after.receipts).toEqual([{ operation_id: 'receipt-89' }, { operation_id: 'scheduled-1' }]);
  expect(after.tasks).toEqual([
    { task: 'close-requests:period', scheduled_at: retryTime },
    { task: 'clean-receipts', scheduled_at: '2026-10-21T18:00:00.000Z' },
    { task: 'nightly-backup', scheduled_at: '2026-10-21T18:00:00.000Z' },
    { task: 'nightly-mail', scheduled_at: '2026-10-21T18:00:00.000Z' },
  ]);
  expect(after.alarm).toBe(Date.parse(retryTime));
  await runInDurableObject(object(), (_instance, state) => {
    expect(
      state.storage.sql
        .exec("SELECT requests_closed_at, revision FROM periods WHERE id = 'period-2'")
        .one(),
    ).toEqual({ requests_closed_at: cleanupTime, revision: Number(before.number) + 1 });
    // Nightly mail may fail without GAS settings; this test checks deadline failures.
    expect(
      state.storage.sql
        .exec('SELECT code, account, operation FROM fatal_errors')
        .toArray()
        .filter((row) => row.operation !== 'alarm:nightly-mail'),
    ).toEqual([{ code: 'E-92', account: null, operation: 'alarm:close-requests:period' }]);
  });
  const logs = logSpy.mock.calls
    .map(([line]) => JSON.parse(String(line)))
    .filter(
      (row) =>
        row.entrance === 'alarm' && !['nightly-backup', 'nightly-mail'].includes(row.operation),
    );
  expect(logs.map(({ operation, result }) => ({ operation, result }))).toEqual([
    { operation: 'close-requests', result: 'failure' },
    { operation: 'close-requests', result: 'success' },
    { operation: 'clean-receipts', result: 'success' },
  ]);
});

test('073-3: 今すぐ締め切ると予定が消え、閉じたピリオドの残った予定は何も変えない', async () => {
  await save('period.create', input());
  await save('period.requests.close');
  const before = await snapshot();
  expect(before.tasks).toEqual([
    { task: 'clean-receipts', scheduled_at: cleanupTime },
    { task: 'nightly-backup', scheduled_at: cleanupTime },
    { task: 'nightly-mail', scheduled_at: cleanupTime },
  ]);
  await runInDurableObject(object(), async (_instance, state) => {
    state.storage.sql.exec(
      'INSERT INTO scheduled_tasks (task, scheduled_at) VALUES (?, ?)',
      'close-requests:period',
      closeTime,
    );
    await state.storage.setAlarm(Date.parse(closeTime));
  });
  vi.setSystemTime(new Date(closeTime));
  expect(await runDurableObjectAlarm(object())).toBe(true);
  expect(await snapshot()).toEqual(before);
});

test('073-4: 期限が延びていたら締め切らず、予定を正しい時刻に入れ直す', async () => {
  await save('period.create', input());
  await setup((sql) => {
    sql.exec("UPDATE periods SET request_deadline_date = '2026-10-22' WHERE id = 'period'");
  });
  const before = await snapshot();
  vi.setSystemTime(new Date(closeTime));
  expect(await runDurableObjectAlarm(object())).toBe(true);
  const after = await snapshot();
  expect(after.period).toEqual(before.period);
  expect(after.number).toBe(before.number);
  expect(after.tasks).toEqual([
    { task: 'clean-receipts', scheduled_at: cleanupTime },
    { task: 'nightly-backup', scheduled_at: cleanupTime },
    { task: 'nightly-mail', scheduled_at: cleanupTime },
    { task: 'close-requests:period', scheduled_at: '2026-10-22T15:00:00.000Z' },
  ]);
  expect(after.alarm).toBe(Date.parse(cleanupTime));
});

test('073-5: 91日前の受付記録を消し、89日前の記録を残して翌日の日本3時に予定を入れ直す', async () => {
  await setup((sql) => {
    for (const days of [91, 89])
      sql.exec(
        'INSERT INTO operation_receipts (operation_id, content_summary, result, received_at) VALUES (?, ?, ?, ?)',
        `receipt-${days}`,
        'summary',
        '{}',
        new Date(Date.parse(cleanupTime) - days * 24 * 60 * 60 * 1000).toISOString(),
      );
  });
  vi.setSystemTime(new Date(cleanupTime));
  expect(await runDurableObjectAlarm(object())).toBe(true);
  const after = await snapshot();
  expect(after.receipts).toEqual([{ operation_id: 'receipt-89' }]);
  expect(after.tasks).toEqual([
    { task: 'clean-receipts', scheduled_at: '2026-10-21T18:00:00.000Z' },
    { task: 'nightly-backup', scheduled_at: '2026-10-21T18:00:00.000Z' },
    { task: 'nightly-mail', scheduled_at: '2026-10-21T18:00:00.000Z' },
  ]);
  expect(after.alarm).toBe(Date.parse('2026-10-21T18:00:00.000Z'));
});

test('073-6: 起き直すと足りない締め切り・清掃予定を入れ、一番早い予定にアラームを合わせる', async () => {
  await save('period.create', input());
  await runInDurableObject(object(), async (_instance, state) => {
    state.storage.sql.exec('DELETE FROM scheduled_tasks');
    state.storage.sql.exec(
      `INSERT INTO periods (id, name, start_date, end_date, request_deadline_date, request_url_key, requests_closed_at)
      VALUES ('closed', '締め切り済み', '2026-12-01', '2026-12-15', '2026-11-20', 'test-closed', ?),
      ('no-deadline', '未定', '2026-12-16', '2026-12-31', NULL, 'test-no-deadline', NULL)`,
      now,
    );
    await state.storage.deleteAlarm();
  });
  await abortAllDurableObjects();
  const after = await snapshot();
  expect(after.tasks).toEqual([
    { task: 'close-requests:period', scheduled_at: closeTime },
    { task: 'clean-receipts', scheduled_at: cleanupTime },
    { task: 'nightly-backup', scheduled_at: cleanupTime },
    { task: 'nightly-mail', scheduled_at: cleanupTime },
  ]);
  expect(after.alarm).toBe(Date.parse(closeTime));
});
