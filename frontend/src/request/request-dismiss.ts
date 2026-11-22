export function dismissRequest(
  sending: boolean,
  status: 'idle' | 'saving' | 'deleting' | 'done',
  finish: (() => void) | undefined,
  blocked: () => boolean,
  close: () => void,
) {
  if (sending) return;
  if (status === 'done') finish?.();
  else if (!blocked()) close();
}
