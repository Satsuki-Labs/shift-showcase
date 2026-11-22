/// <reference types="@cloudflare/workers-types" />
/// <reference types="@cloudflare/vitest-plugin/types" />
import { SAVE_SHAPE_VERSION } from '../../shared/save-shapes';
import { env } from 'cloudflare:workers';
import { reset, runInDurableObject } from 'cloudflare:test';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import worker, { type Env } from '../../server/src/index';
import { AppError } from '../../shared/app-error';
import type {
  JsonValue,
  RevisionTarget,
  SaveConflictResponse,
  SaveRequest,
  SaveSuccess,
} from '../../shared/protocol';
import type { SaveOperation } from '../../server/src/saves/operations';

const { fakeOperations } = vi.hoisted(() => ({ fakeOperations: new Map<string, SaveOperation>() }));
vi.mock('../../shared/save-shapes', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../shared/save-shapes')>();
  return {
    ...actual,
    validateSaveShape(operation: string, data: unknown) {
      if (!fakeOperations.has(operation)) actual.validateSaveShape(operation, data);
    },
  };
});
vi.mock('../../server/src/saves/operations', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/src/saves/operations')>();
  return {
    ...actual,
    findOperation(name: string) {
      return fakeOperations.get(name) ?? actual.findOperation(name);
    },
  };
});

const origin = 'https://localhost';
const local: Env = {
  ...(env as Env),
  ENVIRONMENT: '手元',
  LOCAL_EMAIL: 'local@example.invalid',
  LOCAL_ROLE: 'first',
};
let generation: string;
let failAfterFirstWrite = false;
type Update = { id: string; notes: string };
function updates(data: JsonValue): Update[] {
  const list = (data as { updates?: unknown })?.updates;
  if (!Array.isArray(list) || list.length === 0) throw new AppError('E-32', 'updates');
  for (const item of list) {
    if (!item || typeof item.id !== 'string' || !item.id) throw new AppError('E-32', 'id');
    if (typeof item.notes !== 'string') throw new AppError('E-32', 'notes');
  }
  return list as Update[];
}
function target(id: string): RevisionTarget {
  return { unit: 'staff', id };
}
function object() {
  const namespace = local.ORGANIZATION;
  return namespace.get(namespace.idFromName('organization'));
}
beforeEach(async () => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  failAfterFirstWrite = false;
  fakeOperations.set('test.update', {
    validate(data) {
      updates(data);
    },
    targets(data) {
      return updates(data).map((item) => target(item.id));
    },
    write({ sql }, data) {
      const list = updates(data);
      for (const item of list) {
        sql.exec('UPDATE staff SET notes = ? WHERE id = ?', item.notes, item.id);
        if (failAfterFirstWrite) throw new Error('Private database details');
      }
      return {
        staff: list.map((item) =>
          sql
            .exec<{ id: string; notes: string }>(
              'SELECT id, notes FROM staff WHERE id = ?',
              item.id,
            )
            .one(),
        ),
      };
    },
  });
  generation = await runInDurableObject(object(), (_instance, state) => {
    state.storage.sql.exec(
      "INSERT INTO staff (id, name, notes, sort_order, default_first_facility, default_second_facility, employment_status) VALUES ('staff-1', 'Test 1', 'original-1', 0, 'A', 'C', 'active'), ('staff-2', 'Test 2', 'original-2', 1, 'A', 'C', 'active')",
    );
    return state.storage.sql
      .exec<{ generation: string }>('SELECT generation FROM data_version')
      .one().generation;
  });
});
afterEach(async () => {
  fakeOperations.clear();
  vi.restoreAllMocks();
  vi.useRealTimers();
  await reset();
});
function save(
  operationId = 'save-1',
  list: Update[] = [{ id: 'staff-1', notes: 'saved-note' }],
): SaveRequest {
  return {
    operationId,
    operation: 'test.update',
    saveShapeVersion: SAVE_SHAPE_VERSION,
    dataGeneration: generation,
    revisions: list.map((item) => ({ target: target(item.id), revision: 1 })),
    data: { updates: list },
  };
}
function send(body: unknown): Promise<Response> {
  return worker.fetch(
    new Request(`${origin}/api/save`, {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    local,
  );
}
function savedState() {
  return runInDurableObject(object(), (_instance, state) => ({
    staff: state.storage.sql.exec('SELECT * FROM staff ORDER BY id').toArray(),
    receipts: state.storage.sql
      .exec(
        'SELECT operation_id, result, received_at FROM operation_receipts ORDER BY operation_id',
      )
      .toArray(),
    changeNumber: state.storage.sql.exec('SELECT data_change_number FROM backup_state').one()
      .data_change_number,
    generation: state.storage.sql.exec('SELECT generation FROM data_version').one().generation,
    snapshots: state.storage.sql
      .exec('SELECT * FROM period_snapshots ORDER BY period_id')
      .toArray(),
  }));
}
async function error(response: Response, code: string, status: number, field?: string) {
  expect(response.status).toBe(status);
  expect(await response.json()).toEqual({
    code,
    requestId: response.headers.get('X-Request-Id'),
    ...(field ? { field } : {}),
  });
}

test('successful save returns new revisions and changed data and advances the change number once', async () => {
  const response = await send(save());
  expect(response.status).toBe(200);
  const result = (await response.json()) as SaveSuccess;
  expect(result).toEqual({
    ok: true,
    revisions: [{ target: target('staff-1'), revision: result.dataChangeNumber }],
    data: { staff: [{ id: 'staff-1', notes: 'saved-note' }] },
    dataChangeNumber: 2,
  });
  expect(response.headers.get('X-Data-Generation')).toBe(generation);
  expect(response.headers.get('X-App-Version')).toBe('test-build');
  expect(response.headers.get('X-Request-Id')).toMatch(/^[0-9a-f-]{36}$/);
  const state = await savedState();
  expect(state.changeNumber).toBe(result.dataChangeNumber);
  expect(state.staff[0]).toMatchObject({ notes: 'saved-note', revision: result.dataChangeNumber });
  expect(state.receipts).toEqual([
    {
      operation_id: 'save-1',
      result: JSON.stringify(result),
      received_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T.*Z$/),
    },
  ]);
  await runInDurableObject(object(), (_instance, state) => {
    expect(
      state.storage.sql.exec('SELECT content_summary FROM operation_receipts').one()
        .content_summary,
    ).not.toContain('saved-note');
  });
});

test('135-1: 保存後のsetAlarmが失敗しても成功を返し、保存とE-92の記録が残る', async () => {
  await runInDurableObject(object(), async (instance, state) => {
    const sql = state.storage.sql;
    sql.exec('DELETE FROM scheduled_tasks');
    sql.exec(
      "INSERT INTO scheduled_tasks (task, scheduled_at) VALUES ('clean-receipts', '2099-01-01T00:00:00.000Z')",
    );
    const before = sql.exec('SELECT COUNT(*) AS count FROM fatal_errors').one().count;
    const setAlarm = vi
      .spyOn(state.storage, 'setAlarm')
      .mockRejectedValueOnce(new Error('Alarm unavailable'));
    const result = await instance.handle(
      new Request(`${origin}/api/save`, {
        method: 'POST',
        headers: { Origin: origin, 'Content-Type': 'application/json' },
        body: JSON.stringify(save()),
      }),
      { email: local.LOCAL_EMAIL!, role: 'first' },
      crypto.randomUUID(),
    );
    expect(setAlarm).toHaveBeenCalledTimes(1);
    expect(result.status).toBe(200);
    const saved = result.body as SaveSuccess;
    expect(saved).toEqual({
      ok: true,
      revisions: [{ target: target('staff-1'), revision: saved.dataChangeNumber }],
      data: { staff: [{ id: 'staff-1', notes: 'saved-note' }] },
      dataChangeNumber: 2,
    });
    expect(sql.exec("SELECT notes, revision FROM staff WHERE id = 'staff-1'").one()).toEqual({
      notes: 'saved-note',
      revision: saved.dataChangeNumber,
    });
    expect(sql.exec('SELECT result FROM operation_receipts').one().result).toBe(
      JSON.stringify(result.body),
    );
    expect(sql.exec('SELECT COUNT(*) AS count FROM fatal_errors').one().count).toBe(
      Number(before) + 1,
    );
    expect(
      sql.exec('SELECT code, account, operation FROM fatal_errors ORDER BY id DESC LIMIT 1').one(),
    ).toEqual({ code: 'E-92', account: 'first', operation: 'align-alarm' });
  });
});

test('replaying the same operation and content returns the first result without saving again', async () => {
  const first = await (await send(save())).json();
  const before = await savedState();
  const response = await send(save());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(first);
  expect(await savedState()).toEqual(before);
});

test('different content under the same operation ID is E-34 and leaves saved state unchanged', async () => {
  await send(save());
  const before = await savedState();
  await error(
    await send(save('save-1', [{ id: 'staff-1', notes: 'different-note' }])),
    'E-34',
    409,
  );
  expect(await savedState()).toEqual(before);
});

test('stale revisions return E-33 with the other saved content and reject the entire multi-target save', async () => {
  await runInDurableObject(object(), (_instance, state) => {
    state.storage.sql.exec(
      "UPDATE staff SET notes = 'other-person-note', revision = 2 WHERE id = 'staff-2'",
    );
  });
  const before = await savedState();
  for (const list of [
    [{ id: 'staff-2', notes: 'mine' }],
    [
      { id: 'staff-1', notes: 'mine-1' },
      { id: 'staff-2', notes: 'mine-2' },
    ],
  ]) {
    const response = await send(save('conflict', list));
    expect(response.status).toBe(409);
    expect((await response.json()) as SaveConflictResponse).toEqual({
      code: 'E-33',
      requestId: response.headers.get('X-Request-Id'),
      conflicts: [
        {
          target: target('staff-2'),
          revision: 2,
          data: expect.objectContaining({ id: 'staff-2', notes: 'other-person-note', revision: 2 }),
        },
      ],
    });
    expect(await savedState()).toEqual(before);
  }
});

test('a failed operation rolls back every write and receipt, and the same ID can be retried from the beginning', async () => {
  await runInDurableObject(object(), (_instance, state) => {
    state.storage.sql.exec(
      "INSERT INTO periods (id, name, start_date, end_date, request_url_key) VALUES ('past', '過去', '2000-07-01', '2000-07-31', 'trial-past')",
    );
    state.storage.sql.exec(
      "INSERT INTO staff_history (staff_id, since, employment_type, qualification, quarter_hour_pay, budget) SELECT id, 'initial', 'full_time', 'none', 250, 1000 FROM staff",
    );
  });
  const input = save('retry', [
    { id: 'staff-1', notes: 'saved-1' },
    { id: 'staff-2', notes: 'saved-2' },
  ]);
  const before = await savedState();
  failAfterFirstWrite = true;
  await error(await send(input), 'E-92', 500);
  expect(await savedState()).toEqual(before);
  failAfterFirstWrite = false;
  const response = await send(input);
  expect(response.status).toBe(200);
  const result = (await response.json()) as SaveSuccess;
  expect(result).toEqual({
    ok: true,
    revisions: [
      { target: target('staff-1'), revision: result.dataChangeNumber },
      { target: target('staff-2'), revision: result.dataChangeNumber },
    ],
    data: {
      staff: [
        { id: 'staff-1', notes: 'saved-1' },
        { id: 'staff-2', notes: 'saved-2' },
      ],
    },
    dataChangeNumber: 2,
  });
  const after = await savedState();
  expect(after.changeNumber).toBe(result.dataChangeNumber);
  expect(after.receipts).toHaveLength(1);
  expect(after.snapshots).toHaveLength(1);
});

test('065-4: 日本の今日で終わるピリオドと未来のピリオドには写しを取らない', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-01T16:00:00Z'));
  await runInDurableObject(object(), (_instance, state) => {
    state.storage.sql
      .exec(`INSERT INTO periods (id, name, start_date, end_date, request_url_key) VALUES
      ('today', '今日まで', '2026-10-01', '2026-10-02', 'trial-today'),
      ('future', '未来', '2026-10-03', '2026-10-31', 'trial-future')`);
  });
  expect((await send(save())).status).toBe(200);
  expect((await savedState()).snapshots).toEqual([]);
});

test('065-5: 終了後の衝突と受付記録から返す送り直しは写しを取らない', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-01T16:00:00Z'));
  await runInDurableObject(object(), (_instance, state) => {
    state.storage.sql.exec(
      "INSERT INTO periods (id, name, start_date, end_date, request_url_key) VALUES ('past', '過去', '2026-10-01', '2026-10-02', 'trial-past')",
    );
  });
  const input = save();
  expect((await send(input)).status).toBe(200);
  vi.setSystemTime(new Date('2026-10-02T16:00:00Z'));
  const conflict = await send({
    ...save('conflict'),
    revisions: [{ target: target('staff-1'), revision: 9 }],
  });
  expect(conflict.status).toBe(409);
  expect(await conflict.json()).toMatchObject({ code: 'E-33' });
  expect((await savedState()).snapshots).toEqual([]);
  expect((await send(input)).status).toBe(200);
  expect((await savedState()).snapshots).toEqual([]);
});

test('a different data generation is E-42 without a save', async () => {
  const before = await savedState();
  const response = await send({ ...save(), dataGeneration: crypto.randomUUID() });
  expect(response.headers.get('X-Data-Generation')).toBe(generation);
  await error(response, 'E-42', 409);
  expect(await savedState()).toEqual(before);
});

test('401-2: a different save shape is E-47 before validation or writes on both save routes', async () => {
  await runInDurableObject(object(), (_instance, state) => {
    state.storage.sql.exec(
      "INSERT INTO periods (id, name, start_date, end_date, request_deadline_date, request_url_key) VALUES ('shape-period', '保存番号', '2099-01-01', '2099-01-31', '2098-12-31', 'trial-shape')",
    );
  });
  const before = await savedState();
  const validate = vi.spyOn(fakeOperations.get('test.update')!, 'validate');
  // Even an operation and payload removed by a later release must get E-47.
  for (const saveShapeVersion of [SAVE_SHAPE_VERSION + 1, SAVE_SHAPE_VERSION + 2]) {
    const response = await send({
      ...save(),
      saveShapeVersion,
      operation: 'removed.operation',
      data: null,
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      code: 'E-47',
      requestId: response.headers.get('X-Request-Id'),
    });
  }
  const response = await worker.fetch(
    new Request(`${origin}/api/request/trial-shape/save`, {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...save(),
        operation: 'request.none.set',
        saveShapeVersion: SAVE_SHAPE_VERSION + 1,
      }),
    }),
    local,
  );
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ code: 'E-47' });
  expect(validate).not.toHaveBeenCalled();
  expect(await savedState()).toEqual(before);
});

test('unknown operations are E-35 and unreadable or incomplete saves are E-36', async () => {
  const before = await savedState();
  await error(await send({ ...save(), operation: 'not.registered' }), 'E-35', 404);
  const { operationId: _operationId, ...withoutId } = save();
  await error(await send(withoutId), 'E-36', 400);
  await error(
    await send({
      ...save('missing-target', [
        { id: 'staff-1', notes: 'one' },
        { id: 'staff-2', notes: 'two' },
      ]),
      revisions: [{ target: target('staff-1'), revision: 1 }],
    }),
    'E-36',
    400,
  );
  await error(
    await worker.fetch(
      new Request(`${origin}/api/save`, {
        method: 'POST',
        headers: { Origin: origin },
        body: '{',
      }),
      local,
    ),
    'E-36',
    400,
  );
  expect(await savedState()).toEqual(before);
});

test('operation input errors return E-32 with the field and leave all saved state unchanged', async () => {
  const before = await savedState();
  await error(
    await send({ ...save(), data: { updates: [{ id: 'staff-1', notes: 42 }] } }),
    'E-32',
    400,
    'notes',
  );
  expect(await savedState()).toEqual(before);
});

test('deleting and recreating a unit gives it a different revision and rejects the old revision', async () => {
  fakeOperations.set('test.delete', {
    validate() {},
    targets() {
      return [target('staff-1')];
    },
    write({ sql }) {
      sql.exec("DELETE FROM staff WHERE id = 'staff-1'");
      return { staff: [] };
    },
  });
  fakeOperations.set('test.recreate', {
    validate() {},
    targets() {
      return [target('staff-1')];
    },
    write({ sql }) {
      sql.exec(
        "INSERT INTO staff (id, name, notes, sort_order, default_first_facility, default_second_facility, employment_status) VALUES ('staff-1', 'Recreated', 'recreated-note', 0, 'A', 'C', 'active')",
      );
      return { staff: [{ id: 'staff-1', notes: 'recreated-note' }] };
    },
  });
  const deleted = await send({ ...save('delete'), operation: 'test.delete' });
  expect(deleted.status).toBe(200);
  const deletedResult = (await deleted.json()) as SaveSuccess;
  expect(deletedResult).toEqual({
    ok: true,
    dataChangeNumber: 2,
    revisions: [{ target: target('staff-1'), revision: null }],
    data: { staff: [] },
  });
  const recreated = await send({
    ...save('recreate'),
    operation: 'test.recreate',
    revisions: [{ target: target('staff-1'), revision: null }],
  });
  expect(recreated.status).toBe(200);
  const recreatedResult = (await recreated.json()) as SaveSuccess;
  expect(recreatedResult).toEqual({
    ok: true,
    dataChangeNumber: deletedResult.dataChangeNumber + 1,
    revisions: [{ target: target('staff-1'), revision: recreatedResult.dataChangeNumber }],
    data: { staff: [{ id: 'staff-1', notes: 'recreated-note' }] },
  });
  const beforeStaleSave = await savedState();
  expect(beforeStaleSave.staff[0]).toMatchObject({
    id: 'staff-1',
    revision: recreatedResult.dataChangeNumber,
  });
  const stale = await send(save('stale'));
  expect(stale.status).toBe(409);
  expect(await stale.json()).toEqual({
    code: 'E-33',
    requestId: stale.headers.get('X-Request-Id'),
    conflicts: [
      {
        target: target('staff-1'),
        revision: recreatedResult.dataChangeNumber,
        data: expect.objectContaining({
          notes: 'recreated-note',
          revision: recreatedResult.dataChangeNumber,
        }),
      },
    ],
  });
  expect(await savedState()).toEqual(beforeStaleSave);
});

test('success uses the next change number for every changed unit and replay returns the original number', async () => {
  await runInDurableObject(object(), (_instance, state) => {
    state.storage.sql.exec('UPDATE backup_state SET data_change_number = 41 WHERE id = 1');
    state.storage.sql.exec("UPDATE staff SET revision = CASE id WHEN 'staff-1' THEN 5 ELSE 7 END");
  });
  const input = {
    ...save('shared-number', [
      { id: 'staff-1', notes: 'saved-1' },
      { id: 'staff-2', notes: 'saved-2' },
    ]),
    revisions: [
      { target: target('staff-1'), revision: 5 },
      { target: target('staff-2'), revision: 7 },
    ],
  };
  const response = await send(input);
  expect(response.status).toBe(200);
  const first = (await response.json()) as SaveSuccess;
  expect(first).toEqual({
    ok: true,
    dataChangeNumber: 42,
    revisions: [
      { target: target('staff-1'), revision: 42 },
      { target: target('staff-2'), revision: 42 },
    ],
    data: {
      staff: [
        { id: 'staff-1', notes: 'saved-1' },
        { id: 'staff-2', notes: 'saved-2' },
      ],
    },
  });
  const saved = await savedState();
  expect(saved.changeNumber).toBe(42);
  expect(saved.staff.map((row) => row.revision)).toEqual([42, 42]);
  const next = await send({
    ...save('next'),
    revisions: [{ target: target('staff-1'), revision: 42 }],
  });
  expect(next.status).toBe(200);
  expect(((await next.json()) as SaveSuccess).dataChangeNumber).toBe(43);
  const beforeReplay = await savedState();
  const replay = await send(input);
  expect(replay.status).toBe(200);
  expect(await replay.json()).toEqual(first);
  expect(await savedState()).toEqual(beforeReplay);
});

test('400-1: 受付が渡した更新番号で、照らす行の外の変更も同じ番号になる', async () => {
  fakeOperations.set('test.related', {
    validate() {},
    targets() {
      return [target('staff-1')];
    },
    write({ sql, revision }) {
      sql.exec("UPDATE staff SET notes = 'related', revision = ? WHERE id = 'staff-2'", revision);
      sql.exec("UPDATE staff SET notes = 'saved' WHERE id = 'staff-1'");
      return null;
    },
  });
  await runInDurableObject(object(), (_instance, state) => {
    state.storage.sql.exec('UPDATE backup_state SET data_change_number = 41 WHERE id = 1');
  });
  const response = await send({ ...save(), operation: 'test.related', data: null });
  expect(response.status).toBe(200);
  const result = (await response.json()) as SaveSuccess;
  expect(result.dataChangeNumber).toBe(42);
  expect(result.revisions).toEqual([
    { target: target('staff-1'), revision: result.dataChangeNumber },
  ]);
  expect((await savedState()).staff.map((row) => row.revision)).toEqual([
    result.dataChangeNumber,
    result.dataChangeNumber,
  ]);
});
