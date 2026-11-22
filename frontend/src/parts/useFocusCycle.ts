import { useEffect, type RefObject } from 'react';

const captureScopes: HTMLElement[] = [];

/** Capture scopes handle Tab before enclosing bubble scopes. */
export function useFocusCycle(
  container: RefObject<HTMLElement | null>,
  enabled: boolean,
  capture: boolean,
) {
  useEffect(() => {
    const node = container.current;
    if (!enabled || !node) return;
    if (capture) captureScopes.push(node);
    const keydown = (event: KeyboardEvent) => {
      if (
        event.key !== 'Tab' ||
        event.defaultPrevented ||
        (capture && captureScopes[captureScopes.length - 1] !== node)
      )
        return;
      const elements = Array.from(
        node.querySelectorAll<HTMLElement>(
          'button:not(:disabled):not([tabindex="-1"]), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]',
        ),
      ).filter(
        (element) =>
          !element.closest('[inert]') &&
          element.getClientRects().length > 0 &&
          getComputedStyle(element).visibility !== 'hidden',
      );
      const first = elements[0],
        last = elements[elements.length - 1];
      if (
        !first ||
        !node.contains(document.activeElement) ||
        (event.shiftKey ? document.activeElement === first : document.activeElement === last)
      ) {
        event.preventDefault();
        (event.shiftKey ? last : first)?.focus({ preventScroll: true });
      }
      event.stopImmediatePropagation();
    };
    document.addEventListener('keydown', keydown, capture);
    return () => {
      if (capture) captureScopes.splice(captureScopes.indexOf(node), 1);
      document.removeEventListener('keydown', keydown, capture);
    };
  }, [container, enabled, capture]);
}
