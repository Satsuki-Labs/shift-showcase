import { layoutRect } from './viewport';
import './SelectBox.css';
import './TimeField.css';
import './DateField.css';
import './Popup.css';
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Reveal } from './Reveal';
import { floatingHost, useFloating, type FloatingPlacement } from './Floating';
import { useDismissOutside } from './useDismissOutside';
import { useFocusCycle } from './useFocusCycle';

/** Keep choices outside animated fields, but inside their dialog's focus scope. */
export function Popup({
  anchor,
  owner,
  open,
  close,
  children,
  className,
  width,
  alignToOwner = false,
  placement,
  scrollContainer,
  placementHeight,
  scrollStep,
}: {
  anchor: RefObject<HTMLElement | null>;
  owner: RefObject<HTMLElement | null>;
  open: boolean;
  close: () => void;
  children: ReactNode;
  className: string;
  width?: number;
  alignToOwner?: boolean;
  placement?: FloatingPlacement;
  scrollContainer?: RefObject<HTMLElement | null>;
  placementHeight?: (height: number) => number;
  scrollStep?: () => number;
}) {
  const popup = useRef<HTMLDivElement>(null);
  const [host, setHost] = useState<Element | null>(null);
  useEffect(() => {
    setHost(floatingHost(owner.current));
  }, [owner]);
  useFloating(popup, {
    open: open && Boolean(host),
    anchor: () => anchor.current,
    anchorBounds: (node) => layoutRect(alignToOwner ? owner.current! : node),
    width,
    matchWidth: true,
    placement,
    scrollContainer,
    placementHeight,
    scrollStep,
  });
  useDismissOutside(
    open,
    (target) => Boolean(owner.current?.contains(target) || popup.current?.contains(target)),
    close,
    { escape: true, scroll: true, restoreFocus: () => anchor.current },
  );
  useFocusCycle(popup, open && Boolean(host), true);
  useEffect(() => {
    if (!open) return;
    const observer = new MutationObserver(() => {
      if (owner.current?.closest('[inert]')) close();
    });
    observer.observe(owner.current!.closest('.dlg-body') ?? owner.current!.parentElement!, {
      subtree: true,
      attributes: true,
      attributeFilter: ['inert'],
    });
    return () => observer.disconnect();
  }, [open, owner, close]);
  return (
    host &&
    createPortal(
      <div
        className={'floating-popup ' + className}
        ref={popup}
        style={{ left: 0, top: 0, width: 0, pointerEvents: open ? 'auto' : 'none' }}
      >
        <Reveal reserveSpace open={open}>
          {children}
        </Reveal>
      </div>,
      host,
    )
  );
}
