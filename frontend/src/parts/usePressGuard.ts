import { useRef } from 'react';

/** A newly revealed target must not receive the second press of a quick pair. */
export function createPressGuard() {
  let readyAt = performance.now() + 1000;
  return {
    blocked: () => performance.now() < readyAt,
    restart: () => {
      readyAt = performance.now() + 1000;
    },
  };
}

export function usePressGuard() {
  const guard = useRef<ReturnType<typeof createPressGuard> | null>(null);
  if (!guard.current) guard.current = createPressGuard();
  return guard.current;
}

/** Keep guarding after the dialog unmounts, until the revealed page is ready. */
export function guardRevealedContent() {
  const guard = createPressGuard();
  const events = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick'] as const;
  const consume = (event: Event) => {
    if (!guard.blocked()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  events.forEach((type) => document.addEventListener(type, consume, true));
  setTimeout(
    () => events.forEach((type) => document.removeEventListener(type, consume, true)),
    1000,
  );
}
