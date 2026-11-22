import { useMemo } from 'react';
import { CalendarDays, House, MessageSquare, Pencil } from 'lucide-react';
import type { CalendarRows } from '../../../shared/protocol';
import { Reveal } from '../parts/Reveal';
import {
  buildingNumbers,
  eventListRows,
  type BuildingChoice,
  type EventListRow,
} from './event-model';
import { slashDayParts } from '../format/date';
import { NumberUnits } from '../parts/NumberUnits';

export function BuildingName({ choice }: { choice: BuildingChoice }) {
  return (
    <span className="event-building-name">
      {buildingNumbers(choice).map((building) => (
        <i key={building} className={`dot ${building === 1 ? 'c1' : 'c2'}`} />
      ))}
      {choice}
    </span>
  );
}
function EventRow({ row, edit }: { row: EventListRow; edit: (date: string) => void }) {
  const date = slashDayParts(row.date);
  return (
    <div className={`event-row${row.kind === 'memo' ? ' memo' : ''}`}>
      <div className="event-date">
        <span className="event-date-day">{date.day}</span>日（{date.weekday}）
      </div>
      <div>
        <span className={`event-kind ${row.kind}`}>
          {row.kind === 'event' ? <House size={16} /> : <MessageSquare size={16} />}
          {row.kind === 'event' ? '行事' : 'メモ'}
        </span>
      </div>
      <div>
        <BuildingName
          choice={row.buildings.length === 2 ? '両方' : row.buildings[0] === 1 ? '第一' : '第二'}
        />
      </div>
      <div className="event-content" title={row.content}>
        {row.content}
      </div>
      <div className="event-arrival">{row.arrival || '―'}</div>
      <div>
        <button className="btn btn-sub btn-small" type="button" onClick={() => edit(row.date)}>
          <Pencil size={18} strokeWidth={2.2} />
          編集
        </button>
      </div>
    </div>
  );
}
export function EventList({ data, edit }: { data: CalendarRows; edit: (date: string) => void }) {
  const months = useMemo(() => {
    const grouped = new Map<string, EventListRow[]>();
    for (const row of eventListRows(data)) {
      const month = row.date.slice(0, 7);
      grouped.set(month, [...(grouped.get(month) ?? []), row]);
    }
    return [...grouped].map(([month, rows]) => ({
      key: month,
      content: (
        <section className="event-month">
          <header className="band nv">
            <CalendarDays size={22} strokeWidth={2.4} />
            <b>{Number(month.slice(5, 7))}月</b>
            <span>
              <NumberUnits>{`${rows.length}件`}</NumberUnits>
            </span>
          </header>
          <div>
            <div className="event-row head">
              {['日付', '種類', '建物', '内容', '受付開始時刻', ''].map((label, index) => (
                <div
                  key={index}
                  className={index === 0 ? 'event-date' : index === 3 ? 'event-content' : ''}
                >
                  {label}
                </div>
              ))}
            </div>
            <Reveal
              items={rows.map((row) => ({
                key: JSON.stringify(row),
                content: <EventRow row={row} edit={edit} />,
              }))}
            />
          </div>
        </section>
      ),
    }));
  }, [data, edit]);
  return (
    <div className="event-list">
      {months.length ? (
        <Reveal items={months} />
      ) : (
        <section className="event-empty">まだ登録されていません</section>
      )}
    </div>
  );
}
