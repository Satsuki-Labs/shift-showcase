import { dayLabelWithYear } from '../format/date';
import { conflictRows } from '../parts/save-conflict';
import { facilities, type PeriodForm } from './model';

export function periodConflictRows(yours: PeriodForm, theirs: PeriodForm) {
  const date = (value: string | null) => [value ? dayLabelWithYear(value) : 'なし'];
  const count = (value: string) => [value === '' ? '―' : `${value}人`];
  return conflictRows([
    { label: '名前', yours: yours.name, theirs: theirs.name },
    { label: '開始日', yours: date(yours.startDate), theirs: date(theirs.startDate) },
    { label: '終了日', yours: date(yours.endDate), theirs: date(theirs.endDate) },
    { label: '希望の\n締め切り', yours: date(yours.deadline), theirs: date(theirs.deadline) },
    ...facilities.flatMap((facility) => [
      {
        label: `${facility} 人数`,
        yours: count(yours.coverage[facility].total),
        theirs: count(theirs.coverage[facility].total),
      },
    ]),
  ]);
}
