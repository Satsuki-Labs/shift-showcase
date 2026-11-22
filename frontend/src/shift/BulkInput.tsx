import { useLayoutEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import {
  Check,
  ClipboardList,
  MousePointerClick,
  Pencil,
  RotateCcw,
  Tag,
  Trash2,
} from 'lucide-react';
import { FieldGroup } from '../parts/FieldGroup';
import { Reveal } from '../parts/Reveal';
import { Segmented } from '../parts/Segmented';
import { TimeField } from '../parts/TimeField';
import { RoleButtons } from '../parts/RoleButtons';
import { WarningMark } from '../parts/icons';
import { useDialogFocus } from '../parts/Dialog';
import { MOVEMENT_ROLES, movementRole } from '../../../shared/staff';
import {
  chooseOffice,
  hasTime,
  slotNames,
  toggleOffice,
  type CellForm,
  type DefaultDayKind,
} from './cell-model';
import {
  bulkDefaultKindLabels,
  bulkDefaults,
  bulkDefaultKinds,
  bulkIsDefault,
  bulkMovement,
  bulkProblems,
  type BulkContext,
  type BulkDraft,
  type BulkMode,
  type BulkOperation,
  type BulkOptions,
  type BulkTarget,
} from './bulk-model';
import { OfficeWorkSelector } from './OfficeWorkSelector';
import './BulkInput.css';

const defaultKindOrder: readonly DefaultDayKind[] = ['normal', 'saturday', 'peak'];
const operations = [
  { value: 'insert', label: '入れる', icon: Pencil },
  { value: 'cancel', label: '取り消す', icon: Trash2 },
] as const;
function BulkCancelNotice({ mode }: { mode: BulkMode }) {
  return (
    <div className="notice warn bulk-cancel">
      <WarningMark size={22} />
      <div>
        {mode === 'roles' ? (
          <>
            <span>対象の日のシフトの役割のみを</span>
            <span>取り消します。</span>
            <br />
            <span>時刻は取り消されず、</span>
            <span>保持されます。</span>
          </>
        ) : (
          <>
            対象の日の時刻と役割を取り消します。
            <br />
            有給と空の日は、そのままです。
          </>
        )}
      </div>
    </div>
  );
}
export function BulkInput({
  context,
  target,
  options,
  operationChosen,
  modeChosen,
  chooseOperation,
  chooseMode,
  setDraft,
  setRoleSelection,
  setSpecialCare,
  slotIndex,
  setSlotIndex,
  onValidityChange,
}: {
  context: BulkContext;
  target: BulkTarget;
  options: BulkOptions;
  operationChosen: boolean;
  modeChosen: boolean;
  chooseOperation: (value: BulkOperation) => void;
  chooseMode: (value: BulkMode) => void;
  setDraft: Dispatch<SetStateAction<BulkDraft>>;
  setRoleSelection: Dispatch<SetStateAction<CellForm['roles']>>;
  setSpecialCare: Dispatch<SetStateAction<boolean>>;
  slotIndex: number;
  setSlotIndex: (value: number) => void;
  onValidityChange?: (valid: boolean) => void;
}) {
  const { operation, mode, draft, roleSelection, specialCare } = options;
  const focus = useDialogFocus(),
    endInput = useRef<HTMLInputElement>(null);
  const [timeFocused, setTimeFocused] = useState(false);
  const [startValid, setStartValid] = useState(true),
    [endValid, setEndValid] = useState(true);
  useLayoutEffect(() => {
    onValidityChange?.(startValid && endValid);
  }, [startValid, endValid, onValidityChange]);
  const initialDraft = bulkDefaults(context, target, draft.kind),
    isDefault = bulkIsDefault(draft, initialDraft);
  const slotId = draft.kind === 'saturday' ? 0 : (target - 1) * 2 + slotIndex;
  const slot = draft.slots[slotId],
    slotChoices = slotNames.slice((target - 1) * 2, target * 2);
  const availableKinds = bulkDefaultKinds(context),
    problems = bulkProblems(options),
    problem = problems[slotId];
  const timeMessage =
    timeFocused && problem === '出勤と退勤の両方を入れてください'
      ? null
      : problem?.includes('時間が重なっています')
        ? '1回目と2回目の時間が重なっています'
        : problem;
  const noDefault = !slot.start_time && !slot.end_time && !hasTime(initialDraft.slots[slotId]);
  const office = draft.slots.some((row) => hasTime(row) && row.is_office);
  const modeLabels =
    operation === 'insert' ? ['時刻と役割', '時刻だけ', '役割だけ'] : ['シフト', '役割だけ'];
  const modeValues: BulkMode[] =
    operation === 'insert' ? ['both', 'time', 'roles'] : ['both', 'roles'];
  const editTime = (change: { start_time?: string; end_time?: string }) =>
    setDraft((current) => ({
      ...current,
      slots: current.slots.map((row) => {
        const next = row.id === slotId ? { ...row, ...change } : row;
        return !next.start_time && !next.end_time ? { ...next, is_office: false } : next;
      }),
    }));
  return (
    <div className="bulk-input">
      <FieldGroup
        fitContent
        className={`bulk-operation-section${operation === 'cancel' ? ' danger' : ''}`}
      >
        <p className="sec-t">
          <MousePointerClick size={20} />
          1. 操作を選ぶ
        </p>
        <Segmented
          options={operations.map((row) => row.label)}
          value={operationChosen ? operations.find((row) => row.value === operation)!.label : null}
          prefix={(label) => {
            const Icon = operations.find((row) => row.label === label)!.icon;
            return <Icon size={20} />;
          }}
          onChange={(label) =>
            chooseOperation(operations.find((row) => row.label === label)!.value)
          }
        />
      </FieldGroup>
      <Reveal open={operationChosen} className="bulk-target-reveal">
        <FieldGroup
          fitContent
          className={`bulk-target-section${operation === 'cancel' ? ' danger' : ''}`}
        >
          <p className="sec-t">
            <Tag size={20} />
            2. 対象を選ぶ
          </p>
          <div className="bulk-mode">
            <Segmented
              options={modeLabels}
              value={modeChosen ? modeLabels[modeValues.indexOf(mode)] : null}
              onChange={(label) => chooseMode(modeValues[modeLabels.indexOf(label)])}
            />
          </div>
        </FieldGroup>
      </Reveal>
      {operationChosen && operation === 'cancel' && <BulkCancelNotice mode={mode} />}
      <Reveal open={modeChosen} scrollToShow="target" className="bulk-content-reveal">
        <section className="bulk-content-section">
          <Reveal
            swap
            items={[
              {
                key: `${operation}/${mode}`,
                content: (
                  <div
                    className={`bulk-input-panel${mode === 'roles' || operation === 'cancel' ? ' single' : ''}${operation === 'cancel' ? ' bulk-remove-roles' : ''}`}
                  >
                    {operation === 'insert' && mode !== 'roles' && (
                      <FieldGroup className="bulk-times">
                        <p className="sec-t">
                          <ClipboardList size={20} />
                          3. 入れる内容を選ぶ
                        </p>
                        <Reveal
                          swap
                          className="work-kind"
                          items={[
                            {
                              key: isDefault ? 'default' : 'edited',
                              content: isDefault ? (
                                <Segmented
                                  value={bulkDefaultKindLabels[draft.kind]}
                                  options={defaultKindOrder.map(
                                    (kind) => bulkDefaultKindLabels[kind],
                                  )}
                                  disabledOptions={defaultKindOrder
                                    .filter((kind) => !availableKinds.includes(kind))
                                    .map((kind) => bulkDefaultKindLabels[kind])}
                                  onChange={(label) => {
                                    const kind = defaultKindOrder.find(
                                      (kind) => bulkDefaultKindLabels[kind] === label,
                                    );
                                    if (kind) {
                                      setDraft(bulkDefaults(context, target, kind));
                                      setSlotIndex(0);
                                    }
                                  }}
                                />
                              ) : (
                                <button
                                  type="button"
                                  className="btn btn-sub back"
                                  onClick={() => setDraft(initialDraft)}
                                >
                                  <RotateCcw size={20} />
                                  既定のシフトに戻す
                                </button>
                              ),
                            },
                          ]}
                        />
                        <div className="site-slots">
                          <Reveal
                            swap
                            className="bulk-slot-choice"
                            items={
                              draft.kind === 'saturday'
                                ? [
                                    {
                                      key: 'saturday',
                                      content: <p className="sat">土曜の勤務は、Aに入ります。</p>,
                                    },
                                  ]
                                : [
                                    {
                                      key: 'rounds',
                                      content: (
                                        <Segmented
                                          options={slotChoices}
                                          value={slotNames[slotId]}
                                          errors={slotChoices.filter(
                                            (_, index) =>
                                              problems[(target - 1) * 2 + index] &&
                                              !(
                                                timeFocused &&
                                                index === slotIndex &&
                                                problems[slotId] ===
                                                  '出勤と退勤の両方を入れてください'
                                              ),
                                          )}
                                          onChange={(value) =>
                                            setSlotIndex(slotChoices.indexOf(value))
                                          }
                                        />
                                      ),
                                    },
                                  ]
                            }
                          />
                          <span className={`pill ${isDefault ? 'e1' : 'e3'} st`}>
                            {isDefault ? '既定のシフト' : '新しく入力'}
                          </span>
                        </div>
                        <div className="bulk-time-fields">
                          <div
                            className="time-fields"
                            onFocusCapture={() => setTimeFocused(true)}
                            onBlurCapture={(event) => {
                              if (!event.currentTarget.contains(event.relatedTarget))
                                setTimeFocused(false);
                            }}
                          >
                            <TimeField
                              arrivalKey={`${draft.kind}/${slotId}`}
                              label="出勤"
                              value={slot.start_time}
                              onValidityChange={setStartValid}
                              onCommit={(start_time) => editTime({ start_time })}
                              onConfirmed={
                                !slot.end_time ? () => focus(endInput.current) : undefined
                              }
                            />
                            <TimeField
                              arrivalKey={`${draft.kind}/${slotId}`}
                              label="退勤"
                              inputRef={endInput}
                              value={slot.end_time}
                              onValidityChange={setEndValid}
                              onCommit={(end_time) => editTime({ end_time })}
                            />
                          </div>
                          <Reveal
                            open={Boolean(timeMessage) || noDefault}
                            className="bulk-time-message"
                          >
                            {timeMessage ? (
                              <div className="msg">
                                <WarningMark size={22} />
                                {timeMessage}
                              </div>
                            ) : (
                              <p className="bulk-none-note">既定のシフトはありません。</p>
                            )}
                          </Reveal>
                        </div>
                      </FieldGroup>
                    )}
                    {(operation === 'insert' || mode === 'roles') && (
                      <FieldGroup className="bulk-input-right">
                        <Reveal
                          className="bulk-input-details"
                          items={[
                            ...(operation === 'insert' &&
                            mode !== 'roles' &&
                            draft.kind !== 'saturday'
                              ? [
                                  {
                                    key: 'assignment',
                                    content: (
                                      <section className="bulk-assignment">
                                        <span className="lab">担当区分</span>
                                        <Segmented
                                          value={slot.facility}
                                          options={target === 1 ? ['A', 'B'] : ['C', 'D']}
                                          onChange={(facility) =>
                                            setDraft((current) => ({
                                              ...current,
                                              slots: current.slots.map((row) =>
                                                row.building === target
                                                  ? { ...row, facility }
                                                  : row,
                                              ),
                                            }))
                                          }
                                        />
                                      </section>
                                    ),
                                  },
                                ]
                              : []),
                            ...(mode !== 'time'
                              ? [
                                  {
                                    key: 'roles',
                                    content: (
                                      <section className="bulk-roles">
                                        <p className="sec-t">役割</p>
                                        <RoleButtons
                                          value={mode === 'roles' ? roleSelection : draft.roles}
                                          bulkMovement={
                                            mode === 'roles'
                                              ? movementRole([target])
                                              : bulkMovement(context, target, draft.kind)
                                          }
                                          remove={operation === 'cancel'}
                                          office={
                                            mode === 'both'
                                              ? {
                                                  enabled: office,
                                                  toggle: () =>
                                                    setDraft((current) => toggleOffice(current)),
                                                }
                                              : undefined
                                          }
                                          onChange={(roles) =>
                                            mode === 'roles'
                                              ? setRoleSelection(roles)
                                              : setDraft((current) => ({
                                                  ...current,
                                                  roles,
                                                  manualMovement:
                                                    current.manualMovement ||
                                                    MOVEMENT_ROLES.some(
                                                      (role) =>
                                                        current.roles.includes(role) !==
                                                        roles.includes(role),
                                                    ),
                                                }))
                                          }
                                        />
                                        {mode === 'both' && (
                                          <OfficeWorkSelector
                                            slots={draft.slots}
                                            choose={(id) =>
                                              setDraft((current) => chooseOffice(current, id))
                                            }
                                          />
                                        )}
                                        {mode === 'roles' && operation === 'insert' && (
                                          <label className="chk cell-special-care">
                                            <input
                                              className="visually-hidden"
                                              type="checkbox"
                                              checked={specialCare}
                                              onChange={(event) =>
                                                setSpecialCare(event.target.checked)
                                              }
                                            />
                                            <span
                                              className={`cell-check${specialCare ? ' on' : ''}`}
                                            >
                                              {specialCare && <Check size={20} />}
                                            </span>
                                            特別対応
                                          </label>
                                        )}
                                      </section>
                                    ),
                                  },
                                ]
                              : []),
                          ]}
                        />
                      </FieldGroup>
                    )}
                  </div>
                ),
              },
            ]}
          />
        </section>
      </Reveal>
    </div>
  );
}
