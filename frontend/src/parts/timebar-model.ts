export interface TimeBarSlot {
  id: number;
  building: 1 | 2;
  start_time: string;
  end_time: string;
  is_office: boolean;
}
export type TimebarPart = 'move' | 'start' | 'end' | 'draw';
export interface TimebarDrag<T extends TimeBarSlot = TimeBarSlot> {
  slots: readonly T[];
  id: number;
  part: TimebarPart;
  anchor: number;
  start: number;
  end: number;
  low: number;
  high: number;
  previous?: T;
  next?: T;
}
export const timeMinutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
const timeText = (minute: number) =>
  `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
const snap = (minute: number) => Math.round(minute / 15) * 15;
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
const complete = (slot: TimeBarSlot) => Boolean(slot.start_time && slot.end_time);

export function beginTimebarDrag<T extends TimeBarSlot>(
  slots: readonly T[],
  id: number,
  part: TimebarPart,
  at: number,
  onOverlap?: (slot: T) => void,
): TimebarDrag<T> | null {
  const ordered = slots.filter(complete).sort((a, b) => a.start_time.localeCompare(b.start_time));
  if (
    ordered.some(
      (slot, i) =>
        slot.end_time <= slot.start_time || (i > 0 && ordered[i - 1].end_time > slot.start_time),
    )
  )
    return null;
  const slot = slots.find((row) => row.id === id);
  if (!slot) return null;
  if (part === 'draw') {
    if (slot.start_time || slot.end_time) return null;
    const anchor = clamp(snap(at), 420, 1320);
    const overlap = ordered.find(
      (row) => timeMinutes(row.start_time) < anchor && anchor < timeMinutes(row.end_time),
    );
    if (overlap) {
      onOverlap?.(overlap);
      return null;
    }
    return {
      slots,
      id,
      part,
      anchor,
      start: anchor,
      end: anchor,
      low: Math.max(
        420,
        ...ordered
          .filter((row) => timeMinutes(row.end_time) <= anchor)
          .map((row) => timeMinutes(row.end_time)),
      ),
      high: Math.min(
        1320,
        ...ordered
          .filter((row) => timeMinutes(row.start_time) >= anchor)
          .map((row) => timeMinutes(row.start_time)),
      ),
    };
  }
  if (!complete(slot)) return null;
  const i = ordered.findIndex((row) => row.id === id),
    previous = ordered[i - 1],
    next = ordered[i + 1];
  return {
    slots,
    id,
    part,
    anchor: at,
    start: timeMinutes(slot.start_time),
    end: timeMinutes(slot.end_time),
    low: previous ? timeMinutes(previous.end_time) : 420,
    high: next ? timeMinutes(next.start_time) : 1320,
    previous,
    next,
  };
}

export function moveTimebarDrag<T extends TimeBarSlot>(drag: TimebarDrag<T>, at: number): T[] {
  const { slots, id, part, anchor, low, high, previous, next } = drag;
  if (part !== 'draw' && snap(at - anchor) === 0) return [...slots];
  let start = drag.start,
    end = drag.end,
    neighbour: { id: number; start_time?: string; end_time?: string } | undefined;
  if (part === 'draw') {
    const minute = clamp(snap(at), low, high);
    start = Math.min(anchor, minute);
    end = Math.max(anchor, minute);
    if (end - start < 15)
      return slots.map((slot) =>
        slot.id === id ? { ...slot, start_time: '', end_time: '' } : slot,
      );
  } else if (part === 'move') {
    start = clamp(snap(start + at - anchor), low, high - (end - start));
    end = start + drag.end - drag.start;
  } else if (part === 'start') {
    start = Math.min(snap(start + at - anchor), end - 15);
    if (
      previous &&
      low === drag.start &&
      previous.building === slots.find((slot) => slot.id === id)!.building &&
      start < drag.start
    ) {
      start = Math.max(start, timeMinutes(previous.start_time) + 15);
      neighbour = { id: previous.id, end_time: timeText(start) };
    } else start = Math.max(start, low);
  } else {
    end = Math.max(snap(end + at - anchor), start + 15);
    if (
      next &&
      high === drag.end &&
      next.building === slots.find((slot) => slot.id === id)!.building &&
      end > drag.end
    ) {
      end = Math.min(end, timeMinutes(next.end_time) - 15);
      neighbour = { id: next.id, start_time: timeText(end) };
    } else end = Math.min(end, high);
  }
  return slots.map((slot) =>
    slot.id === id
      ? { ...slot, start_time: timeText(start), end_time: timeText(end) }
      : slot.id === neighbour?.id
        ? { ...slot, ...neighbour }
        : slot,
  );
}
