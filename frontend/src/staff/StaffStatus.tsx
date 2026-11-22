import { DateField } from '../parts/DateField';
import { FieldGroup } from '../parts/FieldGroup';
import { Segmented } from '../parts/Segmented';
import { Reveal } from '../parts/Reveal';
import { statusProblem, type StaffForm } from './model';
import { WarningMark } from '../parts/icons';
import { employmentStatuses } from '../format/labels';

const statuses = employmentStatuses.map((option) => option.label);
const values = employmentStatuses.map((option) => option.value);
export function StaffStatus({
  form,
  onChange,
}: {
  form: StaffForm;
  onChange: (patch: Partial<StaffForm>) => void;
}) {
  const reason = statusProblem(form),
    message =
      reason === 'missing_date'
        ? form.employmentStatus === 'leave'
          ? '始まりの日を入れてください'
          : '退職日を入れてください'
        : reason === 'end_before_start'
          ? '終わりの見込みは、始まりより後の日にしてください'
          : '';
  return (
    <FieldGroup className="pair-cell staff-status">
      <span className="lab">在籍状況</span>
      <Segmented
        options={statuses}
        value={statuses[values.indexOf(form.employmentStatus)]}
        onChange={(value) => onChange({ employmentStatus: values[statuses.indexOf(value)] })}
      />
      <Reveal
        open={form.employmentStatus !== 'active'}
        scrollToShow="end"
        swap
        items={
          form.employmentStatus === 'active'
            ? []
            : [
                {
                  key: form.employmentStatus,
                  content: (
                    <div
                      className={`status-dates${form.employmentStatus === 'leave' ? ' status-dates-leave' : ''}`}
                    >
                      {form.employmentStatus === 'leave' ? (
                        <>
                          <DateField
                            label="始まり"
                            required
                            value={form.leaveStart}
                            onChange={(leaveStart) => onChange({ leaveStart })}
                          />
                          <DateField
                            label="終わりの見込み"
                            value={form.leaveEnd}
                            onChange={(leaveEnd) => onChange({ leaveEnd })}
                          />
                        </>
                      ) : (
                        <DateField
                          label="退職日"
                          required
                          value={form.retirementDate}
                          onChange={(retirementDate) => onChange({ retirementDate })}
                        />
                      )}
                    </div>
                  ),
                },
              ]
        }
      />
      <Reveal open={Boolean(message)} className="form-message">
        <div className="msg">
          <WarningMark size={22} />
          {message}
        </div>
      </Reveal>
    </FieldGroup>
  );
}
