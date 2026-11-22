import { useEffect, useState } from 'react';
import { SAVE_TIMING } from '../saving/timing';

export function useLoadingIndicator(request: object | null): boolean {
  const [shownRequest, setShownRequest] = useState<object | null>(null);
  useEffect(() => {
    setShownRequest(null);
    if (request === null) return;
    const timer = setTimeout(() => setShownRequest(request), SAVE_TIMING.showAfterMs);
    return () => clearTimeout(timer);
  }, [request]);
  return request !== null && shownRequest === request;
}
