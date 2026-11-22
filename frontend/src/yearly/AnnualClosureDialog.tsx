import type { AnnualRules } from '../../../shared/protocol';
import { RulePeriodDialog } from './RulePeriodDialog';

export function AnnualClosureDialog({
  year,
  before,
  close,
}: {
  year: number;
  before: AnnualRules['annualClosures'][number] | null;
  close: () => void;
}) {
  return <RulePeriodDialog kind="closure" year={year} before={before} close={close} />;
}
