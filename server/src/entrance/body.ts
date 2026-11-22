import { AppError } from '../../../shared/app-error';
import { MAX_INPUT_BYTES, MAX_JSON_DEPTH } from '../../../shared/limits';

export async function readInputJson(request: Request): Promise<unknown> {
  let value: unknown;
  try {
    const reader = request.body?.getReader();
    if (!reader) throw new AppError('E-36');
    const decoder = new TextDecoder();
    let size = 0,
      body = '';
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > MAX_INPUT_BYTES) {
          await reader.cancel();
          throw new AppError('E-36');
        }
        body += decoder.decode(chunk.value, { stream: true });
      }
      value = JSON.parse(body + decoder.decode());
    } finally {
      reader.releaseLock();
    }
  } catch {
    throw new AppError('E-36');
  }
  const pending = [{ value, depth: 1 }];
  while (pending.length) {
    const item = pending.pop()!;
    if (item.value === null || typeof item.value !== 'object') continue;
    if (item.depth > MAX_JSON_DEPTH) throw new AppError('E-36');
    for (const child of Object.values(item.value))
      pending.push({ value: child, depth: item.depth + 1 });
  }
  return value;
}
