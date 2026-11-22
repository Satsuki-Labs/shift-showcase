import type { CurrentRevision, Role, WorkSlot } from '../../../shared/protocol';
import { conflictRows, type ConflictField } from '../parts/save-conflict';
import { japanTime, shortTime } from '../format/time';
import { changedByLabels, workRoleLabels } from '../format/labels';
import {
  hasTime,
  initialCell,
  orderSlots,
  slotNames,
  storedCell,
  times,
  workBuildings,
  type CellContext,
  type CellForm,
} from './cell-model';

export function comparedCell(context: CellContext) {
  const initial = initialCell(context);
  return { form: initial.seeded ? storedCell(context) : initial.form, seeded: false };
}
export function cellConflictRevisions(
  context: CellContext,
  conflicts: readonly CurrentRevision[],
): CurrentRevision[] {
  return conflicts.map((row) => {
    const target = row.target;
    const revision =
      target.unit === 'staff' && target.id === context.person.id
        ? context.person.revision
        : target.unit === 'day-state'
          ? (context.data.dayStates.find(
              (item) => item.staff_id === target.staffId && item.date === target.date,
            )?.revision ?? null)
          : target.unit === 'work-slot'
            ? (context.data.workSlots.find(
                (item) =>
                  item.staff_id === target.staffId &&
                  item.date === target.date &&
                  item.building === target.building,
              )?.revision ?? null)
            : row.revision;
    return { ...row, revision };
  });
}
export function cellConflictRows(yours: CellForm, theirs: CellForm) {
  const status = (form: CellForm) =>
    form.status === null
      ? '公休・休業日'
      : { none: '勤務', paid_leave: '有給', empty: '空' }[form.status];
  const slots = (form: CellForm) =>
    orderSlots(form.slots).map((slot) =>
      form.status === 'none' && hasTime(slot)
        ? [
            shortTime(slot.start_time),
            '〜',
            shortTime(slot.end_time),
            '　',
            slot.facility,
            ...(slot.is_office ? ['　', 'Y'] : []),
          ]
        : ['なし'],
    );
  const roles = (form: CellForm) => {
    const work = workBuildings(form).map((building) => ({
      building,
      slots: times(form, building) as WorkSlot['slots'],
    }));
    const { topRoles, bottomRoles } = workRoleLabels(
      form.status === 'none' ? form : undefined,
      work,
    );
    const values = [...topRoles, ...bottomRoles];
    return values.length
      ? values.flatMap((value, index) => (index ? ['・', value] : [value]))
      : ['なし'];
  };
  const left = slots(yours),
    right = slots(theirs);
  const fields: ConflictField[] = [
    { label: '状態', yours: [status(yours)], theirs: [status(theirs)] },
    ...slotNames.map((label, index) => ({ label, yours: left[index], theirs: right[index] })),
    { label: '役割', yours: roles(yours), theirs: roles(theirs), separators: ['・'] },
    {
      label: '特別対応',
      yours: [yours.status === 'none' && yours.specialCare ? 'あり' : 'なし'],
      theirs: [theirs.status === 'none' && theirs.specialCare ? 'あり' : 'なし'],
    },
    { label: '備考', yours: yours.notes, theirs: theirs.notes, wholeText: true },
  ];
  return conflictRows(fields);
}
export function cellConflictDescription(
  before: CellContext,
  current: CellContext,
): string | undefined {
  const rows = [...current.data.dayStates, ...current.data.workSlots]
    .filter((row) => row.staff_id === current.person.id && row.date === current.date)
    .filter((row) => {
      const previous =
        'building' in row
          ? before.data.workSlots.find(
              (item) =>
                item.staff_id === row.staff_id &&
                item.date === row.date &&
                item.building === row.building,
            )
          : before.data.dayStates.find(
              (item) => item.staff_id === row.staff_id && item.date === row.date,
            );
      return row.revision !== previous?.revision;
    })
    .filter((row) => Number.isFinite(Date.parse(row.last_changed_at)))
    .sort((a, b) => Date.parse(b.last_changed_at) - Date.parse(a.last_changed_at));
  const latest = rows[0];
  if (!latest) return;
  const who = Object.prototype.hasOwnProperty.call(changedByLabels, latest.last_changed_by)
    ? changedByLabels[latest.last_changed_by as Role]
    : undefined;
  if (!who) return;
  return `${who}が${japanTime(latest.last_changed_at)}にシフトを変更し、保存しました。`;
}
