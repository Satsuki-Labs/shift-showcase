import { useEffect, useRef } from 'react';
import { isRevealScroll } from './Reveal';

interface DismissOptions {
  escape?: boolean;
  scroll?: boolean;
  preserveRevealScroll?: boolean;
  restoreFocus?: () => HTMLElement | null | undefined;
}

/** Consume the outside press, including its click after the popup has closed. */
export function useDismissOutside(
  open: boolean,
  contains: (target: Node) => boolean,
  close: () => void,
  options: DismissOptions = {},
) {
  const current = useRef({ open, contains, close, options });
  current.current = { open, contains, close, options };
  useEffect(() => {
    let consumeClick = false;
    const outside = (event: Event) =>
      current.current.open &&
      (!(event.target instanceof Node) || !current.current.contains(event.target));
    const consume = (event: Event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    const pointerdown = (event: PointerEvent) => {
      consumeClick = outside(event);
      if (!consumeClick) return;
      consume(event);
      current.current.close();
    };
    const click = (event: MouseEvent) => {
      if (!consumeClick && (event.detail === 0 || !outside(event))) return;
      consumeClick = false;
      consume(event);
      current.current.close();
    };
    const keydown = (event: KeyboardEvent) => {
      consumeClick = false;
      const { open, close, options } = current.current;
      if (!open || !options.escape || event.key !== 'Escape' || event.defaultPrevented) return;
      consume(event);
      close();
      options.restoreFocus?.()?.focus({ preventScroll: true });
    };
    const scroll = (event: Event) => {
      if (!current.current.options.scroll || !outside(event)) return;
      if (
        current.current.options.preserveRevealScroll &&
        isRevealScroll(event, current.current.contains)
      )
        return;
      consumeClick = false;
      current.current.close();
    };
    document.addEventListener('pointerdown', pointerdown, true);
    document.addEventListener('click', click, true);
    document.addEventListener('keydown', keydown, true);
    document.addEventListener('scroll', scroll, { capture: true, passive: true });
    return () => {
      document.removeEventListener('pointerdown', pointerdown, true);
      document.removeEventListener('click', click, true);
      document.removeEventListener('keydown', keydown, true);
      document.removeEventListener('scroll', scroll, true);
    };
  }, []);
}
