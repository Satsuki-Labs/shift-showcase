import { useLayoutEffect, useRef, type RefObject } from 'react';
import { layoutRect, layoutScrollTop, viewport } from './viewport';
import { revealTargetScrollTop, scrollToShow } from './Reveal';

interface Bounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
}
interface Size {
  width: number;
  height: number;
}
type Direction = 'down' | 'right';
export type FloatingPlacement = 'auto' | 'vertical' | 'vertical-full' | 'reveal-below';
export type NoticePlacement = 'notice-space' | 'navigation';

function isNoticePlacement(
  placement: FloatingPlacement | NoticePlacement | undefined,
): placement is NoticePlacement {
  return placement === 'notice-space' || placement === 'navigation';
}

export function floatingHost(owner: HTMLElement | null) {
  return owner?.closest('.dim') ?? document.body;
}

/** Positions use the same coordinate space as bounds and the anchor. */
function floatingPosition(
  anchor: Bounds,
  size: Size,
  bounds: Bounds,
  direction: Direction = 'down',
  gap = 6,
  left = anchor.left,
  placement: FloatingPlacement = 'auto',
  placementHeight = size.height,
) {
  const referenceHeight = Math.max(size.height, placementHeight);
  const width = Math.min(size.width, Math.max(0, bounds.right - bounds.left));
  if (placement === 'reveal-below') {
    const available = Math.max(0, bounds.bottom - bounds.top - (anchor.bottom - anchor.top) - gap);
    return {
      left: Math.round(Math.max(bounds.left, Math.min(left, bounds.right - width))),
      top: Math.round(anchor.bottom + gap),
      width,
      height: Math.min(size.height, available),
    };
  }
  const below = Math.max(0, bounds.bottom - Math.max(bounds.top, anchor.bottom + gap));
  const above = Math.max(0, Math.min(bounds.bottom, anchor.top - gap) - bounds.top);
  const fitsRight = anchor.right + gap + width <= bounds.right;
  const fitsLeft = anchor.left - gap - width >= bounds.left;
  const beside =
    placement === 'auto' &&
    ((direction === 'right' && fitsRight) ||
      (referenceHeight > below && referenceHeight > above && (fitsRight || fitsLeft)));
  const upwards = !beside && referenceHeight > below && (referenceHeight <= above || above > below);
  const available = beside ? bounds.bottom - bounds.top : upwards ? above : below;
  const height =
    placement === 'vertical-full' ? size.height : Math.min(size.height, Math.max(0, available));
  const placedHeight =
    placement === 'vertical-full'
      ? referenceHeight
      : Math.min(referenceHeight, Math.max(0, available));
  const top = beside ? anchor.top : upwards ? anchor.top - gap - placedHeight : anchor.bottom + gap;
  const sideLeft = fitsRight ? anchor.right + gap : anchor.left - gap - width;
  return {
    left: Math.round(
      Math.max(bounds.left, Math.min(beside ? sideLeft : left, bounds.right - width)),
    ),
    top: Math.round(Math.max(bounds.top, Math.min(top, bounds.bottom - placedHeight))),
    width,
    height,
  };
}

/** Reveal below the anchor, stopping when the anchor reaches the top of the viewport. */
function floatingRevealScrollTop(
  scrollTop: number,
  anchor: Bounds,
  bounds: Bounds,
  height: number,
) {
  const bottom = anchor.bottom + 6 + height;
  if (bottom <= bounds.bottom) return scrollTop;
  return Math.min(
    revealTargetScrollTop(scrollTop, bottom, bounds.bottom),
    scrollTop + Math.max(0, anchor.top - bounds.top),
  );
}

/** Notices use the page-top layout so scrolling cannot change their fixed position. */
function noticePosition(
  navigation: Bounds | undefined,
  tools: Bounds | undefined,
  panel: Bounds | undefined,
  size: Size,
  viewport: Size & { scrollX: number; scrollY: number },
  placement: NoticePlacement = 'notice-space',
) {
  const fallback = Math.max(8, navigation ? navigation.bottom + viewport.scrollY + 8 : 8);
  const toolsTop = tools ? tools.top + viewport.scrollY : 0;
  const toolsBottom = tools ? tools.bottom + viewport.scrollY : 0;
  const panelTop = panel ? panel.top + viewport.scrollY : 0;
  const fits =
    placement === 'notice-space' &&
    tools &&
    panel &&
    toolsTop >= 0 &&
    toolsBottom <= viewport.height &&
    tools.left + viewport.scrollX >= 0 &&
    tools.right + viewport.scrollX <= viewport.width &&
    panelTop >= 0 &&
    panelTop <= viewport.height &&
    panelTop - toolsBottom >= size.height;
  return {
    top: fits ? toolsBottom + (panelTop - toolsBottom - size.height) / 2 : fallback,
    right: 16,
  };
}

interface FloatingOptions {
  open: boolean;
  anchor: () => HTMLElement | null | undefined;
  placement?: FloatingPlacement | NoticePlacement;
  anchorBounds?: (anchor: HTMLElement) => Bounds;
  bounds?: () => Bounds;
  origin?: () => { left: number; top: number };
  visibleBounds?: () => { left: number; right: number };
  visibleAnchor?: () => HTMLElement | null | undefined;
  onAnchorHidden?: () => void;
  direction?: Direction;
  scrollContainer?: RefObject<HTMLElement | null>;
  width?: number;
  matchWidth?: boolean;
  left?: (anchor: Bounds) => number;
  placementHeight?: (height: number) => number;
  scrollStep?: () => number;
}

export function useFloating(popup: RefObject<HTMLElement | null>, options: FloatingOptions) {
  const current = useRef(options);
  current.current = options;
  const update = useRef<(() => void) | undefined>(undefined);
  useLayoutEffect(() => {
    const node = popup.current;
    if (!node) return;
    const scroller = current.current.scrollContainer?.current ?? node;
    if (!options.open) {
      if (scroller.style.overflowY !== 'auto') return;
      let cancelled = false;
      // Keep the closing content's width and scroll position until Reveal finishes.
      const hideScrollbar = () => {
        if (!cancelled) scroller.style.overflowY = 'hidden';
      };
      const animations = node.getAnimations({ subtree: true });
      if (animations.length)
        void Promise.allSettled(animations.map((animation) => animation.finished)).then(
          hideScrollbar,
        );
      else hideScrollbar();
      return () => {
        cancelled = true;
      };
    }
    const owner = () =>
      current.current.anchor() ??
      (isNoticePlacement(current.current.placement)
        ? (document.querySelector<HTMLElement>('.navigation') ?? document.body)
        : null);
    const anchor = owner();
    if (!anchor) return;
    let revealedAnchor = anchor,
      destination: number | undefined,
      cancelScroll: (() => void) | undefined,
      interrupted = false;
    const observed = new Set<Element>();
    const observe = (elements: (Element | null)[]) => {
      const next = new Set(elements.filter((element): element is Element => Boolean(element)));
      observed.forEach((element) => {
        if (!next.has(element)) {
          observer.unobserve(element);
          observed.delete(element);
        }
      });
      next.forEach((element) => {
        if (!observed.has(element)) {
          observer.observe(element);
          observed.add(element);
        }
      });
    };
    const place = () => {
      const settings = current.current,
        attachedOwner = owner();
      if (!attachedOwner) return;
      if (isNoticePlacement(settings.placement)) {
        const tools = document.querySelector<HTMLElement>('.header-tools');
        const content = document.getElementById('tab-content');
        const panel = Array.from(
          content?.querySelectorAll<HTMLElement>('.raised-panel') ?? [],
        ).find((element) => element.getClientRects().length && layoutRect(element).height > 0);
        observe([node, attachedOwner, tools, content, panel ?? null]);
        const navigation = settings.anchor() ?? document.querySelector<HTMLElement>('.navigation');
        const position = noticePosition(
          navigation ? layoutRect(navigation) : undefined,
          tools ? layoutRect(tools) : undefined,
          panel ? layoutRect(panel) : undefined,
          layoutRect(node),
          viewport(),
          settings.placement,
        );
        node.style.top = String(position.top) + 'px';
        node.style.right = String(position.right) + 'px';
        return;
      }
      const mark = layoutRect(attachedOwner),
        visible = settings.visibleBounds?.();
      const visibleOwner = settings.visibleAnchor?.();
      const visibleMark = visibleOwner ? layoutRect(visibleOwner) : mark;
      if (visible && (visibleMark.right < visible.left || visibleMark.right > visible.right)) {
        settings.onAnchorHidden?.();
        return;
      }
      const origin = settings.origin?.() ?? { left: 0, top: 0 };
      const relative = (rect: Bounds): Bounds => ({
        left: rect.left - origin.left,
        right: rect.right - origin.left,
        top: rect.top - origin.top,
        bottom: rect.bottom - origin.top,
      });
      const area = settings.bounds?.() ?? {
        left: 8,
        right: viewport().width - 8,
        top: 8,
        bottom: viewport().height - 8,
      };
      const bounds = relative(area),
        attached = relative(settings.anchorBounds?.(attachedOwner) ?? mark);
      const requestedWidth =
        settings.width ?? (settings.matchWidth ? attached.right - attached.left : undefined);
      if (requestedWidth !== undefined)
        node.style.width = String(Math.min(requestedWidth, bounds.right - bounds.left)) + 'px';
      if (scroller === node) {
        node.style.maxHeight = '';
        node.style.overflowY = '';
      }
      const size = layoutRect(node);
      const frameHeight =
        scroller === node ? 0 : Math.max(0, size.height - layoutRect(scroller).height);
      // Measure the full content without expanding the inner viewport and losing its scroll position.
      const height =
        size.height +
        (scroller === node ? 0 : Math.max(0, scroller.scrollHeight - scroller.clientHeight));
      const position = floatingPosition(
        attached,
        { width: size.width, height },
        bounds,
        settings.direction,
        6,
        settings.left?.(attached),
        settings.placement,
        settings.placementHeight?.(height),
      );
      const step = settings.scrollStep?.() ?? 0;
      if (position.height < height && step > 0) {
        const snappedHeight =
          frameHeight + Math.max(0, Math.floor((position.height - frameHeight) / step)) * step;
        if (position.top < attached.top) position.top += position.height - snappedHeight;
        position.height = snappedHeight;
      }
      node.style.left = String(position.left) + 'px';
      node.style.top = String(position.top) + 'px';
      const constrained = position.height < height;
      node.toggleAttribute('data-scroll-constrained', constrained);
      scroller.style.maxHeight = constrained
        ? String(Math.max(0, Math.floor(position.height - frameHeight))) + 'px'
        : '';
      scroller.style.overflowY = constrained ? 'auto' : '';
      if (settings.placement === 'reveal-below') {
        if (revealedAnchor !== attachedOwner) {
          cancelScroll?.();
          revealedAnchor = attachedOwner;
          destination = undefined;
          interrupted = false;
        }
        const page = document.scrollingElement as HTMLElement | null;
        if (!page || interrupted) return;
        const top = floatingRevealScrollTop(
          layoutScrollTop(page),
          attached,
          bounds,
          position.height,
        );
        if (
          top > layoutScrollTop(page) &&
          (destination === undefined || Math.abs(top - destination) > 1)
        ) {
          cancelScroll?.();
          destination = top;
          cancelScroll = scrollToShow(page, top, {
            owner: node,
            onInterrupt: () => {
              interrupted = true;
            },
            onScroll: place,
          });
        }
      }
    };
    const observer = new ResizeObserver(place);
    update.current = place;
    observe([node, anchor]);
    place();
    const content = isNoticePlacement(options.placement)
      ? document.getElementById('tab-content')
      : null;
    const mutations = content ? new MutationObserver(place) : undefined;
    mutations?.observe(content!, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'hidden'],
    });
    document.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      cancelScroll?.();
      update.current = undefined;
      observer.disconnect();
      mutations?.disconnect();
      document.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [options.open, popup]);
  useLayoutEffect(() => {
    update.current?.();
  });
}
