import './Segmented.css';
import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { WarningMark } from './icons';

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  errors,
  disabledOptions,
  prefix,
}: {
  value: T | null;
  options: readonly T[];
  onChange: (value: T) => void;
  errors?: readonly T[];
  disabledOptions?: readonly T[];
  prefix?: (option: T) => ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const node = root.current;
    if (!node) return;
    if (value === null) node.classList.remove('ready');
    let active = true;
    const measure = () => {
      if (!active) return;
      const button = node.querySelector<HTMLElement>('button.on');
      const left = button?.offsetLeft ?? 0,
        width = button?.offsetWidth ?? 0;
      node.style.setProperty('--seg-left', `${left}px`);
      node.style.setProperty('--seg-width', `${width}px`);
    };
    measure();
    let readyFrame = 0;
    const frame =
      value === null
        ? 0
        : requestAnimationFrame(() => {
            readyFrame = requestAnimationFrame(() => node.classList.add('ready'));
          });
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    void document.fonts.ready.then(measure);
    return () => {
      active = false;
      cancelAnimationFrame(frame);
      cancelAnimationFrame(readyFrame);
      observer.disconnect();
    };
  }, [value, options]);
  const firstEnabled = options.find((option) => !disabledOptions?.includes(option));
  return (
    <div
      ref={root}
      className={`seg${value === null ? ' seg-unselected' : ''}${errors === undefined ? '' : ' seg-with-errors'}`}
    >
      {options.map((option, index) => (
        <button
          type="button"
          key={option}
          tabIndex={option === value || (value === null && option === firstEnabled) ? 0 : -1}
          disabled={disabledOptions?.includes(option)}
          className={`${option === value ? 'on' : ''}${option.length === 1 ? ' single' : ''}${errors?.includes(option) ? ' bad' : ''}`}
          onClick={() => onChange(option)}
          onKeyDown={(event) => {
            if (
              !['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'Home', 'End'].includes(
                event.key,
              )
            )
              return;
            event.preventDefault();
            const available = options
              .map((item, i) => ({ item, i }))
              .filter(({ item }) => !disabledOptions?.includes(item));
            if (!available.length) return;
            const at = available.findIndex(({ i }) => i === index);
            const next =
              available[
                event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? available.length - 1
                    : (at +
                        (event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1) +
                        available.length) %
                      available.length
              ].i;
            onChange(options[next]);
            (event.currentTarget.parentElement?.children[next] as HTMLElement)?.focus();
          }}
        >
          {prefix?.(option)}
          {errors === undefined ? (
            option
          ) : (
            <span className="seg-label">
              {option}
              {errors.includes(option) && (
                <span className="seg-error">
                  <WarningMark size={18} />
                </span>
              )}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
