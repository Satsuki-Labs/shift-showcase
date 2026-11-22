import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { withCleanup } from './cleanup.mjs';

const usage = `使い方：
  npm run maintenance -- restore --at "2026-11-12 14:05:37" --url <アプリのURL>
  npm run maintenance -- restore-finish --id <操作の番号> --to <戻した時点のISO日時> --url <アプリのURL>
  npm run maintenance -- import <ファイル> [--id <操作の番号>] --url <アプリのURL>
公開が原因でデータが壊れたときは、先にコードを前の版に戻してから戻す。`;
const uuid = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;
function validDate(value) {
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function fromJapan(value) {
  if (
    !/^\d{4}-\d\d-\d\d (?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(value) ||
    !validDate(value.slice(0, 10))
  )
    throw new Error();
  return new Date(
    value.replace(' ', 'T') + (value.length === 16 ? ':00' : '') + '+09:00',
  ).toISOString();
}
function iso(value) {
  if (
    !/^\d{4}-\d\d-\d\dT(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(
      value,
    ) ||
    !validDate(value.slice(0, 10)) ||
    !Number.isFinite(Date.parse(value))
  )
    throw new Error();
  return new Date(value).toISOString();
}
function japanParts(at) {
  return new Date(Date.parse(at) + 9 * 3600000).toISOString();
}
function displayTime(at, seconds = false) {
  const p = japanParts(at);
  return `${p.slice(0, 4)}年${Number(p.slice(5, 7))}月${Number(p.slice(8, 10))}日 ${p.slice(11, seconds ? 19 : 16)}`;
}
function parse(args) {
  const [operation, ...rest] = args;
  if (!['restore', 'restore-finish', 'import'].includes(operation)) throw new Error();
  const options = {},
    positional = [];
  for (let i = 0; i < rest.length; i++) {
    if (!rest[i].startsWith('--')) {
      positional.push(rest[i]);
      continue;
    }
    const key = rest[i].slice(2);
    if (
      !['url', 'id', 'to', 'at'].includes(key) ||
      options[key] !== undefined ||
      !rest[i + 1] ||
      rest[i + 1].startsWith('--')
    )
      throw new Error();
    options[key] = rest[++i];
  }
  const allowed = {
    restore: ['url', 'at'],
    'restore-finish': ['url', 'id', 'to'],
    import: ['url', 'id'],
  }[operation];
  if (
    Object.keys(options).some((key) => !allowed.includes(key)) ||
    positional.length !== (operation === 'import' ? 1 : 0)
  )
    throw new Error();
  const url = new URL(options.url);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.protocol !== 'https:' &&
      !(url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname)))
  )
    throw new Error();
  if (options.id !== undefined && !uuid.test(options.id)) throw new Error();
  let target;
  if (operation === 'restore') {
    target = { at: options.at, to: fromJapan(options.at) };
  }
  if (operation === 'restore-finish' && (!options.id || !options.to)) throw new Error();
  if (operation === 'restore-finish') target = { to: iso(options.to) };
  return { operation, options, url, file: positional[0], target };
}
function quote(value) {
  return `'${value.replaceAll("'", "''")}'`;
}
function finishCommand(url, id, to) {
  return `npm run maintenance -- restore-finish --url ${quote(url)} --id ${quote(id)} --to ${quote(to)}`;
}
function importCommand(url, file, id) {
  return `npm run maintenance -- import ${quote(file)} --url ${quote(url)} --id ${quote(id)}`;
}
function showError(reply, id) {
  console.error(`失敗しました。番号：${reply.code ?? '不明'}${id ? `、操作の番号：${id}` : ''}`);
  if (reply.table !== undefined || reply.line !== undefined)
    console.error(`場所：表 ${reply.table ?? 'ファイル全体'}、ファイルの${reply.line ?? 0}行目`);
  if (reply.reason) console.error(`理由：${reply.reason}`);
  if (reply.field) console.error(`項目：${reply.field}`);
  if (reply.code === 'E-45')
    console.error(
      `ファイルの形の版：${reply.formatVersion}、データの形の版：${reply.schemaVersion}`,
    );
}
export async function run(args) {
  let parsed;
  try {
    parsed = parse(args);
  } catch {
    console.error(usage);
    return 1;
  }
  return withCleanup(parsed.url, () => execute(parsed));
}
function requestHeaders(address) {
  const url = new URL(address);
  if (url.protocol === 'https:') {
    console.log(
      'これは本番のデータを書き換える操作です。AIがこの命令を打った場合は、ここで止まり、この会話で保守担当からこの操作の許可を受けているかを確かめてください。',
    );
  }
  const headers = { Origin: url.origin };
  if (url.protocol === 'https:') {
    try {
      const token = execFileSync('cloudflared', ['access', 'token', `-app=${address}`], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      }).trim();
      if (!token || /\s/.test(token)) throw new Error();
      headers['cf-access-token'] = token;
    } catch {
      console.error(
        `ログインの証明を取得できません。次を実行してください：\ncloudflared access login --quiet ${quote(address)}`,
      );
      return null;
    }
  }
  return headers;
}
function createClient(url, headers, options) {
  async function post(action, body, id) {
    const endpoint = new URL(`/api/maintenance/${action}`, url);
    if (id) endpoint.searchParams.set('id', id);
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(60000),
        headers: {
          ...headers,
          'Content-Type': action === 'import' ? 'application/gzip' : 'application/json',
        },
        body: action === 'import' ? body : JSON.stringify(body),
      });
      const reply = await response.json();
      if (!response.ok && typeof reply?.code !== 'string') return null;
      if (!reply || typeof reply !== 'object') return null;
      return reply;
    } catch {
      return null;
    }
  }
  const restart = () => post('restart', {});
  async function finish(id, to) {
    await restart();
    let pending = 0;
    for (let attempt = 0; attempt < 30; attempt++) {
      const reply = await post('restore-finish', { id, to });
      if (reply?.ok === true) {
        console.log(`戻しました。戻した時点：${displayTime(to, true)}（おおよそ）`);
        return 0;
      }
      if (reply && reply.code !== 'E-46') {
        showError(reply, id);
        return 1;
      }
      pending = reply?.code === 'E-46' ? pending + 1 : 0;
      if (pending && pending % 5 === 0) await restart();
      if (attempt < 29) await sleep(2000);
    }
    console.error(
      `まだ終わっていません。次をそのまま実行してください：\n${finishCommand(options.url, id, to)}`,
    );
    return 1;
  }
  return { post, finish };
}
async function execute({ operation, options, url, file, target }) {
  const headers = requestHeaders(options.url);
  if (!headers) return 1;
  const { post, finish } = createClient(url, headers, options);
  if (operation === 'restore-finish') return finish(options.id, target.to);
  if (operation === 'restore') {
    const id = randomUUID();
    const reply = await post('restore-prepare', { id, at: target.at });
    if (!reply) {
      console.error('予約の答えが届きませんでした。戻す操作はまだ終わっていません。');
      return 1;
    }
    if (reply.code) {
      showError(reply, id);
      return 1;
    }
    try {
      console.log(
        `戻す前の時刻：${displayTime(iso(reply.at), true)}（この時刻へ戻すと、今回戻す前の状態に戻せます）`,
      );
    } catch {
      console.error('戻す前の時刻の答えを読めません。');
      return 1;
    }
    return finish(id, target.to);
  }
  const id = options.id ?? randomUUID();
  let bytes;
  try {
    bytes = await readFile(file);
  } catch {
    console.error(`ファイルを読めません。\n${usage}`);
    return 1;
  }
  const reply = await post('import', bytes, id);
  if (!reply) {
    console.error(
      `答えが届きませんでした。同じ操作の番号で送り直してください：\n${importCommand(options.url, file, id)}`,
    );
    return 1;
  }
  if (reply.code || reply.ok !== true) {
    showError(reply, id);
    return 1;
  }
  try {
    console.log(
      `読み込みました。ファイルを作った日時：${displayTime(reply.createdAt)}、スタッフ ${reply.staff}人、ピリオド ${reply.periods}件`,
    );
  } catch {
    console.error(
      `答えを読めません。同じ操作の番号で送り直してください：\n${importCommand(options.url, file, id)}`,
    );
    return 1;
  }
  return 0;
}
