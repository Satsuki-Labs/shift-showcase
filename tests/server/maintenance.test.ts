/// <reference types="@cloudflare/workers-types" />
/// <reference types="@cloudflare/vitest-plugin/types" />
import { SAVE_SHAPE_VERSION } from '../../shared/save-shapes';
import { env } from 'cloudflare:workers';
import { abortAllDurableObjects, reset, runInDurableObject } from 'cloudflare:test';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { gzipSync, gunzipSync, strFromU8, strToU8 } from 'fflate';
import worker, { type Env } from '../../server/src/index';
import { createBackup, INCLUDED_TABLES } from '../../server/src/backup/file';
import { receiveImport } from '../../server/src/maintenance/import';
import { operationOf, respond } from '../../server/src/entrance/response';
import type { Identity } from '../../shared/protocol';

const origin = 'https://localhost';
const now = new Date('2026-10-16T09:00:00.000Z');
const identity: Identity = { email: 'maintenance@example.invalid', role: 'maintenance' };
const mark = '0000007b-0000b26e-00001538-0c3e87bb37b3db5cc52eedb93cd3b96b';
const idA = '00000000-0000-4000-8000-000000000001',
  idB = '00000000-0000-4000-8000-000000000002';
function stub(name = 'maintenance') {
  const ns = (env as Env).ORGANIZATION;
  return ns.get(ns.idFromName(name));
}
function request(action: string, body: unknown = {}, id = idA, sentOrigin = origin) {
  return new Request(`${origin}/api/maintenance/${action}?id=${id}`, {
    method: 'POST',
    headers: { Origin: sentOrigin },
    body: body instanceof Uint8Array ? body : JSON.stringify(body),
  });
}
function snapshot(storage: DurableObjectStorage) {
  const names = [
    ...INCLUDED_TABLES,
    'data_version',
    'backup_state',
    'mail_state',
    'scheduled_tasks',
    'operation_receipts',
  ];
  return Object.fromEntries(
    names.map((table) => [
      table,
      storage.sql.exec(`SELECT * FROM "${table}" ORDER BY rowid`).toArray(),
    ]),
  );
}
function seed(storage: DurableObjectStorage) {
  const sql = storage.sql,
    pair = { slot1: null, slot2: null };
  const times = {
    normal: { first: pair, second: pair },
    peak: { first: pair, second: pair },
    saturday: null,
  };
  sql.exec(
    "INSERT INTO staff (id, name, sort_order, default_first_facility, default_second_facility, default_work_times, employment_status, retirement_date) VALUES ('s', '試験', 0, 'A', 'C', ?, 'retired', '2026-10-10')",
    JSON.stringify(times),
  );
  sql.exec("INSERT INTO staff_history VALUES ('s', 'initial', 250, 'full_time', 'none', 100000)");
  sql.exec(
    "INSERT INTO periods (id, name, start_date, end_date, request_deadline_date, request_url_key) VALUES ('p', '試験', '2026-10-01', '2026-10-31', '2026-10-20', 'p')",
  );
  sql.exec("INSERT INTO coverage_requirements VALUES ('p', 'A', 3)");
  sql.exec(
    "INSERT INTO day_states (staff_id, date, status, last_changed_by, last_changed_at) VALUES ('s', '2026-10-01', 'none', 'first', 'now')",
  );
  sql.exec(
    "INSERT INTO work_slots (staff_id, date, building, first_start_time, first_end_time, first_facility, last_changed_by, last_changed_at) VALUES ('s', '2026-10-01', 1, '09:00', '12:00', 'A', 'first', 'now'), ('s', '2026-10-01', 2, '13:00', '17:00', 'C', 'second', 'now')",
  );
  sql.exec(
    "INSERT INTO daily_requests (staff_id, date, kind) VALUES ('s', '2026-10-01', 'unavailable')",
  );
  sql.exec("INSERT INTO facility_days VALUES ('A', '2026-10-01', 1, '09:00', '19:00', 1)");
  sql.exec(
    "INSERT INTO building_days VALUES (1, '2026-10-01', ?, 1)",
    JSON.stringify([
      { kind: 'event', content: '研修', arrival_time: '14:00' },
      { kind: 'memo', content: '連絡' },
    ]),
  );
  sql.exec(
    "INSERT INTO peaks (start_date, end_date, name) VALUES ('2026-12-01', '2026-12-31', '年末の繁忙期')",
  );
  sql.exec(
    `INSERT INTO period_snapshots (period_id, staff, annual_closures, captured_at) VALUES ('p', ?, '[]', 'now')`,
    JSON.stringify([
      {
        id: 'past-person',
        name: '過去の人',
        notes: '',
        sort_order: 0,
        revision: 1,
        in_use: true,
        default_first_facility: null,
        default_second_facility: 'D',
        default_work_times: times,
        default_roles: [],
        employment_status: 'active',
        leave_start_date: null,
        leave_expected_end_date: null,
        retirement_date: null,
        history: [
          {
            staff_id: 'past-person',
            since: 'initial',
            quarter_hour_pay: 300,
            employment_type: 'part_time',
            qualification: 'assistant',
            budget: 50000,
          },
        ],
      },
    ]),
  );
  sql.exec(
    "INSERT INTO distributed_sheets VALUES ('p', 'first', 'now', ?)",
    JSON.stringify({ removed: { '2020-01-01': '以前の人' } }),
  );
  sql.exec("UPDATE contact_names SET name = CASE site WHEN 'first' THEN '担当A' ELSE '担当B' END");
  sql.exec('UPDATE backup_state SET data_change_number = 9');
  sql.exec("UPDATE opening_rules SET normal_start_time = '14:00'");
  sql.exec("DELETE FROM annual_closures WHERE name = 'GW'");
}
async function file() {
  return runInDurableObject(stub('source'), (_instance, state) => {
    seed(state.storage);
    const file = createBackup(state.storage.sql, now);
    const bytes = new Uint8Array(file.compressedBytes);
    let offset = 0;
    for (const chunk of file.chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return bytes;
  });
}
function mutate(bytes: Uint8Array, edit: (lines: any[]) => void) {
  const lines = strFromU8(gunzipSync(bytes))
    .trimEnd()
    .split('\n')
    .map((line) => JSON.parse(line));
  edit(lines);
  return gzipSync(strToU8(lines.map((line) => JSON.stringify(line)).join('\n') + '\n'));
}
function editRow(lines: any[], table: string, column: string, value: unknown) {
  const index = lines.findIndex((line) => line.table === table);
  lines[index + 1][lines[index].columns.indexOf(column)] = value;
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(now);
});
afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await reset();
});

test('ふだんの認証とOriginを通り、担当者には保守操作を許さない', async () => {
  const config: Env = {
    ...(env as Env),
    ENVIRONMENT: '手元',
    LOCAL_EMAIL: identity.email,
    LOCAL_ROLE: 'first',
  };
  for (const role of ['first', 'second'] as const) {
    const before = await runInDurableObject(stub(), (_instance, state) => snapshot(state.storage));
    for (const action of ['restore-prepare', 'restart', 'restore-finish', 'import']) {
      const result = await stub().handle(request(action), { ...identity, role }, 'test');
      expect(result.result).toBe('E-35');
      expect(operationOf(request(action))).toBe(`maintenance-${action}`);
    }
    await runInDurableObject(stub(), (_instance, state) =>
      expect(snapshot(state.storage)).toEqual(before),
    );
  }
  const denied = await worker.fetch(
    request('restore-prepare', {}, idA, 'https://other.invalid'),
    config,
  );
  expect(await denied.json()).toMatchObject({ code: 'E-26' });
});

test('削除した入口とbookmarkを含む予約は既存の不正要求として断り、データを変えない', async () => {
  await runInDurableObject(stub(), async (instance, state) => {
    const before = snapshot(state.storage);
    const time = vi.spyOn(state.storage, 'getBookmarkForTime');
    const prepare = vi.spyOn(state.storage, 'onNextSessionRestoreBookmark');
    const removed = await instance.handle(request('bookmark'), identity, 'test');
    expect(operationOf(request('bookmark'))).toBe('unknown');
    expect(removed.result).toBe('E-35');
    expect(respond(removed, 'test').status).toBe(404);
    for (const bookmark of [mark, '', null, 123]) {
      for (const target of [{ bookmark }, { bookmark, at: '2026-10-16 10:30:37' }]) {
        const result = await instance.handle(
          request('restore-prepare', { id: idA, ...target }),
          identity,
          'test',
        );
        expect(result.body).toMatchObject({ code: 'E-32', field: 'bookmark' });
        expect(respond(result, 'test').status).toBe(400);
      }
    }
    expect(time).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
    expect(snapshot(state.storage)).toEqual(before);
  });
});

test.each(['2026-10-16 10:30:37', '2026-10-16 10:30'])(
  '日本時間%sを予約して秒を保ち、応答には戻す前の時刻だけを返す',
  async (at) => {
    await runInDurableObject(stub(), async (instance, state) => {
      const time = vi.spyOn(state.storage, 'getBookmarkForTime').mockResolvedValue(mark);
      const prepare = vi
        .spyOn(state.storage, 'onNextSessionRestoreBookmark')
        .mockResolvedValue(mark);
      const result = await instance.handle(
        request('restore-prepare', { id: idA, at }),
        identity,
        'test',
      );
      expect(result.body).toEqual({ at: now.toISOString() });
      expect(time).toHaveBeenCalledWith(
        new Date('2026-10-16T01:30:' + (at.length === 19 ? '37' : '00') + '.000Z'),
      );
      expect(prepare).toHaveBeenCalledWith(mark);
    });
  },
);

test('不正な日時と30日より前や未来の予約はデータを変えずに断る', async () => {
  await runInDurableObject(stub(), async (instance, state) => {
    const before = snapshot(state.storage);
    const time = vi.spyOn(state.storage, 'getBookmarkForTime');
    const prepare = vi.spyOn(state.storage, 'onNextSessionRestoreBookmark');
    for (const at of [
      '2026-02-30 10:30:37',
      '2026-10-16 24:30:37',
      '2026-10-16 14:60:37',
      '2026-10-16 10:30:60',
      '2026-09-15 10:30:37',
      '2026-10-17 10:30:37',
    ]) {
      expect(
        (await instance.handle(request('restore-prepare', { id: idA, at }), identity, 'test')).body,
      ).toMatchObject({ code: 'E-32', field: 'at' });
    }
    expect(time).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
    expect(snapshot(state.storage)).toEqual(before);
  });
});

test('147-1: 日本時間で予約し、複数の待つ番号を守り、復元後の確定・再送・古い世代・目覚ましを扱う', async () => {
  await runInDurableObject(stub(), async (instance, state) => {
    const storage = state.storage,
      before = snapshot(storage);
    const setAlarm = vi.spyOn(storage, 'setAlarm');
    const time = vi.spyOn(storage, 'getBookmarkForTime').mockResolvedValue(mark);
    const prepare = vi.spyOn(storage, 'onNextSessionRestoreBookmark').mockResolvedValue(mark);
    const abort = vi.spyOn(state, 'abort').mockImplementation(() => {
      throw new Error('mock restart');
    });
    expect(
      (
        await instance.handle(
          request('restore-prepare', { id: idA, at: '2026-10-16 10:30' }),
          identity,
          'test',
        )
      ).body,
    ).toEqual({ at: now.toISOString() });
    expect(time).toHaveBeenCalledWith(new Date('2026-10-16T01:30:00.000Z'));
    expect(prepare).toHaveBeenCalledWith(mark);
    expect(abort).not.toHaveBeenCalled();
    await instance.handle(
      request('restore-prepare', { id: idB, at: '2026-10-16 10:30' }),
      identity,
      'test',
    );
    expect(
      JSON.parse(
        String(
          storage.sql.exec('SELECT pending_restore_ids FROM data_version').one()
            .pending_restore_ids,
        ),
      ),
    ).toEqual([idA, idB]);
    const waiting = snapshot(storage);
    expect(
      (
        await instance.handle(
          request('restore-finish', { id: idA, to: now.toISOString() }),
          identity,
          'test',
        )
      ).result,
    ).toBe('E-46');
    expect(snapshot(storage)).toEqual(waiting);
    expect(
      (
        await instance.handle(
          request('restore-prepare', { id: crypto.randomUUID(), at: '2026-09-15 10:30' }),
          identity,
          'test',
        )
      ).body,
    ).toMatchObject({ code: 'E-32', field: 'at' });
    // PITR is unavailable locally: restore pending IDs and business data to the earlier point.
    storage.sql.exec("UPDATE data_version SET pending_restore_ids = '[]'");
    storage.sql.exec(
      "INSERT INTO staff (id, name, sort_order, default_first_facility, default_second_facility, employment_status) VALUES ('later', 'later', 0, 'A', NULL, 'active')",
    );
    storage.sql.exec('DELETE FROM staff');
    storage.sql.exec(
      "INSERT INTO scheduled_tasks VALUES ('close-requests:test', '2026-10-16T10:00:00.000Z')",
    );
    await instance.handle(request('restart'), identity, 'test');
    expect(abort).toHaveBeenCalledOnce();
    abort.mockRestore();
    const finish = await instance.handle(
      request('restore-finish', { id: idA, to: now.toISOString() }),
      identity,
      'test',
    );
    expect(finish.result).toBe('success');
    expect(respond(finish, 'test').headers.get('X-Restored-To')).toBe(now.toISOString());
    const version = storage.sql.exec('SELECT * FROM data_version').one();
    expect(version).toMatchObject({
      restored_to: now.toISOString(),
      finished_restore_ids: JSON.stringify([idA]),
      pending_restore_ids: '[]',
    });
    expect(version.generation).not.toBe(before.data_version[0].generation);
    expect(
      storage.sql.exec('SELECT data_change_number FROM backup_state').one().data_change_number,
    ).toBe(2);
    expect(setAlarm).toHaveBeenLastCalledWith(Date.parse('2026-10-16T10:00:00.000Z'));
    const done = snapshot(storage);
    expect(
      (
        await instance.handle(
          request('restore-finish', { id: idA, to: now.toISOString() }),
          identity,
          'test',
        )
      ).result,
    ).toBe('success');
    expect(snapshot(storage)).toEqual(done);
    const save = new Request(`${origin}/api/save`, {
      method: 'POST',
      headers: { Origin: origin },
      body: JSON.stringify({
        operationId: crypto.randomUUID(),
        operation: 'staff.reorder',
        data: [],
        saveShapeVersion: SAVE_SHAPE_VERSION,
        dataGeneration: before.data_version[0].generation,
        revisions: [],
      }),
    });
    const refused = await instance.handle(save, identity, 'test');
    expect(refused.result).toBe('E-42');
    expect(respond(refused, 'test').headers.get('X-Restored-To')).toBe(now.toISOString());
    const read = await instance.handle(
      new Request(`${origin}/api/change-number`),
      identity,
      'test',
    );
    expect(respond(read, 'test').headers.get('X-Restored-To')).toBe(now.toISOString());
    vi.spyOn(storage, 'getAlarm').mockRejectedValue(new Error('alarm'));
    expect(
      (
        await instance.handle(
          request('restore-finish', { id: idB, to: now.toISOString() }),
          identity,
          'test',
        )
      ).result,
    ).toBe('success');
    expect(
      storage.sql.exec('SELECT code, operation FROM fatal_errors ORDER BY id DESC LIMIT 1').one(),
    ).toEqual({ code: 'E-92', operation: 'maintenance-restore-finish' });
  });
});

test('147-1: 起動し直した同じ保存先ではコンストラクターが予定を補充してから2段目が通る', async () => {
  await runInDurableObject(stub(), async (instance, state) => {
    state.storage.sql.exec('DELETE FROM scheduled_tasks');
    vi.spyOn(state, 'abort').mockImplementation(() => {});
    await instance.handle(request('restart'), identity, 'test');
    expect(state.abort).toHaveBeenCalledOnce();
    vi.restoreAllMocks();
  });
  await abortAllDurableObjects();
  const result = await stub().handle(
    request('restore-finish', { id: idA, to: now.toISOString() }),
    identity,
    'test',
  );
  expect(result.result).toBe('success');
  await runInDurableObject(stub(), (_instance, state) => {
    expect(state.storage.sql.exec('SELECT COUNT(*) AS n FROM scheduled_tasks').one().n).toBe(3);
  });
});

test('147-1/2: 版2の全表が戻り、初期値を置換し、保存先だけの状態を保ち、同じ番号は再実行しない', async () => {
  const bytes = await file();
  const source = await runInDurableObject(stub('source'), (_instance, state) =>
    snapshot(state.storage),
  );
  await runInDurableObject(stub(), async (instance, state) => {
    const sql = state.storage.sql;
    const setAlarm = vi.spyOn(state.storage, 'setAlarm');
    await state.storage.deleteAlarm();
    sql.exec(
      "UPDATE backup_state SET data_change_number = 20, sent_change_number = 3, failed_nights = 2, last_failure_code = 'E-63'",
    );
    sql.exec("UPDATE mail_state SET annual_task_mailed_on = '2026-02-01'");
    const before = snapshot(state.storage);
    const result = await instance.handle(request('import', bytes), identity, 'test');
    expect(result.result).toBe('success');
    expect(result.body).toEqual({ ok: true, createdAt: now.toISOString(), staff: 1, periods: 1 });
    expect(respond(result, 'test').headers.get('X-Restored-To')).toBe(now.toISOString());
    const after = snapshot(state.storage);
    for (const table of INCLUDED_TABLES) expect(after[table]).toEqual(source[table]);
    expect(after.data_version[0]).toMatchObject({
      restored_to: now.toISOString(),
      finished_restore_ids: JSON.stringify([idA]),
      pending_restore_ids: '[]',
    });
    expect(after.data_version[0].generation).not.toBe(before.data_version[0].generation);
    expect(after.backup_state[0]).toEqual({ ...before.backup_state[0], data_change_number: 21 });
    expect(after.mail_state).toEqual(before.mail_state);
    expect(after.scheduled_tasks).toContainEqual({
      task: 'close-requests:p',
      scheduled_at: '2026-10-20T15:00:00.000Z',
    });
    expect(setAlarm).toHaveBeenLastCalledWith(
      Math.min(...after.scheduled_tasks.map((row) => Date.parse(String(row.scheduled_at)))),
    );
    expect((await instance.handle(request('import', bytes), identity, 'test')).result).toBe(
      'success',
    );
    expect(snapshot(state.storage)).toEqual(after);
  });
});

test('147-1: 空でない保存先と版違いを拒否し、壊れたファイル・保存の決まり違いは場所付きで全体を取り消す', async () => {
  const bytes = await file();
  await runInDurableObject(stub(), async (instance, state) => {
    const before = snapshot(state.storage);
    const cases: [string, Uint8Array, string][] = [
      [
        '形の版',
        mutate(bytes, (lines) => {
          lines[0].formatVersion = 1;
        }),
        'E-45',
      ],
      [
        '新しいデータの版',
        mutate(bytes, (lines) => {
          lines[0].schemaVersion += 1;
        }),
        'E-45',
      ],
      [
        '担当者21字',
        mutate(bytes, (lines) => {
          editRow(lines, 'contact_names', 'name', 'あ'.repeat(21));
        }),
        'E-38',
      ],
      [
        '担当者の行欠け',
        mutate(bytes, (lines) => {
          lines.splice(lines.findIndex((line) => line.table === 'contact_names') + 1, 1);
          lines.at(-1).rows--;
        }),
        'E-38',
      ],
      [
        '種類',
        mutate(bytes, (lines) => {
          lines[0].format = 'other';
        }),
        'E-38',
      ],
      [
        '番号',
        mutate(bytes, (lines) => {
          lines[0].changeNumber = -1;
        }),
        'E-38',
      ],
      [
        '日時',
        mutate(bytes, (lines) => {
          lines[0].createdAt = 'invalid';
        }),
        'E-38',
      ],
      [
        '表欠け',
        mutate(bytes, (lines) => {
          lines.splice(
            lines.findIndex((line) => line.table === 'staff_history'),
            2,
          );
        }),
        'E-38',
      ],
      [
        '表順',
        mutate(bytes, (lines) => {
          lines[1].table = 'periods';
        }),
        'E-38',
      ],
      [
        '列',
        mutate(bytes, (lines) => {
          lines[1].columns.reverse();
        }),
        'E-38',
      ],
      [
        '値の数',
        mutate(bytes, (lines) => {
          lines[2].pop();
        }),
        'E-38',
      ],
      [
        '終わり無し',
        mutate(bytes, (lines) => {
          lines.pop();
        }),
        'E-38',
      ],
      [
        '件数',
        mutate(bytes, (lines) => {
          lines.at(-1).rows++;
        }),
        'E-38',
      ],
      [
        '終わりの後',
        mutate(bytes, (lines) => {
          lines.push({ extra: true });
        }),
        'E-38',
      ],
      [
        '番号過大',
        mutate(bytes, (lines) => {
          editRow(lines, 'staff', 'revision', 10);
        }),
        'E-38',
      ],
      [
        '壊れたJSON',
        mutate(bytes, (lines) => {
          editRow(lines, 'daily_requests', 'replaced_shift', '{');
        }),
        'E-38',
      ],
      [
        '無いピリオド',
        mutate(bytes, (lines) => {
          editRow(lines, 'staff_history', 'since', 'missing');
        }),
        'E-38',
      ],
      [
        '履歴無し',
        mutate(bytes, (lines) => {
          lines.splice(lines.findIndex((line) => line.table === 'staff_history') + 1, 1);
          lines.at(-1).rows--;
        }),
        'E-38',
      ],
      [
        '勤務重複',
        mutate(bytes, (lines) => {
          const i = lines.findIndex((line) => line.table === 'work_slots');
          lines[i + 2][lines[i].columns.indexOf('first_start_time')] = '11:00';
        }),
        'E-38',
      ],
      [
        '有給に勤務',
        mutate(bytes, (lines) => {
          editRow(lines, 'day_states', 'status', 'paid_leave');
        }),
        'E-38',
      ],
      [
        '勤務なし役割',
        mutate(bytes, (lines) => {
          const i = lines.findIndex((line) => line.table === 'work_slots');
          lines.splice(i + 1, 2);
          lines.at(-1).rows -= 2;
          editRow(lines, 'day_states', 'roles', '["closing"]');
        }),
        'E-38',
      ],
      [
        '両建物にⅠ',
        mutate(bytes, (lines) => {
          editRow(lines, 'day_states', 'roles', '["movement_first"]');
        }),
        'E-38',
      ],
      [
        '第二だけにⅠ',
        mutate(bytes, (lines) => {
          const i = lines.findIndex((line) => line.table === 'work_slots');
          lines.splice(i + 1, 1);
          lines.at(-1).rows--;
          editRow(lines, 'day_states', 'roles', '["movement_first"]');
        }),
        'E-38',
      ],
      [
        '勤務なしにⅡ',
        mutate(bytes, (lines) => {
          const i = lines.findIndex((line) => line.table === 'work_slots');
          lines.splice(i + 1, 2);
          lines.at(-1).rows -= 2;
          editRow(lines, 'day_states', 'roles', '["movement_second"]');
        }),
        'E-38',
      ],
      ['行が大きい', gzipSync(strToU8('x'.repeat(1024 * 1024 + 1))), 'E-38'],
      ['gzip切断', bytes.slice(0, -1), 'E-38'],
      ['32MB超', new Uint8Array(32 * 1024 * 1024 + 1), 'E-38'],
    ];
    for (const [name, data, code] of cases) {
      const result = await instance.handle(request('import', data), identity, name);
      expect(result.result, name).toBe(code);
      if (code === 'E-38')
        expect(result.body, name).toMatchObject({
          table: expect.toSatisfy((table: unknown) => table === null || typeof table === 'string'),
          line: expect.any(Number),
          reason: expect.any(String),
        });
      expect(snapshot(state.storage), name).toEqual(before);
    }
    for (const table of ['staff', 'periods']) {
      if (table === 'staff')
        state.storage.sql.exec(
          "INSERT INTO staff (id, name, sort_order, default_first_facility, default_second_facility, employment_status) VALUES ('exists', 'exists', 0, 'A', NULL, 'active')",
        );
      else
        state.storage.sql.exec(
          "INSERT INTO periods (id, name, start_date, end_date, request_url_key) VALUES ('exists', 'exists', '2026-01-01', '2026-01-31', 'exists')",
        );
      const nonempty = snapshot(state.storage);
      await expect(receiveImport(request('import', bytes), state.storage)).rejects.toMatchObject({
        code: 'E-44',
      });
      expect(snapshot(state.storage)).toEqual(nonempty);
      state.storage.sql.exec(`DELETE FROM ${table}`);
    }
  });
});
