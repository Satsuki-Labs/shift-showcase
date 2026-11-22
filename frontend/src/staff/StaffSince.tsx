import { SelectBox, type SelectOption } from '../parts/SelectBox';
import type { SinceChange } from './since';
import { WarningMark } from '../parts/icons';

export function StaffSince({
  change,
  value,
  options,
  noOptions,
  onChange,
}: {
  change: SinceChange;
  value: string;
  options: readonly SelectOption<string>[];
  noOptions: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div className={`since-row${noOptions ? ' since-no-options' : ''}`}>
      <span className="what">{change.label}</span>
      {noOptions ? (
        <>
          <span className="lab">いつから適用するか</span>
          <div className="since-warning">
            <WarningMark size={22} />
            先に、次のピリオドを作ってください
          </div>
        </>
      ) : (
        <SelectBox label="いつから適用するか" value={value} options={options} onChange={onChange} />
      )}
    </div>
  );
}
