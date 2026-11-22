export function isValidDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function addDays(date: string, days: number): string {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

export function dateRange(start: string, end: string): string[] {
  const dates: string[] = [];
  for (let date = start; date <= end; date = addDays(date, 1)) dates.push(date);
  return dates;
}

// 日本の年月日・時分を、UTCの各欄から読めるDateにする。
export function japanDateTime(now: Date): Date {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000);
}

export function japanDate(now: Date): string {
  return japanDateTime(now).toISOString().slice(0, 10);
}
