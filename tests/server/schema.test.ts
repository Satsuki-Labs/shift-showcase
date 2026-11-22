/// <reference types="@cloudflare/workers-types" />
/// <reference types="@cloudflare/vitest-plugin/types" />
import { abortAllDurableObjects, reset, runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { afterEach, expect, test } from 'vitest';
import type { Env } from '../../server/src/index';
import { applyMigrations } from '../../server/src/schema/apply';
import { MIGRATIONS, type Migration } from '../../server/src/schema/migrations';

afterEach(async () => {
  await reset();
});

test('既存の並び順と担当者名を保ち、足すだけの変更で番号が1から始まる', async () => {
  await runInDurableObject(newObject(), async (_instance, state) => {
    await state.storage.deleteAll();
    await applyMigrations(state.storage, MIGRATIONS.slice(0, 2));
    addStaff(state.storage);
    state.storage.sql.exec("UPDATE staff SET sort_order = 7 WHERE id = 'staff-1'");
    state.storage.sql.exec("UPDATE contact_names SET name = '担当A' WHERE site = 'first'");
    await applyMigrations(state.storage);
    expect(
      state.storage.sql.exec('SELECT staff_order_revision FROM data_version').one()
        .staff_order_revision,
    ).toBe(1);
    expect(
      state.storage.sql
        .exec('SELECT site, name, revision FROM contact_names ORDER BY site')
        .toArray(),
    ).toEqual([
      { site: 'first', name: '担当A', revision: 1 },
      { site: 'second', name: '', revision: 1 },
    ]);
    expect(
      state.storage.sql.exec("SELECT sort_order FROM staff WHERE id = 'staff-1'").one().sort_order,
    ).toBe(7);
    expect(MIGRATIONS[2].additive).toBe(true);
  });
});

function newObject() {
  const namespace = (env as Env).ORGANIZATION;
  return namespace.get(namespace.newUniqueId());
}

function snapshot(storage: DurableObjectStorage) {
  const schema = storage.sql
    .exec(
      "SELECT type, name, sql FROM sqlite_master WHERE substr(name, 1, 2) != '__' AND substr(name, 1, 4) != '_cf_' AND substr(name, 1, 7) != 'sqlite_' ORDER BY type, name",
    )
    .toArray();
  const data = schema
    .filter((entry) => entry.type === 'table')
    .map((entry) => ({
      table: entry.name,
      rows: storage.sql.exec(`SELECT * FROM "${entry.name}" ORDER BY rowid`).toArray(),
    }));
  return { schema, data };
}

function addStaff(storage: DurableObjectStorage) {
  storage.sql.exec(
    "INSERT INTO staff (id, name, sort_order, default_first_facility, default_second_facility, employment_status) VALUES ('staff-1', 'Test', 0, 'A', 'C', 'active')",
  );
}

function nonAdditiveStatements(sql: string) {
  // Quoted values and identifiers may contain semicolons or comment markers.
  const statements = sql
    .replace(
      /('(?:''|[^'])*'|"(?:""|[^"])*"|`(?:``|[^`])*`|\[[^\]]*\])|--[^\r\n]*|\/\*[\s\S]*?\*\//g,
      (_match, quoted: string | undefined) => (quoted ? 'quoted' : ' '),
    )
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean);
  return statements.filter(
    (statement) =>
      !/^(?:CREATE\s+(?:TABLE|(?:UNIQUE\s+)?INDEX)\b|ALTER\s+TABLE\s+\S+\s+ADD\s+COLUMN\b)/i.test(
        statement,
      ),
  );
}

test('足すだけの変更には表・列・索引を足す文しか含められない', () => {
  const allowedSql = `
    -- CREATE TABLE と書いたコメントだけでは文にならない
    CREATE TABLE IF NOT EXISTS "new;table" (id TEXT, note TEXT DEFAULT 'a;--/*b');
    /* 文の前のコメント */ ALTER TABLE staff ADD COLUMN extra TEXT DEFAULT '';
    CREATE INDEX IF NOT EXISTS staff_extra_index ON staff(extra);
    CREATE TABLE another_table (id TEXT);
    CREATE INDEX another_index ON another_table(id);
  `;
  expect(nonAdditiveStatements(allowedSql)).toEqual([]);
  for (const sql of [
    'DROP TABLE staff;',
    'ALTER TABLE staff DROP COLUMN notes;',
    'ALTER TABLE staff RENAME COLUMN notes TO memo;',
    'DELETE FROM staff;',
    "UPDATE staff SET notes = '';",
    "INSERT INTO staff (id) VALUES ('new');",
    'CREATE TRIGGER remove_staff AFTER INSERT ON staff BEGIN DELETE FROM staff; END;',
    'PRAGMA user_version = 2;',
  ]) {
    expect(nonAdditiveStatements(`${allowedSql} ${sql}`), sql).not.toEqual([]);
  }
  for (const migration of MIGRATIONS) {
    expect(typeof migration.additive).toBe('boolean');
    if (migration.additive) {
      expect(nonAdditiveStatements(migration.sql), `migration ${migration.number}`).toEqual([]);
    }
  }
});

test('足すだけかを記録し、欄のない既存の記録でも開ける', async () => {
  await runInDurableObject(newObject(), async (_instance, state) => {
    const records =
      state.storage.kv.get<{ number: number; summary: string; additive: boolean }[]>(
        'schema:migrations',
      )!;
    expect(records).toEqual(
      MIGRATIONS.map(({ number, additive }) => ({ number, additive, summary: expect.any(String) })),
    );
    const legacyRecords = records.map(({ number, summary }) => ({ number, summary }));
    state.storage.kv.put('schema:migrations', legacyRecords);
    addStaff(state.storage);
    const before = snapshot(state.storage);
    await applyMigrations(state.storage);
    expect(snapshot(state.storage)).toEqual(before);
    expect(state.storage.kv.get('schema:migrations')).toEqual(legacyRecords);
  });
});

test('古いコードは知らない変更が全部足すだけのときだけ開ける', async () => {
  await runInDurableObject(newObject(), async (_instance, state) => {
    const next = MIGRATIONS.at(-1)!.number + 1;
    const migrations: readonly Migration[] = [
      ...MIGRATIONS,
      {
        number: next,
        sql: "ALTER TABLE staff ADD COLUMN extra TEXT NOT NULL DEFAULT 'added';",
        additive: true,
      },
      {
        number: next + 1,
        sql: 'CREATE TABLE extra_table (id TEXT); CREATE INDEX staff_extra ON staff(extra);',
        additive: true,
      },
    ];
    addStaff(state.storage);
    await applyMigrations(state.storage, migrations);
    const records =
      state.storage.kv.get<{ number: number; summary: string; additive?: boolean }[]>(
        'schema:migrations',
      )!;
    expect(records.map((record) => record.additive)).toEqual(
      migrations.map((migration) => migration.additive),
    );
    const before = snapshot(state.storage);
    await applyMigrations(state.storage, MIGRATIONS);
    expect(snapshot(state.storage)).toEqual(before);
    expect(state.storage.kv.get('schema:migrations')).toEqual(records);
    // Old writes name their columns, so the added column receives its default.
    state.storage.sql.exec(
      "INSERT INTO staff (id, name, sort_order, employment_status) VALUES ('old-code', 'Old', 1, 'active')",
    );
    expect(
      state.storage.sql.exec("SELECT extra FROM staff WHERE id = 'old-code'").one().extra,
    ).toBe('added');
    const afterWrite = snapshot(state.storage);
    const known = records.slice(0, MIGRATIONS.length),
      [first, second] = records.slice(MIGRATIONS.length);
    for (const incompatibleRecords of [
      [...known, { ...first, additive: false }, second],
      [...known, first, { ...second, additive: false }],
      [...known, first, { number: second.number, summary: second.summary }],
      [...known, first, { ...second, number: second.number + 1 }],
      [{ ...known[0], number: known[0].number + 1 }, ...known.slice(1), first, second],
    ]) {
      state.storage.kv.put('schema:migrations', incompatibleRecords);
      await expect(applyMigrations(state.storage, MIGRATIONS)).rejects.toMatchObject({
        code: 'E-43',
      });
      expect(snapshot(state.storage)).toEqual(afterWrite);
      expect(state.storage.kv.get('schema:migrations')).toEqual(incompatibleRecords);
    }
    state.storage.kv.put('schema:migrations', records);
    await expect(
      applyMigrations(state.storage, [{ ...MIGRATIONS[0], number: 2 }]),
    ).rejects.toMatchObject({ code: 'E-43' });
    expect(snapshot(state.storage)).toEqual(afterWrite);
  });
});

test('first activation creates all designed tables, the current schema version and a fresh generation', async () => {
  expect(MIGRATIONS.map((migration) => migration.number)).toEqual(
    MIGRATIONS.map((_, index) => index + 1),
  );
  const stub = newObject();
  const generation = await runInDurableObject(stub, (_instance, state) => {
    const tables = snapshot(state.storage).data.map((entry) => entry.table);
    expect(tables).toEqual([
      'annual_closures',
      'backup_state',
      'building_days',
      'contact_names',
      'coverage_requirements',
      'daily_requests',
      'data_version',
      'day_states',
      'distributed_sheets',
      'facility_days',
      'fatal_errors',
      'mail_state',
      'no_requests',
      'opening_rules',
      'operation_receipts',
      'peaks',
      'period_snapshots',
      'periods',
      'scheduled_tasks',
      'staff',
      'staff_history',
      'work_slots',
    ]);
    const version = state.storage.sql.exec('SELECT * FROM data_version').one();
    expect(version).toEqual({
      id: 1,
      restored_to: null,
      finished_restore_ids: '[]',
      pending_restore_ids: '[]',
      schema_version: MIGRATIONS.at(-1)!.number,
      staff_order_revision: 1,
      generation: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      ),
    });
    expect(state.storage.sql.exec('SELECT * FROM backup_state').one()).toEqual({
      id: 1,
      last_success_at: null,
      data_change_number: 1,
      failed_nights: 0,
      sent_change_number: 0,
      last_failure_code: null,
    });
    return version.generation;
  });
  await runInDurableObject(newObject(), (_instance, state) => {
    expect(state.storage.sql.exec('SELECT generation FROM data_version').one().generation).not.toBe(
      generation,
    );
  });
});

test('reactivation preserves schema, saved data and generation', async () => {
  const stub = newObject();
  const before = await runInDurableObject(stub, (_instance, state) => {
    addStaff(state.storage);
    return snapshot(state.storage);
  });
  await abortAllDurableObjects();
  const freshStub = (env as Env).ORGANIZATION.get(stub.id);
  const after = await runInDurableObject(freshStub, (_instance, state) => snapshot(state.storage));
  expect(after).toEqual(before);
});

test('CRLFからLF、LFからCRLFで当て直してもデータベースが変わらない', async () => {
  const lf = MIGRATIONS.map((migration) => ({
    ...migration,
    sql: migration.sql.replace(/\r\n/g, '\n'),
  }));
  const crlf = lf.map((migration) => ({ ...migration, sql: migration.sql.replace(/\n/g, '\r\n') }));
  for (const [first, second] of [
    [crlf, lf],
    [lf, crlf],
  ]) {
    await runInDurableObject(newObject(), async (_instance, state) => {
      await state.storage.deleteAll();
      await applyMigrations(state.storage, first);
      addStaff(state.storage);
      const before = snapshot(state.storage);
      await applyMigrations(state.storage, second);
      expect(snapshot(state.storage)).toEqual(before);
    });
  }
});

test('modified applied SQL produces E-43 without changing the database', async () => {
  await runInDurableObject(newObject(), async (_instance, state) => {
    addStaff(state.storage);
    const before = snapshot(state.storage);
    const modified = [
      { ...MIGRATIONS[0], sql: MIGRATIONS[0].sql.replace('name TEXT NOT NULL', 'name TEXT') },
    ];
    await expect(applyMigrations(state.storage, modified)).rejects.toMatchObject({ code: 'E-43' });
    expect(snapshot(state.storage)).toEqual(before);
  });
});

test('複数の形の変更が通るとデータの変更番号を一つだけ進め、当て直しても変えない', async () => {
  const next = MIGRATIONS.at(-1)!.number + 1;
  const nextSql =
    "CREATE INDEX staff_name_index ON staff(name); UPDATE staff SET notes = 'migration-3';";
  await runInDurableObject(newObject(), async (_instance, state) => {
    addStaff(state.storage);
    const generation = state.storage.sql
      .exec('SELECT generation FROM data_version')
      .one().generation;
    const changeNumber = state.storage.sql
      .exec<{ data_change_number: number }>('SELECT data_change_number FROM backup_state')
      .one().data_change_number;
    const migrations = [
      ...MIGRATIONS,
      { number: next, sql: nextSql, additive: false },
      { number: next + 1, sql: 'ALTER TABLE staff ADD COLUMN extra TEXT;', additive: true },
    ];
    await applyMigrations(state.storage, migrations);
    expect(state.storage.sql.exec("SELECT notes FROM staff WHERE id = 'staff-1'").one().notes).toBe(
      'migration-3',
    );
    expect(
      state.storage.sql.exec("SELECT name FROM sqlite_master WHERE name = 'staff_name_index'").one()
        .name,
    ).toBe('staff_name_index');
    expect(state.storage.sql.exec('SELECT * FROM data_version').one()).toEqual({
      id: 1,
      schema_version: next + 1,
      staff_order_revision: 1,
      generation,
      restored_to: null,
      finished_restore_ids: '[]',
      pending_restore_ids: '[]',
    });
    expect(
      state.storage.sql.exec('SELECT data_change_number FROM backup_state').one()
        .data_change_number,
    ).toBe(changeNumber + 1);
    const records = state.storage.kv.get('schema:migrations');
    expect(records).toEqual(
      migrations.map(({ number, additive }) => ({ number, additive, summary: expect.any(String) })),
    );
    const before = snapshot(state.storage);
    await applyMigrations(state.storage, migrations);
    expect(snapshot(state.storage)).toEqual(before);
    expect(state.storage.kv.get('schema:migrations')).toEqual(records);
  });
});

test.each(['空', '既存'])(
  '%sの保存先で二本目の形の変更が失敗すると、その回の変更と記録をすべて取り消す',
  async (initial) => {
    await runInDurableObject(newObject(), async (_instance, state) => {
      if (initial === '空') await state.storage.deleteAll();
      else addStaff(state.storage);
      const known = initial === '空' ? [] : MIGRATIONS;
      const next = known.length + 1;
      const first =
        initial === '空'
          ? MIGRATIONS[0]
          : {
              number: next,
              sql: "CREATE INDEX staff_name_index ON staff(name); UPDATE staff SET notes = 'changed';",
              additive: false,
            };
      const second =
        initial === '空'
          ? MIGRATIONS[1]
          : { number: next + 1, sql: 'ALTER TABLE staff ADD COLUMN extra TEXT;', additive: true };
      const before = snapshot(state.storage);
      const records = state.storage.kv.get('schema:migrations');
      await expect(
        applyMigrations(state.storage, [
          ...known,
          first,
          {
            ...second,
            sql: `${second.sql} SELECT missing_column FROM staff;`,
          },
        ]),
      ).rejects.toMatchObject({ code: 'E-43' });
      expect(snapshot(state.storage)).toEqual(before);
      expect(state.storage.kv.get('schema:migrations')).toEqual(records);
    });
  },
);

test('day states, work slots and period URL keys reject duplicates', async () => {
  await runInDurableObject(newObject(), (_instance, state) => {
    addStaff(state.storage);
    const insertDay = () =>
      state.storage.sql.exec(
        'INSERT INTO day_states (staff_id, date, status, last_changed_by, last_changed_at) VALUES (?, ?, ?, ?, ?)',
        'staff-1',
        '2026-10-01',
        'none',
        'operator',
        '2026-10-01T00:00:00.000Z',
      );
    insertDay();
    expect(insertDay).toThrow();
    const insertWork = (building: number, facility: string) =>
      state.storage.sql.exec(
        'INSERT INTO work_slots (staff_id, date, building, first_start_time, first_end_time, first_facility, last_changed_by, last_changed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        'staff-1',
        '2026-10-01',
        building,
        '09:00',
        '12:00',
        facility,
        'operator',
        '2026-10-01T00:00:00.000Z',
      );
    insertWork(1, 'A');
    expect(() => insertWork(1, 'B')).toThrow();
    insertWork(2, 'C');
    expect(state.storage.sql.exec('SELECT COUNT(*) AS count FROM day_states').one().count).toBe(1);
    expect(state.storage.sql.exec('SELECT COUNT(*) AS count FROM work_slots').one().count).toBe(2);
    const insertPeriod = (id: string, key: string) =>
      state.storage.sql.exec(
        'INSERT INTO periods (id, name, start_date, end_date, request_deadline_date, request_url_key) VALUES (?, ?, ?, ?, ?, ?)',
        id,
        'Test',
        '2026-10-01',
        '2026-10-31',
        '2026-09-25',
        key,
      );
    insertPeriod('period-1', 'test-key-1');
    expect(() => insertPeriod('period-2', 'test-key-1')).toThrow();
    insertPeriod('period-2', 'test-key-2');
  });
});

test('移行後のデータベースは公休の状態を直接書くことを拒否する', async () => {
  await runInDurableObject(newObject(), (_instance, state) => {
    addStaff(state.storage);
    expect(() =>
      state.storage.sql.exec(
        "INSERT INTO day_states (staff_id, date, status, last_changed_by, last_changed_at) VALUES ('staff-1', '2026-10-01', 'holiday', 'first', 'saved-at')",
      ),
    ).toThrow();
    expect(state.storage.sql.exec('SELECT * FROM day_states').toArray()).toEqual([]);
  });
});
