import { ERROR_CODES, type ErrorCode } from './error-codes';

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly identifier: (typeof ERROR_CODES)[ErrorCode]['identifier'];
  declare readonly field?: string;

  constructor(...[code, field]: ['E-32', string] | [Exclude<ErrorCode, 'E-32'>]) {
    super();
    this.code = code;
    this.identifier = ERROR_CODES[code].identifier;
    if (field !== undefined) this.field = field;
  }
}
