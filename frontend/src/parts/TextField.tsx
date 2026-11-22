import { useId, useLayoutEffect, useRef, useState } from 'react';

export function TextField({
  label,
  value,
  onChange,
  required = false,
  multiline = false,
  numeric = false,
  grouped = false,
  placeholder,
  maxLength,
}: {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  multiline?: boolean;
  numeric?: boolean;
  grouped?: boolean;
  placeholder?: string;
  maxLength?: number;
}) {
  const id = useId();
  const [focused, setFocused] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    if (focused && grouped) input.current?.select();
  }, [focused, grouped]);
  const [whole, fraction] = value.split('.');
  const display =
    grouped && !focused
      ? whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (fraction === undefined ? '' : `.${fraction}`)
      : value;
  const change = (text: string) => {
    if (numeric)
      text = text.replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0));
    if (grouped) text = text.replace(/,/g, '');
    if (!numeric || /^(\d+(\.\d*)?)?$/.test(text)) onChange(text);
  };
  return (
    <>
      {label !== undefined && (
        <label className="lab" htmlFor={id}>
          {label}
          {required && <span className="req">*</span>}
        </label>
      )}
      {multiline ? (
        <textarea
          id={label === undefined ? undefined : id}
          className="field"
          value={value}
          placeholder={placeholder}
          maxLength={maxLength}
          onChange={(event) => change(event.target.value)}
        />
      ) : (
        <input
          ref={input}
          id={label === undefined ? undefined : id}
          className="field"
          value={display}
          placeholder={placeholder}
          maxLength={maxLength}
          inputMode={numeric ? 'decimal' : 'text'}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onChange={(event) => change(event.target.value)}
        />
      )}
    </>
  );
}
