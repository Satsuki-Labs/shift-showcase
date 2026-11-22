import type { PointerEvent } from 'react';

export function beginRequestDrag(
  event: PointerEvent<HTMLDivElement>,
  {
    drag,
    locked,
    closing,
    open,
    stopFocus,
    setDragOffset,
  }: {
    drag: { current: { pointerId: number; startY: number; handle: HTMLDivElement } | undefined };
    locked: boolean;
    closing: boolean;
    open: boolean;
    stopFocus: () => void;
    setDragOffset: (offset: number) => void;
  },
) {
  if (drag.current || !event.isPrimary || event.button !== 0 || locked || closing || !open) return;
  stopFocus();
  drag.current = {
    pointerId: event.pointerId,
    startY: event.clientY,
    handle: event.currentTarget,
  };
  event.currentTarget.setPointerCapture(event.pointerId);
  setDragOffset(0);
}
