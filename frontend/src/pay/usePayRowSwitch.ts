import { useCallback, useLayoutEffect, useRef, type RefObject } from 'react';
import { motionEasing, motionMs } from '../parts/motion';
import { layoutRect, layoutValue, scrollWindow, viewport } from '../parts/viewport';

interface TargetBounds {
  from: number;
  needed: number;
  rowTop: number;
  pageBottom: number;
  height: number;
  gap: number;
}

/** Keep the reading position within the page that will remain after the switch. */
function payRowSwitchTarget({ from, needed, rowTop, pageBottom, height, gap }: TargetBounds) {
  const desired = Math.max(gap, Math.min(from, height - needed - gap));
  const maximumScroll = Math.max(0, pageBottom - height);
  return Math.max(rowTop - maximumScroll, Math.min(rowTop, desired));
}

interface Motion {
  id: string;
  stop: () => void;
}

export function usePayRowSwitch(
  list: RefObject<HTMLElement | null>,
  openStaffId: string | null,
  toggle: (id: string) => void,
) {
  const active = useRef<Motion | null>(null);
  const cancel = useCallback(() => active.current?.stop(), []);
  useLayoutEffect(() => cancel, [cancel]);
  useLayoutEffect(() => {
    if (active.current && active.current.id !== openStaffId) cancel();
  }, [openStaffId, cancel]);

  return useCallback(
    (id: string) => {
      cancel();
      const node = list.current,
        main = node?.closest('main');
      const rows = Array.from(node?.querySelectorAll<HTMLButtonElement>('button.pr') ?? []);
      const row = rows.find(
        (button) => button.parentElement?.querySelector('.pay-details')?.id === `pay-details-${id}`,
      );
      if (openStaffId && openStaffId !== id && node && main && row) {
        const view = viewport(),
          from = layoutRect(row).top;
        const heights = rows.map((button) => {
          const detail = button.parentElement!.querySelector('.pay-details');
          return detail ? layoutRect(detail).height : 0;
        });
        const rowTop =
          from +
          view.scrollY -
          heights.slice(0, rows.indexOf(row)).reduce((sum, height) => sum + height, 0);
        const baseBottom =
          layoutRect(main).bottom + view.scrollY - heights.reduce((sum, height) => sum + height, 0);
        const duration = motionMs(row, '--motion-reveal'),
          ease = motionEasing(row, '--ease-standard');
        const started = performance.now(),
          gap = layoutValue(16);
        const events = [
          'wheel',
          'touchstart',
          'touchmove',
          'mousedown',
          'pointerdown',
          'keydown',
        ] as const;
        let raf: number | undefined,
          target: number | undefined,
          stableFrames = 0;
        const stop = () => {
          if (active.current?.stop !== stop) return;
          if (raf !== undefined) cancelAnimationFrame(raf);
          observer.disconnect();
          events.forEach((event) => document.removeEventListener(event, stop, true));
          window.removeEventListener('resize', stop);
          active.current = null;
        };
        const apply = () => {
          if (active.current?.stop !== stop || !row.isConnected || !row.classList.contains('op'))
            return;
          const bounds = layoutRect(row);
          if (target === undefined) {
            const frame = row.parentElement!.querySelector('.reveal-frame');
            const item = frame?.querySelector('.reveal-item:not(.leaving)');
            const facts = row.parentElement!.querySelector('.pay-factrow');
            if (frame && item && facts) {
              const itemBounds = layoutRect(item);
              target = payRowSwitchTarget({
                from,
                needed:
                  layoutRect(frame).top - bounds.top + layoutRect(facts).bottom - itemBounds.top,
                rowTop,
                pageBottom: baseBottom + itemBounds.height,
                height: viewport().height,
                gap,
              });
            }
          }
          const progress =
            duration === 0 ? 1 : Math.max(0, Math.min(1, (performance.now() - started) / duration));
          const desired = from + ((target ?? from) - from) * ease(progress),
            current = viewport();
          const next = Math.max(
            0,
            Math.min(
              current.scrollY + bounds.top - desired,
              Math.max(0, current.scrollHeight - current.height),
            ),
          );
          if (Math.abs(next - current.scrollY) > 0.05) scrollWindow(next);
          if (duration === 0 && target !== undefined) stop();
        };
        const observer = new ResizeObserver(() => {
          if (active.current?.stop !== stop) return;
          stableFrames = 0;
          apply();
        });
        const tick = () => {
          if (active.current?.stop !== stop) return;
          if (!row.isConnected || !row.classList.contains('op')) {
            stop();
            return;
          }
          apply();
          if (active.current?.stop !== stop) return;
          stableFrames++;
          if (
            performance.now() - started >= duration &&
            (target === undefined || stableFrames >= 3)
          ) {
            stop();
            return;
          }
          raf = requestAnimationFrame(tick);
        };
        active.current = { id, stop };
        events.forEach((event) =>
          document.addEventListener(event, stop, { capture: true, passive: true }),
        );
        window.addEventListener('resize', stop);
        node
          .querySelectorAll('.pay-details .reveal-frame')
          .forEach((frame) => observer.observe(frame));
        raf = requestAnimationFrame(tick);
      }
      toggle(id);
    },
    [list, openStaffId, toggle, cancel],
  );
}
