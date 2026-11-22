import type { PeriodSummary, Staff } from '../../../shared/protocol';
import { dayLabelWithYear } from '../format/date';
import {
  employmentStatuses,
  employmentTypes,
  qualifications,
  workRoleLabels,
} from '../format/labels';
import { yen } from '../format/number';
import { shortTime } from '../format/time';
import { conflictRows, type ConflictField } from '../parts/save-conflict';
import {
  formAssignments,
  getWorkSlot,
  historyChanges,
  historyValues,
  initialForm,
  kindKeys,
  workKinds,
  workSlots,
  type HistoryField,
  type SinceSelections,
  type StaffForm,
} from './model';
import { appliedSince, historyNames, sincePeriodParts } from './since';

export function staffConflictRows(
  yours: StaffForm,
  original: Staff | undefined,
  person: Staff,
  periods: readonly PeriodSummary[],
  since: SinceSelections,
  kept: readonly HistoryField[] = [],
) {
  const theirs = initialForm(person);
  const date = (value: string | null) => [value ? dayLabelWithYear(value) : 'なし'];
  const role = (form: StaffForm) => {
    const { topRoles, bottomRoles } = workRoleLabels({ roles: form.roles }, []);
    const labels = [...topRoles, ...bottomRoles];
    return labels.length
      ? labels.flatMap((value, index) => (index ? ['・', value] : [value]))
      : ['なし'];
  };
  const fields: ConflictField[] = [
    { label: '名字', yours: yours.familyName, theirs: theirs.familyName },
    { label: '名前', yours: yours.givenName, theirs: theirs.givenName },
    {
      label: '第一の\n担当区分',
      yours: [yours.firstFacility ?? 'なし'],
      theirs: [theirs.firstFacility ?? 'なし'],
    },
    {
      label: '第二の\n担当区分',
      yours: [yours.secondFacility ?? 'なし'],
      theirs: [theirs.secondFacility ?? 'なし'],
    },
    { label: '役割', yours: role(yours), theirs: role(theirs), separators: ['・'] },
    {
      label: '在籍状況',
      yours: [employmentStatuses.find((item) => item.value === yours.employmentStatus)!.label],
      theirs: [employmentStatuses.find((item) => item.value === theirs.employmentStatus)!.label],
    },
    {
      label: '休職の始まり',
      yours: date(yours.employmentStatus === 'leave' ? yours.leaveStart : null),
      theirs: date(theirs.employmentStatus === 'leave' ? theirs.leaveStart : null),
    },
    {
      label: '終わりの\n見込み',
      yours: date(yours.employmentStatus === 'leave' ? yours.leaveEnd : null),
      theirs: date(theirs.employmentStatus === 'leave' ? theirs.leaveEnd : null),
    },
    {
      label: '退職日',
      yours: date(yours.employmentStatus === 'retired' ? yours.retirementDate : null),
      theirs: date(theirs.employmentStatus === 'retired' ? theirs.retirementDate : null),
    },
  ];
  for (const kindName of workKinds) {
    const kind = kindKeys[kindName];
    const choices =
      kind === 'saturday'
        ? (['第一 1回目'] as const)
        : workSlots({ default_first_facility: 'A', default_second_facility: 'C' });
    const value = (form: StaffForm, slot: (typeof choices)[number]) => {
      const time = getWorkSlot(form.workTimes, kind, slot);
      return (kind === 'saturday' || workSlots(formAssignments(form)).includes(slot)) &&
        (time.start || time.end)
        ? [shortTime(time.start), '〜', shortTime(time.end)]
        : ['なし'];
    };
    fields.push(
      ...choices.map((slot) => ({
        label: `${kindName}\n${kind === 'saturday' ? 'A' : slot}`,
        yours: value(yours, slot),
        theirs: value(theirs, slot),
      })),
    );
  }
  const values = (form: StaffForm, field: HistoryField) => {
    const value = historyValues(form)[field];
    if (field === 'employment_type')
      return employmentTypes.find((item) => item.value === value)!.label;
    if (field === 'qualification')
      return qualifications.find((item) => item.value === value)!.label;
    return yen(Number(value));
  };
  const application = (
    source: Staff | undefined,
    form: StaffForm,
    field: HistoryField,
    selected: SinceSelections,
    retained: readonly HistoryField[],
  ) => {
    const changed = historyChanges(form, source, retained).includes(field);
    const id = changed ? selected[field] : source ? appliedSince(source, field) : undefined;
    const period = periods.find((item) => item.id === id);
    return period ? sincePeriodParts(period) : ['なし'];
  };
  for (const field of Object.keys(historyNames) as HistoryField[])
    fields.push(
      {
        label: historyNames[field],
        yours: [values(yours, field)],
        theirs: [values(theirs, field)],
      },
      {
        label: `${historyNames[field]}\nいつから`,
        yours: application(original, yours, field, since, kept),
        theirs: application(person, theirs, field, {}, []),
      },
    );
  fields.push({ label: '備考', yours: yours.notes, theirs: theirs.notes, wholeText: true });
  return conflictRows(fields);
}
