import { AppError } from '../../../shared/app-error';
import { SAVE_SHAPE_VERSION, validateSaveShape } from '../../../shared/save-shapes';
import type {
  Identity,
  JsonValue,
  Revision,
  RevisionTarget,
  SaveConflict,
  SaveRequest,
  SaveSuccess,
} from '../../../shared/protocol';
import { validIdentifier } from '../../../shared/limits';
import { findOperation, findRequestOperation } from './operations';
import { advanceRevision, isTarget, readRevision, targetKey } from './revisions';
import { capturePeriodSnapshots } from './snapshots';
import { readRequestPeriod, requestChangeNumber } from '../reads/request-sheet';
import { isRequestOperation } from './requests';
import { alignAlarm } from '../scheduled/tasks';
import { readInputJson } from '../entrance/body';
import { recordFatal } from '../entrance/records';

function validateTargetIds(target: RevisionTarget): void {
  if ('id' in target && !validIdentifier(target.id, target.unit === 'period'))
    throw new AppError('E-32', 'id');
  if ('staffId' in target && !validIdentifier(target.staffId))
    throw new AppError('E-32', 'staff_id');
  if ('periodId' in target && !validIdentifier(target.periodId, true))
    throw new AppError('E-32', 'period_id');
}

function isJson(value: unknown): value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJson);
  return (
    typeof value === 'object' &&
    Object.getPrototypeOf(value) === Object.prototype &&
    Object.values(value).every(isJson)
  );
}
function isRevision(value: unknown): value is Revision {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return (
    Object.keys(item).length === 2 &&
    isTarget(item.target) &&
    (item.revision === null ||
      (Number.isSafeInteger(item.revision) && (item.revision as number) >= 1))
  );
}
function parseSave(value: unknown): SaveRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AppError('E-36');
  const input = value as Record<string, unknown>;
  if (!Number.isSafeInteger(input.saveShapeVersion) || (input.saveShapeVersion as number) < 1)
    throw new AppError('E-36');
  if (input.saveShapeVersion !== SAVE_SHAPE_VERSION) throw new AppError('E-47');
  if (
    Object.keys(input).length !== 6 ||
    typeof input.operationId !== 'string' ||
    typeof input.operation !== 'string' ||
    !input.operation.trim() ||
    typeof input.dataGeneration !== 'string' ||
    !Array.isArray(input.revisions) ||
    !input.revisions.every(isRevision) ||
    new Set(input.revisions.map((item) => targetKey(item.target))).size !==
      input.revisions.length ||
    !isJson(input.data)
  )
    throw new AppError('E-36');
  if (!validIdentifier(input.operationId)) throw new AppError('E-32', 'operationId');
  if (!validIdentifier(input.dataGeneration)) throw new AppError('E-32', 'dataGeneration');
  input.revisions.forEach((item) => validateTargetIds(item.target));
  return input as unknown as SaveRequest;
}
function canonical(value: JsonValue): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export async function receiveSave(
  request: Request,
  storage: DurableObjectStorage,
  identity: Identity | null,
  requestKey?: string,
): Promise<SaveSuccess | SaveConflict> {
  const input = parseSave(await readInputJson(request));
  const requestPeriod =
    requestKey === undefined ? null : readRequestPeriod(storage.sql, requestKey);
  if (requestPeriod ? !isRequestOperation(input.operation) : isRequestOperation(input.operation))
    throw new AppError('E-35');
  const summarized = {
    operation: input.operation,
    data: input.data,
    dataGeneration: input.dataGeneration,
    revisions: [...input.revisions].sort((left, right) =>
      targetKey(left.target).localeCompare(targetKey(right.target)),
    ),
    ...(requestPeriod ? { periodId: requestPeriod.id } : {}),
  };
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(canonical(summarized as unknown as JsonValue)),
  );
  const summary = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');

  let saved = false;
  const result = storage.transactionSync<SaveSuccess | SaveConflict>(() => {
    // 外で読んだ後にawaitがあるので、締め切りは取り引きの中で読み直して確かめる。
    const period = requestKey === undefined ? null : readRequestPeriod(storage.sql, requestKey);
    const generation = storage.sql
      .exec<{ generation: string }>('SELECT generation FROM data_version WHERE id = 1')
      .one().generation;
    if (input.dataGeneration !== generation) throw new AppError('E-42');
    const receipt = storage.sql
      .exec(
        'SELECT content_summary, result FROM operation_receipts WHERE operation_id = ?',
        input.operationId,
      )
      .toArray()[0];
    if (receipt) {
      if (receipt.content_summary !== summary) throw new AppError('E-34');
      return JSON.parse(receipt.result as string) as SaveSuccess;
    }
    if (period && requestChangeNumber(period).requestsClosed) throw new AppError('E-37');
    const requestOperation = period
      ? findRequestOperation(input.operation, storage.sql, period)
      : undefined;
    const staffOperation = period ? undefined : findOperation(input.operation);
    const operation = requestOperation ?? staffOperation;
    if (!operation) throw new AppError('E-35');
    if (operation.validate(input.data) !== undefined)
      throw new Error('Validation must be synchronous');
    validateSaveShape(input.operation, input.data);
    const targets = operation.targets(input.data);
    if (
      !Array.isArray(targets) ||
      !targets.every(isTarget) ||
      new Set(targets.map(targetKey)).size !== targets.length
    )
      throw new Error('Invalid operation targets');
    targets.forEach(validateTargetIds);
    const expected = new Map(
      input.revisions.map((item) => [targetKey(item.target), item.revision]),
    );
    if (
      targets.length !== expected.size ||
      targets.some((target) => !expected.has(targetKey(target)))
    )
      throw new AppError('E-36');
    const current = targets.map((target) => readRevision(storage.sql, target));
    const conflicts = current.filter(
      (item) => item.revision !== expected.get(targetKey(item.target)),
    );
    if (conflicts.length) return { code: 'E-33', conflicts };

    capturePeriodSnapshots(storage.sql);
    if (!requestOperation && !identity) throw new AppError('E-35');
    const previousNumber = storage.sql
      .exec<{ data_change_number: number }>(
        'SELECT data_change_number FROM backup_state WHERE id = 1',
      )
      .one().data_change_number;
    const dataChangeNumber =
      current.reduce((number, item) => Math.max(number, item.revision ?? 0), previousNumber) + 1;
    const data = requestOperation
      ? requestOperation.write({ sql: storage.sql, revision: dataChangeNumber }, input.data)
      : staffOperation!.write(
          { sql: storage.sql, identity: identity!, revision: dataChangeNumber },
          input.data,
        );
    if (!isJson(data)) throw new Error('Operation must return synchronous JSON data');
    storage.sql.exec(
      'UPDATE backup_state SET data_change_number = ? WHERE id = 1',
      dataChangeNumber,
    );
    const revisions = current.map((item) =>
      advanceRevision(storage.sql, item.target, dataChangeNumber),
    );
    if (period)
      storage.sql.exec(
        'UPDATE periods SET request_change_number = request_change_number + 1 WHERE id = ?',
        period.id,
      );
    const result: SaveSuccess = { ok: true, revisions, data, dataChangeNumber };
    storage.sql.exec(
      'INSERT INTO operation_receipts (operation_id, content_summary, result, received_at) VALUES (?, ?, ?, ?)',
      input.operationId,
      summary,
      JSON.stringify(result),
      new Date().toISOString(),
    );
    saved = true;
    return result;
  });
  if ('ok' in result) {
    try {
      await alignAlarm(storage);
    } catch (error) {
      if (!saved) throw error;
      recordFatal(storage, 'E-92', identity?.role ?? null, 'align-alarm');
    }
  }
  return result;
}
