import './Reveal.css';
import { useLayoutEffect, useRef } from 'react';

export function usePeriodArrival(periodId: string | null) {
  const content = useRef<HTMLDivElement>(null);
  const lastPeriod = useRef<string | null>(null);
  useLayoutEffect(() => {
    const node = content.current;
    if (periodId === null || !node) return;
    const changed = lastPeriod.current !== null && lastPeriod.current !== periodId;
    lastPeriod.current = periodId;
    if (!changed) return;
    // Finish removing the previous animation before a rapid switch restarts it.
    void node.offsetWidth;
    node.classList.add('period-arrival');
    const finish = (event: AnimationEvent) => {
      if (event.target === node && event.animationName === 'period-arrival')
        node.classList.remove('period-arrival');
    };
    node.addEventListener('animationend', finish);
    return () => {
      node.removeEventListener('animationend', finish);
      node.classList.remove('period-arrival');
    };
  }, [periodId]);
  return content;
}
