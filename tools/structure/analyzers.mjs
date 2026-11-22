import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ESLint } from 'eslint';
import { limits, lineOptions } from '../../eslint.config.mjs';
import { root, localPath } from './files.mjs';

const execute = promisify(execFile);

async function jsonCommand(script, args) {
  try {
    const { stdout } = await execute(process.execPath, [resolve(root, script), ...args], {
      cwd: root,
      maxBuffer: 32 * 1024 * 1024,
      timeout: 25000,
      env: { ...process.env, CI: 'true', NO_COLOR: '1' },
    });
    return stdout;
  } catch (error) {
    // 道具のエラーは基準値の負債にはしない。走らなければ必ず止める。
    throw new Error(`${script}: ${error.stderr || error.message}`);
  }
}

export async function checkSizes(entries, report) {
  const eslint = new ESLint({
    cwd: root,
    allowInlineConfig: false,
    overrideConfig: {
      rules: {
        'max-lines': ['error', { max: 0, ...lineOptions }],
        'max-lines-per-function': ['error', { max: 0, ...lineOptions }],
      },
    },
  });
  const results = await eslint.lintFiles(
    entries.filter(({ source }) => source).map(({ file }) => file),
  );
  const sizes = { files: [], functions: [] };
  for (const result of results) {
    const file = localPath(result.filePath);
    for (const message of result.messages) {
      if (!['max-lines', 'max-lines-per-function'].includes(message.ruleId))
        throw new Error(`${file}:${message.line ?? 1} ${message.message}`);
      const lines = Number(/\((\d+)\)/.exec(message.message)?.[1]);
      if (!Number.isSafeInteger(lines)) throw new Error(`行数を読めません: ${message.message}`);
      const kind = message.ruleId === 'max-lines' ? 'file' : 'function';
      sizes[kind === 'file' ? 'files' : 'functions'].push({ file, line: message.line, lines });
      if (lines > limits[kind])
        report(
          `size/${kind}-lines`,
          file,
          message.line,
          `${lines}行（上限${limits[kind]}行、超過${lines - limits[kind]}行）`,
          lines - limits[kind],
        );
    }
  }
  return sizes;
}

export async function checkDuplicates(report) {
  const directory = await mkdtemp(join(tmpdir(), 'shift-structure-'));
  try {
    await jsonCommand('node_modules/jscpd/run-jscpd.js', [
      '--config',
      '.jscpd.json',
      '--output',
      directory,
      '--fail-on-empty',
      '--absolute',
    ]);
    const result = JSON.parse(await readFile(join(directory, 'jscpd-report.json'), 'utf8'));
    if (!Array.isArray(result.duplicates)) throw new Error('jscpdの結果を読めません');
    for (const duplicate of result.duplicates) {
      for (const [fragment, other] of [
        [duplicate.firstFile, duplicate.secondFile],
        [duplicate.secondFile, duplicate.firstFile],
      ]) {
        if (!fragment?.name || !Number.isInteger(fragment.start))
          throw new Error('jscpdの場所を読めません');
        report(
          'duplicates/blocks',
          localPath(resolve(root, fragment.name)),
          fragment.start,
          `${duplicate.lines}行の書き写し: ${localPath(resolve(root, other.name))}:${other.start}`,
        );
      }
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function checkUnused(entries, report) {
  const output = await jsonCommand('node_modules/knip/bin/knip.js', [
    '--config',
    'knip.json',
    '--reporter',
    'json',
    '--no-progress',
    '--no-config-hints',
    '--no-exit-code',
  ]);
  const result = JSON.parse(output);
  if (!Array.isArray(result.issues)) throw new Error('knipの結果を読めません');
  const scope = new Set(entries.filter(({ source }) => source).map(({ path }) => path));
  for (const issue of result.issues) {
    const file = localPath(resolve(root, issue.file));
    if (!scope.has(file)) continue;
    for (const category of ['files', 'exports', 'types', 'nsExports', 'nsTypes'])
      for (const symbol of issue[category] ?? [])
        report(
          `unused/${category}`,
          file,
          symbol.line ?? 1,
          symbol.name ?? 'どこからも読まれていないファイル',
        );
  }
}
