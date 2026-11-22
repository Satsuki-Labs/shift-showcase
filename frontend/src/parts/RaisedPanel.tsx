import { layoutRect } from './viewport';
import './RaisedPanel.css';
import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type ReactNode,
} from 'react';
import { flushSync } from 'react-dom';
import { panelShape } from './panel-shape';
import { motionEasing, motionMs } from './motion';

/** The measured outline and its two rises; callers supply the contents. */
export function RaisedPanel({
  left,
  actions,
  children,
  back = false,
  animateBack = false,
  animateWidth = true,
  raised = 'white',
  padding = true,
  bandSelector,
  className = '',
  ...attributes
}: {
  left: ReactNode;
  actions: ReactNode;
  children: ReactNode;
  back?: boolean;
  animateBack?: boolean;
  animateWidth?: boolean;
  raised?: 'white' | 'navy' | false;
  padding?: boolean;
  bandSelector?: string;
} & HTMLAttributes<HTMLDivElement>) {
  const root = useRef<HTMLDivElement>(null);
  const leftRef = useRef<HTMLDivElement>(null);
  const ear = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const drawnSize = useRef({ width: 0, height: 0 });
  const earWidth = useRef<number | null>(null);
  const frame = useRef<number | undefined>(undefined);
  const clipId = useId();
  const backClipId = useId();
  const backWidth = useRef(0);
  const backControls = useRef<ReactNode>(null);
  if (back) backControls.current = left;
  const [paths, setPaths] = useState({
    back: '',
    front: '',
    navy: '',
    width: 0,
    height: 0,
    clipHeight: 0,
  });
  useLayoutEffect(() => {
    const panel = root.current!,
      leftNode = leftRef.current!,
      earNode = ear.current!,
      bodyNode = body.current!;
    const draw = () => {
      const { width, height } = layoutRect(panel);
      drawnSize.current = { width, height };
      const radius = parseFloat(getComputedStyle(panel).getPropertyValue('--radius-part'));
      const measuredWidth = layoutRect(earNode).width;
      const rise =
        measuredWidth < radius * 2 + 4 || (raised === false && frame.current === undefined)
          ? null
          : { side: 'right' as const, width: measuredWidth };
      const front = panelShape({ width, height, step: 64, raised: rise, radius });
      const band = bandSelector ? bodyNode.querySelector<HTMLElement>(bandSelector) : null;
      if (back) backWidth.current = layoutRect(leftNode).width;
      const next = {
        back:
          back || animateBack
            ? panelShape({
                width,
                height,
                step: 44,
                raised: { side: 'left', width: backWidth.current },
                radius,
                inset: 0,
              })
            : '',
        front,
        navy: raised === 'navy' ? front : '',
        width,
        height,
        clipHeight: 64 + (band?.offsetHeight ?? 0),
      };
      setPaths((before) =>
        before.back === next.back &&
        before.front === next.front &&
        before.navy === next.navy &&
        before.width === next.width &&
        before.height === next.height &&
        before.clipHeight === next.clipHeight
          ? before
          : next,
      );
    };
    if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    frame.current = undefined;
    delete panel.dataset.sliding;
    const from = earWidth.current;
    earNode.style.width = '';
    const target = layoutRect(earNode).width;
    const duration = matchMedia('(prefers-reduced-motion: reduce)').matches
      ? 0
      : motionMs(panel, '--motion-slide');
    const minimumRiseWidth =
      parseFloat(getComputedStyle(panel).getPropertyValue('--radius-part')) * 2 + 4;
    if (
      animateWidth &&
      from !== null &&
      from >= minimumRiseWidth &&
      target >= minimumRiseWidth &&
      from !== target &&
      layoutRect(panel).width === drawnSize.current.width &&
      duration > 0
    ) {
      const easing = motionEasing(panel, '--ease-slide'),
        start = performance.now();
      panel.dataset.sliding = 'true';
      earNode.style.width = `${from}px`;
      for (const child of earNode.children as HTMLCollectionOf<HTMLElement>) {
        child.style.animation = 'none';
        void child.offsetWidth;
        child.style.animation = 'period-arrival var(--motion-reveal) var(--ease-standard)';
        child.addEventListener(
          'animationend',
          () => {
            child.style.animation = '';
          },
          { once: true },
        );
      }
      const tick = (now: number) => {
        const progress = Math.min(1, (now - start) / duration);
        earWidth.current = from + (target - from) * easing(progress);
        earNode.style.width = `${earWidth.current}px`;
        if (progress < 1) frame.current = requestAnimationFrame(tick);
        else {
          frame.current = undefined;
          earNode.style.width = '';
          delete panel.dataset.sliding;
        }
        flushSync(draw);
      };
      frame.current = requestAnimationFrame(tick);
    } else {
      earWidth.current = target;
      for (const child of earNode.children as HTMLCollectionOf<HTMLElement>)
        child.style.animation = '';
    }
    draw();
    const resize = () => {
      if (frame.current !== undefined) cancelAnimationFrame(frame.current);
      frame.current = undefined;
      earNode.style.width = '';
      delete panel.dataset.sliding;
      earWidth.current = layoutRect(earNode).width;
      flushSync(draw);
    };
    window.addEventListener('resize', resize);
    // Only a changed outline needs a synchronous commit before painting.
    const observer = new ResizeObserver(() => {
      const { width, height } = layoutRect(panel);
      if (width !== drawnSize.current.width) {
        if (frame.current !== undefined) cancelAnimationFrame(frame.current);
        frame.current = undefined;
        earNode.style.width = '';
        delete panel.dataset.sliding;
        earWidth.current = layoutRect(earNode).width;
      }
      if (frame.current === undefined) earWidth.current = layoutRect(earNode).width;
      if (width !== drawnSize.current.width || height !== drawnSize.current.height) flushSync(draw);
      else draw();
    });
    for (const node of [panel, leftNode, earNode, bodyNode]) observer.observe(node);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', resize);
      if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    };
  }, [actions, raised, back, animateBack, animateWidth, bandSelector]);
  return (
    <div
      {...attributes}
      className={`raised-panel ${className}`}
      data-raised={raised || 'none'}
      data-padding={padding}
      data-animate-back={animateBack || undefined}
      data-back={back}
      ref={root}
    >
      <svg className="raised-panel-shape">
        <defs>
          <clipPath id={clipId}>
            <rect x={-1} y={-1} width={paths.width + 2} height={paths.clipHeight + 1} />
          </clipPath>
          <clipPath id={backClipId}>
            <rect width={paths.width} height={animateBack ? paths.clipHeight : paths.height} />
            {animateBack && <path d={paths.front} />}
          </clipPath>
        </defs>
        {(back || animateBack) && (
          <g clipPath={`url(#${backClipId})`}>
            <path className="raised-panel-back" d={paths.back} />
          </g>
        )}
        <path className="raised-panel-front" d={paths.front} />
        <path className="raised-panel-outline" d={paths.front} />
        <path className="raised-panel-navy" d={paths.navy} clipPath={`url(#${clipId})`} />
      </svg>
      <div className="raised-panel-left" ref={leftRef}>
        {animateBack ? (
          <>
            {!back && left}
            <div className="raised-panel-back-window" inert={!back}>
              <div className="raised-panel-back-controls">{backControls.current}</div>
            </div>
          </>
        ) : (
          left
        )}
      </div>
      <div className="raised-panel-ear" ref={ear}>
        {actions}
      </div>
      <div className="raised-panel-body" ref={body}>
        {children}
      </div>
    </div>
  );
}
