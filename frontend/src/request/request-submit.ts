import type { RequestSheetResponse, SaveRequest } from '../../../shared/protocol';
import { saveRequest } from './api';
import { requestKey, type LoadFailure } from './model';
import { loadSheet, readRequests } from '../loading/request-sheet';

export type SubmitRequest = (
  request: SaveRequest,
) => Promise<'saved' | 'dismissed' | { status: 'conflict'; sheet: RequestSheetResponse }>;

export function createRequestSubmit({
  key,
  latest,
  writes,
  pollController,
  setFresh,
  updateSheet,
  setPicked,
  setFailure,
}: {
  key: string;
  latest: { current: RequestSheetResponse | undefined };
  writes: { current: number };
  pollController: { current: AbortController | undefined };
  setFresh: (value: Set<string>) => void;
  updateSheet: (value: RequestSheetResponse) => void;
  setPicked: (value: undefined) => void;
  setFailure: (value: LoadFailure) => void;
}): SubmitRequest {
  return async (request) => {
    writes.current++;
    pollController.current?.abort();
    const deadline = Date.now() + 30000;
    try {
      try {
        await saveRequest(key, request);
      } catch (error) {
        const code =
          typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
        if (
          code === 'E-33' ||
          code === 'E-42' ||
          (code === 'E-32' && request.operation === 'request.none.set')
        ) {
          try {
            const data = await loadSheet(
              key,
              AbortSignal.timeout(Math.max(1, deadline - Date.now())),
            );
            setFresh(new Set());
            updateSheet(data);
          } catch {
            /* 今の内容は、次の10秒ごとの確かめでも読み直す。 */
          }
          return { status: 'conflict', sheet: latest.current! };
        }
        throw error;
      }
      try {
        const requests = await readRequests(
          key,
          AbortSignal.timeout(Math.max(1, deadline - Date.now())),
        );
        const current = latest.current!;
        const previous = new Set(current.dailyRequests.map(requestKey));
        setFresh(
          new Set(
            requests.dailyRequests.filter((row) => !previous.has(requestKey(row))).map(requestKey),
          ),
        );
        updateSheet({ ...current, ...requests });
      } catch {
        /* 保存は届いた。中身は10秒ごとの確かめで読み直す。 */
      }
      return 'saved';
    } catch (error) {
      const code =
        typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
      if (code === 'E-27') {
        setPicked(undefined);
        setFailure('badurl');
        return 'dismissed';
      }
      if (code === 'E-37') {
        setPicked(undefined);
        updateSheet({ ...latest.current!, requestsClosed: true });
        return 'dismissed';
      }
      throw error;
    } finally {
      writes.current--;
    }
  };
}
