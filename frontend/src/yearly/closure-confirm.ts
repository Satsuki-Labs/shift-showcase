import type {
  OpeningConflict,
  SavePreviewDay,
  SavePreviewResponse,
  Staff,
} from '../../../shared/protocol';
import type { SaveInput } from '../saving/types';
import type { DayBuilding } from './day-model';
import { dayLabel } from '../format/date';

export function needsDayPreview(
  form: readonly DayBuilding[],
  initial: readonly DayBuilding[],
): boolean {
  return form.some((group) =>
    group.facilities.some(
      (row) =>
        initial
          .find((item) => item.building === group.building)
          ?.facilities.find((item) => item.facility === row.facility)?.is_open !== row.is_open,
    ),
  );
}
export function handlesPreviewError(field: string): boolean {
  return field === 'confirmation' || field === 'paid_leave';
}
export function previewDecision(date: string, input: SaveInput, response: SavePreviewResponse) {
  const day = response.days.find((row) => row.date === date);
  const confirmed = {
    ...input,
    data: {
      ...(input.data as Record<string, import('../../../shared/protocol').JsonValue>),
      confirmed: response.dataChangeNumber,
    },
  };
  if (day?.paid_leave.length) return { kind: 'blocked' as const, day, input: confirmed };
  if (day && (day.remove.length || day.add.length))
    return { kind: 'confirm' as const, day, input: confirmed };
  return { kind: 'save' as const, input: confirmed };
}
export type PreviewDecision = ReturnType<typeof previewDecision>;
export function closureConfirmation(
  day: SavePreviewDay,
  staff: readonly Pick<Staff, 'id' | 'name'>[],
) {
  const names = (ids: string[]) => ids.map((id) => staff.find((person) => person.id === id)!.name);
  const closed = [...day.closed].sort().join('・'),
    opened = [...day.opened].sort().join('・');
  if (day.paid_leave.length)
    return {
      kind: 'blocked' as const,
      title: '休業にできません',
      message: '以下の人が、この日は有給です。有給を外してから、休業にしてください。',
      sections: [{ names: names(day.paid_leave) }],
      cancelLabel: '閉じる',
      confirmLabel: undefined,
    };
  if (day.remove.length && day.add.length)
    return {
      kind: 'both' as const,
      title: '勤務を変えますか？',
      message: undefined,
      sections: [
        {
          text: `${closed}を休業にします。${closed}の勤務が消える人（${day.remove.length}人）`,
          names: names(day.remove),
        },
        {
          text: `${opened}を営業に戻します。既定の勤務が入る人（${day.add.length}人）`,
          names: names(day.add),
        },
      ],
      after: '消えた勤務は、元に戻りません。',
      cancelLabel: 'いいえ',
      confirmLabel: 'はい、保存する',
    };
  if (day.remove.length)
    return {
      kind: 'remove' as const,
      title: `${day.remove.length}人の勤務を消しますか？`,
      message: `${closed}を休業にします。次の人の${day.closed.length === 4 ? '' : `、${closed}の`}勤務が消えます。消えた勤務は、元に戻りません。`,
      sections: [{ names: names(day.remove) }],
      cancelLabel: 'いいえ',
      confirmLabel: 'はい、休業にする',
    };
  return {
    kind: 'add' as const,
    title: `${day.add.length}人に勤務を入れますか？`,
    message: `${opened}を営業に戻します。次の人に、既定の勤務が入ります。`,
    sections: [{ names: names(day.add) }],
    cancelLabel: 'いいえ',
    confirmLabel: 'はい、営業に戻す',
  };
}

export function handlesRulePreviewError(field: string): boolean {
  return field === 'confirmation';
}
export const openingConflictMessage = '時刻が合わなくなる日があるため、保存できません。';
export function handlesOpeningConflict(field: string): boolean {
  return field === 'opening_conflict';
}
export function handlesRuleInputError(field: string): boolean {
  return handlesRulePreviewError(field) || handlesOpeningConflict(field);
}
export function facilityBuilding(facility: OpeningConflict['facility']): '第一' | '第二' {
  return facility < 'C' ? '第一' : '第二';
}
export function openingConflictFacility(row: OpeningConflict) {
  return `${facilityBuilding(row.facility)}${row.facility}`;
}
export function openingConflictField(row: OpeningConflict) {
  return row.field === 'start_time' ? '営業' : '締め';
}
export function openingConflictConfirmation(rows: readonly OpeningConflict[]) {
  const dates = [...new Set(rows.map((row) => row.date))].sort();
  return {
    message:
      '以下の日は、手動で変更した時刻と合わなくなります。\nそれぞれの日を開いて、修正してください。',
    rows: dates.map((date) => ({
      date,
      label: dayLabel(date),
      facilities: rows
        .filter((row) => row.date === date)
        .sort((a, b) => a.facility.localeCompare(b.facility)),
    })),
  };
}
export function rulePreviewDecision(input: SaveInput, response: SavePreviewResponse) {
  const data = input.data as Record<string, import('../../../shared/protocol').JsonValue>;
  const deleting = data.after === null;
  if (response.openingConflicts.length)
    return { kind: 'error' as const, message: openingConflictMessage };
  return {
    kind: !deleting && response.days.length === 0 ? ('save' as const) : ('confirm' as const),
    deleting,
    days: response.days,
    input: { ...input, data: { ...data, confirmed: response.dataChangeNumber } },
  };
}
export type RulePreviewDecision = ReturnType<typeof rulePreviewDecision>;
export function ruleClosureConfirmation(
  days: readonly SavePreviewDay[],
  deleting: boolean,
  staff: readonly Pick<Staff, 'id' | 'name'>[],
) {
  const names = (ids: string[]) => ids.map((id) => staff.find((person) => person.id === id)!.name);
  return {
    title: deleting ? '毎年の休業日を削除しますか？' : '勤務を変えますか？',
    message:
      days.length === 0
        ? undefined
        : deleting
          ? '削除すると、作成済みのピリオドの、次の日が営業に戻り、既定の勤務が入ります。'
          : 'この休業日を保存すると、作成済みのピリオドの、次の日の勤務が変わります。',
    rows: [...days]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((day) => ({
        date: day.date,
        label: dayLabel(day.date),
        sections: [
          ...(day.remove.length
            ? [
                {
                  text: `${day.remove.length}人の勤務が消えます`,
                  names: names(day.remove),
                  keep: false,
                },
              ]
            : []),
          ...(day.add.length
            ? [
                {
                  text: `${day.add.length}人に既定の勤務が入ります`,
                  names: names(day.add),
                  keep: false,
                },
              ]
            : []),
          ...(day.paid_leave.length
            ? [
                {
                  text: '有給の人がいるため、変更しません',
                  names: names(day.paid_leave),
                  keep: true,
                },
              ]
            : []),
        ],
      })),
    after: days.some((day) => day.remove.length > 0) ? '消えた勤務は、元に戻りません。' : undefined,
    confirmLabel: deleting ? 'はい、削除する' : 'はい、保存する',
    cancelLabel: 'いいえ',
  };
}
