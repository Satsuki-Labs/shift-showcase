import { LockKeyhole } from 'lucide-react';
import type { ReactNode } from 'react';
import { bulkDateNumber, type BulkCalendarDay } from './bulk-model';
import './BulkCalendar.css';

export function BulkCalendar({
  dates,
  blocked,
  selected,
  choose,
  calendar,
  legend,
}: {
  dates: readonly string[];
  blocked: ReadonlySet<string>;
  selected: readonly string[];
  choose?: (date: string) => void;
  calendar?: ReadonlyMap<string, BulkCalendarDay>;
  legend?: ReactNode;
}) {
  const offset = new Date(`${dates[0]}T00:00:00Z`).getUTCDay();
  const trailing = (7 - ((offset + dates.length) % 7)) % 7;
  return (
    <div className={`bcal${choose ? '' : ' ro'}`}>
      {legend}
      {[...'日月火水木金土'].map((label, index) => (
        <div key={label} className={`bw${index === 6 ? ' sat' : index === 0 ? ' sun' : ''}`}>
          {label}
        </div>
      ))}
      {Array.from({ length: offset }, (_, index) => (
        <div key={index} className="bcal-cell" />
      ))}
      {dates.map((date) => {
        const day = choose ? calendar?.get(date) : undefined;
        const locked = day?.closed ?? blocked.has(date),
          on = selected.includes(date),
          paid = !locked && day?.status === 'paid_leave';
        const unavailable = day?.selectable === false;
        const className = `bd${locked ? ' closed' : paid ? ' paid' : on ? ' on' : ''}${unavailable && !locked && !paid ? ' unavailable' : ''}`;
        const mark = locked ? (
          <i className="mk">
            <LockKeyhole size={14} />
          </i>
        ) : paid ? (
          <small>有給</small>
        ) : day?.status === 'empty' ? (
          <small>空</small>
        ) : (
          day &&
          day.buildings.length > 0 && (
            <span className="bulk-day-bands">
              {day.buildings.map((building) => (
                <i key={building} className={`bulk-day-band c${building}`} />
              ))}
            </span>
          )
        );
        const number = bulkDateNumber(date, dates[0]);
        const content = choose ? (
          <>
            <span className="bulk-day-number">{number}</span>
            <span className="bulk-day-mark">{mark}</span>
          </>
        ) : (
          <>
            {number}
            {mark}
          </>
        );
        return (
          <div key={date} className="bcal-cell">
            {choose ? (
              <button type="button" className={className} onClick={() => choose(date)}>
                {content}
              </button>
            ) : (
              <span className={className}>{content}</span>
            )}
          </div>
        );
      })}
      {Array.from({ length: trailing }, (_, index) => (
        <div key={`trailing-${index}`} className="bcal-cell" />
      ))}
    </div>
  );
}
export function BulkLegend({
  review = false,
  changeLabel,
}: {
  review?: boolean;
  changeLabel?: string;
}) {
  return (
    <div className="lg">
      <span>
        <i className="l on" />
        {review ? changeLabel : '選んだ日'}
      </span>
      <span>
        <i className="l closed" />
        休業・公休の日
      </span>
      {!review && (
        <>
          <span>
            <i className="l paid" />
            有給
          </span>
          <span>
            <i className="bulk-day-band c1" />
            勤務が入っている日
          </span>
        </>
      )}
    </div>
  );
}
