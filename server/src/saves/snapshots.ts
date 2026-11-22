import { historyForPeriod, japanToday } from '../../../shared/staff';
import { readAnnualRules, readStaff } from '../reads/first-load';
import { snapshotStaff } from '../../../shared/period-snapshot';

export function capturePeriodSnapshots(sql: SqlStorage): void {
  const now = new Date();
  const ended = sql
    .exec<{ id: string; start_date: string }>(
      `SELECT id, start_date FROM periods
    WHERE end_date < ? AND NOT EXISTS (SELECT 1 FROM period_snapshots WHERE period_id = periods.id)`,
      japanToday(now),
    )
    .toArray();
  if (!ended.length) return;
  const staff = readStaff(sql);
  const periods = sql
    .exec<{ id: string; start_date: string }>('SELECT id, start_date FROM periods')
    .toArray();
  const annualClosures = JSON.stringify(readAnnualRules(sql).annualClosures);
  for (const period of ended) {
    const capturedStaff = staff.map((person) => {
      const history = historyForPeriod(person.history, periods, period.start_date);
      return snapshotStaff({
        ...person,
        history: history ? [{ ...history, since: 'initial' }] : [],
      });
    });
    sql.exec(
      'INSERT INTO period_snapshots (period_id, staff, annual_closures, captured_at, staff_format) VALUES (?, ?, ?, ?, 1)',
      period.id,
      JSON.stringify(capturedStaff),
      annualClosures,
      now.toISOString(),
    );
  }
}
