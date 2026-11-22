import type {
  CurrentRevision,
  JsonValue,
  Revision,
  SaveRequest,
  SaveSuccess,
} from '../../../shared/protocol';
import type { ErrorCode } from '../../../shared/error-codes';

export interface SaveInput {
  operation: string;
  revisions: Revision[];
  data: JsonValue;
  label: string;
}
export type SaveState =
  | { kind: 'queued' | 'sending' | 'slow' | 'offline' | 'service-wait' }
  | { kind: 'failed'; code: ErrorCode }
  | { kind: 'input-error'; field: string }
  | { kind: 'conflict'; conflicts: CurrentRevision[] }
  | { kind: 'reload-required'; code: 'E-42' | 'E-47' };
interface PendingSave {
  operationId: string;
  label: string;
  state: SaveState;
}
export interface StoredPendingSave extends PendingSave {
  operation: string;
  order: number;
  dialogOpen: boolean;
}
export interface Draft {
  order: number;
  request: SaveRequest;
  label: string;
  state: SaveState;
}
export type SaveEvent =
  | { kind: 'state'; pending: PendingSave }
  | { kind: 'saved'; operationId: string; operation: string; label: string; result: SaveSuccess }
  | { kind: 'discarded'; operationId: string }
  | { kind: 'dialog-closed'; operationId: string }
  | { kind: 'version-changed'; appVersion: string };
export interface BrowserPort {
  events: EventTarget;
  isOnline(): boolean;
}
export type SaveTransport = (request: SaveRequest, signal: AbortSignal) => Promise<Response>;
