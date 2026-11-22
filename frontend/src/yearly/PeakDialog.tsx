import type { AnnualRules } from '../../../shared/protocol';
import { RulePeriodDialog } from './RulePeriodDialog';
import type { RuleCalendar } from './client';

export function PeakDialog({
  year,
  before,
  close,
  rules,
  calendar,
}: {
  year: number;
  before: AnnualRules['peaks'][number] | null;
  close: () => void;
  rules: AnnualRules;
  calendar: RuleCalendar;
}) {
  return (
    <RulePeriodDialog
      kind="break"
      year={year}
      before={before}
      close={close}
      rules={rules}
      calendar={calendar}
    />
  );
}
