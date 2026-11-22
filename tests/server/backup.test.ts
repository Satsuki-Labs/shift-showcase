/// <reference types="@cloudflare/workers-types" />
/// <reference types="@cloudflare/vitest-plugin/types" />
import { env } from 'cloudflare:workers';
import { reset, runInDurableObject } from 'cloudflare:test';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { gunzipSync, strFromU8 } from 'fflate';
import type { Env } from '../../server/src/index';
import { createBackup, INCLUDED_TABLES, EXCLUDED_TABLES } from '../../server/src/backup/file';
import { backupBody, sendBackup, type BackupEnvironment } from '../../server/src/backup/send';
import { runNightlyBackup } from '../../server/src/backup/nightly';
import { runScheduledTasks } from '../../server/src/scheduled/tasks';
import { readFirstLoad } from '../../server/src/reads/first-load';
import { receiveImport } from '../../server/src/maintenance/import';
import { applyMigrations } from '../../server/src/schema/apply';
import { MIGRATIONS } from '../../server/src/schema/migrations';

function decodeBackup(bytes: Uint8Array) {
  const lines = strFromU8(gunzipSync(bytes))
    .trimEnd()
    .split('\n')
    .map((line) => JSON.parse(line));
  const header = lines.shift();
  const end = lines.pop();
  const tables: Record<string, { columns: string[]; rows: unknown[][] }> = {};
  let current!: { columns: string[]; rows: unknown[][] };
  for (const line of lines) {
    if (Array.isArray(line)) current.rows.push(line);
    else current = tables[line.table] = { columns: line.columns, rows: [] };
  }
  expect(end).toEqual({
    end: true,
    tables: INCLUDED_TABLES.length,
    rows: Object.values(tables).reduce((sum, table) => sum + table.rows.length, 0),
  });
  return { ...header, tables };
}

const now = new Date('2026-10-20T18:00:00.000Z');
const next = '2026-10-21T18:00:00.000Z';
const settings: BackupEnvironment = {
  ENVIRONMENT: '本番',
  BACKUP_GAS_URL: 'https://script.google.com/macros/s/test/exec',
  BACKUP_GAS_TOKEN: 'x'.repeat(43),
};
function inside<T>(work: (storage: DurableObjectStorage) => T | Promise<T>) {
  const ns = (env as Env).ORGANIZATION;
  return runInDurableObject(ns.get(ns.idFromName('backup-test')), (_instance, state) =>
    work(state.storage),
  );
}
function prepare(storage: DurableObjectStorage, number = 1) {
  storage.sql.exec('UPDATE backup_state SET data_change_number = ? WHERE id = 1', number);
  storage.sql.exec(
    "UPDATE scheduled_tasks SET scheduled_at = ? WHERE task = 'nightly-backup'",
    now.toISOString(),
  );
}
function state(storage: DurableObjectStorage) {
  return storage.sql.exec('SELECT * FROM backup_state').one();
}
function notification(storage: DurableObjectStorage) {
  return readFirstLoad(
    storage,
    { email: 'test@example.invalid', role: 'first' },
    { appVersion: 'test', requestId: 'test', dataGeneration: 'test' },
  ).notifications;
}
function run(storage: DurableObjectStorage, config = settings) {
  // These tests isolate the backup job.
  storage.sql.exec(
    "UPDATE scheduled_tasks SET scheduled_at = ? WHERE task = 'nightly-mail'",
    new Date(Date.now() + 86400000).toISOString(),
  );
  return runScheduledTasks(storage, config);
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(now);
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await reset();
});

test('変更のない夜と手元ではファイルを作らず、状態を保って次の3時へ進む', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch');
  await inside(async (storage) => {
    for (const config of [settings, { ENVIRONMENT: '手元' } as const]) {
      prepare(storage, config.ENVIRONMENT === '手元' ? 9 : 0);
      storage.sql.exec(
        "UPDATE backup_state SET failed_nights = 1, last_failure_code = 'E-63', last_success_at = 'previous' WHERE id = 1",
      );
      const before = state(storage);
      await run(storage, config);
      expect(state(storage)).toEqual(before);
      expect(
        storage.sql
          .exec("SELECT scheduled_at FROM scheduled_tasks WHERE task = 'nightly-backup'")
          .one().scheduled_at,
      ).toBe(next);
    }
  });
  expect(fetch).not.toHaveBeenCalled();
});

test('形の変更後は保存がなくても次の夜に新しい形のバックアップを送る', async () => {
  const fetch = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async () => Response.json({ ok: true, status: 'saved' }));
  await inside(async (storage) => {
    const before = state(storage).data_change_number as number;
    prepare(storage, before);
    storage.sql.exec('UPDATE backup_state SET sent_change_number = ? WHERE id = 1', before);
    const next = MIGRATIONS.at(-1)!.number + 1;
    await applyMigrations(storage, [
      ...MIGRATIONS,
      {
        number: next,
        sql: "ALTER TABLE staff ADD COLUMN extra TEXT NOT NULL DEFAULT 'added';",
        additive: true,
      },
    ]);
    await run(storage);
    expect(state(storage)).toMatchObject({
      data_change_number: before + 1,
      sent_change_number: before + 1,
    });
    expect(fetch).toHaveBeenCalledOnce();
    const request = JSON.parse(String(fetch.mock.calls[0][1]?.body));
    const backup = decodeBackup(Uint8Array.from(atob(request.data), (c) => c.charCodeAt(0)));
    expect(backup).toMatchObject({ schemaVersion: next, changeNumber: before + 1 });
    expect(backup.tables.staff.columns).toContain('extra');
  });
});

test.each(['saved', 'duplicate'])(
  '145-1: %s で成功日時・送った番号を確定し、失敗を解消する',
  async (status) => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      Response.json({ ok: true, status }),
    );
    await inside(async (storage) => {
      prepare(storage, 7);
      storage.sql.exec(
        "UPDATE backup_state SET failed_nights = 2, last_failure_code = 'E-62' WHERE id = 1",
      );
      await run(storage);
      expect(state(storage)).toEqual({
        id: 1,
        last_success_at: now.toISOString(),
        data_change_number: 7,
        failed_nights: 0,
        last_failure_code: null,
        sent_change_number: 7,
      });
      expect(notification(storage)).toEqual([]);
    });
  },
);

test('145-1: 1夜では通知せず、保存がなくても再送し、2夜目の番号を通知して成功で消す', async () => {
  const fetch = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementationOnce(async () => Response.json({ ok: false, code: 'quota' }))
    .mockImplementationOnce(async () => Response.json({ ok: false, code: 'rejected' }))
    .mockImplementationOnce(async () => Response.json({ ok: true, status: 'saved' }));
  await inside(async (storage) => {
    prepare(storage, 7);
    await run(storage);
    expect(notification(storage)).toEqual([]);
    expect(state(storage)).toMatchObject({ failed_nights: 1, sent_change_number: 0 });
    vi.setSystemTime(new Date(next));
    await run(storage);
    expect(notification(storage)).toEqual([{ kind: 'backup_failure', code: 'E-62' }]);
    vi.setSystemTime(new Date('2026-10-22T18:00:00.000Z'));
    await run(storage);
    expect(notification(storage)).toEqual([]);
  });
  expect(fetch).toHaveBeenCalledTimes(3);
});

test.each([
  ['rejected', 'E-62'],
  ['quota', 'E-63'],
  ['temporary', 'E-64'],
  ['network', 'E-64'],
  ['http', 'E-64'],
  ['html', 'E-64'],
  ['missing', 'E-52'],
  ['url', 'E-52'],
  ['token', 'E-52'],
  ['file', 'E-92'],
])('145-1: %s の失敗を %s に分け、次夜にし、致命的な記録へ書かない', async (kind, code) => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
    if (kind === 'network') throw new TypeError('network');
    if (kind === 'http') return new Response('', { status: 503 });
    if (kind === 'html') return new Response('<html>Sign in</html>');
    return Response.json({ ok: false, code: kind });
  });
  await inside(async (storage) => {
    prepare(storage);
    if (kind === 'file') storage.sql.exec('DROP TABLE distributed_sheets');
    const config =
      kind === 'missing'
        ? ({ ENVIRONMENT: '本番' } as const)
        : kind === 'url'
          ? { ...settings, BACKUP_GAS_URL: 'http://example.invalid' }
          : kind === 'token'
            ? { ...settings, BACKUP_GAS_TOKEN: 'invalid' }
            : settings;
    await run(storage, config);
    expect(state(storage)).toMatchObject({
      failed_nights: 1,
      last_failure_code: code,
      sent_change_number: 0,
    });
    expect(
      storage.sql
        .exec("SELECT scheduled_at FROM scheduled_tasks WHERE task = 'nightly-backup'")
        .one().scheduled_at,
    ).toBe(next);
    expect(storage.sql.exec('SELECT * FROM fatal_errors').toArray()).toEqual([]);
  });
  if (['missing', 'url', 'token', 'file'].includes(kind)) expect(fetch).not.toHaveBeenCalled();
});

test('145-1: 応答本文を待っている間も6分で打ち切る', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  let signal: AbortSignal | null | undefined;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
    signal = init?.signal;
    return { status: 200, json: () => new Promise(() => {}) } as Response;
  });
  await inside(async (storage) => {
    const pending = sendBackup(createBackup(storage.sql, now), settings);
    await vi.advanceTimersByTimeAsync(6 * 60 * 1000);
    expect(await pending).toBe('E-64');
    expect(signal?.aborted).toBe(true);
  });
});

test('145-1: リダイレクトを指定し、移った先の最後の答えで成功を判断する', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
    expect(init?.redirect).toBe('follow');
    const response = Response.json({ ok: true, status: 'saved' });
    Object.defineProperty(response, 'url', { value: 'https://script.googleusercontent.com/final' });
    Object.defineProperty(response, 'redirected', { value: true });
    return response;
  });
  await inside(async (storage) => {
    prepare(storage);
    await run(storage);
    expect(state(storage).sent_change_number).toBe(1);
  });
  expect(fetch).toHaveBeenCalledOnce();
});

test('145-1: バックアップに失敗しても同じ3時の掃除と締め切りを行う', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
    Response.json({ ok: false, code: 'temporary' }),
  );
  await inside(async (storage) => {
    prepare(storage);
    storage.sql.exec(
      "INSERT INTO periods (id, name, start_date, end_date, request_deadline_date, request_url_key) VALUES ('p', 'p', '2026-11-01', '2026-11-30', '2026-10-20', 'p')",
    );
    storage.sql.exec(
      "INSERT INTO scheduled_tasks VALUES ('close-requests:p', ?)",
      now.toISOString(),
    );
    storage.sql.exec(
      "UPDATE scheduled_tasks SET scheduled_at = ? WHERE task = 'clean-receipts'",
      now.toISOString(),
    );
    storage.sql.exec(
      "INSERT INTO operation_receipts VALUES ('old', 'summary', '{}', '2020-01-01')",
    );
    await run(storage);
    expect(
      storage.sql.exec('SELECT requests_closed_at FROM periods').one().requests_closed_at,
    ).toBe(now.toISOString());
    expect(storage.sql.exec('SELECT * FROM operation_receipts').toArray()).toEqual([]);
    expect(storage.sql.exec('SELECT * FROM fatal_errors').toArray()).toEqual([]);
    expect(storage.sql.exec('SELECT * FROM scheduled_tasks ORDER BY task').toArray()).toEqual([
      { task: 'clean-receipts', scheduled_at: next },
      { task: 'nightly-backup', scheduled_at: next },
      { task: 'nightly-mail', scheduled_at: next },
    ]);
  });
});

test('145-1: 送信後・結果を書く前の停止から再実行しても同じ夜の失敗は1つだけ', async () => {
  const fetch = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async () => Response.json({ ok: false, code: 'quota' }));
  await inside(async (storage) => {
    prepare(storage);
    const transaction = vi.spyOn(storage, 'transactionSync').mockImplementationOnce(() => {
      throw new Error('stopped before write');
    });
    await expect(runNightlyBackup(storage, settings, now.toISOString(), next, now)).rejects.toThrow(
      'stopped before write',
    );
    expect(state(storage).failed_nights).toBe(0);
    transaction.mockRestore();
    await runNightlyBackup(storage, settings, now.toISOString(), next, now);
    await run(storage);
    expect(state(storage)).toMatchObject({ failed_nights: 1, last_failure_code: 'E-63' });
  });
  expect(fetch).toHaveBeenCalledTimes(2);
});

test('145-1: 本文とファイルの形、全表・全行を保ち、除外する表とアプリの表の分類を確認する', async () => {
  await inside(async (storage) => {
    prepare(storage, 9);
    storage.sql.exec(
      "INSERT INTO staff (id, name, sort_order, default_first_facility, default_second_facility, employment_status) VALUES ('s', '試験', 0, 'A', 'C', 'active')",
    );
    storage.sql.exec(
      "INSERT INTO periods (id, name, start_date, end_date, request_url_key) VALUES ('p', 'p', '2026-01-01', '2026-01-31', 'p')",
    );
    storage.sql.exec(
      "INSERT INTO period_snapshots (period_id, staff, annual_closures, captured_at, staff_format) VALUES ('p', '[]', '[]', 'now', 1)",
    );
    storage.sql.exec(
      "INSERT INTO distributed_sheets VALUES ('p', 'first', 'now', '{}'), ('p', 'second', 'now', '{}')",
    );
    const emptyPair = { slot1: null, slot2: null };
    const work = {
      normal: { first: emptyPair, second: emptyPair },
      peak: { first: emptyPair, second: emptyPair },
      saturday: null,
    };
    storage.sql.exec(
      "UPDATE staff SET default_first_facility = 'A', default_second_facility = 'C', default_work_times = ?",
      JSON.stringify(work),
    );
    storage.sql.exec(
      "INSERT INTO staff_history VALUES ('s', 'initial', 250, 'full_time', 'none', 0)",
    );
    const file = createBackup(storage.sql, now);
    const request = JSON.parse(backupBody(file, settings.BACKUP_GAS_TOKEN!));
    const unpacked = decodeBackup(Uint8Array.from(atob(request.data), (c) => c.charCodeAt(0)));
    const version = storage.sql.exec('SELECT * FROM data_version').one();
    expect(request).toEqual({
      version: 1,
      kind: 'backup',
      token: settings.BACKUP_GAS_TOKEN,
      key: `${version.generation}-9`,
      createdAt: now.toISOString(),
      data: expect.any(String),
    });
    expect(unpacked).toMatchObject({
      format: 'shift-showcase-backup',
      formatVersion: 2,
      schemaVersion: version.schema_version,
      generation: version.generation,
      changeNumber: 9,
      createdAt: now.toISOString(),
    });
    expect(Object.keys(unpacked.tables)).toEqual(INCLUDED_TABLES);
    for (const table of INCLUDED_TABLES) {
      const cursor = storage.sql.exec(`SELECT * FROM "${table}"`);
      expect(unpacked.tables[table]).toEqual({
        columns: cursor.columnNames,
        rows: [...cursor.raw()],
      });
    }
    const tables = storage.sql
      .exec<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND substr(name, 1, 2) != '__' AND substr(name, 1, 4) != '_cf_' AND substr(name, 1, 7) != 'sqlite_'",
      )
      .toArray()
      .map((row) => row.name)
      .sort();
    expect([...INCLUDED_TABLES, ...EXCLUDED_TABLES].sort()).toEqual(tables);
    for (const table of [...INCLUDED_TABLES].reverse())
      storage.sql.exec('DELETE FROM "' + table + '"');
    const body = Uint8Array.from(atob(request.data), (c) => c.charCodeAt(0));
    await receiveImport(
      new Request('https://test.invalid/api/maintenance/import?id=' + crypto.randomUUID(), {
        method: 'POST',
        body,
      }),
      storage,
    );
    for (const table of INCLUDED_TABLES)
      expect([...storage.sql.exec('SELECT * FROM "' + table + '"').raw()]).toEqual(
        unpacked.tables[table].rows,
      );
  });
});

test('145-1: 送信を待つ間の保存は混ぜず、その番号は次の夜に送る', async () => {
  let finish!: (response: Response) => void;
  let sent!: () => void;
  const started = new Promise<void>((resolve) => {
    sent = resolve;
  });
  const bodies: { changeNumber: number }[] = [];
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
    const request = JSON.parse(String(init?.body));
    bodies.push(decodeBackup(Uint8Array.from(atob(request.data), (c) => c.charCodeAt(0))));
    sent();
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  await inside(async (storage) => {
    prepare(storage, 1);
    const pending = run(storage);
    await started;
    storage.sql.exec('UPDATE backup_state SET data_change_number = 2');
    storage.sql.exec(
      "INSERT INTO staff (id, name, sort_order, default_first_facility, default_second_facility, employment_status) VALUES ('s', 'after', 0, 'A', 'C', 'active')",
    );
    finish(Response.json({ ok: true, status: 'saved' }));
    await pending;
    expect(state(storage)).toMatchObject({ data_change_number: 2, sent_change_number: 1 });
    fetch.mockImplementationOnce(async (_url, init) => {
      const request = JSON.parse(String(init?.body));
      bodies.push(decodeBackup(Uint8Array.from(atob(request.data), (c) => c.charCodeAt(0))));
      return Response.json({ ok: true, status: 'saved' });
    });
    vi.setSystemTime(new Date(next));
    await run(storage);
    expect(state(storage).sent_change_number).toBe(2);
    expect(bodies.map((body) => body.changeNumber)).toEqual([1, 2]);
    expect(bodies[0]).toHaveProperty('tables.staff.rows', []);
    expect(bodies[1]).toHaveProperty('tables.staff.rows.0.0', 's');
  });
});
