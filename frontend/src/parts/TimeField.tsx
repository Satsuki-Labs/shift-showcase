import './TimeField.css';
import { useId, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Clock3 } from 'lucide-react';
import { WarningMark } from './icons';
import { Popup } from './Popup';
import { TimeChoices, timeHours as hours, timeMinutes as minutes } from './TimeSelect';
import { useValueArrival } from './useValueArrival';

export function TimeField({
  label,
  labelEnd,
  value,
  onCommit,
  inputRef,
  onConfirmed,
  onValidityChange,
  compact = false,
  placeholder,
  arrivalKey,
}: {
  label: string;
  value: string;
  onCommit: (value: string) => void;
  labelEnd?: ReactNode;
  inputRef?: RefObject<HTMLInputElement | null>;
  onConfirmed?: () => void;
  compact?: boolean;
  placeholder?: string;
  onValidityChange?: (valid: boolean) => void;
  arrivalKey?: string | number;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const ownInput = useRef<HTMLInputElement>(null);
  const input = inputRef ?? ownInput;
  const [raw, setRaw] = useState<string | null>(null);
  const draft = useRef<string | null>(null);
  const selection = useRef(arrivalKey);
  const shown = value.replace(/^0(?=\d:)/, '');
  const arrival = useValueArrival(shown, arrivalKey);
  useLayoutEffect(() => {
    if (selection.current === arrivalKey) return;
    selection.current = arrivalKey;
    draft.current = null;
    setRaw(null);
    setOpen(false);
    if (document.activeElement === input.current) input.current?.blur();
  }, [arrivalKey, input]);
  const read = (digits: string) => {
    const parts =
      digits.length === 4
        ? [digits.slice(0, 2), digits.slice(2)]
        : digits.length === 3
          ? [`0${digits[0]}`, digits.slice(1)]
          : null;
    const time = parts?.join(':');
    return time && Number(parts![1]) <= 59 && time >= '07:00' && time <= '22:00' ? time : '';
  };
  const [hour, minute] = value.split(':');
  const invalid = raw !== null && raw !== '' && !read(raw);
  useLayoutEffect(() => {
    onValidityChange?.(!invalid);
  }, [invalid, onValidityChange]);
  const choose = (nextHour: string, nextMinute: string) => {
    draft.current = null;
    setRaw(null);
    onCommit(`${nextHour}:${nextHour === '22' ? '00' : nextMinute}`);
  };
  return (
    <div className={`time-field${compact ? ' compact' : ''}`} ref={root}>
      {labelEnd ? (
        <div className="lab">
          <label htmlFor={id}>{label}</label>
          {labelEnd}
        </div>
      ) : (
        <label className="lab" htmlFor={id}>
          {label}
        </label>
      )}
      <div className="time">
        <div className="time-field-entry">
          <input
            ref={input}
            id={id}
            inputMode="numeric"
            value={raw ?? shown}
            placeholder={placeholder}
            aria-invalid={invalid || undefined}
            aria-describedby={invalid ? `${id}-error` : undefined}
            onFocus={arrival.stop}
            onChange={(event) => {
              arrival.stop();
              const digits = event.target.value
                .replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
                .replace(/\D/g, '')
                .slice(0, 4);
              draft.current = digits;
              setRaw(digits);
              const next = read(digits);
              if (digits.length === 4 && next) {
                draft.current = null;
                setRaw(null);
                onCommit(next);
                if (onConfirmed) onConfirmed();
                else input.current?.blur();
              }
            }}
            onBlur={() => {
              if (draft.current !== null) {
                const next = read(draft.current);
                if (draft.current && !next) return;
                onCommit(next);
              }
              draft.current = null;
              setRaw(null);
            }}
          />
          <span className="time-field-value value-arrival" ref={arrival.root}>
            <span>{shown}</span>
            <span className="value-arrival-leaving" ref={arrival.leaving} />
          </span>
        </div>
        <button
          ref={trigger}
          type="button"
          className={open ? 'open' : ''}
          onClick={() => {
            arrival.stop();
            setOpen(!open);
          }}
        >
          <Clock3 size={22} strokeWidth={2.4} />
        </button>
      </div>
      {invalid && (
        <div className="form-message" id={`${id}-error`}>
          <div className="msg">
            <WarningMark size={22} />
            7:00〜22:00の間で入れてください。
          </div>
        </div>
      )}
      <Popup
        anchor={trigger}
        owner={root}
        open={open}
        close={() => setOpen(false)}
        className="time-popup"
        width={220}
        alignToOwner
        placement="vertical"
      >
        <TimeChoices
          hours={hours}
          hour={hour}
          minute={minute}
          open={open}
          disabledMinute={(item) => hour === '22' && item !== '00'}
          onHour={(item) => choose(item, minutes.includes(minute) ? minute : '00')}
          onMinute={(item) => {
            choose(hours.includes(hour) ? hour : '09', item);
            setOpen(false);
            trigger.current?.focus({ preventScroll: true });
          }}
        />
      </Popup>
    </div>
  );
}
