/// <reference types="@cloudflare/workers-types" />
/// <reference types="@cloudflare/vitest-plugin/types" />
import { env } from 'cloudflare:workers';
import { abortAllDurableObjects, reset, runInDurableObject } from 'cloudflare:test';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { afterEach, beforeAll, expect, test, vi } from 'vitest';
import worker, { type Env } from '../../server/src/index';
import { authenticate } from '../../server/src/entrance/auth';
import type { ErrorCode } from '../../shared/error-codes';
import type { ErrorResponse } from '../../shared/protocol';

let keys: Awaited<ReturnType<typeof generateKeyPair>>;
let publicKey: Awaited<ReturnType<typeof exportJWK>>;
beforeAll(async () => {
  keys = await generateKeyPair('RS256', { extractable: true });
  publicKey = { ...(await exportJWK(keys.publicKey)), kid: 'test-key', alg: 'RS256', use: 'sig' };
});
afterEach(async () => {
  vi.restoreAllMocks();
  await reset();
});
const origin = 'https://localhost';
const local: Env = {
  ...(env as Env),
  ENVIRONMENT: '手元',
  LOCAL_EMAIL: 'local@example.invalid',
  LOCAL_ROLE: 'first',
};
function production(team: string): Env {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    if (String(input) !== `https://${team}.cloudflareaccess.com/cdn-cgi/access/certs`)
      throw new Error('Unexpected external URL');
    return Response.json({ keys: [publicKey] });
  });
  return {
    ...local,
    ENVIRONMENT: '本番',
    ACCESS_TEAM: team,
    ACCESS_AUDIENCE: 'test-audience',
    ROLE_TABLE: {
      'first.person@gmail.com': 'first',
      'second@example.invalid': 'second',
      'maintenance@example.invalid': 'maintenance',
    },
  };
}
async function proof(
  settings: Env,
  email = 'first.person@gmail.com',
  options: { expired?: boolean; issuer?: string; audience?: string; privateKey?: CryptoKey } = {},
): Promise<string> {
  return new SignJWT({ email })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setIssuer(options.issuer ?? `https://${settings.ACCESS_TEAM}.cloudflareaccess.com`)
    .setAudience(options.audience ?? settings.ACCESS_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(options.expired ? Math.floor(Date.now() / 1000) - 30 : '5m')
    .sign(options.privateKey ?? keys.privateKey);
}
function request(path = 'first-load', token?: string): Request {
  return new Request(`${origin}/api/${path}`, {
    headers: token ? { 'Cf-Access-Jwt-Assertion': token } : {},
  });
}
async function expectError(response: Response, code: ErrorCode): Promise<void> {
  expect(response.ok).toBe(false);
  expect(response.headers.get('X-Restored-To')).toBe('null');
  expect(await response.json()).toEqual({ code, requestId: response.headers.get('X-Request-Id') });
}
function object() {
  const namespace = local.ORGANIZATION;
  return namespace.get(namespace.idFromName('organization'));
}

test.each(['http://127.0.0.1:5173', 'http://localhost:5173', 'http://[::1]:5173'])(
  '手元では許可されたホスト%sへの要求だけで試験用の担当者として入れる',
  async (url) => {
    const response = await worker.fetch(new Request(`${url}/api/first-load`), local);
    expect(response.status).toBe(200);
    expect(((await response.json()) as { identity: unknown }).identity).toEqual({
      email: local.LOCAL_EMAIL,
      role: local.LOCAL_ROLE,
    });
  },
);

test.each([
  'https://app.example.invalid',
  'http://192.168.1.2:5173',
  'http://localhost.example.invalid',
  'http://127.0.0.2:5173',
])('手元でも許可されていないホスト%sでは証明なしの要求を本番と同じE-22で断る', async (url) => {
  const get = vi.fn(() => {
    throw new Error('Rejected local request reached the object');
  });
  const guarded = {
    ...local,
    ORGANIZATION: { idFromName: vi.fn(), get } as unknown as Env['ORGANIZATION'],
  };
  const response = await worker.fetch(new Request(`${url}/api/first-load`), guarded);
  expect(response.status).toBe(401);
  await expectError(response, 'E-22');
  expect(get).not.toHaveBeenCalled();
});

test('148-1: 読み込み・保存・希望表・入口で断る返事にも復元前はnullの見出しが付く', async () => {
  for (const path of [
    'first-load',
    'change-number',
    'year-load?year=2026',
    'period-load?id=missing',
    'request/missing/load',
    'missing',
  ]) {
    expect((await worker.fetch(request(path), local)).headers.get('X-Restored-To')).toBe('null');
  }
  const save = new Request(`${origin}/api/save`, {
    method: 'POST',
    headers: { Origin: origin },
    body: '{}',
  });
  expect((await worker.fetch(save, local)).headers.get('X-Restored-To')).toBe('null');
});

test('production rejects missing, expired, wrong signature, issuer and audience proofs before the object', async () => {
  const settings = production('proof-test');
  const get = vi.fn(() => {
    throw new Error('Rejected proof reached the object');
  });
  const guarded = {
    ...settings,
    ORGANIZATION: { idFromName: vi.fn(), get } as unknown as Env['ORGANIZATION'],
  };
  await expectError(await worker.fetch(request(), guarded), 'E-22');
  const wrongKeys = await generateKeyPair('RS256');
  for (const [options, code] of [
    [{ expired: true }, 'E-23'],
    [{ privateKey: wrongKeys.privateKey }, 'E-24'],
    [{ issuer: 'https://other.cloudflareaccess.com' }, 'E-24'],
    [{ audience: 'other-audience' }, 'E-24'],
  ] as const)
    await expectError(
      await worker.fetch(request('first-load', await proof(settings, undefined, options)), guarded),
      code,
    );
  expect(get).not.toHaveBeenCalled();
});

test('135-4: Accessの鍵の返事が500ならE-82をHTTP 503で返す', async () => {
  const settings = production('key-failure-test');
  vi.mocked(globalThis.fetch).mockResolvedValue(new Response(null, { status: 500 }));
  const get = vi.fn(() => {
    throw new Error('Failed key lookup reached the object');
  });
  const guarded = {
    ...settings,
    ORGANIZATION: { idFromName: vi.fn(), get } as unknown as Env['ORGANIZATION'],
  };
  const response = await worker.fetch(request('first-load', await proof(settings)), guarded);
  expect(response.status).toBe(503);
  await expectError(response, 'E-82');
  expect(get).not.toHaveBeenCalled();
});

test('本番では登録済みのアドレスで入り、Gmailの別名と未登録のアドレスは断る', async (context) => {
  const settings = production('address-test');
  const signed = await proof(settings);
  const started = performance.now();
  await authenticate(request('first-load', signed), settings);
  const verificationMs = performance.now() - started;
  const response = await worker.fetch(request('first-load', signed), settings);
  expect(response.status).toBe(200);
  expect(((await response.json()) as { identity: unknown }).identity).toEqual({
    email: 'first.person@gmail.com',
    role: 'first',
  });
  // Includes signature/claim validation and the mocked public-key lookup, without signing or the object read.
  await context.annotate(
    `Local proof verification reference: ${verificationMs.toFixed(3)} ms`,
    'verification-time',
  );
  for (const email of [
    'first.person+alias@gmail.com',
    'firstperson@gmail.com',
    'unknown@example.invalid',
  ]) {
    await expectError(
      await worker.fetch(request('first-load', await proof(settings, email)), settings),
      'E-25',
    );
  }
});

test('production never uses the configured local identity without a proof', async () => {
  await expectError(await worker.fetch(request(), production('local-bypass-test')), 'E-22');
});

test.each([
  ['Taro@Example.com', 'taro@example.com', 'first'],
  ['taro@example.com', 'Taro@Example.com', 'second'],
  ['TARO@EXAMPLE.COM', 'Taro@Example.com', 'maintenance'],
] as const)(
  '本番では表の%sと証明の%sを同じアドレスとして%sの役割で入れる',
  async (registered, email, role) => {
    const settings = production(`case-${role}-test`);
    settings.ROLE_TABLE = { [registered]: role };
    const response = await worker.fetch(
      new Request('https://app.example.invalid/api/first-load', {
        headers: { 'Cf-Access-Jwt-Assertion': await proof(settings, email) },
      }),
      settings,
    );
    expect(response.status).toBe(200);
    expect(((await response.json()) as { identity: unknown }).identity).toEqual({ email, role });
  },
);

test.each(['first', 'second'] as const)(
  '表のアドレスが小文字にそろえると重なる場合は役割がfirstと%sでも両方のアドレスを設定不備で断る',
  async (role) => {
    const settings = production(`duplicate-${role}-test`);
    settings.ROLE_TABLE = { 'User@Example.com': 'first', 'user@example.com': role };
    const get = vi.fn(() => {
      throw new Error('Invalid role table reached the object');
    });
    const guarded = {
      ...settings,
      ORGANIZATION: { idFromName: vi.fn(), get } as unknown as Env['ORGANIZATION'],
    };
    for (const email of ['User@Example.com', 'user@example.com']) {
      await expectError(
        await worker.fetch(request('first-load', await proof(settings, email)), guarded),
        'E-52',
      );
    }
    expect(get).not.toHaveBeenCalled();
  },
);

test('cross-site mutations are rejected without changing stored data', async () => {
  await expectError(
    await worker.fetch(
      new Request(`${origin}/api/screen-error`, {
        method: 'POST',
        headers: { Origin: 'https://other.example.invalid' },
        body: JSON.stringify({ code: 'E-72', screen: 'staff' }),
      }),
      local,
    ),
    'E-26',
  );
  await runInDurableObject(object(), (_instance, state) => {
    expect(state.storage.sql.exec('SELECT COUNT(*) AS count FROM fatal_errors').one().count).toBe(
      0,
    );
  });
});

test('missing or malformed role and Access configuration is E-52', async () => {
  const settings = production('config-test');
  for (const patch of [
    { ROLE_TABLE: {} },
    { ROLE_TABLE: { bad: 'first' } },
    { ROLE_TABLE: { 'first@example.invalid': 'unknown' } },
    { ACCESS_TEAM: '' },
    { ACCESS_AUDIENCE: '' },
  ]) {
    await expectError(await worker.fetch(request(), { ...settings, ...patch }), 'E-52');
  }
  for (const table of [
    { 'first@example.invalid': 'first' },
    { 'first@example.invalid': 'first', 'another@example.invalid': 'first' },
    { ...settings.ROLE_TABLE, 'another@example.invalid': 'first' },
  ]) {
    await expectError(await worker.fetch(request(), { ...settings, ROLE_TABLE: table }), 'E-22');
  }
});

test('unexpected server errors are E-92 without internal messages and retain only the newest 100 fatal records', async () => {
  const logs = vi.spyOn(console, 'log').mockImplementation(() => {});
  await runInDurableObject(object(), (_instance, state) => {
    state.storage.sql.exec(
      "WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM n WHERE x < 100) INSERT INTO fatal_errors (code, reason, occurred_at, account, operation) SELECT 'E-72', 'screen_render_failed', '2026-10-01T00:00:00.000Z', 'first', 'staff' FROM n",
    );
    state.storage.sql.exec('DROP TABLE staff');
  });
  const response = await worker.fetch(request(), local);
  const requestId = response.headers.get('X-Request-Id');
  await expectError(response, 'E-92');
  expect(logs).toHaveBeenCalledTimes(1);
  expect(JSON.parse(logs.mock.calls[0][0] as string)).toMatchObject({
    requestId,
    role: 'first',
    operation: 'first-load',
    result: 'E-92',
  });
  await runInDurableObject(object(), (_instance, state) => {
    const rows = state.storage.sql.exec('SELECT * FROM fatal_errors ORDER BY id').toArray();
    expect(rows).toHaveLength(100);
    expect(rows[0].id).toBe(2);
    expect(rows[99]).toEqual({
      id: 101,
      code: 'E-92',
      reason: 'unexpected_server',
      occurred_at: expect.any(String),
      account: 'first',
      operation: 'first-load',
    });
  });
});

test('screen reports record known error codes and reject unknown codes with E-36', async () => {
  const send = (code: string) =>
    worker.fetch(
      new Request(`${origin}/api/screen-error`, {
        method: 'POST',
        headers: { Origin: origin },
        body: JSON.stringify({ code, screen: 'staff' }),
      }),
      local,
    );
  expect((await send('E-72')).status).toBe(200);
  await expectError(await send('E-99'), 'E-36');
  await runInDurableObject(object(), (_instance, state) => {
    expect(
      state.storage.sql
        .exec("SELECT code, reason, account, operation FROM fatal_errors WHERE code = 'E-72'")
        .toArray(),
    ).toEqual([
      { code: 'E-72', reason: 'screen_render_failed', account: 'first', operation: 'staff' },
    ]);
    expect(
      state.storage.sql.exec("SELECT COUNT(*) AS count FROM fatal_errors WHERE code = 'E-99'").one()
        .count,
    ).toBe(0);
  });
});

test('a failed schema migration returns E-43 and one log line for every interaction', async () => {
  await runInDurableObject(object(), (_instance, state) => {
    state.storage.kv.put('schema:migrations', [{ number: 1, summary: 'modified' }]);
  });
  await abortAllDurableObjects();
  const logs = vi.spyOn(console, 'log').mockImplementation(() => {});
  for (const req of [
    request(),
    request('change-number'),
    new Request(`${origin}/api/screen-error`, {
      method: 'POST',
      headers: { Origin: origin },
      body: JSON.stringify({ code: 'E-72', screen: 'staff' }),
    }),
  ]) {
    await expectError(await worker.fetch(req, local), 'E-43');
  }
  expect(logs).toHaveBeenCalledTimes(3);
  expect(
    logs.mock.calls.map((entry) => (JSON.parse(entry[0] as string) as { result: string }).result),
  ).toEqual(['E-43', 'E-43', 'E-43']);
});
