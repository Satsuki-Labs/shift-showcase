const weekdays = '日月火水木金土';
const weekday = (date: string) => weekdays[new Date(`${date}T00:00:00Z`).getUTCDay()];

export function yearMonthDay(date: string): string {
  return `${date.slice(0, 4)}年${monthDay(date)}`;
}

export function monthDay(date: string): string {
  return `${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日`;
}

export function dayLabel(date: string): string {
  return `${monthDay(date)}（${weekday(date)}）`;
}

export function japanDateTime(instant: string): string {
  const japan = new Date(new Date(instant).getTime() + 9 * 60 * 60 * 1000).toISOString();
  return `${dayLabel(japan.slice(0, 10))}${Number(japan.slice(11, 13))}:${japan.slice(14, 16)}`;
}

export function dayLabelWithYear(date: string): string {
  return `${date.slice(0, 4)}年${dayLabel(date)}`;
}

export function slashMonthDay(date: string): string {
  return `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
}

export function slashDayLabel(date: string): string {
  return `${slashMonthDay(date)}（${weekday(date)}）`;
}

export function slashDayParts(date: string): { month: number; day: number; weekday: string } {
  return {
    month: Number(date.slice(5, 7)),
    day: Number(date.slice(8, 10)),
    weekday: weekday(date),
  };
}

export function dateRange(start: string, end: string): string {
  return start === end ? monthDay(start) : `${monthDay(start)}〜${monthDay(end)}`;
}
