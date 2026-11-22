import { useLayoutEffect, useRef, useState, type FocusEvent } from 'react';
import { flushSync } from 'react-dom';

export const nameColumnWidth = 144;
const minimumDayWidth = 131;
interface CellFocus {
  personId: string;
  date: string;
}
interface DayWindow {
  width: number;
  first: number;
  last: number;
  start: number;
  end: number;
}

function dayWindow(count: number, width: number, left: number, available: number): DayWindow {
  const first = Math.max(0, Math.min(count, Math.floor(left / width)));
  const last = Math.min(count, Math.ceil((left + available) / width));
  return { width, first, last, start: Math.max(0, first - 2), end: Math.min(count, last + 2) };
}

/** Only window boundaries enter React state; pixel scrolling does not rebuild rows. */
export function useVisibleShiftDays(dates: readonly string[], hasTable: boolean) {
  const scroll = useRef<HTMLDivElement>(null),
    proxy = useRef<HTMLSpanElement>(null);
  // Measure in the layout effect before mounting any day contents or painting.
  const [window, setWindow] = useState<DayWindow>({
    width: 132,
    first: 0,
    last: 0,
    start: 0,
    end: 0,
  });
  const current = useRef(window),
    focused = useRef<CellFocus | null>(null);
  const pending = useRef<CellFocus | null>(null),
    parking = useRef(false);
  const cellButton = (target: CellFocus) => {
    const row = Array.from(
      scroll.current?.querySelectorAll<HTMLElement>('[data-shift-person]') ?? [],
    ).find((node) => node.dataset.shiftPerson === target.personId);
    return Array.from(row?.querySelectorAll<HTMLElement>('[data-shift-date]') ?? [])
      .find((node) => node.dataset.shiftDate === target.date)
      ?.querySelector<HTMLButtonElement>('button');
  };
  const park = () => {
    parking.current = true;
    proxy.current?.focus({ preventScroll: true });
    parking.current = false;
  };
  const update = (next: DayWindow, synchronous = false) => {
    const old = current.current;
    if (
      old.width === next.width &&
      old.first === next.first &&
      old.last === next.last &&
      old.start === next.start &&
      old.end === next.end
    )
      return;
    const active = document.activeElement?.closest<HTMLElement>('[data-shift-date]');
    if (active && scroll.current?.contains(active)) {
      const index = dates.indexOf(active.dataset.shiftDate!);
      if (index < next.start || index >= next.end) park();
    }
    current.current = next;
    if (synchronous) flushSync(() => setWindow(next));
    else setWindow(next);
  };
  const measure = (resize: boolean, synchronous = false) => {
    const node = scroll.current;
    if (!node) return;
    const available = Math.max(0, node.clientWidth - nameColumnWidth);
    const visible = Math.max(7, Math.min(9, Math.floor(available / minimumDayWidth)));
    const width = resize && available > 0 ? available / visible : current.current.width;
    update(dayWindow(dates.length, width, node.scrollLeft, available), synchronous);
  };
  const focusCell = (personId: string, date: string) => {
    const node = scroll.current,
      index = dates.indexOf(date);
    if (!node || index < 0) return;
    const width = current.current.width,
      available = Math.max(0, node.clientWidth - nameColumnWidth);
    const left = index * width,
      right = left + width;
    if (left < node.scrollLeft) node.scrollLeft = left;
    else if (right > node.scrollLeft + available) node.scrollLeft = right - available;
    const target = { personId, date };
    pending.current = target;
    measure(false);
    const button = cellButton(target);
    if (button) {
      pending.current = null;
      button.focus({ preventScroll: true });
    }
  };
  useLayoutEffect(() => {
    measure(true);
    const node = scroll.current;
    if (!node) return;
    const observer = new ResizeObserver(() => measure(true));
    observer.observe(node);
    const onScroll = () => measure(false, true);
    node.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      observer.disconnect();
      node.removeEventListener('scroll', onScroll);
    };
  }, [dates, hasTable]);
  useLayoutEffect(() => {
    const target = pending.current;
    if (target) {
      const button = cellButton(target);
      if (button) {
        pending.current = null;
        button.focus({ preventScroll: true });
      }
    }
  });
  const onFocusCapture = (event: FocusEvent<HTMLDivElement>) => {
    const cell = (event.target as HTMLElement).closest<HTMLElement>('[data-shift-date]');
    const row = cell?.closest<HTMLElement>('[data-shift-person]');
    if (cell && row) {
      focused.current = { personId: row.dataset.shiftPerson!, date: cell.dataset.shiftDate! };
      focusCell(focused.current.personId, focused.current.date);
    }
  };
  return {
    scroll,
    proxy,
    window,
    focusCell,
    onFocusCapture,
    refresh: () => measure(false),
    // Dialog retains this stable node even when the original cell leaves the window.
    parkForDialog: (target: EventTarget) => {
      if ((target as HTMLElement).closest('.shift-cell-button')) park();
    },
    restoreFocus: () => {
      if (!parking.current && focused.current)
        focusCell(focused.current.personId, focused.current.date);
    },
    resumeKeyboard: () => {
      const target = focused.current;
      if (target) flushSync(() => focusCell(target.personId, target.date));
      if (target) cellButton(target)?.focus({ preventScroll: true });
    },
  };
}
