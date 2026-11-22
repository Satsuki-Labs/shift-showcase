import { useEffect, useState } from 'react';
import { holidayName } from '../../../shared/holidays';
import { japanToday } from '../../../shared/staff';
import { dayLabel } from '../format/date';

export function HeaderDate() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const current = new Date();
      setNow(current);
      timer = setTimeout(tick, 60_000 - (current.getTime() % 60_000));
    };
    tick();
    return () => clearTimeout(timer);
  }, []);
  const today = japanToday(now);
  const [todayDate, todayWeekday] = dayLabel(today).split('（');
  const [month, day] = todayDate.split(/[月日]/);
  const japanTime = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const weekday = japanTime.getUTCDay();
  const todayColor =
    holidayName(today) || weekday === 0 ? 'sunday' : weekday === 6 ? 'saturday' : undefined;
  return (
    <span className="app-header-date">
      <span className="header-date-clock">
        <span>
          {month}
          <span className="header-date-label">月</span>
          {day}
          <span className="header-date-label">
            日（<span className={todayColor}>{todayWeekday[0]}</span>）
          </span>
        </span>
        <span className="header-date-divider" />
        <span className="header-date-time">
          {japanTime.getUTCHours()}
          <span className="header-date-colon">:</span>
          {String(japanTime.getUTCMinutes()).padStart(2, '0')}
        </span>
      </span>
    </span>
  );
}
