import { createReadStream } from 'node:fs';
import { mkdtemp, readFile, rm, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { createInterface } from 'node:readline';
import { DatabaseSync } from 'node:sqlite';
import { createGunzip } from 'node:zlib';
import ts from 'typescript';
import { INCLUDED_TABLES } from '../../server/src/backup/file.ts';

export const SCHEMA_TIME_LIMIT_SECONDS = 20;

export async function readMigrations(root) {
  const path = join(root, 'server/src/schema/migrations.ts');
  const source = ts.createSourceFile(
    path,
    await readFile(path, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const imports = new Map();
  for (const node of source.statements) {
    if (
      ts.isImportDeclaration(node) &&
      node.importClause?.name &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      node.moduleSpecifier.text.endsWith('.sql?raw')
    ) {
      imports.set(
        node.importClause.name.text,
        resolve(dirname(path), node.moduleSpecifier.text.slice(0, -4)),
      );
    }
  }
  const declaration = source.statements
    .filter(ts.isVariableStatement)
    .flatMap((node) => [...node.declarationList.declarations])
    .find((node) => ts.isIdentifier(node.name) && node.name.text === 'MIGRATIONS');
  if (!declaration?.initializer || !ts.isArrayLiteralExpression(declaration.initializer))
    throw new Error('データの形の変更を読めません。');
  const migrations = [];
  for (const element of declaration.initializer.elements) {
    const properties = ts.isObjectLiteralExpression(element) ? element.properties : [];
    const value = (name) =>
      properties.find(
        (property) => ts.isPropertyAssignment(property) && property.name.getText(source) === name,
      )?.initializer;
    const number = value('number'),
      sql = value('sql');
    if (
      !number ||
      !ts.isNumericLiteral(number) ||
      Number(number.text) !== migrations.length + 1 ||
      !sql
    )
      throw new Error('データの形の番号を特定できません。');
    let text;
    if (ts.isStringLiteral(sql) || ts.isNoSubstitutionTemplateLiteral(sql)) text = sql.text;
    else if (ts.isIdentifier(sql) && imports.has(sql.text))
      text = await readFile(imports.get(sql.text), 'utf8');
    else throw new Error('データの形の変更のSQLを読めません。');
    migrations.push({ number: Number(number.text), sql: text });
  }
  if (!migrations.length) throw new Error('データの形の番号を特定できません。');
  return migrations;
}

function apply(db, migration) {
  db.exec('BEGIN');
  try {
    db.exec(migration.sql);
    if (migration.number === 1) {
      db.prepare('INSERT INTO data_version (id, schema_version, generation) VALUES (1, ?, ?)').run(
        migration.number,
        'schema-timing',
      );
    } else
      db.prepare('UPDATE data_version SET schema_version = ? WHERE id = 1').run(migration.number);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export async function measureSchema(backupPath, previousSchema, migrations) {
  if (
    !Number.isSafeInteger(previousSchema) ||
    previousSchema < 1 ||
    previousSchema > migrations.at(-1).number
  ) {
    throw new Error('前の版のデータの形を手元で再現できません。');
  }
  const directory = await mkdtemp(join(tmpdir(), 'shift-schema-'));
  let db, input, gzip, lines;
  let stage = 'prepare';
  try {
    // Use a temporary disk database so that the measured commits include writes to disk.
    db = new DatabaseSync(join(directory, 'schema.sqlite'));
    db.exec('PRAGMA foreign_keys = ON');
    for (const migration of migrations.filter((item) => item.number <= previousSchema))
      apply(db, migration);
    // Initial migrations seed some business tables. Replace those rows with the backup's exact contents.
    db.exec('BEGIN');
    for (const table of [...INCLUDED_TABLES].reverse()) db.exec(`DELETE FROM "${table}"`);
    stage = 'backup';
    input = createReadStream(backupPath);
    gzip = createGunzip();
    input.on('error', (error) => gzip.destroy(error));
    lines = createInterface({ input: input.pipe(gzip), crlfDelay: Infinity });
    let header = false,
      ended = false,
      tableIndex = 0,
      rows = 0,
      insert,
      columns = [];
    const invalid = () => {
      throw new Error('バックアップの表・列・行・件数を確認できません。');
    };
    for await (const line of lines) {
      if (ended) invalid();
      const value = JSON.parse(line);
      if (!header) {
        if (value?.format !== 'shift-showcase-backup' || value.formatVersion !== 2)
          throw new Error('バックアップのファイルの形の版が違います。');
        if (value.schemaVersion !== previousSchema)
          throw new Error('バックアップのデータの形の版が前の版と違います。');
        header = true;
      } else if (Array.isArray(value)) {
        if (!insert || value.length !== columns.length) invalid();
        insert.run(...value);
        rows++;
      } else if (value?.end === true) {
        if (
          tableIndex !== INCLUDED_TABLES.length ||
          value.tables !== tableIndex ||
          value.rows !== rows
        )
          invalid();
        ended = true;
      } else {
        const table = INCLUDED_TABLES[tableIndex];
        if (!table || value?.table !== table) invalid();
        columns = db
          .prepare(`SELECT * FROM "${table}" LIMIT 0`)
          .columns()
          .map((column) => column.name);
        if (
          !Array.isArray(value.columns) ||
          value.columns.length !== columns.length ||
          columns.some((column, index) => column !== value.columns[index])
        )
          invalid();
        insert = db.prepare(
          `INSERT INTO "${table}" (${columns.map((column) => `"${column}"`).join(',')}) VALUES (${columns.map(() => '?').join(',')})`,
        );
        tableIndex++;
      }
    }
    if (!header || !ended) invalid();
    db.exec('COMMIT');
    stage = 'measure';
    const start = performance.now();
    for (const migration of migrations.filter((item) => item.number > previousSchema))
      apply(db, migration);
    return (performance.now() - start) / 1000;
  } catch (error) {
    // SQLite errors can contain a backed-up value; keep the data out of terminal output.
    if (stage === 'backup' && error instanceof Error && error.message.startsWith('バックアップ'))
      throw error;
    throw new Error(
      stage === 'backup'
        ? 'バックアップのファイルを読み込めません。'
        : stage === 'measure'
          ? '新しい版の表の形の変更を手元で実行できません。'
          : '前の版の表の形を手元で作れません。',
    );
  } finally {
    lines?.close();
    input?.destroy();
    gzip?.destroy();
    db?.close();
    await rm(join(directory, 'schema.sqlite'), { force: true });
    await rmdir(directory);
  }
}
