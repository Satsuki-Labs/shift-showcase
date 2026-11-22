import type { DayState, Role, WorkSlot } from '../../../shared/protocol';

export function payExcelFileName(period: string, target: string, outputDate: string): string {
  return `${period}_給与管理_${target.replace(/[ 　]/g, '')}_${outputDate}.xlsx`;
}

export const shiftExcelKinds = {
  draft: '下書き',
  initial: '初版',
  revised: '修正版',
  backup: '控え',
} as const;
export function shiftExcelFileName(
  period: string,
  site: 1 | 2,
  kind: keyof typeof shiftExcelKinds,
  outputDate: string,
): string {
  return `${period}_${site === 1 ? '第一' : '第二'}_${shiftExcelKinds[kind]}_${outputDate}.xlsx`;
}

export const employmentTypes = [
  { value: 'full_time', label: '常勤' },
  { value: 'part_time', label: '非常勤' },
  { value: 'casual', label: 'アルバイト' },
] as const;
export const qualifications = [
  { value: 'certified', label: '資格1' },
  { value: 'assistant', label: '資格2' },
  { value: 'none', label: 'なし' },
] as const;
export const employmentStatuses = [
  { value: 'active', label: '在籍' },
  { value: 'leave', label: '休職' },
  { value: 'retired', label: '退職' },
] as const;

export const changedByLabels: Record<Role, string> = {
  first: '第一の担当者',
  second: '第二の担当者',
  maintenance: '保守担当',
};

export function workRoleLabels(
  state: Pick<DayState, 'roles'> | undefined,
  work: readonly Pick<WorkSlot, 'building' | 'slots'>[],
) {
  const topRoles = (
    [
      ['lead', '主'],
      ['deputy', '副'],
      ['closing', '閉'],
      ['prep', '準備'],
    ] as const
  )
    .filter(([role]) => state?.roles.includes(role))
    .map(([, label]) => label);
  const hasFirst = work.some((row) => row.building === 1),
    hasSecond = work.some((row) => row.building === 2);
  const movement =
    hasFirst && hasSecond
      ? 'Ⅰ→Ⅱ'
      : state?.roles.includes('movement_first')
        ? 'Ⅰ'
        : state?.roles.includes('movement_second')
          ? 'Ⅱ'
          : null;
  const bottomRoles = [
    work.some((row) => row.slots.some((slot) => slot.is_office)) ? 'Y' : null,
    movement,
    state?.roles.includes('temporary_absence') ? '抜' : null,
    state?.roles.includes('alpha') ? 'α' : null,
  ].filter((value): value is string => value !== null);
  return { topRoles, bottomRoles };
}
