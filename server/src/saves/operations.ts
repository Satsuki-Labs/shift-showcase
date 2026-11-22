import type { Identity, JsonValue, RevisionTarget } from '../../../shared/protocol';
import { settingsOperations } from './settings';
import { staffOperations } from './staff';
import { calendarOperations } from './calendar';
import { periodOperations } from './periods';
import { cellOperations } from './cells';
import { requestOperations, type RequestSaveOperation } from './requests';
import type { RequestPeriod } from '../reads/request-sheet';

export interface SaveOperation {
  validate(data: JsonValue): void;
  targets(data: JsonValue): readonly RevisionTarget[];
  // Writes must be synchronous; the receiver owns the transaction and revisions.
  write(
    context: { sql: SqlStorage; identity: Identity; revision: number },
    data: JsonValue,
  ): JsonValue;
}

const operations: ReadonlyMap<string, SaveOperation> = new Map(
  Object.entries({
    ...settingsOperations,
    ...staffOperations,
    ...calendarOperations,
    ...periodOperations,
    ...cellOperations,
  }),
);

export function findOperation(name: string): SaveOperation | undefined {
  return operations.get(name);
}

export function findRequestOperation(
  name: string,
  sql: SqlStorage,
  period: RequestPeriod,
): RequestSaveOperation | undefined {
  const operations = requestOperations(sql, period);
  return Object.hasOwn(operations, name) ? operations[name] : undefined;
}
