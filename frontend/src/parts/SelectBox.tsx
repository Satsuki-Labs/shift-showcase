import { layoutRect } from './viewport';
import './SelectBox.css';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { Popup } from './Popup';
import { slashMonthDay } from '../format/date';

export interface SelectOption<T extends string> {
  value: T;
  label: string;
  short?: string;
  period?: { start_date: string; end_date: string; current: boolean };
}

export function SelectBox<T extends string>({
  label,
  value,
  options,
  onChange,
  required = false,
  selectedAtStart = false,
}: {
  label?: string;
  value: T;
  options: readonly SelectOption<T>[];
  onChange: (value: T) => void;
  required?: boolean;
  selectedAtStart?: boolean;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const choices = useRef<Array<HTMLButtonElement | null>>([]);
  const previousOpen = useRef(false);
  const [popupWidth, setPopupWidth] = useState<number>();
  const selected = options.find((option) => option.value === value);
  useLayoutEffect(() => {
    const popup = list.current,
      button = trigger.current;
    if (!open || !popup || !button) return;
    const measure = () => {
      const frame = popup.parentElement!,
        style = getComputedStyle(frame);
      const frameWidth =
        parseFloat(style.paddingLeft) +
        parseFloat(style.paddingRight) +
        parseFloat(style.borderLeftWidth) +
        parseFloat(style.borderRightWidth);
      // Intrinsic layout includes the check, gaps, period box and the actual scrollbar.
      popup.style.width = 'max-content';
      const contentWidth = Math.ceil(layoutRect(popup).width + frameWidth);
      popup.style.width = '';
      setPopupWidth(Math.max(layoutRect(button).width, Math.min(400, contentWidth)));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(popup);
    observer.observe(button);
    measure();
    return () => observer.disconnect();
  }, [open, options]);
  const focusChoice = (index: number, alignStart = false) => {
    const choice = choices.current[index];
    if (!choice) return;
    choice.focus({ preventScroll: true });
    const popup = list.current;
    if (!popup) return;
    const item = layoutRect(choice),
      box = layoutRect(popup);
    const top = box.top + popup.clientTop,
      bottom = top + popup.clientHeight;
    if (alignStart || item.top < top) popup.scrollTop += item.top - top;
    else if (item.bottom > bottom) popup.scrollTop += item.bottom - bottom;
  };
  useEffect(() => {
    const opening = open && !previousOpen.current;
    previousOpen.current = open;
    if (!open || (selectedAtStart && !opening)) return;
    focusChoice(
      Math.max(
        0,
        options.findIndex((option) => option.value === value),
      ),
      selectedAtStart,
    );
  }, [open, options, value, selectedAtStart]);
  return (
    <div className="select-root" ref={root}>
      {label !== undefined && (
        <label className="lab" htmlFor={id}>
          {label}
          {required && <span className="req">*</span>}
        </label>
      )}
      <button
        type="button"
        id={label === undefined ? undefined : id}
        className={`select${open ? ' open' : ''}${value ? '' : ' empty'}`}
        ref={trigger}
        onClick={() => setOpen(!open)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        {selected?.short !== undefined ? (
          <span className="select-short">{selected.short}</span>
        ) : (
          <span className="select-label">{selected?.label ?? '選んでください'}</span>
        )}
        <ChevronDown className="chev" size={22} strokeWidth={3} />
      </button>
      <Popup
        anchor={trigger}
        owner={root}
        open={open}
        close={() => setOpen(false)}
        className="select-popup"
        width={popupWidth}
        placement="vertical"
        scrollContainer={list}
        scrollStep={() => (choices.current[0] ? layoutRect(choices.current[0]).height : 0)}
      >
        <div className="pop">
          <div
            className="select-options scrollbar-thin"
            ref={list}
            onKeyDown={(event) => {
              const index = choices.current.indexOf(document.activeElement as HTMLButtonElement);
              if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                event.preventDefault();
                const next =
                  event.key === 'Home'
                    ? 0
                    : event.key === 'End'
                      ? options.length - 1
                      : (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) %
                        options.length;
                focusChoice(next);
              } else if (event.key === 'Tab') setOpen(false);
            }}
          >
            {options.map((option, index) => (
              <button
                key={option.value}
                type="button"
                className={`opt${value === option.value ? ' on' : ''}`}
                ref={(node) => {
                  choices.current[index] = node;
                }}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                  trigger.current?.focus({ preventScroll: true });
                }}
              >
                {value === option.value && <Check size={18} strokeWidth={3.2} />}
                <span className="select-option-label">{option.label}</span>
                {option.period && (
                  <span className="select-option-period">
                    {option.period.current && <span className="select-option-today">今日</span>}
                    <span className="select-option-dates">
                      <span>{slashMonthDay(option.period.start_date)}</span>
                      <span>〜</span>
                      <span>{slashMonthDay(option.period.end_date)}</span>
                    </span>
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      </Popup>
    </div>
  );
}
