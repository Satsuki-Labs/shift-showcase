import type { ReactNode } from 'react';
import { monthDay } from '../format/date';
import { WarningMark } from '../parts/icons';
import type { ClosedFacilityDay } from './closed-facility';
import './ClosedFacilityNotice.css';

export function ClosedFacilityNotice({
  days,
  children,
  className = '',
}: {
  days: readonly ClosedFacilityDay[];
  children?: ReactNode;
  className?: string;
}) {
  const groups = new Map<string, string[]>();
  for (const day of days) {
    const facilities = day.facilities.join('・');
    groups.set(facilities, [...(groups.get(facilities) ?? []), day.date]);
  }
  if (!days.length && !children) return null;
  return (
    <div className={`notice warn closed-facility-notice${className ? ` ${className}` : ''}`}>
      <WarningMark size={26} />
      <div>
        {children}
        {[...groups].map(([facilities, dates]) => (
          <div className="closed-facility-message" key={facilities}>
            {`${dates.map(monthDay).join('・')}は${facilities}が休業です。\n保存すると、休業の${facilities}に勤務が入ります。`}
          </div>
        ))}
      </div>
    </div>
  );
}
