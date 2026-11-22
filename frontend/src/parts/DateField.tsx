import './DateField.css';
import { useId, useRef, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { japanToday } from '../../../shared/staff';
import { Popup } from './Popup';
import { monthDay, dayLabel, dayLabelWithYear } from '../format/date';
import { layoutRect } from './viewport';

const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
const dateOf = (value: string) => new Date(`${value}T00:00:00Z`);
export function DateField({
  label,
  value,
  onChange,
  required = false,
  hideRequiredMark = false,
  min,
  max,
  monthDayOnly = false,
  hideYear = false,
  emptyMonth,
  stableCalendarPosition = false,
}: {
  label: string;
  value: string | null;
  onChange: (value: string | null) => void;
  required?: boolean;
  hideRequiredMark?: boolean;
  min?: string;
  max?: string;
  monthDayOnly?: boolean;
  hideYear?: boolean;
  emptyMonth?: string;
  stableCalendarPosition?: boolean;
}) {
  const id = useId(),
    today = japanToday();
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState((value ?? emptyMonth ?? today).slice(0, 7));
  const root = useRef<HTMLDivElement>(null),
    button = useRef<HTMLButtonElement>(null);
  const calendar = useRef<HTMLDivElement>(null);
  const first = dateOf(`${month}-01`),
    year = first.getUTCFullYear(),
    monthIndex = first.getUTCMonth();
  const dayCount = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  const placementHeight = (height: number) => {
    const grid = calendar.current?.querySelector<HTMLElement>('.calg'),
      day = grid?.querySelector('button');
    if (!grid || !day) return height;
    const weeks = Math.ceil((first.getUTCDay() + dayCount) / 7);
    return (
      height + (6 - weeks) * (layoutRect(day).height + parseFloat(getComputedStyle(grid).rowGap))
    );
  };
  const choose = (next: string | null) => {
    onChange(next);
    setOpen(false);
    button.current?.focus({ preventScroll: true });
  };
  const move = (amount: number) =>
    setMonth(new Date(Date.UTC(year, monthIndex + amount, 1)).toISOString().slice(0, 7));
  return (
    <div className="date-field" ref={root}>
      <label className="lab" htmlFor={id}>
        {label}
        {required && !hideRequiredMark && <span className="req">*</span>}
      </label>
      <button
        id={id}
        ref={button}
        type="button"
        className={`select${open ? ' open' : ''}${value ? '' : ' empty'}`}
        onClick={() => {
          if (!open) setMonth((value ?? emptyMonth ?? today).slice(0, 7));
          setOpen(!open);
        }}
      >
        <span>
          {value
            ? monthDayOnly
              ? monthDay(value)
              : hideYear
                ? dayLabel(value)
                : dayLabelWithYear(value)
            : required
              ? '選んでください'
              : '未定'}
        </span>
        <CalendarDays size={22} strokeWidth={2} />
      </button>
      <Popup
        anchor={button}
        owner={root}
        open={open}
        close={() => setOpen(false)}
        className="date-popup"
        width={320}
        placement="vertical-full"
        placementHeight={stableCalendarPosition ? placementHeight : undefined}
      >
        <div className="cal" ref={calendar}>
          <div className="calh">
            <button
              className="icon-button step"
              type="button"
              disabled={min !== undefined && month <= min.slice(0, 7)}
              onClick={() => move(-1)}
            >
              <ChevronLeft size={22} strokeWidth={2.6} />
            </button>
            <span>
              {year}年{monthIndex + 1}月
            </span>
            <button
              className="icon-button step"
              type="button"
              disabled={max !== undefined && month >= max.slice(0, 7)}
              onClick={() => move(1)}
            >
              <ChevronRight size={22} strokeWidth={2.6} />
            </button>
          </div>
          <div className="calg">
            {weekdays.map((day, index) => (
              <i key={day} className={index === 0 ? 'sun' : index === 6 ? 'sat' : ''}>
                {day}
              </i>
            ))}
            {Array.from({ length: first.getUTCDay() }, (_, index) => (
              <span key={`blank${index}`} />
            ))}
            {Array.from({ length: dayCount }, (_, index) => {
              const date = `${month}-${String(index + 1).padStart(2, '0')}`,
                day = dateOf(date).getUTCDay();
              return (
                <button
                  type="button"
                  key={date}
                  disabled={Boolean((min && date < min) || (max && date > max))}
                  className={`${day === 0 ? 'sun' : day === 6 ? 'sat' : ''}${date === value ? ' on' : ''}${date === today ? ' today' : ''}`}
                  onClick={() => choose(date)}
                >
                  {index + 1}
                </button>
              );
            })}
          </div>
          {!required && (
            <div className="calf">
              <button className="btn btn-sub btn-small" type="button" onClick={() => choose(null)}>
                未定にする
              </button>
            </div>
          )}
        </div>
      </Popup>
    </div>
  );
}
