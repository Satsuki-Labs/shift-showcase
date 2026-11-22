import type {
  RequestChangeNumberResponse,
  RequestRequestsResponse,
  RequestSheetResponse,
} from '../../../shared/protocol';

async function read<T>(key: string, endpoint: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(`/api/request/${encodeURIComponent(key)}/${endpoint}`, { signal });
  const body: unknown = await response.json();
  if (!response.ok) throw body;
  return body as T;
}

export const loadSheet = (key: string, signal: AbortSignal) =>
  read<RequestSheetResponse>(key, 'load', signal);

export const readChangeNumber = (key: string, signal: AbortSignal) =>
  read<RequestChangeNumberResponse>(key, 'change-number', signal);

export const readRequests = (key: string, signal: AbortSignal) =>
  read<RequestRequestsResponse>(key, 'requests', signal);
