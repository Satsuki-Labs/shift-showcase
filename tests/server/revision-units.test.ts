/// <reference types="@cloudflare/workers-types" />
/// <reference types="@cloudflare/vitest-plugin/types" />
import { env } from 'cloudflare:workers';
import { reset, runInDurableObject } from 'cloudflare:test';
import { afterEach, expect, test } from 'vitest';
import type { Env } from '../../server/src/index';
import { receiveSave } from '../../server/src/saves/receiver';
import { SAVE_SHAPE_VERSION } from '../../shared/save-shapes';

afterEach(async () => {
  await reset();
});

test('403直し2: 未保存の保存先でも初めの並び順番号からの2人目はE-33になる', async () => {
  const namespace = (env as Env).ORGANIZATION;
  await runInDurableObject(namespace.get(namespace.newUniqueId()), async (_instance, state) => {
    const generation = state.storage.sql
      .exec<{ generation: string }>('SELECT generation FROM data_version')
      .one().generation;
    const save = () =>
      receiveSave(
        new Request('https://test.invalid/api/save', {
          method: 'POST',
          body: JSON.stringify({
            operationId: crypto.randomUUID(),
            operation: 'staff.reorder',
            data: [],
            revisions: [{ target: { unit: 'staff-order' }, revision: 1 }],
            dataGeneration: generation,
            saveShapeVersion: SAVE_SHAPE_VERSION,
          }),
        }),
        state.storage,
        { email: 'first@example.invalid', role: 'first' },
      );
    expect(
      state.storage.sql.exec('SELECT data_change_number FROM backup_state').one()
        .data_change_number,
    ).toBe(1);
    expect(await save()).toMatchObject({
      ok: true,
      dataChangeNumber: 2,
      revisions: [{ target: { unit: 'staff-order' }, revision: 2 }],
    });
    expect(await save()).toMatchObject({
      code: 'E-33',
      conflicts: [{ target: { unit: 'staff-order' }, revision: 2 }],
    });
    expect(
      state.storage.sql.exec('SELECT data_change_number FROM backup_state').one()
        .data_change_number,
    ).toBe(2);
  });
});
