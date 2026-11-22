import type { OrganizationObject } from './organization-object';
import { authenticate } from './entrance/auth';
import {
  failure,
  operationOf,
  requestRoute,
  respond,
  type EntranceResult,
} from './entrance/response';
import { logRequest } from './entrance/records';
import type { Identity } from '../../shared/protocol';

export { OrganizationObject } from './organization-object';

export interface Env {
  ENVIRONMENT: '本番' | '手元';
  ROLE_TABLE: Record<string, unknown>;
  ACCESS_TEAM: string;
  ACCESS_AUDIENCE: string;
  BACKUP_GAS_URL?: string;
  BACKUP_GAS_TOKEN?: string;
  LOCAL_EMAIL?: string;
  LOCAL_ROLE?: string;
  ORGANIZATION: DurableObjectNamespace<OrganizationObject>;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const started = performance.now();
    const requestId = crypto.randomUUID();
    const operation = operationOf(request);
    const entrance = requestRoute(request) ? 'request' : 'staff';
    let identity: Identity | null = null;
    let result: EntranceResult;
    try {
      if (entrance === 'staff') identity = await authenticate(request, env);
      const id = env.ORGANIZATION.idFromName('organization');
      result = await env.ORGANIZATION.get(id).handle(request, identity, requestId);
    } catch (error) {
      result = failure(error, requestId, null);
    }
    logRequest(requestId, operation, identity?.role ?? null, result.result, started, entrance);
    return respond(result, requestId);
  },
} satisfies ExportedHandler<Env>;
