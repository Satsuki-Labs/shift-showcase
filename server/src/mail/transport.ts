export type GasResult =
  { kind: 'answer'; value: unknown } | { kind: 'unreachable' | 'timeout' | 'http' | 'unreadable' };

export async function postGas(url: string, body: string): Promise<GasResult> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async (): Promise<GasResult> => {
        let response: Response;
        try {
          response = await fetch(url, {
            method: 'POST',
            redirect: 'follow',
            headers: { 'Content-Type': 'application/json' },
            body,
            signal: controller.signal,
          });
        } catch {
          return { kind: 'unreachable' };
        }
        if (response.status !== 200) return { kind: 'http' };
        try {
          return { kind: 'answer', value: await response.json() };
        } catch {
          return { kind: 'unreadable' };
        }
      })(),
      new Promise<GasResult>((resolve) => {
        timeout = setTimeout(
          () => {
            resolve({ kind: 'timeout' });
            controller.abort();
          },
          6 * 60 * 1000,
        );
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}
