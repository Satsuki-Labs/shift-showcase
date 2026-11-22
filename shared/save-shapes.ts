import { AppError } from './app-error';
import { facilities } from './calendar';
import { DAY_ROLES, DEFAULT_STAFF_ROLES } from './staff';

// Increase by one for removals, renames, type changes, or changes of meaning.
// Keep a separate tests/shared/save-shapes.v<N>.json for each released shape.
export const SAVE_SHAPE_VERSION = 1;
export const SAVE_SHAPE_MISMATCH_MESSAGE = 'アプリが新しくなる前の入力のため、保存できませんでした';

export type SaveShape =
  | 'string'
  | 'number'
  | 'boolean'
  | 'null'
  | { fields: Readonly<Record<string, SaveShape>>; optional?: readonly string[] }
  | { array: SaveShape }
  | { record: SaveShape }
  | { union: readonly SaveShape[] }
  | { enum: readonly (string | number)[] };
const object = (fields: Record<string, SaveShape>, optional?: string[]): SaveShape => ({
  fields,
  ...(optional ? { optional } : {}),
});
const array = (item: SaveShape): SaveShape => ({ array: item });
const nullable = (item: SaveShape): SaveShape => ({ union: [item, 'null'] });
const facility: SaveShape = { enum: facilities };
const building: SaveShape = { enum: [1, 2] };
const id = object({ id: 'string' });
const workSlot = nullable(object({ start: 'string', end: 'string' }));
const workPair = object({ slot1: workSlot, slot2: workSlot });
const workCategory = object({ first: workPair, second: workPair });
const historyChange = (value: SaveShape) => object({ value, period_id: 'string' }, ['period_id']);
const shiftCell = object({
  staff_id: 'string',
  date: 'string',
  status: { enum: ['none', 'paid_leave', 'empty'] },
  roles: array({ enum: DAY_ROLES }),
  special_care: 'boolean',
  buildings: array(
    object({
      building,
      slots: array(
        object({
          start_time: 'string',
          end_time: 'string',
          facility,
          is_office: 'boolean',
        }),
      ),
    }),
  ),
  notes: nullable('string'),
});
const calendarDayFields: Record<string, SaveShape> = {
  date: 'string',
  buildings: array(
    object({
      building,
      event: nullable(object({ content: 'string', arrival_time: nullable('string') })),
      memo: nullable('string'),
      facilities: array(
        object({
          facility,
          is_open: nullable('boolean'),
          start_time: nullable('string'),
          end_time: nullable('string'),
        }),
      ),
    }),
  ),
};
const peak = nullable(object({ start_date: 'string', end_date: 'string', name: 'string' }));
const closure = nullable(
  object({
    start_month: 'number',
    start_day: 'number',
    end_month: 'number',
    end_day: 'number',
    name: 'string',
  }),
);
const period = object({
  id: 'string',
  name: 'string',
  start_date: 'string',
  end_date: 'string',
  request_deadline_date: nullable('string'),
  coverage: array(object({ facility, total_required: 'number' })),
});
const distribution = object({
  id: 'string',
  site: { enum: ['first', 'second'] },
  cells: { record: { record: 'string' } },
});
const requestDay = { staff_id: 'string', date: 'string' } as const;
const requestNone = object({ staff_id: 'string' });

// The receiver uses this list before the operation's date/range/business checks.
// These are wire types: e.g. opening-rule rows do not send fiscal_year.
export const SAVE_SHAPES: Readonly<Record<string, SaveShape>> = {
  'settings.contact-names.save': object({ first: 'string', second: 'string' }, ['first', 'second']),
  'staff.save': object({
    staff: object({
      id: 'string',
      name: 'string',
      notes: 'string',
      default_first_facility: nullable({ enum: ['A', 'B'] }),
      default_second_facility: nullable({ enum: ['C', 'D'] }),
      default_work_times: object({
        normal: workCategory,
        peak: workCategory,
        saturday: workSlot,
      }),
      default_roles: array({ enum: DEFAULT_STAFF_ROLES }),
      employment_status: { enum: ['active', 'leave', 'retired'] },
      leave_start_date: nullable('string'),
      leave_expected_end_date: nullable('string'),
      retirement_date: nullable('string'),
    }),
    history: object(
      {
        quarter_hour_pay: historyChange('number'),
        employment_type: historyChange({ enum: ['full_time', 'part_time', 'casual'] }),
        qualification: historyChange({ enum: ['certified', 'assistant', 'none'] }),
        budget: historyChange('number'),
      },
      ['quarter_hour_pay', 'employment_type', 'qualification', 'budget'],
    ),
  }),
  'staff.delete': id,
  'staff.reorder': array('string'),
  'shift.cell.save': shiftCell,
  'shift.bulk.save': object({ cells: array(shiftCell) }),
  'shift.cell.cancel': object({ ...requestDay, building }),
  'calendar.day.save': object({ ...calendarDayFields, confirmed: nullable('number') }),
  'calendar.days.save': object({
    days: array(object(calendarDayFields)),
    confirmed: nullable('number'),
  }),
  'calendar.peak.save': object({ before: peak, after: peak }),
  'calendar.annual-closure.save': object({
    before: closure,
    after: closure,
    confirmed: nullable('number'),
  }),
  'calendar.opening-rules.save': object({
    fiscal_year: 'number',
    rules: array(
      object({
        facility,
        normal_start_time: 'string',
        normal_end_time: 'string',
        peak_start_time: 'string',
        peak_end_time: 'string',
        saturday_start_time: 'string',
        saturday_end_time: 'string',
        arrival_end_mode: { enum: ['fixed_time', 'duration'] },
        arrival_end_time: nullable('string'),
        arrival_duration_minutes: nullable('number'),
      }),
    ),
  }),
  'period.publish': distribution,
  'period.redistribute': distribution,
  'period.create': period,
  'period.update': period,
  'period.request-url.regenerate': id,
  'period.requests.close': id,
  'period.delete': id,
  'request.day.save': object(
    {
      ...requestDay,
      kind: {
        enum: ['unavailable', 'am_unavailable', 'pm_unavailable', 'time_unavailable', 'available'],
      },
      start_time: nullable('string'),
      end_time: nullable('string'),
      memo: nullable('string'),
    },
    ['memo'],
  ),
  'request.day.delete': object(requestDay),
  'request.none.set': requestNone,
  'request.none.clear': requestNone,
};

function matches(shape: SaveShape, value: unknown): boolean {
  if (typeof shape === 'string')
    return shape === 'null'
      ? value === null
      : typeof value === shape && (shape !== 'number' || Number.isFinite(value));
  if ('union' in shape) return shape.union.some((item) => matches(item, value));
  if ('enum' in shape) return shape.enum.some((item) => item === value);
  if ('array' in shape)
    return Array.isArray(value) && value.every((item) => matches(shape.array, item));
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if ('record' in shape) return Object.values(value).every((item) => matches(shape.record, item));
  const row = value as Record<string, unknown>;
  return (
    Object.keys(row).every((key) => Object.prototype.hasOwnProperty.call(shape.fields, key)) &&
    Object.entries(shape.fields).every(([key, item]) =>
      Object.prototype.hasOwnProperty.call(row, key)
        ? matches(item, row[key])
        : shape.optional?.includes(key),
    )
  );
}

export function validateSaveShape(operation: string, data: unknown): void {
  if (!Object.prototype.hasOwnProperty.call(SAVE_SHAPES, operation)) throw new AppError('E-35');
  const shape = SAVE_SHAPES[operation];
  // The receiver runs the operation validator first to keep its field guidance.
  if (!matches(shape, data)) throw new AppError('E-32', 'data');
}
