import './TimeSelect.css';
import { useLayoutEffect, useRef, useState } from 'react';
import { ChevronDown, Clock3 } from 'lucide-react';
import { Popup } from './Popup';
import { useValueArrival } from './useValueArrival';

export const timeHours = Array.from({ length: 16 }, (_, index) =>
  String(index + 7).padStart(2, '0'),
);
export const timeMinutes = ['00', '15', '30', '45'];
const durationHours = Array.from({ length: 16 }, (_, index) => String(index).padStart(2, '0'));

export function TimeChoices({
  hours,
  hour,
  minute,
  hourLabel = '時',
  disabledMinute,
  onHour,
  onMinute,
  open,
  center = false,
  startAtTop = false,
}: {
  hours: readonly string[];
  hour: string;
  minute: string;
  hourLabel?: string;
  disabledMinute: (minute: string) => boolean;
  onHour: (hour: string) => void;
  onMinute: (minute: string) => void;
  open: boolean;
  center?: boolean;
  startAtTop?: boolean;
}) {
  const column = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!open || !center) return;
    const node = column.current!,
      selected = node.querySelector<HTMLButtonElement>('.on');
    if (selected)
      node.scrollTop =
        selected.offsetTop - node.offsetTop - node.clientHeight / 2 + selected.offsetHeight / 2;
    else if (startAtTop) node.scrollTop = 0;
  });
  return (
    <div className="tpick">
      <div className="scrollbar-thin" ref={column}>
        <b>{hourLabel}</b>
        {hours.map((item) => (
          <button
            type="button"
            key={item}
            className={item === hour ? 'on' : ''}
            onClick={() => onHour(item)}
          >
            {Number(item)}
          </button>
        ))}
      </div>
      <div className="scrollbar-thin">
        <b>分</b>
        {timeMinutes.map((item) => (
          <button
            type="button"
            key={item}
            disabled={disabledMinute(item)}
            className={item === minute && !disabledMinute(item) ? 'on' : ''}
            onClick={() => onMinute(item)}
          >
            {item}
          </button>
        ))}
      </div>
    </div>
  );
}

export function TimeSelect({
  value,
  onCommit,
  allowed,
  duration = false,
}: {
  value: string;
  onCommit: (value: string) => void;
  allowed?: (time: string) => boolean;
  duration?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null),
    trigger = useRef<HTMLButtonElement>(null);
  const [hour = '', minute = ''] = value.split(':');
  const shown = !value
    ? ''
    : duration
      ? `${Number(hour)}時間${minute}分`
      : value.replace(/^0(?=\d:)/, '');
  const arrival = useValueArrival(shown, shown);
  const permitted = (h: string, m: string) =>
    duration
      ? !(h === '00' && m === '00') && !(h === '15' && m !== '00')
      : !(h === '22' && m !== '00') && (allowed?.(`${h}:${m}`) ?? true);
  const hours = (duration ? durationHours : timeHours).filter((h) =>
    timeMinutes.some((m) => permitted(h, m)),
  );
  return (
    <div className="time-select" ref={root}>
      <button
        type="button"
        ref={trigger}
        className={`select pick-time${open ? ' open' : ''}`}
        onClick={() => setOpen(!open)}
      >
        <span className="value-arrival" ref={arrival.root}>
          <span>{shown}</span>
          <span className="value-arrival-leaving" ref={arrival.leaving} />
        </span>
        {duration ? (
          <ChevronDown size={20} strokeWidth={2.4} className="chev" />
        ) : (
          <Clock3 size={22} strokeWidth={2.4} className="time-select-clock" />
        )}
      </button>
      <Popup
        anchor={trigger}
        owner={root}
        open={open}
        close={() => setOpen(false)}
        className="time-popup time-select-popup"
        width={220}
        alignToOwner
        placement="vertical"
      >
        <TimeChoices
          hours={hours}
          hour={hour}
          minute={minute}
          hourLabel={duration ? '時間' : '時'}
          open={open}
          center
          startAtTop={duration && !value}
          disabledMinute={(m) => !hour || !permitted(hour, m)}
          onHour={(h) => {
            const m =
              timeMinutes.includes(minute) && permitted(h, minute)
                ? minute
                : timeMinutes.find((item) => permitted(h, item))!;
            onCommit(`${h}:${m}`);
          }}
          onMinute={(m) => {
            onCommit(`${hour}:${m}`);
            setOpen(false);
            trigger.current?.focus({ preventScroll: true });
          }}
        />
      </Popup>
    </div>
  );
}
