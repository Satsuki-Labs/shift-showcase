import { appendFile, mkdir, readFile, readdir, realpath } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { dirname, extname, join, relative, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { devNull } from 'node:os';
import { parseEnv } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import ts from 'typescript';
import { measureSchema, readMigrations, SCHEMA_TIME_LIMIT_SECONDS } from './measure-schema.mjs';
import { executeTool } from './execute.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const worker = 'shift-showcase';
const url = 'https://shift-showcase.your-subdomain.workers.dev/';
const fields = [
  '公開日時',
  'コミット',
  '組み立てた版の番号',
  'データの形の番号',
  '直前の版のID',
  '戻すときの時刻',
];
const versionId = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
const usage =
  '使い方：npm run release -- check | deploy [--dry-run] [--initial] [--backup <前の晩のバックアップのファイル>]';

function inside(parent, child) {
  const path = relative(parent, child);
  return (
    path !== '' &&
    path !== '..' &&
    !path.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) &&
    !isAbsolute(path)
  );
}
async function optional(path) {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return '';
    throw error;
  }
}
function jsonc(text) {
  const parsed = ts.parseConfigFileTextToJson('wrangler.jsonc', text);
  if (parsed.error) throw new Error('公開の設定を読めません。');
  return parsed.config;
}
async function files(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error('公開する出力にリンクがあります。');
    if (entry.isDirectory()) result.push(...(await files(path)));
    else if (entry.isFile()) result.push(path);
    else throw new Error('公開する出力に通常のファイル以外があります。');
  }
  return result;
}
function missingSettings(config) {
  const vars = config.vars ?? {};
  const emails = Object.keys(vars.ROLE_TABLE ?? {}).map((email) => email.toLowerCase());
  if (new Set(emails).size !== emails.length)
    throw new Error('ROLE_TABLEのアドレスが大文字と小文字を区別せずに重複しています。');
  return [
    !vars.ACCESS_TEAM?.trim() && 'ACCESS_TEAM',
    !vars.ACCESS_AUDIENCE?.trim() && 'ACCESS_AUDIENCE',
    (!vars.ROLE_TABLE ||
      !Object.keys(vars.ROLE_TABLE).length ||
      Object.entries(vars.ROLE_TABLE).some(
        ([email, role]) =>
          !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
          !['first', 'second', 'maintenance'].includes(role),
      ) ||
      !Object.values(vars.ROLE_TABLE).includes('maintenance')) &&
      'ROLE_TABLE',
  ].filter(Boolean);
}
async function inspectBuild() {
  const input = jsonc(await readFile(join(root, 'wrangler.jsonc'), 'utf8'));
  const deployDirectory = join(root, 'frontend/.wrangler/deploy');
  const redirect = JSON.parse(await readFile(join(deployDirectory, 'config.json'), 'utf8'));
  const configPath = resolve(deployDirectory, redirect.configPath);
  const dist = await realpath(join(root, 'frontend/dist'));
  if (redirect.auxiliaryWorkers?.length || !inside(dist, await realpath(configPath)))
    throw new Error('Viteの公開先を特定できません。');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  const workerDirectory = dirname(configPath);
  const assetDirectory = resolve(workerDirectory, config.assets?.directory ?? '');
  const main = resolve(workerDirectory, config.main ?? '');
  if (
    assetDirectory !== join(dist, 'client') ||
    workerDirectory === assetDirectory ||
    !inside(workerDirectory, await realpath(main)) ||
    config.no_bundle !== true ||
    config.name !== worker ||
    input.name !== worker ||
    config.vars?.ENVIRONMENT !== '本番' ||
    JSON.stringify(config.vars) !== JSON.stringify(input.vars) ||
    config.keep_vars ||
    config.build ||
    config.find_additional_modules ||
    config.rules?.some(
      (rule) =>
        rule.type !== 'ESModule' ||
        rule.globs.some((glob) => !['**/*.js', '**/*.mjs'].includes(glob)),
    )
  ) {
    throw new Error('公開物の設定または送信する範囲が本番用ではありません。');
  }
  const allowed = new Set(['ENVIRONMENT', 'ROLE_TABLE', 'ACCESS_TEAM', 'ACCESS_AUDIENCE']);
  if (Object.keys(config.vars).some((key) => !allowed.has(key)))
    throw new Error('公開する設定に手元用または秘密の項目があります。');
  const privateValues = [];
  for (const directory of [root, join(root, 'frontend'), workerDirectory]) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (!entry.isFile() || !/^(?:\.dev\.vars|\.env)(?:\.|$)/.test(entry.name)) continue;
      const values = parseEnv(await readFile(join(directory, entry.name), 'utf8'));
      if (values.CLOUDFLARE_API_TOKEN || values.CLOUDFLARE_API_KEY)
        throw new Error('設定ファイルにAPIの鍵があります。値を表示せず中止します。');
      for (const [key, value] of Object.entries(values)) {
        if (value && (key === 'LOCAL_EMAIL' || /TOKEN|SECRET|PASSWORD|GAS_URL/.test(key)))
          privateValues.push(value);
      }
    }
  }
  const workerFiles = await files(workerDirectory);
  const assetFiles = await files(assetDirectory);
  if (!assetFiles.includes(join(assetDirectory, '_headers')))
    throw new Error('画面のファイルの守りの見出しが組み立てた出力にありません。');
  const sent = workerFiles.filter(
    (path) =>
      ['.js', '.mjs'].includes(extname(path)) ||
      (config.upload_source_maps && path.endsWith('.map')),
  );
  for (const path of [...sent, ...assetFiles]) {
    if (/^(?:\.dev\.vars|\.env)(?:\.|$)/.test(path.split(/[\\/]/).at(-1)))
      throw new Error('公開するファイルに手元の設定の写しがあります。');
    const text = await readFile(path, 'utf8');
    if (privateValues.some((value) => text.includes(value)))
      throw new Error('公開するファイルに手元の設定値があります。値を表示せず中止します。');
    if (path.endsWith('.map')) {
      const map = JSON.parse(text);
      if (map.sources?.some((source) => /(?:^|[\\/])(tests|tools)(?:[\\/])/.test(source)))
        throw new Error('公開するWorkerに試験用のコードがあります。');
    } else if (sent.includes(path)) {
      const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
      function visit(node) {
        const specifier =
          ts.isImportDeclaration(node) || ts.isExportDeclaration(node)
            ? node.moduleSpecifier
            : ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword
              ? node.arguments[0]
              : null;
        if (specifier) {
          if (!ts.isStringLiteral(specifier))
            throw new Error('Workerの読み込むファイルを特定できません。');
          const name = specifier.text;
          if (
            name !== 'cloudflare:workers' &&
            (!name.startsWith('.') || !sent.includes(resolve(dirname(path), name)))
          ) {
            throw new Error('公開するWorkerに本番用と確認できない読み込みがあります。');
          }
        }
        ts.forEachChild(node, visit);
      }
      visit(source);
    }
  }
  const code = await readFile(main, 'utf8');
  const stamp = /\bAPP_VERSION\s*=\s*"([\dT:.Z-]+)"/.exec(code)?.[1];
  if (!stamp || !Number.isFinite(Date.parse(stamp)) || !code.includes('OrganizationObject'))
    throw new Error('組み立てたWorkerの版を確認できません。');
  let sameClient = false;
  for (const path of assetFiles.filter((path) => path.endsWith('.js'))) {
    if ((await readFile(path, 'utf8')).includes(stamp)) sameClient = true;
  }
  if (!sameClient) throw new Error('画面とWorkerの版がそろっていません。');
  const migrations = await readMigrations(root);
  return { configPath, config, stamp, schema: migrations.at(-1).number, migrations };
}
function parseRecord(message) {
  try {
    const record = JSON.parse(message);
    if (record && typeof record === 'object') {
      record[fields[2]] ??= record['組み立てた版の印'];
      record[fields[5]] ??= record['公開前の日時付きの印'];
    }
    if (!record || fields.some((field) => typeof record[field] !== 'string' || !record[field]))
      return null;
    if (!/^[a-f\d]{40}$/i.test(record[fields[1]]) || !/^\d+$/.test(record[fields[3]])) return null;
    return record;
  } catch {
    return null;
  }
}
function previousRecord(id, current, listVersions) {
  const stop = (stoppedId) => {
    throw new Error(`現在の版の説明から公開の記録を読めません。版のID：${stoppedId}`);
  };
  if (current?.id !== id) stop(id);
  const record = parseRecord(current.annotations?.['workers/message']);
  if (record) return { record, id, secrets: [] };
  if (current.annotations?.['workers/triggered_by'] !== 'secret') stop(id);
  const versions = listVersions();
  if (
    !Array.isArray(versions) ||
    versions.some(
      (version) =>
        !versionId.test(version?.id ?? '') ||
        typeof version.metadata?.created_on !== 'string' ||
        !Number.isFinite(Date.parse(version.metadata.created_on)),
    )
  )
    stop(id);
  // Wrangler lists oldest first. Start at the deployed version, ignoring newer uploads.
  const ordered = [...versions].sort((a, b) =>
    b.metadata.created_on.localeCompare(a.metadata.created_on),
  );
  const index = ordered.findIndex((version) => version.id === id);
  if (index < 0) stop(id);
  const secrets = [id];
  for (const version of ordered.slice(index + 1)) {
    const record = parseRecord(version.annotations?.['workers/message']);
    if (record) return { record, id: version.id, secrets };
    if (version.annotations?.['workers/triggered_by'] !== 'secret') stop(version.id);
    secrets.push(version.id);
  }
  stop(secrets.at(-1));
}
function currentVersion(deployments) {
  if (!Array.isArray(deployments) || !deployments.length)
    throw new Error('現在公開されている版を特定できません。');
  const latest = [...deployments].sort((a, b) => b.created_on.localeCompare(a.created_on))[0];
  const versions = latest.versions?.filter((version) => version.percentage > 0);
  if (
    versions?.length !== 1 ||
    versions[0].percentage !== 100 ||
    !versionId.test(versions[0].version_id)
  )
    throw new Error('公開中の版が1つではありません。');
  return versions[0].version_id;
}

function userChanges(config, priorCommit, execute) {
  const current = Object.keys(config.vars.ROLE_TABLE);
  let previous = [];
  if (priorCommit) {
    try {
      const table = jsonc(execute('git', ['show', `${priorCommit}:wrangler.jsonc`]))?.vars
        ?.ROLE_TABLE;
      if (!table || typeof table !== 'object' || Array.isArray(table)) throw new Error();
      previous = Object.keys(table);
    } catch {
      return [
        `ユーザーの追加・削除：前回の公開と比べられませんでした（今回のアドレス：${current.join('、')}）`,
      ];
    }
  }
  const previousEmails = new Set(previous.map((email) => email.toLowerCase()));
  const currentEmails = new Set(current.map((email) => email.toLowerCase()));
  const added = current.filter((email) => !previousEmails.has(email.toLowerCase()));
  const removed = previous.filter((email) => !currentEmails.has(email.toLowerCase()));
  return [
    ...(added.length
      ? [
          `ユーザーの追加：${added.join('、')}（Cloudflareのログインの許可には、管理画面で別に足します）`,
        ]
      : []),
    ...(removed.length
      ? [
          `ユーザーの削除：${removed.join('、')}（Cloudflareのログインの許可からは、管理画面で別に外します）`,
        ]
      : []),
  ];
}

async function inspectPublished(stamp, api, signal) {
  let requestId = null,
    version = '未完了（返事を確認できません）';
  const from = Date.now() - 60000;
  try {
    // Real request keys contain no hyphens; this key can never name a sheet.
    const response = await fetch(new URL('api/request/release-check-invalid-key/load', url), {
      signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]),
      redirect: 'error',
      cache: 'no-store',
    });
    requestId = response.headers.get('X-Request-Id');
    if (!versionId.test(requestId ?? '')) requestId = null;
    // Read no response data unless the server rejected the deliberately invalid key.
    const body = response.status === 404 ? await response.json() : null;
    version =
      response.status === 404 &&
      body?.code === 'E-27' &&
      body.requestId === requestId &&
      requestId &&
      response.headers.get('X-App-Version') === stamp
        ? '確認済み'
        : '未完了（返事の状態・版・要求IDが一致しません）';
  } catch {
    /* The deployment remains published even when its reply cannot be checked. */
  }
  let logs = '未完了（要求IDを取得できません）',
    logsOk = false;
  if (requestId) {
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt) await delay(2000, undefined, { signal });
        const { response, body } = await api('workers/observability/telemetry/query', {
          method: 'POST',
          body: JSON.stringify({
            queryId: crypto.randomUUID(),
            view: 'events',
            timeframe: { from, to: Date.now() },
            parameters: {
              datasets: [worker],
              filters: [{ key: 'requestId', operation: 'eq', type: 'string', value: requestId }],
              filterCombination: 'and',
              limit: 100,
            },
          }),
        });
        if ([401, 403].includes(response.status)) {
          logs = '未確認（Wranglerのログインでは問い合わせられません）';
          logsOk = true;
          break;
        }
        if (!response.ok || !body.success || !Array.isArray(body.result?.events?.events))
          throw new Error();
        if (body.result.events.events.some((event) => event.source?.requestId === requestId)) {
          logs = '確認済み';
          logsOk = true;
          break;
        }
        logs = '未完了（要求IDの記録が見つかりません）';
      }
    } catch {
      logs = '未完了（記録の問い合わせが完了しませんでした）';
      logsOk = false;
    }
  }
  const lines = [
    `新しい版の返事：${version}`,
    `要求ID：${requestId ?? '未確認'}`,
    `記録の到着：${logs}`,
  ];
  for (const line of lines) console.log(line);
  return { lines, ok: version === '確認済み' && logsOk };
}

function inspectCi(commit, execute) {
  try {
    execute('gh', ['--version']);
  } catch {
    throw new Error('ghがありません。GitHub CLIを用意してください。');
  }
  try {
    execute('gh', ['auth', 'status', '--hostname', 'github.com']);
  } catch {
    throw new Error(
      'ghのログインを確認できません。保守担当のGitHubへのログイン状態を確認してください。',
    );
  }
  const api = (path) => {
    const output = execute('gh', ['api', `repos/{owner}/{repo}/${path}`]);
    try {
      return JSON.parse(output);
    } catch {
      throw new Error('GitHubの検査の答えを読めません。');
    }
  };
  const ancestors = execute('git', ['rev-list', '--first-parent', commit]).split(/\r?\n/);
  if (ancestors[0] !== commit || ancestors.some((sha) => !/^[a-f\d]{40}$/i.test(sha)))
    throw new Error('公開するコミットの履歴を読めません。');
  for (let index = 0; index < ancestors.length; index++) {
    const sha = ancestors[index];
    const response = api(`actions/workflows/ci.yml/runs?head_sha=${sha}&branch=main&per_page=100`);
    if (!Array.isArray(response.workflow_runs)) throw new Error('GitHubの検査の答えを読めません。');
    const runs = response.workflow_runs.filter(
      (run) =>
        run.head_sha === sha &&
        run.head_branch === 'main' &&
        ['push', 'workflow_dispatch'].includes(run.event),
    );
    const latest = runs.sort((a, b) => b.id - a.id)[0];
    if (latest) {
      if (!Number.isSafeInteger(latest.id) || latest.id <= 0)
        throw new Error('GitHubの検査の番号を読めません。');
      if (latest.status !== 'completed')
        throw new Error('GitHubの検査が終わるまで待ってから打ち直してください');
      if (latest.conclusion !== 'success')
        throw new Error('GitHubの検査が成功していないので公開を止めます。');
      const response = api(`actions/runs/${latest.id}/jobs?filter=latest&per_page=100`);
      const checks = response.jobs?.filter((job) => job.name === 'check');
      if (
        !checks?.length ||
        checks.some((job) => job.status !== 'completed' || job.conclusion !== 'success')
      ) {
        throw new Error('GitHubの検査（check）の成功を確認できないので公開を止めます。');
      }
      return `GitHubの検査：成功（コミット ${sha}、検査の番号 ${latest.id}）`;
    }
    const parent = ancestors[index + 1];
    if (!parent) break;
    // Inspect every main commit, so an intervening code change followed by a revert cannot be skipped.
    const changed = execute('git', ['diff', '--name-only', '--no-renames', parent, sha])
      .split(/\r?\n/)
      .filter(Boolean);
    if (changed.some((path) => !path.startsWith('design/') && !/^[^/]+\.md$/.test(path))) {
      throw new Error(
        'GitHubの検査が無いコミットにdesign/**・*.md以外の変更があります。mainの検査を実行してください。',
      );
    }
  }
  throw new Error('GitHubの検査が回ったコミットが見つかりません。mainの検査を実行してください。');
}

export async function run(args) {
  const mode = args[0];
  let initial = false,
    dryRun = false,
    backupPath;
  let valid = mode === 'check' || mode === 'deploy';
  for (let index = 1; index < args.length; index++) {
    if (mode === 'deploy' && args[index] === '--initial' && !initial) initial = true;
    else if (mode === 'deploy' && args[index] === '--dry-run' && !dryRun) dryRun = true;
    else if (
      mode === 'deploy' &&
      args[index] === '--backup' &&
      !backupPath &&
      args[index + 1] &&
      !args[index + 1].startsWith('--')
    )
      backupPath = args[++index];
    else valid = false;
  }
  if (!valid) {
    console.error(usage);
    return 1;
  }
  if (mode === 'deploy' && new URL(url).protocol === 'https:') {
    console.log(
      'これは本番への公開です。AIがこの命令を打った場合は、ここで止まり、この会話で保守担当から公開の許可を受けているかを確かめてください。',
    );
  }
  let interrupted = false,
    loginAttempted = false,
    published = false,
    attempted = false,
    id = null,
    record = null,
    recordPath;
  let recordWritten = false,
    step = '公開の確認';
  let status = 1;
  let env = {
    ...process.env,
    WRANGLER_SEND_METRICS: 'false',
    WRANGLER_LOG_PATH: devNull,
    CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false',
  };
  const abort = new AbortController();
  const interrupt = () => {
    interrupted = true;
    abort.abort();
  };
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', interrupt);
  const execute = (tool, arguments_, interactive = false, cleanup = false) => {
    if (interrupted && !cleanup) throw new Error('中止しました。');
    return executeTool(tool, arguments_, { root, env, interactive });
  };
  const ask = async (question) => {
    const terminal = createInterface({ input: process.stdin, output: process.stdout });
    try {
      return (await terminal.question(`${question} `, { signal: abort.signal })).trim();
    } finally {
      terminal.close();
    }
  };
  const wranglerJson = (arguments_, configPath) => {
    const output = execute('wrangler', [
      ...arguments_,
      '--json',
      ...(configPath ? ['--config', configPath] : []),
    ]);
    try {
      return JSON.parse(output);
    } catch {
      throw new Error(`wrangler ${arguments_[0]} の答えを読めません。`);
    }
  };
  const showRecovery = () => {
    console.error(`公開先：${url}、今回の版のID：${id ?? '未確認'}`);
    if (record) for (const field of fields) console.error(`${field}：${record[field]}`);
  };
  const writeRecord = async (lines) => {
    try {
      await mkdir(dirname(recordPath), { recursive: true });
      await appendFile(recordPath, `${lines.join('\n')}\n`, 'utf8');
    } catch {
      const error = new Error(`公開の記録に書けません。書き込み先：${recordPath}`);
      if (!published) throw error;
      console.error(error.message);
      console.error('残りの手順を続けます。');
    }
  };
  try {
    let commit, subject, ci;
    if (mode === 'deploy') {
      const commonDir = resolve(root, execute('git', ['rev-parse', '--git-common-dir']));
      recordPath = join(dirname(commonDir), 'release-log', '公開の記録.txt');
      if (env.CLOUDFLARE_API_TOKEN || env.CLOUDFLARE_API_KEY)
        throw new Error('APIの鍵が設定されています。値を表示せず中止します。');
      if (execute('git', ['status', '--porcelain', '--untracked-files=all']))
        throw new Error('コミットしていない変更があります。');
      if (execute('git', ['branch', '--show-current']) !== 'main')
        throw new Error('公開できるのはmainブランチだけです。');
      execute('git', ['fetch', 'origin']);
      commit = execute('git', ['rev-parse', 'HEAD']);
      if (!/^[a-f\d]{40}$/i.test(commit) || commit !== execute('git', ['rev-parse', 'origin/main']))
        throw new Error('最新のorigin/mainと一致しません。');
      ci = inspectCi(commit, execute);
      subject = execute('git', ['show', '-s', '--format=%s', commit]);
      console.log(ci);
    }
    for (const arguments_ of [
      ['run', 'typecheck'],
      ['run', 'build'],
    ])
      execute('npm', arguments_, true);
    const build = await inspectBuild();
    if (mode === 'check')
      console.log(
        `公開物を確認しました。Worker：${worker}、URL：${url}\n組み立てた版の番号：${build.stamp}、データの形の番号：${build.schema}`,
      );
    const missing = missingSettings(build.config);
    if (missing.length) console.log(`公開用の設定の未設定：${missing.join('、')}`);
    if (mode === 'check') return 0;
    if (missing.length) throw new Error('公開用の設定が未設定です。');
    loginAttempted = true;
    execute('wrangler', ['login'], true);
    const identity = wranglerJson(['whoami']);
    if (!identity.loggedIn || identity.authType !== 'OAuth Token' || !identity.accounts?.length)
      throw new Error('Wranglerのブラウザでのログインを確認できません。');
    let account = identity.accounts[0];
    if (identity.accounts.length > 1) {
      console.log(
        identity.accounts
          .map((entry, index) => `${index + 1}：${entry.name}（${entry.id}）`)
          .join('\n'),
      );
      account = identity.accounts[Number(await ask('公開先アカウントの番号：')) - 1];
    }
    if (!account || !/^[a-f\d]{32}$/i.test(account.id))
      throw new Error('公開先アカウントを選べません。');
    if (build.config.account_id && build.config.account_id !== account.id)
      throw new Error('設定のアカウントと選んだアカウントが一致しません。');
    env = { ...env, CLOUDFLARE_ACCOUNT_ID: account.id };
    const auth = wranglerJson(['auth', 'token']);
    if (auth.type !== 'oauth' || typeof auth.token !== 'string' || !auth.token)
      throw new Error('ログインの証明を取得できません。');
    const get = async (path, options = {}) => {
      try {
        const response = await fetch(
          `https://api.cloudflare.com/client/v4/accounts/${account.id}/${path}`,
          {
            ...options,
            headers: { Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json' },
            signal: AbortSignal.any([abort.signal, AbortSignal.timeout(30000)]),
            redirect: 'error',
          },
        );
        const body = await response.json();
        return { response, body };
      } catch {
        throw new Error('Cloudflareの対象の確認が完了しませんでした。');
      }
    };
    const subdomain = await get('workers/subdomain');
    if (
      !subdomain.response.ok ||
      !subdomain.body.success ||
      subdomain.body.result?.subdomain !== 'your-subdomain'
    )
      throw new Error(
        'workers.devの名前がyour-subdomainと確認できません。設定は変更していません。',
      );
    const settings = await get(`workers/scripts/${worker}/settings`);
    const absent =
      settings.response.status === 404 &&
      settings.body.errors?.some((error) => error.code === 10007);
    if (!absent && (!settings.response.ok || !settings.body.success))
      throw new Error('対象Workerの有無を確認できません。');
    if (initial !== absent)
      throw new Error(
        initial
          ? '初回の指定ですが、対象Workerは既にあります。'
          : '更新の指定ですが、対象Workerがありません。',
      );
    let previous = 'なし',
      changed = initial,
      priorCommit;
    if (!initial) {
      previous = currentVersion(
        wranglerJson(['deployments', 'list', '--name', worker], build.configPath),
      );
      const { record: prior } = previousRecord(
        previous,
        wranglerJson(['versions', 'view', previous, '--name', worker], build.configPath),
        () => wranglerJson(['versions', 'list', '--name', worker], build.configPath),
      );
      priorCommit = prior[fields[1]];
      const changedFiles = execute('git', [
        'diff',
        '--numstat',
        '--ignore-cr-at-eol',
        prior[fields[1]],
        commit,
        '--',
        'server/migrations',
      ]);
      const previousSchema = Number(prior[fields[3]]);
      changed = previousSchema !== build.schema || Boolean(changedFiles);
      if (changed) {
        if (!backupPath)
          throw new Error(
            'DB設計の変更を測るため、--backup に前の晩のバックアップのファイルを指定してください。',
          );
        const seconds = await measureSchema(resolve(backupPath), previousSchema, build.migrations);
        console.log(`DB設計の変更にかかった時間：${seconds.toFixed(3)}秒`);
        if (seconds >= SCHEMA_TIME_LIMIT_SECONDS)
          throw new Error('30秒に近いので公開を止めます。変更を何回かの公開に分けてください。');
      }
    }
    console.log(
      [
        `公開先：${url}（アカウント：${account.name}）`,
        `公開するコミット：${commit.slice(0, 7)} ${subject}`,
        `DB設計の変更：${changed ? 'あり（コードだけを前の版に戻せない場合があります）' : 'なし'}`,
        ...userChanges(build.config, priorCommit, execute),
      ].join('\n'),
    );
    if (
      !dryRun &&
      (await ask(
        '公開します。公開するときは「公開」と入力して Enter を押してください（それ以外は公開しません）：',
      )) !== '公開'
    )
      throw new Error('公開しませんでした。');
    step = '公開直前の手元の確認';
    // Recheck the source at the same point for both dry-run and publication.
    if (
      execute('git', ['status', '--porcelain', '--untracked-files=all']) ||
      execute('git', ['rev-parse', 'HEAD']) !== commit
    )
      throw new Error('検査の後に手元の変更がありました。');
    if (dryRun) {
      console.log('ここまで問題ありません。公開はしていません。');
      status = 0;
    } else {
      const at = new Date(Date.now() + 9 * 3600000).toISOString().replace('Z', '+09:00');
      const restoreAt = initial ? 'なし' : at.slice(0, 19).replace('T', ' ');
      record = Object.fromEntries(
        fields.map((field, index) => [
          field,
          [at, commit, build.stamp, String(build.schema), previous, restoreAt][index],
        ]),
      );
      await writeRecord([
        '',
        ...fields.map((field) => `${field}：${record[field]}`),
        `公開先：${url}`,
        ci,
      ]);
      recordWritten = true;
      console.log(`記録に書きました：${recordPath}`);
      attempted = true;
      step = 'wrangler deploy';
      const output = execute('wrangler', [
        'deploy',
        '--config',
        build.configPath,
        '--message',
        JSON.stringify(record),
      ]);
      published = true;
      step = '今回の版のIDの確認';
      id = /Current Version ID:\s*([a-f\d-]+)/i.exec(output)?.[1] ?? null;
      if (!versionId.test(id ?? '')) {
        id = null;
        throw new Error('公開しましたが、今回の版のIDは未確認です。');
      }
      await writeRecord([`今回の版のID：${id}`]);
      console.log('公開済みです。');
      let verified = false;
      let readbackResult = '未確認（読み返しの失敗）';
      step = '版の説明の読み返し';
      try {
        const view = wranglerJson(['versions', 'view', id, '--name', worker], build.configPath);
        const readback =
          view.id === id ? JSON.parse(view.annotations?.['workers/message'] ?? 'null') : null;
        const missingFields = fields.filter((field) => readback?.[field] !== record[field]);
        if (missingFields.length) {
          readbackResult = `未完了（欠けた項目：${missingFields.join('、')}）`;
          console.error(
            `公開済みですが、版の説明が欠けています。記録を確認してください：${recordPath}`,
          );
          for (const field of missingFields) console.error(`欠けた項目 ${field}：${record[field]}`);
        } else {
          verified = true;
          readbackResult = '6項目を確認済み';
          console.log('今回の版の説明の6項目を読み返して確認しました。');
        }
      } catch {
        console.error(
          `公開済みですが、版の説明は未確認です。記録を確認してください：${recordPath}`,
        );
      }
      await writeRecord([`版の説明の読み返し：${readbackResult}`]);
      if (!verified) showRecovery();
      if (initial) {
        for (const name of ['BACKUP_GAS_URL', 'BACKUP_GAS_TOKEN']) {
          step = `秘密の値の登録（${name}）`;
          execute(
            'wrangler',
            ['secret', 'put', name, '--name', worker, '--config', build.configPath],
            true,
          );
        }
        step = '秘密の値の登録後の版のIDの確認';
        const finalId = currentVersion(
          wranglerJson(['deployments', 'list', '--name', worker], build.configPath),
        );
        await writeRecord([`秘密の値の登録後の最終的な版のID：${finalId}`]);
        console.log(`秘密の値を登録しました。記録に書きました：${recordPath}`);
      }
      step = '新しい版の返事と記録の到着の確認';
      const checked = await inspectPublished(build.stamp, get, abort.signal);
      await writeRecord(checked.lines);
      status = verified && checked.ok ? 0 : 1;
    }
  } catch (error) {
    console.error(
      error instanceof Error && error.name !== 'AbortError' ? error.message : '中止しました。',
    );
    if (published)
      console.error(
        '本体は公開済みです。Deploymentsで版を確認し、初回の秘密の値の登録が未完了なら、残りの秘密の値を登録してください。',
      );
    else if (attempted)
      console.error(
        '公開の成否は未確認です。Deploymentsで確認してください。自動では再公開しません。',
      );
    if (record) showRecovery();
  } finally {
    if (loginAttempted) {
      try {
        execute('wrangler', ['logout'], false, true);
        console.log('Wranglerからログアウトしました。');
      } catch {
        console.error(
          'Wranglerのログアウトが未確認です。保守担当が npx wrangler logout を実行してください。',
        );
        status = 1;
        step = 'Wranglerのログアウト（未確認）';
      }
    }
    if (mode === 'deploy' && (status !== 0 || published)) {
      const result = `結果：${
        published
          ? status === 0
            ? '公開済み'
            : '公開済み・確かめ未完了：公開はした。確かめ（版のIDの読み取り、版の説明の読み返し、新しい版の返事と記録の到着）のどれかが欠けた。打ち直さない。'
          : attempted
            ? '成否不明：公開の命令の途中で切れた。打ち直す前に、CloudflareのDeploymentsと版の説明を見る。'
            : '未公開：公開の前に止まった。本番は変わっていない。'
      }`;
      if (recordWritten) {
        try {
          await writeRecord([
            ...(status !== 0 ? [`今回の版のID：${id ?? '未確認'}`, `止まった所：${step}`] : []),
            result,
          ]);
        } catch (writeError) {
          console.error(writeError.message);
        }
      }
      console.log(result);
    }
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', interrupt);
  }
  return status;
}
