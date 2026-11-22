import { DurableObject } from 'cloudflare:workers';
import type { Env } from './index';
import { applyMigrations } from './schema/apply';
import { AppError } from '../../shared/app-error';
import { validFiscalYear, validIdentifier } from '../../shared/limits';
import { ERROR_CODES } from '../../shared/error-codes';
import type { DailyRequest, Identity } from '../../shared/protocol';
import {
  failure,
  metadata,
  operationOf,
  requestRoute,
  saveReply,
  type EntranceResult,
} from './entrance/response';
import { recordFatal } from './entrance/records';
import { receiveScreenError } from './entrance/screen-error';
import { readChangeNumber, readFirstLoad, readGeneration } from './reads/first-load';
import { checkOrigin } from './entrance/auth';
import { receiveSave } from './saves/receiver';
import { readYearLoad } from './reads/year-load';
import { readPeriodLoad } from './reads/period-load';
import { readSavePreview } from './saves/preview';
import {
  readRequestPeriod,
  readRequestSheet,
  readRequests,
  requestChangeNumber,
} from './reads/request-sheet';
import { initializeScheduledTasks, runScheduledTasks } from './scheduled/tasks';
import { StallMail, stalledTasks } from './mail/stall';
import { receiveMaintenance } from './maintenance/receiver';

export class OrganizationObject extends DurableObject<Env> {
  private schemaFailed = false;
  private readonly stallMail = new StallMail();
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      try {
        await applyMigrations(ctx.storage);
      } catch {
        this.schemaFailed = true;
      }
      if (!this.schemaFailed) await initializeScheduledTasks(ctx.storage);
    });
  }

  async alarm(): Promise<void> {
    if (this.schemaFailed) throw new AppError('E-43');
    await runScheduledTasks(this.ctx.storage, this.env);
  }

  async handle(
    request: Request,
    identity: Identity | null,
    requestId: string,
  ): Promise<EntranceResult> {
    let generation: string | null = null;
    let restoredTo: string | null = null;
    try {
      if (this.schemaFailed) {
        try {
          ({ generation, restoredTo } = readGeneration(this.ctx.storage));
        } catch {
          /* No version exists if the first migration failed. */
        }
        throw new AppError('E-43');
      }
      ({ generation, restoredTo } = readGeneration(this.ctx.storage));
      checkOrigin(request);
      const operation = operationOf(request);
      const route = requestRoute(request);
      if (route) {
        const period = readRequestPeriod(this.ctx.storage.sql, route.key);
        if (route.operation === 'save') {
          let value = await receiveSave(request, this.ctx.storage, null, route.key);
          if ('code' in value)
            value = {
              ...value,
              conflicts: value.conflicts.map((conflict) => {
                if (conflict.target.unit !== 'daily-request' || conflict.data === null)
                  return conflict;
                const { memo, ...data } = conflict.data as unknown as DailyRequest;
                return { ...conflict, data: { ...data, has_memo: memo !== null } };
              }),
            };
          ({ generation, restoredTo } = readGeneration(this.ctx.storage));
          return saveReply(value, requestId, generation, restoredTo);
        }
        const body =
          route.operation === 'load'
            ? readRequestSheet(this.ctx.storage.sql, period, metadata(requestId, generation))
            : route.operation === 'requests'
              ? readRequests(this.ctx.storage.sql, period)
              : requestChangeNumber(period);
        return { body, status: 200, generation, restoredTo, result: 'success' };
      }
      if (!identity) throw new AppError('E-35');
      if (operation.startsWith('maintenance-')) {
        const body = await receiveMaintenance(request, this.ctx, identity, operation);
        ({ generation, restoredTo } = readGeneration(this.ctx.storage));
        return { body, status: 200, generation, restoredTo, result: 'success' };
      }
      if (request.method === 'POST' && operation === 'save-preview') {
        return {
          body: await readSavePreview(request, this.ctx.storage, metadata(requestId, generation)),
          status: 200,
          generation,
          restoredTo,
          result: 'success',
        };
      }
      if (request.method === 'POST' && operation === 'save') {
        const value = await receiveSave(request, this.ctx.storage, identity);
        ({ generation, restoredTo } = readGeneration(this.ctx.storage));
        return saveReply(value, requestId, generation, restoredTo);
      }
      if (request.method === 'GET' && operation === 'first-load') {
        const now = new Date();
        const delayed = stalledTasks(this.ctx.storage.sql, this.env, now);
        const sending = this.stallMail.start(this.ctx.storage, this.env, delayed, now);
        if (sending) this.ctx.waitUntil(sending);
        return {
          body: readFirstLoad(
            this.ctx.storage,
            identity,
            metadata(requestId, generation),
            delayed.length > 0,
          ),
          status: 200,
          generation,
          restoredTo,
          result: 'success',
        };
      }
      if (request.method === 'GET' && operation === 'year-load') {
        const value = new URL(request.url).searchParams.get('year');
        if (value === null || !/^-?\d+$/.test(value) || !validFiscalYear(Number(value)))
          throw new AppError('E-36');
        return {
          body: readYearLoad(this.ctx.storage, Number(value), metadata(requestId, generation)),
          status: 200,
          generation,
          restoredTo,
          result: 'success',
        };
      }
      if (request.method === 'GET' && operation === 'period-load') {
        const id = new URL(request.url).searchParams.get('id');
        if (!validIdentifier(id, true)) throw new AppError('E-32', 'id');
        return {
          body: readPeriodLoad(this.ctx.storage, id, metadata(requestId, generation)),
          status: 200,
          generation,
          restoredTo,
          result: 'success',
        };
      }
      if (request.method === 'GET' && operation === 'change-number') {
        return {
          body: readChangeNumber(this.ctx.storage),
          status: 200,
          generation,
          restoredTo,
          result: 'success',
        };
      }
      if (request.method === 'POST' && operation === 'screen-error') {
        await receiveScreenError(request, this.ctx.storage, identity.role);
        return { body: { ok: true }, status: 200, generation, restoredTo, result: 'success' };
      }
      throw new AppError('E-35');
    } catch (error) {
      if (operationOf(request) === 'save' || requestRoute(request)?.operation === 'save') {
        try {
          ({ generation, restoredTo } = readGeneration(this.ctx.storage));
        } catch {
          /* Keep null if the schema has no version. */
        }
      }
      const result = failure(error, requestId, generation, restoredTo);
      if (result.result !== 'success' && ERROR_CODES[result.result].display === 'always') {
        try {
          recordFatal(
            this.ctx.storage,
            result.result,
            identity?.role ?? null,
            operationOf(request),
          );
        } catch {
          /* The schema failure may have prevented the error table from being created. */
        }
      }
      return result;
    }
  }
}
