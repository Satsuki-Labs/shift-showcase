import './PageScrollbar.css';
import { useLayoutEffect, useRef, type RefObject } from 'react';
import { layoutRect, layoutValue, scrollWindow, viewport } from '../parts/viewport';

/** The browser still scrolls the document; this only replaces its visible bar. */
export function PageScrollbar({ band }: { band: RefObject<HTMLElement | null> }) {
  const track = useRef<HTMLDivElement>(null);
  const thumb = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const rail = track.current,
      handle = thumb.current,
      header = band.current;
    if (!rail || !handle || !header) return;
    let drag: { pointer: number; fraction: number } | undefined;
    let travel = 0,
      maximum = 0,
      handleHeight = 0;
    const measure = () => {
      const page = viewport();
      // Document coordinates keep the rail below the original band, even after it scrolls away.
      const top = layoutRect(header).bottom + page.scrollY + layoutValue(8);
      const height = Math.max(0, page.height - top - layoutValue(8));
      maximum = Math.max(0, page.scrollHeight - page.height);
      handleHeight = Math.min(
        height,
        Math.max(layoutValue(32), (height * page.height) / page.scrollHeight),
      );
      travel = height - handleHeight;
      rail.hidden = maximum === 0 || travel <= 0;
      rail.style.top = `${top}px`;
      rail.style.bottom = `${layoutValue(8)}px`;
      rail.style.right = `${layoutValue(4)}px`;
      rail.style.width = `${layoutValue(8)}px`;
      handle.style.height = `${handleHeight}px`;
      handle.style.top = `${(travel * Math.min(maximum, Math.max(0, page.scrollY))) / (maximum || 1)}px`;
    };
    const press = (event: PointerEvent) => {
      if (event.button !== 0 || !event.isPrimary) return;
      measure();
      if (rail.hidden) return;
      event.preventDefault();
      const y = layoutValue(event.clientY),
        bounds = layoutRect(handle);
      if (y >= bounds.top && y <= bounds.bottom) {
        drag = { pointer: event.pointerId, fraction: (y - bounds.top) / handleHeight };
        rail.setPointerCapture(event.pointerId);
      } else {
        const page = viewport();
        const direction = y < bounds.top ? -1 : 1;
        scrollWindow(
          Math.max(
            0,
            Math.min(
              maximum,
              page.scrollY + direction * Math.max(0, page.height - layoutValue(40)),
            ),
          ),
        );
        measure();
      }
    };
    const move = (event: PointerEvent) => {
      if (!drag || event.pointerId !== drag.pointer) return;
      measure();
      if (rail.hidden) return;
      const position =
        layoutValue(event.clientY) - layoutRect(rail).top - drag.fraction * handleHeight;
      scrollWindow(Math.max(0, Math.min(1, position / travel)) * maximum);
      measure();
    };
    const release = (event: PointerEvent) => {
      if (event.pointerId !== drag?.pointer) return;
      drag = undefined;
      if (rail.hasPointerCapture(event.pointerId)) rail.releasePointerCapture(event.pointerId);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(header);
    observer.observe(document.body);
    observer.observe(document.documentElement);
    window.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);
    rail.addEventListener('pointerdown', press);
    rail.addEventListener('pointermove', move);
    rail.addEventListener('pointerup', release);
    rail.addEventListener('pointercancel', release);
    rail.addEventListener('lostpointercapture', release);
    return () => {
      observer.disconnect();
      window.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
      rail.removeEventListener('pointerdown', press);
      rail.removeEventListener('pointermove', move);
      rail.removeEventListener('pointerup', release);
      rail.removeEventListener('pointercancel', release);
      rail.removeEventListener('lostpointercapture', release);
      if (drag && rail.hasPointerCapture(drag.pointer)) rail.releasePointerCapture(drag.pointer);
    };
  }, [band]);
  return (
    <div ref={track} className="page-scrollbar" hidden aria-hidden="true">
      <div ref={thumb} className="page-scrollbar-thumb" />
    </div>
  );
}
