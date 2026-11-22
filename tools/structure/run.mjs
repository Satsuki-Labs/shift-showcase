import { resolve } from 'node:path';
import { root, sources } from './files.mjs';
import { collect, compareBaseline } from './baseline.mjs';
import { checkSizes, checkDuplicates, checkUnused } from './analyzers.mjs';
import { checkImports } from './imports.mjs';
import { checkOwnership } from './ownership.mjs';
import { checkStyles } from './styles.mjs';
import { checkTypes } from './types.mjs';
import { printSummary } from './summary.mjs';

const started = performance.now();
try {
  if (process.argv.slice(2).some((arg) => arg !== '--update'))
    throw new Error('使い方: npm run structure [-- --update]');
  const entries = sources();
  const { counts, findings, report } = collect();
  const [sizes] = await Promise.all([
    checkSizes(entries, report),
    checkDuplicates(report),
    checkUnused(entries, report),
  ]);
  checkImports(entries, report);
  checkOwnership(entries, report);
  checkStyles(entries, report);
  checkTypes(entries, report);
  const passed = compareBaseline(
    resolve(root, 'tools/structure/baseline.json'),
    counts,
    findings,
    process.argv.includes('--update'),
  );
  const seconds = (performance.now() - started) / 1000;
  printSummary(counts, sizes, seconds);
  if (!passed || seconds > 30) {
    if (seconds > 30) console.error('コードのつくりの検査が30秒を超えました');
    process.exitCode = 1;
  }
} catch (error) {
  console.error(`コードのつくりの検査を実行できません：${error.message}`);
  process.exitCode = 1;
}
