import initialSql from '../../migrations/0001_initial.sql?raw';
import periodSnapshotFormatSql from '../../migrations/0002_period_snapshot_format.sql?raw';
import orderContactRevisionsSql from '../../migrations/0003_order_contact_revisions.sql?raw';
import yearlyRuleRevisionsSql from '../../migrations/0004_yearly_rule_revisions.sql?raw';

export interface Migration {
  readonly number: number;
  readonly sql: string;
  readonly additive: boolean;
}

export const MIGRATIONS: readonly Migration[] = [
  { number: 1, sql: initialSql, additive: false },
  { number: 2, sql: periodSnapshotFormatSql, additive: true },
  { number: 3, sql: orderContactRevisionsSql, additive: true },
  { number: 4, sql: yearlyRuleRevisionsSql, additive: true },
];
