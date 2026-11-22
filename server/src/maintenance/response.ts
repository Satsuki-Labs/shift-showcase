import { AppError } from '../../../shared/app-error';

export interface ImportLocation {
  table: string | null;
  line: number;
  reason: string;
}
export class ImportError extends AppError {
  constructor(readonly location: ImportLocation) {
    super('E-38');
  }
}
export class ImportVersionError extends AppError {
  constructor(
    readonly formatVersion: unknown,
    readonly schemaVersion: unknown,
  ) {
    super('E-45');
  }
}
export interface RestorePrepareReply {
  at: string;
}
export interface ImportReply {
  ok: true;
  createdAt: string;
  staff: number;
  periods: number;
}
export type MaintenanceReply = RestorePrepareReply | ImportReply | { ok: true };

export function invalidFile(table: string | null, line: number, reason: string): never {
  throw new ImportError({ table, line, reason });
}
