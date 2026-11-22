import { layoutRect } from './viewport';
import './TimeBar.css';
import { useLayoutEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { Reveal } from './Reveal';
import {
  beginTimebarDrag,
  moveTimebarDrag,
  timeMinutes,
  type TimeBarSlot,
  type TimebarDrag,
  type TimebarPart,
} from './timebar-model';

const label = (slot: TimeBarSlot) =>
  `${slot.start_time.replace(/^0/, '')}〜${slot.end_time.replace(/^0/, '')}`;
const hasBand = (slot: TimeBarSlot) =>
  Boolean(slot.start_time && slot.end_time) &&
  timeMinutes(slot.end_time) > timeMinutes(slot.start_time);
const bandPosition = (slot: TimeBarSlot) => ({
  left: `${(timeMinutes(slot.start_time) - 420) / 9}%`,
  width: `${(timeMinutes(slot.end_time) - timeMinutes(slot.start_time)) / 9}%`,
});
interface TimeBarProps {
  slots: readonly TimeBarSlot[];
  names: readonly string[];
  selected: number;
  select: (id: number) => void;
  change: (slots: readonly TimeBarSlot[]) => void;
  finish: () => void;
  drawOverlap?: (id: number | null) => void;
  drawWarning?: ReactNode;
}
function TimeBarRow({
  slot,
  name,
  slots,
  selected,
  select,
  change,
  finish,
  drawOverlap,
  drawWarning,
}: Omit<TimeBarProps, 'names'> & { slot: TimeBarSlot; name: string }) {
  const track = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointerId: number; calculation: TimebarDrag } | null>(null);
  const [dragging, setDragging] = useState(false);
  const populated = hasBand(slot);
  const active = slot.id === selected;
  const empty = active && !slot.start_time && !slot.end_time;
  const minuteAt = (event: PointerEvent) => {
    const node = track.current!,
      rect = node.getBoundingClientRect(),
      scale = rect.width / node.offsetWidth;
    return (
      420 +
      ((event.clientX - rect.left - node.clientLeft * scale) / (node.clientWidth * scale)) * 900
    );
  };
  const start = (event: PointerEvent, part: TimebarPart) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    if (part !== 'draw') select(slot.id);
    const calculation = beginTimebarDrag(slots, slot.id, part, minuteAt(event), (other) =>
      drawOverlap?.(other.id),
    );
    if (!calculation) return;
    if (part === 'draw') drawOverlap?.(null);
    drag.current = { pointerId: event.pointerId, calculation };
    track.current!.setPointerCapture(event.pointerId);
    setDragging(true);
  };
  const end = (event: PointerEvent) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    setDragging(false);
    finish();
    if (track.current?.hasPointerCapture(event.pointerId))
      track.current.releasePointerCapture(event.pointerId);
  };
  const [tagLeft, setTagLeft] = useState<number | null>(null);
  const [grid, setGrid] = useState<{ positions: number[]; width: number } | null>(null);
  useLayoutEffect(() => {
    const measure = () => {
      const node = track.current!,
        button = node.querySelector<HTMLElement>('.timebar-bar');
      const rect = node.getBoundingClientRect();
      if (rect.width > 0) {
        const scale = rect.width / layoutRect(node).width,
          pixels = scale * window.devicePixelRatio;
        const width = Math.round(
          parseFloat(getComputedStyle(node).getPropertyValue('--timebar-grid-width')) * pixels,
        );
        const positions = Array.from({ length: 16 }, (_, index) => {
          const at = (rect.left + (rect.width * index) / 15) * window.devicePixelRatio;
          const left = Math.round(at - (index === 0 ? 0 : index === 15 ? width : width / 2));
          return (left / window.devicePixelRatio - rect.left) / scale;
        });
        const lineWidth = width / pixels;
        setGrid((previous) =>
          previous?.width === lineWidth &&
          positions.every((left, index) => left === previous.positions[index])
            ? previous
            : { positions, width: lineWidth },
        );
      }
      if (!button) {
        setTagLeft(null);
        return;
      }
      const textWidth = layoutRect(button.querySelector<HTMLElement>('.timebar-text')!).width;
      if (textWidth + 52 <= layoutRect(button).width) {
        setTagLeft(null);
        return;
      }
      const width = textWidth + 16;
      const center =
        ((timeMinutes(slot.start_time) + timeMinutes(slot.end_time) - 840) / 1800) *
        node.clientWidth;
      setTagLeft(Math.max(width / 2, Math.min(node.clientWidth - width / 2, center)));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(track.current!);
    window.addEventListener('resize', measure);
    let active = true;
    void document.fonts.ready.then(() => {
      if (active) measure();
    });
    return () => {
      active = false;
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [slot]);
  return (
    <div className="timebar-row" data-selected={active}>
      <p className="timebar-name">
        <span>{name}</span>
      </p>
      <div className="timebar-lane">
        <div className="timebar-frame">
          <div
            className={`timebar-track${empty ? ' can-draw' : ''}`}
            ref={track}
            onPointerDown={(event) => {
              if (!(event.target as Element).closest('.timebar-bar') && empty) start(event, 'draw');
            }}
            onPointerMove={(event) => {
              if (drag.current?.pointerId === event.pointerId)
                change(moveTimebarDrag(drag.current.calculation, minuteAt(event)));
            }}
            onPointerUp={end}
            onPointerCancel={end}
          >
            {grid && (
              <svg className="timebar-grid">
                {grid.positions.map((left, index) => (
                  <rect key={index} x={left} y="0" width={grid.width} height="100%" />
                ))}
              </svg>
            )}
            {empty &&
              slots
                .filter((other) => other.id !== slot.id && hasBand(other))
                .map((other) => (
                  <div key={other.id} className="timebar-occupied" style={bandPosition(other)} />
                ))}
            {populated && (
              <button
                type="button"
                data-slot={slot.id}
                className={`timebar-bar site${slot.building}${active ? ' selected' : ' other'}${dragging ? ' dragging' : ''}${tagLeft !== null ? ' tight' : ''}`}
                style={bandPosition(slot)}
                onClick={() => select(slot.id)}
                onPointerDown={(event) =>
                  start(
                    event,
                    (event.target as Element).closest('.timebar-handle.start')
                      ? 'start'
                      : (event.target as Element).closest('.timebar-handle.end')
                        ? 'end'
                        : 'move',
                  )
                }
              >
                {active && <i className="timebar-handle start" />}
                <span className="timebar-text">
                  {slot.is_office && <i className="cell-office-dot" />}
                  {label(slot)}
                </span>
                {active && <i className="timebar-handle end" />}
              </button>
            )}
            {empty && (
              <div className="timebar-empty-hint">空いている所を横になぞると、帯ができます</div>
            )}
          </div>
        </div>
        <div className="timebar-lower">
          <div className="timebar-tags">
            {populated && tagLeft !== null && (
              <span
                className={`timebar-tag site${slot.building}${active ? '' : ' other'}`}
                style={{ left: tagLeft }}
              >
                {slot.is_office && <i className="cell-office-dot" />}
                {label(slot)}
              </span>
            )}
          </div>
          <Reveal open={active && Boolean(drawWarning)}>{drawWarning}</Reveal>
        </div>
      </div>
    </div>
  );
}
export function TimeBar(props: TimeBarProps) {
  return (
    <Reveal
      className="timebar-rows"
      items={[
        {
          key: 'scale',
          content: (
            <div className="timebar-scale">
              <div className="timebar-ruler">
                <div className="timebar-coordinate">
                  {Array.from({ length: 16 }, (_, index) => (
                    <i
                      key={index}
                      className={index % 3 === 0 ? 'major' : ''}
                      style={{ left: `${(index / 15) * 100}%` }}
                    />
                  ))}
                  {['7:00', '10:00', '13:00', '16:00', '19:00', '22:00'].map((time, index) => (
                    <span key={time} style={{ left: `${index * 20}%` }}>
                      {time}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          ),
        },
        ...props.slots
          .map((slot, index) => ({ slot, name: props.names[index] }))
          .filter(({ slot }) => slot.start_time || slot.end_time || slot.id === props.selected)
          .map(({ slot, name }) => ({
            key: String(slot.id),
            content: <TimeBarRow {...props} slot={slot} name={name} />,
          })),
      ]}
    />
  );
}
