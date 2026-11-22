import { layoutRect, viewport, scrollWindow } from '../parts/viewport';
import { useLayoutEffect, useMemo, useRef } from 'react';
import { motionMs } from '../parts/motion';
import { facilities, resolvedDayOpening, type Facility } from '../../../shared/calendar';
import { holidayName } from '../../../shared/holidays';
import type { AnnualRules, BuildingEntry, YearLoadResponse } from '../../../shared/protocol';
import { Reveal } from '../parts/Reveal';
import { usePeriodArrival } from '../parts/usePeriodArrival';
import { FacilityBadge } from './format';
import { dateRange } from '../format/date';

const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
function monthRows(month: string): number {
  const first = new Date(`${month}-01T00:00:00Z`);
  const days = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return Math.ceil((first.getUTCDay() + days) / 7);
}
interface Entry {
  kind: 'holiday' | 'event' | 'memo';
  content: string;
  buildings: number[];
  arrival: string | null;
}
function entriesFor(date: string, data: YearLoadResponse): Entry[] {
  const holiday = holidayName(date);
  const entries: Entry[] = holiday
    ? [{ kind: 'holiday', content: holiday, buildings: [], arrival: null }]
    : [];
  const buildings = data.buildingDays
    .filter((row) => row.date === date)
    .sort((a, b) => a.building - b.building);
  for (const kind of ['event', 'memo'] as const)
    for (const building of buildings) {
      const entry = building.entries.find(
        (item): item is Extract<BuildingEntry, { kind: typeof kind }> => item.kind === kind,
      );
      if (!entry) continue;
      const arrival = entry.kind === 'event' ? entry.arrival_time : null;
      const same = entries.find(
        (item) => item.kind === kind && item.content === entry.content && item.arrival === arrival,
      );
      if (same) same.buildings.push(building.building);
      else entries.push({ kind, content: entry.content, arrival, buildings: [building.building] });
    }
  return entries;
}
function CalendarMonth({
  month,
  data,
  rules,
  openDay,
}: {
  month: string;
  data: YearLoadResponse;
  rules: AnnualRules;
  openDay: (date: string) => void;
}) {
  const first = new Date(`${month}-01T00:00:00Z`);
  const count = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  const length = Math.ceil((first.getUTCDay() + count) / 7) * 7;
  return (
    <div className="yearly-grid">
      {Array.from({ length }, (_, index) => {
        const day = index - first.getUTCDay() + 1;
        if (day < 1 || day > count)
          return <div className="yearly-calendar-cell" key={`blank-${index}`} />;
        const date = `${month}-${String(day).padStart(2, '0')}`,
          weekday = index % 7;
        const holiday = holidayName(date),
          entries = entriesFor(date, data);
        const opening = facilities.map(
          (facility) => resolvedDayOpening(date, facility, data, rules)?.isOpen,
        );
        const open = facilities.filter((_, index) => opening[index] === true);
        const closed = opening.every((value) => value === false);
        const arrival =
          entries.length === 1 && entries[0].kind === 'event' ? entries[0].arrival : null;
        return (
          <div className="yearly-calendar-cell" key={date}>
            <button
              type="button"
              onClick={() => openDay(date)}
              className={`yearly-day${closed ? ' closed' : weekday === 6 ? ' saturday' : ''}`}
            >
              <div className="yearly-day-top">
                <b className={weekday === 0 || holiday ? 'sun' : weekday === 6 ? 'sat' : ''}>
                  {day}
                </b>
                <div className="yearly-day-marks">
                  {arrival && <span>{arrival}</span>}
                  {entries.length > 2 && (
                    <span className="yearly-more">+{entries.length - 2}件</span>
                  )}
                  {open.length > 0 &&
                    open.length < 4 &&
                    open.map((facility) => <FacilityBadge key={facility} facility={facility} />)}
                  {closed && weekday !== 0 && !holiday && <span className="yearly-shut">休業</span>}
                </div>
              </div>
              {entries.slice(0, 2).map((entry, index) => (
                <div
                  key={index}
                  className={`yearly-entry ${entry.kind}${entry.kind === 'event' ? (entry.buildings.length === 2 ? ' both' : entry.buildings[0] === 1 ? ' first' : ' second') : ''}${entries.length === 1 ? ' wrap' : ''}`}
                  title={`${entry.content}${entry.arrival ? ` ${entry.arrival} 受付開始` : ''}`}
                >
                  {entry.kind === 'event' && (
                    <span className="yearly-dots">
                      {entry.buildings.map((building) => (
                        <i key={building} className={building === 1 ? 'first' : 'second'} />
                      ))}
                    </span>
                  )}
                  <span className="yearly-entry-name">{entry.content}</span>
                </div>
              ))}
            </button>
          </div>
        );
      })}
    </div>
  );
}
export function Calendar({
  month,
  data,
  rules,
  scrollMonth,
  openDay,
}: {
  month: string;
  data: YearLoadResponse;
  rules: AnnualRules;
  scrollMonth: string | null;
  openDay: (date: string) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const monthContent = usePeriodArrival(month);
  const previousMonth = useRef(month);
  useLayoutEffect(() => {
    const before = previousMonth.current;
    previousMonth.current = month;
    if (scrollMonth !== month) return;
    const weekdays = root.current?.querySelector<HTMLElement>('.yearly-weekdays');
    const frame = root.current?.querySelector<HTMLElement>('.yearly-month-reveal');
    const grid = frame?.querySelector<HTMLElement>('.yearly-grid');
    if (!weekdays || !frame || !grid) return;
    const style = getComputedStyle(grid),
      rows = monthRows(month),
      beforeRows = monthRows(before);
    const rowHeight = parseFloat(style.gridAutoRows),
      gap = parseFloat(style.rowGap);
    if (rows <= beforeRows) {
      if (rows < beforeRows && root.current) {
        const shrink = (beforeRows - rows) * (rowHeight + gap);
        const shortfall =
          viewport().scrollY + viewport().height - (viewport().scrollHeight - shrink);
        // Keep the browser from clamping the scroll position as the page gets shorter.
        if (shortfall > 0)
          root.current.style.minHeight = `${layoutRect(root.current).height - shrink + shortfall}px`;
      }
      return;
    }
    const height = rows * rowHeight + (rows - 1) * gap;
    const tableBottom = layoutRect(frame).top + height + 1;
    const overflow = tableBottom - (viewport().height - 8);
    const distance = Math.min(Math.ceil(overflow), Math.floor(layoutRect(weekdays).top - 8));
    if (distance <= 0) return;
    const start = viewport().scrollY,
      duration = motionMs(frame, '--reveal-duration');
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const started = performance.now();
    let animation = 0;
    const scroll = (now: number) => {
      const progress = reduced || duration <= 0 ? 1 : Math.min(1, (now - started) / duration);
      const eased = progress * progress * (3 - 2 * progress);
      scrollWindow(start + distance * eased);
      if (progress < 1) animation = requestAnimationFrame(scroll);
    };
    animation = requestAnimationFrame(scroll);
    return () => cancelAnimationFrame(animation);
  }, [month, scrollMonth]);
  const items = useMemo(
    () => [
      {
        key: 'month',
        content: <CalendarMonth month={month} data={data} rules={rules} openDay={openDay} />,
      },
    ],
    [month, data, rules, openDay],
  );
  const first = new Date(`${month}-01T00:00:00Z`);
  const monthEnd = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0))
    .toISOString()
    .slice(0, 10);
  const breaks = rules.peaks.filter(
    (row) => row.start_date <= monthEnd && row.end_date >= `${month}-01`,
  );
  return (
    <div className="yearly-calendar" ref={root}>
      <div className="yearly-legend">
        <div className="yearly-legend-items">
          <span>
            <i className="yearly-dot first" />
            第一の行事
          </span>
          <span>
            <i className="yearly-dot second" />
            第二の行事
          </span>
          <span>
            <i className="yearly-legend-memo" />
            メモ
          </span>
          <span>
            <i className="yearly-legend-closed" />
            休業の日
          </span>
          <span>
            <FacilityBadge facility="A" />
            その日に開く施設
          </span>
          <span>
            <b>09:30</b>その日の受付開始時刻
          </span>
        </div>
        <span className="yearly-legend-breaks">
          {breaks.map((row) => `${row.name} ${dateRange(row.start_date, row.end_date)}`).join('、')}
        </span>
      </div>
      <div className="yearly-calendar-frame" ref={monthContent}>
        <div className="yearly-weekdays">
          {weekdays.map((day, index) => (
            <div key={day} className="yearly-calendar-cell">
              <div className={index === 0 ? 'sun' : index === 6 ? 'sat' : ''}>{day}</div>
            </div>
          ))}
        </div>
        <Reveal items={items} className="yearly-month-reveal" />
      </div>
    </div>
  );
}
