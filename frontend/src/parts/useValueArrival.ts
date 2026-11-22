import { useCallback, useLayoutEffect, useRef } from 'react';
import './Reveal.css';

export function useValueArrival(value: string, changeKey: string | number | undefined) {
  const root = useRef<HTMLSpanElement>(null),
    leaving = useRef<HTMLSpanElement>(null);
  const previous = useRef({ value, changeKey });
  const stop = useCallback(() => {
    root.current?.classList.remove('arrive');
    if (leaving.current) leaving.current.textContent = '';
  }, []);
  useLayoutEffect(() => {
    const node = root.current!,
      old = previous.current;
    previous.current = { value, changeKey };
    stop();
    if (
      old.changeKey === changeKey ||
      old.value === value ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    )
      return;
    leaving.current!.textContent = old.value;
    void node.offsetWidth;
    node.classList.add('arrive');
  }, [value, changeKey, stop]);
  useLayoutEffect(() => {
    const node = root.current!,
      reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const finish = (event: AnimationEvent) => {
      if (event.target === node.firstElementChild) stop();
    };
    const reduce = () => {
      if (reduced.matches) stop();
    };
    node.addEventListener('animationend', finish);
    reduced.addEventListener('change', reduce);
    return () => {
      node.removeEventListener('animationend', finish);
      reduced.removeEventListener('change', reduce);
    };
  }, [stop]);
  return { root, leaving, stop };
}
