import type { SaveRequest, SaveSuccess } from '../../../shared/protocol';

export async function saveRequest(key: string, request: SaveRequest): Promise<SaveSuccess> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async () => {
        const response = await fetch(`/api/request/${encodeURIComponent(key)}/save`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(request),
          signal: controller.signal,
        });
        const body: unknown = await response.json();
        if (!response.ok) throw body;
        return body as SaveSuccess;
      })(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error('Request timed out'));
        }, 30000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
