import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { collect, compareBaseline, writeBaseline } from './baseline.mjs';
import { root, sources, localPath } from './files.mjs';
import { checkImports } from './imports.mjs';
import { checkOwnership } from './ownership.mjs';
import { checkStyles } from './styles.mjs';
import { checkTypes } from './types.mjs';
import { checkSizes, checkDuplicates, checkUnused } from './analyzers.mjs';

function entry(path, text) {
  const file = resolve(root, path);
  return {
    file,
    path,
    text,
    source: path.endsWith('.css')
      ? undefined
      : ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true),
  };
}

function scan(check, entries) {
  const result = collect();
  check(entries, result.report);
  return result;
}

test('基準値のないファイルの増加で止まり、更新しても増加を取り込まない', (t) => {
  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'error', () => {});
  const dir = mkdtempSync(join(tmpdir(), 'structure-baseline-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'baseline.json');
  writeBaseline(file, { rule: { 'old.ts': 3, 'growing.ts': 1, 'deleted.ts': 2 } });
  const current = { rule: { 'old.ts': 1, 'growing.ts': 2, 'new.ts': 1 } };
  const original = readFileSync(file, 'utf8');
  assert.equal(compareBaseline(file, current, [], false), false);
  assert.equal(readFileSync(file, 'utf8'), original);
  assert.equal(compareBaseline(file, current, [], true), false);
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), {
    rule: { 'growing.ts': 1, 'old.ts': 1 },
  });
  assert.equal(compareBaseline(file, { rule: { 'old.ts': 1 } }, [], false), true);
  assert.throws(() => compareBaseline(join(dir, 'missing.json'), current, [], true));
});

test('画面間と共通・サーバー・shared・toolsからの禁止した読み込みを全ての構文で数える', () => {
  const { counts } = scan(checkImports, [
    entry(
      'frontend/src/pay/probe.ts',
      `import '../shift/model'; export * from '../staff/model'; import('../yearly/day-model'); type T = import('../periods/model').T; const x = require('../request/model');`,
    ),
    entry('frontend/src/parts/probe.ts', `import '../pay/model';`),
    entry(
      'shared/probe.ts',
      `import '../server/src/index'; import '../frontend/src/pay/model'; import 'react';`,
    ),
    entry('server/src/probe.ts', `import '../../frontend/src/pay/model';`),
    entry('tools/structure/probe.mjs', `import '../../frontend/src/pay/model';`),
    entry('frontend/src/shift/ShiftTab.tsx', `import '../yearly/DayDialog';`),
    entry('frontend/src/main.tsx', `import './request/RequestSheet';`),
  ]);
  assert.deepEqual(counts['imports/direction'], {
    'frontend/src/pay/probe.ts': 5,
    'frontend/src/parts/probe.ts': 1,
    'shared/probe.ts': 3,
    'server/src/probe.ts': 1,
    'tools/structure/probe.mjs': 1,
  });
});

test('設定にある別名の読み込みでも向きを検査する', (t) => {
  const directory = mkdtempSync(resolve(root, 'tools/structure/alias-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  writeFileSync(
    join(directory, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        baseUrl: root,
        paths: { '@screen/*': ['frontend/src/*'] },
      },
    }),
  );
  const probe = entry('tools/structure/probe.mjs', `export * from '@screen/pay/model';`);
  probe.file = join(directory, 'probe.ts');
  assert.equal(scan(checkImports, [probe]).counts['imports/direction'][probe.path], 1);
});

test('施設の順序と施設一覧・上限・本文・日付・丸数字・氏名・勤務の持ち主を見張る', () => {
  const { counts } = scan(checkOwnership, [
    entry('shared/calendar.ts', `export const facilities = ['D', 'C', 'B', 'A'] as const;`),
    entry(
      'server/src/probe.ts',
      `const facilities = ['A', 'B', 'C', 'D']; const MAX_INPUT_BYTES = 1; request.json(); date.setUTCDate(2); const n = 0x2460; function splitStaffName() {} sql.exec('UPDATE work_slots SET revision = 1'); vi.mock('x');`,
    ),
    entry('server/src/saves/work-day.ts', `sql.exec('DELETE FROM work_slots');`),
  ]);
  for (const category of [
    'facilities-order',
    'facilities',
    'limits',
    'body',
    'date',
    'leave',
    'staff',
    'work',
    'test-double',
  ])
    assert.equal(
      Object.values(counts[`ownership/${category}`]).reduce((sum, n) => sum + n, 0),
      1,
      category,
    );
});

const arrival = entry(
  'frontend/src/parts/Reveal.css',
  '@keyframes period-arrival { from { filter: blur(var(--motion-reveal-blur)); } to { filter: blur(0); } }',
);

test('CSSとSVG・styleの決まりの値と動きの読み取りを見張る', () => {
  const { counts, findings } = scan(checkStyles, [
    arrival,
    entry(
      'frontend/src/styles/tokens.css',
      ':root { --color: #fff; } @font-face { font-weight: 500; }',
    ),
    entry(
      'frontend/src/pay/probe.css',
      '.pay-probe { border: 1px solid red; font-size: 15px; font-weight: 500; border-radius: 2px; box-shadow: 1px 1px black; transition: opacity 1s ease; line-height: 15px; font: bold 15px sans-serif; filter: blur(3px); }',
    ),
    entry(
      'frontend/src/pay/Probe.tsx',
      `const style = { color: 'red' }; const props = { fill: '#fff' }; const token = '--motion-fast'; const node = <svg {...props} style={style} fontSize="13px" />; getComputedStyle(document.body).getPropertyValue(token);`,
    ),
    entry(
      'frontend/src/parts/motion.ts',
      `getComputedStyle(document.body).getPropertyValue('--motion-fast');`,
    ),
  ]);
  assert.equal(counts['styles/blur']['frontend/src/pay/probe.css'], 1);
  assert.ok(counts['styles/value']['frontend/src/pay/probe.css'] >= 8);
  assert.equal(counts['styles/value']['frontend/src/pay/Probe.tsx'], 4);
  assert.ok(
    !findings.some(
      ({ file }) =>
        file === 'frontend/src/styles/tokens.css' || file === 'frontend/src/parts/motion.ts',
    ),
  );
});

test('基本のclassの重複とにじみの動きのコピーを検出し、持ち主の欠落でも止まる', () => {
  const { counts } = scan(checkStyles, [
    arrival,
    entry(
      'frontend/src/pay/a.css',
      '.duplicate { color: inherit; } @keyframes copied { 0% { filter: blur(0); } 100% { filter: blur(0); } }',
    ),
    entry('frontend/src/pay/b.css', '.duplicate { color: inherit; }'),
  ]);
  assert.equal(counts['styles/class-owner']['frontend/src/pay/a.css'], 1);
  assert.equal(counts['styles/class-owner']['frontend/src/pay/b.css'], 1);
  assert.equal(counts['styles/arrival-copy']['frontend/src/pay/a.css'], 1);
  assert.equal(
    scan(checkStyles, []).counts['styles/arrival-owner']['frontend/src/parts/Reveal.css'],
    1,
  );
});

test('型の抜け道を構文とコメントで数え、文字列やJSXの文は数えない', () => {
  const { counts } = scan(checkTypes, [
    entry(
      'frontend/src/pay/Probe.tsx',
      `
    let a: any; let b = (value as unknown) as string;
    // @ts-ignore
    // @ts-expect-error
    /* eslint-disable */
    const text = 'any as unknown as @ts-ignore eslint-disable';
    const node = <div>any @ts-ignore eslint-disable</div>;
    function empty() { /* eslint-disable-next-line */ }
  `,
    ),
  ]);
  for (const category of ['any', 'as-unknown-as', 'ts-ignore', 'ts-expect-error'])
    assert.equal(counts[`types/${category}`]['frontend/src/pay/Probe.tsx'], 1);
  assert.equal(counts['types/eslint-disable']['frontend/src/pay/Probe.tsx'], 2);
});

test('ファイルと関数の行数は空行とコメントを除き、既存の超過が育っても数が増える', async (t) => {
  const directory = mkdtempSync(resolve(root, 'tools/structure/size-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = join(directory, 'probe.mjs');
  writeFileSync(
    file,
    `/* eslint-disable max-lines, max-lines-per-function */\nfunction probe() {\n${'  run();\n\n  // comment\n'.repeat(401)}}\n`,
  );
  const result = collect();
  const sizes = await checkSizes([{ file, source: true }], result.report);
  assert.equal(sizes.files[0].lines, 403);
  assert.equal(sizes.functions[0].lines, 403);
  assert.equal(Object.values(result.counts['size/file-lines'])[0], 3);
  assert.equal(Object.values(result.counts['size/function-lines'])[0], 303);
});

test('新しいファイルの書き写し・未使用ファイル・関数・型を道具の結果から数える', async (t) => {
  const directory = mkdtempSync(resolve(root, 'tools/structure/analysis-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const duplicate = `export function calculate(items) {
    const selected = items.filter(item => item.active);
    const amounts = selected.map(item => item.amount);
    const total = amounts.reduce((sum, amount) => sum + amount, 0);
    const count = selected.length;
    const average = count ? total / count : 0;
    return { total, count, average };
  }`;
  writeFileSync(join(directory, 'a.mjs'), duplicate);
  writeFileSync(join(directory, 'b.mjs'), duplicate);
  writeFileSync(
    join(directory, 'run.mjs'),
    `import { used } from './functions.ts'; console.log(used());`,
  );
  writeFileSync(
    join(directory, 'functions.ts'),
    `export function used() { return 1; } export function unused() { return 2; } export type UnusedType = { value: string };`,
  );
  const result = collect();
  await Promise.all([checkDuplicates(result.report), checkUnused(sources(), result.report)]);
  assert.ok(result.counts['duplicates/blocks'][localPath(join(directory, 'a.mjs'))] > 0);
  assert.equal(result.counts['unused/files'][localPath(join(directory, 'b.mjs'))], 1);
  assert.equal(result.counts['unused/exports'][localPath(join(directory, 'functions.ts'))], 1);
  assert.equal(result.counts['unused/types'][localPath(join(directory, 'functions.ts'))], 1);
});
