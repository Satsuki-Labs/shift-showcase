import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { CalendarClock, List } from 'lucide-react';
import type { DefaultWorkTimes } from '../../../shared/staff';
import { Reveal, type RevealItem } from '../parts/Reveal';
import { Segmented } from '../parts/Segmented';
import { TimeField } from '../parts/TimeField';
import { RoleButtons } from '../parts/RoleButtons';
import { FieldGroup } from '../parts/FieldGroup';
import {
  formAssignments,
  getWorkSlot,
  kindKeys,
  setWorkSlot,
  workKinds,
  workProblem,
  workSlots,
  type StaffForm,
  type WorkSlot,
  type WorkProblem,
} from './model';
import { WarningMark } from '../parts/icons';

const problemMessages: Record<WorkProblem, string> = {
  missing_time: '出勤と退勤の両方を入れてください',
  invalid_order: '退勤は、出勤より後の時刻にしてください',
  overlap: '1回目と2回目の時間が重なっています',
  building_overlap: '第一と第二の時間が重なっています',
};
const slotGroups = [
  workSlots({ default_first_facility: 'A', default_second_facility: null }),
  workSlots({ default_first_facility: null, default_second_facility: 'C' }),
];
const slotNumbers = ['1回目', '2回目'] as const;

export function DefaultShifts({
  form,
  checkedTimes,
  onChange,
  onCommit,
  onValidityChange,
}: {
  form: StaffForm;
  checkedTimes: DefaultWorkTimes;
  onChange: (patch: Partial<StaffForm>) => void;
  onCommit: (times: DefaultWorkTimes) => void;
  onValidityChange?: (valid: boolean) => void;
}) {
  const person = formAssignments(form);
  const slots = workSlots(person);
  const [kindName, setKindName] = useState<(typeof workKinds)[number]>('平日');
  const [slot, setSlot] = useState<WorkSlot>(slots[0]);
  const [timeFocused, setTimeFocused] = useState(false);
  const [startValid, setStartValid] = useState(true);
  const [endValid, setEndValid] = useState(true);
  useLayoutEffect(() => {
    onValidityChange?.(startValid && endValid);
  }, [startValid, endValid, onValidityChange]);
  const endInput = useRef<HTMLInputElement>(null);
  const kind = kindKeys[kindName];
  const selected = slots.includes(slot) ? slot : slots[0];
  const time = getWorkSlot(form.workTimes, kind, selected);
  const problem = (category: typeof kind, choice: WorkSlot) => {
    const reason = workProblem(checkedTimes, category, choice, person);
    return timeFocused && category === kind && choice === selected && reason === 'missing_time'
      ? null
      : reason;
  };
  const reason = problem(kind, selected);
  const message = reason === null ? '' : problemMessages[reason];
  const rows = useMemo(() => {
    const result: RevealItem[] = [];
    for (const name of workKinds) {
      const category = kindKeys[name];
      let first = true;
      for (const choice of category === 'saturday' ? [slots[0]] : slots) {
        const value = getWorkSlot(checkedTimes, category, choice);
        if (!value.start || !value.end) continue;
        result.push({
          key: `${category}/${choice === slots[0] && category === 'saturday' ? 'A' : choice}`,
          content: (
            <div className={`work-row${first ? ' head' : ''}${result.length === 0 ? ' top' : ''}`}>
              <span className="kind-t">{name}</span>
              <i
                className={`dot ${category !== 'saturday' && choice.startsWith('第二') ? 'c2' : 'c1'}`}
              />
              <span className="w">{category === 'saturday' ? 'A' : choice}</span>
              <span className="t">
                <span className="work-start">{value.start.replace(/^0/, '')}</span>〜
                {value.end.replace(/^0/, '')}
                {workProblem(checkedTimes, category, choice, person) && <WarningMark size={18} />}
              </span>
            </div>
          ),
        });
        first = false;
      }
    }
    return result.length
      ? result
      : [{ key: 'none', content: <p className="work-none">まだ登録されていません</p> }];
  }, [checkedTimes, form.firstFacility, form.secondFacility]);
  const edit = (field: 'start' | 'end', value: string) => {
    const next = setWorkSlot(form.workTimes, kind, selected, { ...time, [field]: value });
    onCommit(next);
  };
  return (
    <div className="staff-editor-columns">
      <div className="sec-wrap">
        <p className="sec-t">
          <CalendarClock size={22} strokeWidth={2.2} />
          既定のシフト
        </p>
        <section className="sec staff-default-fields">
          <FieldGroup>
            <div className="work-kind">
              <Segmented
                options={workKinds}
                value={kindName}
                onChange={(value) => {
                  onCommit(form.workTimes);
                  setKindName(value);
                }}
              />
            </div>
            <div className="site-slots">
              <Reveal
                swap
                items={
                  kind === 'saturday'
                    ? [
                        {
                          key: 'saturday',
                          content: <p className="sat">土曜はAで働く（第二の人も同じ）</p>,
                        },
                      ]
                    : [
                        {
                          key: slots.join('/'),
                          content:
                            slots.length === 4 ? (
                              <div className="slot-split">
                                {slotGroups.map((choices, index) => (
                                  <div key={index} className="site-choice">
                                    <span className="site-label">
                                      {index === 0 ? '第一' : '第二'}
                                    </span>
                                    <Segmented
                                      options={slotNumbers}
                                      value={
                                        choices.includes(selected)
                                          ? slotNumbers[choices.indexOf(selected)]
                                          : null
                                      }
                                      errors={slotNumbers.filter((_, at) =>
                                        problem(kind, choices[at]),
                                      )}
                                      onChange={(value) => {
                                        onCommit(form.workTimes);
                                        setSlot(choices[slotNumbers.indexOf(value)]);
                                      }}
                                    />
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <Segmented
                                options={slots}
                                value={selected}
                                errors={slots.filter((choice) => problem(kind, choice))}
                                onChange={(value) => {
                                  onCommit(form.workTimes);
                                  setSlot(value);
                                }}
                              />
                            ),
                        },
                      ]
                }
              />
            </div>
          </FieldGroup>
          <FieldGroup className="staff-default-content">
            <div>
              <div
                className="time-fields"
                onFocusCapture={() => setTimeFocused(true)}
                onBlurCapture={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget)) setTimeFocused(false);
                }}
              >
                <TimeField
                  arrivalKey={`${kind}/${selected}`}
                  label="出勤"
                  value={time.start}
                  onValidityChange={setStartValid}
                  onCommit={(value) => edit('start', value)}
                  onConfirmed={
                    !time.end ? () => endInput.current?.focus({ preventScroll: true }) : undefined
                  }
                />
                <TimeField
                  arrivalKey={`${kind}/${selected}`}
                  inputRef={endInput}
                  label="退勤"
                  value={time.end}
                  onValidityChange={setEndValid}
                  onCommit={(value) => edit('end', value)}
                />
              </div>
              <Reveal open={Boolean(message)} className="form-message">
                <div className="msg">
                  <WarningMark size={22} />
                  {message}
                </div>
              </Reveal>
            </div>
            <div className="role-in-shift">
              <span className="lab">役割</span>
              <RoleButtons value={form.roles} onChange={(roles) => onChange({ roles })} />
            </div>
          </FieldGroup>
        </section>
      </div>
      <div className="sec-wrap staff-registered">
        <p className="sec-t">
          <List size={22} strokeWidth={2.2} />
          登録されている既定の勤務時間
        </p>
        <section className="sec">
          <Reveal items={rows} scrollToShow />
        </section>
      </div>
    </div>
  );
}
