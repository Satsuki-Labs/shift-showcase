export function shortTime(time: string): string {
  return time.replace(/^0/, '');
}

export function japanTime(instant: string): string {
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    hour: 'numeric',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(instant));
}

export function hoursMinutes(minutes: number): string {
  return `${Math.floor(minutes / 60)}時間${String(minutes % 60).padStart(2, '0')}分`;
}

export function duration(minutes: number): string {
  return `${Math.floor(minutes / 60)}時間${minutes % 60 ? `${minutes % 60}分` : ''}`;
}
