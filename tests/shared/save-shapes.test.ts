import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import {
  SAVE_SHAPES,
  SAVE_SHAPE_VERSION,
  validateSaveShape,
  type SaveShape,
} from '../../shared/save-shapes';
import { buildRequest } from '../../frontend/src/request/submission';
import type { RequestSheetResponse } from '../../shared/protocol';

// Existing fields (including nested array/record fields) must keep their types.
// A bump needs a new versioned copy; never overwrite the previous version's copy.
function additive(before: SaveShape, after: SaveShape): boolean {
  if (typeof before === 'string' || typeof after === 'string') return before === after;
  if ('enum' in before)
    return (
      'enum' in after &&
      before.enum.length === after.enum.length &&
      before.enum.every((value) => after.enum.includes(value))
    );
  if ('array' in before) return 'array' in after && additive(before.array, after.array);
  if ('record' in before) return 'record' in after && additive(before.record, after.record);
  if ('union' in before)
    return (
      'union' in after &&
      before.union.length === after.union.length &&
      before.union.every((item, index) => additive(item, after.union[index]))
    );
  return (
    'fields' in after &&
    Object.entries(before.fields).every(
      ([key, item]) =>
        Object.hasOwn(after.fields, key) &&
        additive(item, after.fields[key]) &&
        Boolean(before.optional?.includes(key)) === Boolean(after.optional?.includes(key)),
    )
  );
}

it('401-4: サーバーで使う全操作の形を版ごとの写しと比べ、削除・改名・型変更を止め、追加は通す', () => {
  const copy = JSON.parse(
    readFileSync(new URL(`./save-shapes.v${SAVE_SHAPE_VERSION}.json`, import.meta.url), 'utf8'),
  ) as {
    version: number;
    operations: Record<string, SaveShape>;
  };
  expect(copy.version).toBe(SAVE_SHAPE_VERSION);
  for (const [operation, shape] of Object.entries(copy.operations)) {
    expect(Object.hasOwn(SAVE_SHAPES, operation), operation).toBe(true);
    expect(
      additive(shape, SAVE_SHAPES[operation]),
      `${operation}: bump SAVE_SHAPE_VERSION and add its new copy`,
    ).toBe(true);
  }
  // Read the actual operation registrations so a new route cannot miss the list.
  const registrations = ['settings', 'staff', 'calendar', 'periods', 'cells', 'requests'].flatMap(
    (file) => {
      const source = readFileSync(
        new URL(`../../server/src/saves/${file}.ts`, import.meta.url),
        'utf8',
      );
      return [...source.matchAll(/^\s+'([a-z][a-z.-]+)':/gm)].map((match) => match[1]);
    },
  );
  expect(Object.keys(SAVE_SHAPES).sort()).toEqual(registrations.sort());
  const old: SaveShape = {
    fields: { rows: { array: { fields: { name: 'string', count: 'number' } } } },
  };
  expect(
    additive(old, {
      fields: {
        rows: { array: { fields: { name: 'string', count: 'number', note: 'string' } } },
        extra: 'boolean',
      },
    }),
  ).toBe(true);
  expect(additive(old, { fields: { rows: { array: { fields: { count: 'number' } } } } })).toBe(
    false,
  );
  expect(
    additive(old, {
      fields: { rows: { array: { fields: { title: 'string', count: 'number' } } } },
    }),
  ).toBe(false);
  expect(
    additive(old, { fields: { rows: { array: { fields: { name: 'string', count: 'string' } } } } }),
  ).toBe(false);
  // This is the same structural gate called by receiveSave, not a type-only list.
  expect(() => validateSaveShape('settings.contact-names.save', { first: '担当A' })).not.toThrow();
  expect(() => validateSaveShape('settings.contact-names.save', { first: 1 })).toThrow();
  expect(() => validateSaveShape('settings.contact-names.save', { renamed: '担当A' })).toThrow();
});

it('希望の保存はメモを省略でき、送るメモは文字列かnullだけを受け付ける', () => {
  const data = {
    staff_id: 'staff-1',
    date: '2026-10-16',
    kind: 'unavailable',
    start_time: null,
    end_time: null,
  };
  expect(() => validateSaveShape('request.day.save', data)).not.toThrow();
  expect(() =>
    validateSaveShape('request.day.save', { ...data, memo: '通院のため' }),
  ).not.toThrow();
  expect(() => validateSaveShape('request.day.save', { ...data, memo: null })).not.toThrow();
  expect(() => validateSaveShape('request.day.save', { ...data, memo: false })).toThrow();
});

it('401-1: 希望表の4種類の保存にも今の保存番号を付ける', () => {
  const sheet: RequestSheetResponse = {
    appVersion: 'test',
    dataGeneration: 'generation',
    requestId: 'test',
    requestChangeNumber: 0,
    requestsClosed: false,
    period: {
      id: 'period',
      name: '11月度',
      start_date: '2026-10-16',
      end_date: '2026-11-15',
      request_deadline_date: '2026-10-10',
    },
    staff: [],
    dailyRequests: [],
    noRequests: [],
    closedDates: [],
    events: [],
  };
  for (const operation of [
    'request.day.save',
    'request.day.delete',
    'request.none.set',
    'request.none.clear',
  ] as const) {
    const request = buildRequest(sheet, 'staff-1', operation, operation, '2026-10-16', {
      kind: 'unavailable',
      from: '',
      to: '',
      memo: '',
    });
    expect(request.saveShapeVersion).toBe(SAVE_SHAPE_VERSION);
    expect(() => validateSaveShape(operation, request.data)).not.toThrow();
  }
});
