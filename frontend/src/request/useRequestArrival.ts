import { useLayoutEffect, useRef, type RefObject } from 'react';
import type { RequestSheetDailyRequest } from '../../../shared/protocol';
import { motionEasing, motionMs } from '../parts/motion';

type RowSize = { row: HTMLElement; height: number };
type Arrival = { rows: RowSize[]; scrollTop: number; owner: string | null };

/** ポーリングの描画直前に測り、届いた行の高さと位置の補正を一緒に動かす。 */
export function useRequestArrival(
  scroll: RefObject<HTMLDivElement | null>,
  requests: RequestSheetDailyRequest[] | undefined,
  owner: string | null,
) {
  const currentOwner = useRef(owner);
  currentOwner.current = owner;
  const pending = useRef<Arrival>(undefined);
  const animation = useRef(0);
  const stop = useRef<() => void>(() => {});
  const prepare = () => {
    stop.current();
    const box = scroll.current;
    if (!box) return;
    pending.current = {
      owner: currentOwner.current,
      scrollTop: box.scrollTop,
      rows: [...box.querySelectorAll<HTMLElement>('.rq-day')].map((row) => ({
        row,
        height: row.getBoundingClientRect().height,
      })),
    };
  };

  useLayoutEffect(() => {
    const arrival = pending.current;
    pending.current = undefined;
    const box = scroll.current;
    if (!box || !arrival || arrival.owner !== owner) return;
    const changes = arrival.rows
      .filter(({ row }) => row.isConnected)
      .map(({ row, height }) => ({
        row,
        before: height,
        after: row.getBoundingClientRect().height,
      }))
      .filter((row) => row.before !== row.after);
    if (!changes.length) return;
    const clear = () => {
      cancelAnimationFrame(animation.current);
      changes.forEach(({ row }) => {
        row.style.height = '';
      });
    };
    stop.current = clear;
    changes.forEach(({ row, before }) => {
      row.style.height = `${before}px`;
    });
    box.scrollTop = arrival.scrollTop;
    const duration = motionMs(box, '--rq-motion-duration');
    const easing = motionEasing(box, '--rq-motion-easing');
    const started = performance.now();
    let remainder = 0;
    const step = (now: number) => {
      const top =
        box.getBoundingClientRect().top +
        (box.querySelector<HTMLElement>('.rq-colhead')?.offsetHeight ?? 0);
      const anchor = arrival.rows.find(
        ({ row }) => row.isConnected && row.getBoundingClientRect().bottom > top,
      )?.row;
      const before = anchor?.getBoundingClientRect().top;
      const progress = duration ? Math.min(1, (now - started) / duration) : 1;
      changes.forEach(({ row, before, after }) => {
        row.style.height = `${before + (after - before) * easing(progress)}px`;
      });
      if (anchor && before !== undefined) {
        const previous = box.scrollTop;
        const correction = anchor.getBoundingClientRect().top - before + remainder;
        box.scrollTop += correction;
        remainder = correction - (box.scrollTop - previous);
      }
      if (progress < 1) animation.current = requestAnimationFrame(step);
      else {
        clear();
        stop.current = () => {};
      }
    };
    if (duration) animation.current = requestAnimationFrame(step);
    else step(started);
  }, [requests, owner, scroll]);

  useLayoutEffect(
    () => () => {
      stop.current();
      pending.current = undefined;
    },
    [owner],
  );
  return prepare;
}
