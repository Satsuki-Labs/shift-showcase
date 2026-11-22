import { layoutRect, viewport, layoutScrollTop, setLayoutScrollTop } from './viewport';
import './Reveal.css';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { motionMs, motionEasing } from './motion';

export interface RevealItem {
  key: string;
  content: ReactNode;
}
interface Row extends RevealItem {
  leaving?: boolean;
  top?: number;
}
interface Position {
  top: number;
  height: number;
  opacity: number;
  blur: number;
}
interface Snapshot {
  height: number;
  positions: Map<string, Position>;
  changed: boolean;
}
interface Motion extends Snapshot {
  end: number;
  expanding: boolean;
  targetHeight: number;
  targets: Map<string, Position>;
  entering: Set<string>;
  scrollStopped: boolean;
  scrollStarted: boolean;
}

function interruptRevealScroll(
  state: { scrollStarted: boolean; scrollStopped: boolean } | null,
  event: { type: string; key?: string },
  scrollToEnd: boolean,
) {
  if (!state) return;
  // Tab can finish the input while the dialog is still growing, before it can scroll.
  if (!scrollToEnd && !state.scrollStarted && event.type === 'keydown' && event.key === 'Tab')
    return;
  state.scrollStopped = true;
}

function revealScrollTiming(node: Element) {
  return {
    duration: motionMs(node, '--motion-reveal-expand'),
    ease: (progress: number) => progress * progress * (3 - 2 * progress),
  };
}
function advanceRevealScroll(
  scroller: Element,
  state: { scrollStarted: boolean; scrollStopped: boolean },
  top: number,
) {
  if (state.scrollStopped) return;
  const before = layoutScrollTop(scroller);
  setLayoutScrollTop(scroller, top);
  if (layoutScrollTop(scroller) !== before) state.scrollStarted = true;
}
export function revealTargetScrollTop(
  scrollTop: number,
  targetBottom: number,
  viewportBottom: number,
) {
  return scrollTop + Math.max(0, targetBottom - viewportBottom + 16);
}
const revealScrolls = new WeakMap<Element, { owner: Element; top: number }>();

/** Match the actual final position too: its scroll event can arrive after the animation. */
export function isRevealScroll(event: Event, contains: (target: Node) => boolean) {
  const scroller = event.target === document ? document.scrollingElement : event.target;
  if (!(scroller instanceof Element)) return false;
  const scroll = revealScrolls.get(scroller);
  return Boolean(
    scroll &&
    scroll.owner.isConnected &&
    contains(scroll.owner) &&
    layoutScrollTop(scroller) === scroll.top,
  );
}

export function scrollToShow(
  scroller: HTMLElement,
  top: number,
  options?: { owner: Element; onInterrupt: () => void; onScroll?: () => void },
) {
  const from = layoutScrollTop(scroller),
    distance = top - from;
  if (distance <= 0) return () => {};
  const { duration, ease } = revealScrollTiming(scroller);
  const state = { scrollStarted: false, scrollStopped: false };
  const started = performance.now();
  let frame: number | undefined;
  const events = [
    'wheel',
    'touchstart',
    'touchmove',
    'mousedown',
    'pointerdown',
    'keydown',
  ] as const;
  const stop = () => {
    if (frame !== undefined) cancelAnimationFrame(frame);
    events.forEach((event) => scroller.removeEventListener(event, interrupt, true));
  };
  const interrupt = (event: Event) => {
    interruptRevealScroll(state, event as Event & { key?: string }, false);
    if (state.scrollStopped) {
      stop();
      if (options) {
        revealScrolls.delete(scroller);
        options.onInterrupt();
      }
    }
  };
  const tick = (time: number) => {
    const progress = duration <= 0 ? 1 : Math.max(0, Math.min(1, (time - started) / duration));
    advanceRevealScroll(scroller, state, from + distance * ease(progress));
    if (options)
      revealScrolls.set(scroller, { owner: options.owner, top: layoutScrollTop(scroller) });
    options?.onScroll?.();
    if (progress < 1) frame = requestAnimationFrame(tick);
    else stop();
  };
  events.forEach((event) =>
    scroller.addEventListener(event, interrupt, { capture: true, passive: true }),
  );
  frame = requestAnimationFrame(tick);
  return () => {
    stop();
    if (options) revealScrolls.delete(scroller);
  };
}

/** Scrolling disclosures expand before revealing; other list changes move together. */
export function Reveal({
  open = true,
  children,
  items,
  className = '',
  reserveSpace = false,
  scrollToShow = false,
  swap = false,
}: {
  open?: boolean;
  children?: ReactNode;
  items?: readonly RevealItem[];
  className?: string;
  reserveSpace?: boolean;
  scrollToShow?: boolean | 'end' | 'target';
  swap?: boolean;
}) {
  const content = useRef(children);
  const root = useRef<HTMLDivElement>(null);
  const wanted = items ?? (open ? [{ key: 'content', content: children }] : []);
  const [rows, setRows] = useState<Row[]>(() => [...wanted]);
  const initialized = useRef(false);
  const pending = useRef<(Snapshot & { rows: Row[] }) | null>(null);
  const motion = useRef<Motion | null>(null);
  const targetScroll = useRef<{ scrollStarted: boolean; scrollStopped: boolean } | null>(null);
  const settled = useRef<Snapshot | null>(null);
  const frame = useRef<number | undefined>(undefined);
  const scrollToEnd = scrollToShow === 'end';
  const scrollToTarget = scrollToShow === 'target';
  if (open) content.current = children;

  function snapshot(changed: boolean): Snapshot {
    const node = root.current!,
      bounds = layoutRect(node);
    const positions = new Map<string, Position>();
    for (const element of Array.from(node.children) as HTMLElement[]) {
      const rect = layoutRect(element),
        style = getComputedStyle(element),
        key = element.dataset.revealKey!;
      // A resize may have changed the flow since the last painted positions.
      positions.set(
        key,
        motion.current?.positions.get(key) ??
          settled.current?.positions.get(key) ?? {
            top: rect.top - bounds.top,
            height: rect.height,
            opacity: Number(style.opacity),
            blur: parseFloat(style.filter.match(/blur\(([^)]+)/)?.[1] ?? '0'),
          },
      );
    }
    return {
      height: motion.current?.height ?? settled.current?.height ?? bounds.height,
      positions,
      changed,
    };
  }

  useLayoutEffect(() => {
    const node = root.current;
    if (!node) return;
    node.toggleAttribute('inert', !open);
    if (reserveSpace) return;
    if (!initialized.current) {
      initialized.current = true;
      return;
    }
    const current = rows.filter((row) => !row.leaving);
    const changed =
      current.length !== wanted.length ||
      current.some((row, index) => row.key !== wanted[index].key);
    // A parent can render again before the queued rows reach the measuring effect.
    // Keep the first painted geometry until that update has been measured.
    const before = pending.current ?? snapshot(changed);
    const nextRows = [
      ...wanted,
      ...rows
        .filter((row) => !wanted.some((item) => item.key === row.key))
        .map((row) => ({
          ...row,
          leaving: true,
          top: swap ? 0 : (before.positions.get(row.key)?.top ?? 0),
        })),
    ];
    // Keep the scroll range while leaving children are taken out of normal flow.
    node.style.transition = 'none';
    node.style.height = `${before.height}px`;
    pending.current = { ...before, changed: before.changed || changed, rows: nextRows };
    setRows(nextRows);
  }, [open, children, items, reserveSpace, scrollToShow, swap]);

  useLayoutEffect(() => {
    const node = root.current;
    if (!node || reserveSpace) return;
    const elements = Array.from(node.children) as HTMLElement[];
    const duration = motionMs(node, '--reveal-duration');
    const expansion = revealScrollTiming(node);
    const blur = parseFloat(getComputedStyle(node).getPropertyValue('--reveal-blur'));
    const ease = motionEasing(node, '--ease-standard');
    const clean = (element: HTMLElement) => {
      for (const property of ['height', 'opacity', 'filter', 'transition', 'transform', 'top'])
        element.style.removeProperty(property);
    };
    function translate(element: HTMLElement, distance: number) {
      const shift = Math.round(distance * window.devicePixelRatio) / window.devicePixelRatio;
      if (shift === 0) element.style.removeProperty('transform');
      else element.style.transform = `translateY(${shift}px)`;
      return shift;
    }
    function layout() {
      for (const [index, element] of elements.entries()) {
        element.style.transform = '';
        if (rows[index].leaving)
          element.style.top = `${motion.current?.positions.get(rows[index].key)?.top ?? rows[index].top ?? 0}px`;
      }
      const bounds = layoutRect(node!),
        targets = new Map<string, Position>();
      const style = getComputedStyle(node!);
      let height = parseFloat(style.borderTopWidth) + parseFloat(style.paddingTop);
      elements.forEach((element, index) => {
        const rect = layoutRect(element);
        if (!rows[index].leaving) height = Math.max(height, rect.bottom - bounds.top);
        targets.set(rows[index].key, {
          top: swap ? 0 : rect.top - bounds.top,
          height: rect.height,
          opacity: rows[index].leaving ? 0 : 1,
          blur: rows[index].leaving ? blur : 0,
        });
      });
      return {
        height: height + parseFloat(style.paddingBottom) + parseFloat(style.borderBottomWidth),
        targets,
      };
    }
    function finish() {
      frame.current = undefined;
      const state = motion.current!;
      settled.current = {
        height: state.targetHeight,
        positions: new Map(
          [...state.targets].filter(([key]) => rows.some((row) => row.key === key && !row.leaving)),
        ),
        changed: false,
      };
      motion.current = null;
      clean(node!);
      elements.forEach((element) => {
        const leaving = element.classList.contains('leaving');
        element.classList.toggle('open', !leaving);
        clean(element);
        element.toggleAttribute('inert', leaving);
      });
      setRows((current) => current.filter((row) => !row.leaving));
    }
    function animate(before: Snapshot) {
      const previous = motion.current;
      const { height, targets } = layout();
      // A nested Reveal already supplies the changing layout for this frame.
      // Follow it in normal flow instead of easing the same height a second time.
      const followsChild =
        !before.changed &&
        !previous?.changed &&
        !rows.some((row) => row.leaving) &&
        Array.from(node!.querySelectorAll<HTMLElement>('.reveal-frame')).some(
          (child) => child.style.height !== '' && child.style.transition === 'none',
        );
      if (followsChild) {
        if (frame.current !== undefined) cancelAnimationFrame(frame.current);
        frame.current = undefined;
        motion.current = null;
        settled.current = { height, positions: targets, changed: false };
        clean(node!);
        elements.forEach(clean);
        return;
      }
      const reference = previous?.targets ?? before.positions;
      const sameLayout =
        Math.abs(height - (previous?.targetHeight ?? before.height)) < 0.5 &&
        elements.every((element) => {
          const key = element.dataset.revealKey!,
            target = targets.get(key)!,
            old = reference.get(key);
          return (
            old &&
            Math.abs(target.top - old.top) < 0.5 &&
            Math.abs(target.height - old.height) < 0.5
          );
        });
      if (!before.changed && sameLayout) {
        // Restore the current paint after measuring without replacing the running segment.
        if (previous) {
          node!.style.height = `${before.height}px`;
          elements.forEach((element) => {
            const key = element.dataset.revealKey!,
              old = before.positions.get(key)!;
            translate(element, old.top - targets.get(key)!.top);
          });
        } else clean(node!);
        return;
      }
      if (frame.current !== undefined) cancelAnimationFrame(frame.current);
      const now = performance.now();
      const added = rows.some((row) => !row.leaving && !before.positions.has(row.key));
      const expanding = Boolean(
        scrollToShow && (added || scrollToTarget) && height > before.height,
      );
      const continuing = previous && !before.changed;
      const state: Motion = {
        ...before,
        changed: before.changed || previous?.changed || false,
        positions: new Map(before.positions),
        end: continuing ? previous.end : now + (expanding ? expansion.duration : duration),
        expanding: continuing ? previous.expanding : expanding,
        targetHeight: height,
        targets,
        entering: new Set([
          ...(previous?.expanding ? previous.entering : []),
          ...rows
            .filter((row) => !row.leaving && !before.positions.has(row.key))
            .map((row) => row.key),
        ]),
        scrollStopped: scrollToEnd && before.changed ? false : (previous?.scrollStopped ?? false),
        scrollStarted: continuing ? previous.scrollStarted : false,
      };
      motion.current = state;
      if (scrollToTarget) targetScroll.current = state;
      node!.style.transition = 'none';
      node!.style.height = `${before.height}px`;
      if (swap && before.changed) {
        node!.style.height = `${height}px`;
        node!.dispatchEvent(new Event('reveal-swap', { bubbles: true }));
        node!.style.height = `${before.height}px`;
      }
      const from = new Map<string, Position>();
      elements.forEach((element, index) => {
        const key = rows[index].key,
          target = targets.get(key)!;
        from.set(key, before.positions.get(key) ?? { ...target, opacity: 0, blur });
        element.style.transition = 'none';
        element.toggleAttribute(
          'inert',
          Boolean(rows[index].leaving || (state.expanding && state.entering.has(key))),
        );
      });
      const scroller = node!.closest('.dlg-body') ?? document.scrollingElement!;
      const edge = scroller.classList.contains('dlg-body')
        ? layoutRect(scroller).bottom
        : viewport().height;
      const scrollFrom = layoutScrollTop(scroller);
      const scrollDistance = state.expanding
        ? Math.max(0, layoutRect(node!).top + height - edge + 16)
        : 0;
      const scrollMaximum = () =>
        scroller === document.scrollingElement
          ? Math.max(0, viewport().scrollHeight - viewport().height)
          : Math.max(0, scroller.scrollHeight - scroller.clientHeight);
      const scrollRemaining = scrollToEnd ? Math.max(0, scrollMaximum() - scrollFrom) : 0;
      let started = now,
        fromHeight = before.height;
      function tick(time: number) {
        // The first RAF timestamp can precede performance.now() within the same frame.
        const progress =
          state.end <= started
            ? 1
            : Math.max(0, Math.min(1, (time - started) / (state.end - started)));
        const eased = state.expanding ? expansion.ease(progress) : ease(progress);
        state.height = fromHeight + (height - fromHeight) * eased;
        node!.style.height = `${state.height}px`;
        elements.forEach((element, index) => {
          const key = rows[index].key,
            start = from.get(key)!,
            target = targets.get(key)!;
          const hidden = state.expanding && state.entering.has(key);
          const value = {
            top: start.top + (target.top - start.top) * eased,
            height: target.height,
            opacity: hidden ? 0 : start.opacity + (target.opacity - start.opacity) * eased,
            blur: hidden ? blur : start.blur + (target.blur - start.blur) * eased,
          };
          value.top = target.top + translate(element, value.top - target.top);
          state.positions.set(key, value);
          if (start.opacity === 1 && target.opacity === 1) element.style.removeProperty('opacity');
          else element.style.opacity = String(value.opacity);
          if (value.blur === 0) element.style.removeProperty('filter');
          else element.style.filter = `blur(${value.blur}px)`;
        });
        if (!state.scrollStopped && (state.expanding || scrollToTarget)) {
          if (scrollToTarget) {
            const edge = scroller.classList.contains('dlg-body')
              ? layoutRect(scroller).bottom
              : viewport().height;
            const target = revealTargetScrollTop(
              layoutScrollTop(scroller),
              layoutRect(node!).top + height,
              edge,
            );
            advanceRevealScroll(
              scroller,
              state,
              scrollFrom + (target - scrollFrom) * (state.expanding ? eased : 1),
            );
          } else if (scrollToEnd)
            advanceRevealScroll(
              scroller,
              state,
              Math.max(0, scrollMaximum() - scrollRemaining * (1 - eased)),
            );
          else if (scrollDistance)
            advanceRevealScroll(scroller, state, scrollFrom + scrollDistance * eased);
        }
        if (progress < 1) frame.current = requestAnimationFrame(tick);
        else if (state.expanding) {
          state.expanding = false;
          started = time;
          state.end = time + duration;
          fromHeight = height;
          state.positions.forEach((value, key) => from.set(key, value));
          elements.forEach((element, index) =>
            element.toggleAttribute('inert', Boolean(rows[index].leaving)),
          );
          frame.current = requestAnimationFrame(tick);
        } else finish();
      }
      tick(now);
    }
    const before = pending.current;
    if (before && before.rows === rows) {
      pending.current = null;
      animate(before);
    } else if (!motion.current && !before) {
      const { height, targets } = layout();
      settled.current = { height, positions: targets, changed: false };
    }
    const observer = new ResizeObserver(() => animate(snapshot(false)));
    elements.forEach((element) => observer.observe(element));
    const scroller = node.closest('.dlg-body') ?? document.scrollingElement!;
    const targetObserver = scrollToTarget
      ? new ResizeObserver(() => {
          const state = targetScroll.current;
          if (!state || state.scrollStopped || motion.current || !rows.some((row) => !row.leaving))
            return;
          const edge = scroller.classList.contains('dlg-body')
            ? layoutRect(scroller).bottom
            : viewport().height;
          advanceRevealScroll(
            scroller,
            state,
            revealTargetScrollTop(layoutScrollTop(scroller), layoutRect(node).bottom, edge),
          );
        })
      : undefined;
    targetObserver?.observe(scroller);
    return () => {
      observer.disconnect();
      targetObserver?.disconnect();
    };
  }, [rows, reserveSpace, scrollToShow, swap]);

  useLayoutEffect(() => {
    if (reserveSpace) return;
    const stopScroll = (event: Event) =>
      interruptRevealScroll(motion.current ?? targetScroll.current, event, scrollToEnd);
    const events = [
      'wheel',
      'touchstart',
      'touchmove',
      'mousedown',
      'pointerdown',
      'keydown',
    ] as const;
    events.forEach((event) =>
      document.addEventListener(event, stopScroll, { capture: true, passive: true }),
    );
    if (scrollToEnd) window.addEventListener('resize', stopScroll);
    return () => {
      events.forEach((event) => document.removeEventListener(event, stopScroll, true));
      if (scrollToEnd) window.removeEventListener('resize', stopScroll);
      if (frame.current !== undefined) cancelAnimationFrame(frame.current);
      motion.current = null;
      targetScroll.current = null;
    };
  }, [reserveSpace, scrollToEnd]);
  if (reserveSpace)
    return (
      <div ref={root} className={`reveal${open ? ' open' : ''}${className ? ` ${className}` : ''}`}>
        <div>{open ? children : content.current}</div>
      </div>
    );
  const visible = rows.filter((row) => !row.leaving);
  return (
    <div ref={root} className={`reveal-frame${className ? ` ${className}` : ''}`}>
      {rows.map((row) => (
        <div
          key={row.key}
          data-reveal-key={row.key}
          data-reveal-first={!row.leaving && row.key === visible[0]?.key ? '' : undefined}
          data-reveal-last={
            !row.leaving && row.key === visible[visible.length - 1]?.key ? '' : undefined
          }
          className={`reveal reveal-item open${row.leaving ? ' leaving' : ''}`}
          style={row.leaving ? { top: row.top } : undefined}
        >
          {row.content}
        </div>
      ))}
    </div>
  );
}
