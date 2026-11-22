import { budgetOverages } from '../../../shared/pay';

export function budgetNotification(input: Parameters<typeof budgetOverages>[0]): string | null {
  const over = budgetOverages(input);
  if (!over.length) return null;
  return `${input.period.name}　${over[0].name}さん${over.length > 1 ? ` ほか${over.length - 1}人` : ''}`;
}
