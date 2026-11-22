import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeftRight,
  ArrowRight,
  CalendarDays,
  Check,
  ClipboardList,
  Clock3,
  Plus,
  Tag,
  Trash2,
  Undo2,
  UserRound,
} from 'lucide-react';
import type { CurrentRevision, PeriodLoadResponse, WorkSlotTime } from '../../../shared/protocol';
import { allFacilitiesClosed } from '../../../shared/calendar';
import { historyForPeriod, movementRole } from '../../../shared/staff';
import { useAppFrame } from '../app/context';
import { Dialog, SaveButton, SaveConflictNotice, useDialogFocus } from '../parts/Dialog';
import { ConfirmDialog } from '../parts/ConfirmDialog';
import { SaveConflictDialog } from '../parts/SaveConflictDialog';
import { Reveal } from '../parts/Reveal';
import { Panel } from '../parts/Panel';
import { FieldGroup } from '../parts/FieldGroup';
import { RoleButtons } from '../parts/RoleButtons';
import { OfficeWorkSelector } from './OfficeWorkSelector';
import { Segmented } from '../parts/Segmented';
import { TimeField } from '../parts/TimeField';
import { TimeBar } from '../parts/TimeBar';
import { useSave } from '../saving/useSave';
import type { SaveInput } from '../saving/types';
import {
  cellCancel,
  cellChanged,
  cellSave,
  changeCellWork,
  chooseOffice,
  defaults,
  hasTime,
  initialCell,
  insertRequestedWork,
  movement,
  orderSlots,
  otherConfirmation,
  requestBanner,
  restoreRequestedShift,
  slotNames,
  slotOverlapProblem,
  slotProblem,
  toggleOffice,
  updateSlot,
  workBuildings,
  type CellContext,
  type CellForm,
} from './cell-model';
import { otherEditMark, staffCells } from './model';
import { OtherEditMark } from './ShiftCell';
import { WarningMark } from '../parts/icons';
import { dayLabel } from '../format/date';
import { shortTime } from '../format/time';
import {
  cellConflictDescription,
  cellConflictRevisions,
  cellConflictRows,
  comparedCell,
} from './cell-conflict';
import { closedFacilityDays } from './closed-facility';
import { ClosedFacilityNotice } from './ClosedFacilityNotice';

const statuses = ['勤務', '有給', '空'] as const,
  statusValues = ['none', 'paid_leave', 'empty'] as const;
function RequestBanner({
  banner,
  action,
  blocked,
  restore,
  insert,
}: {
  banner: NonNullable<ReturnType<typeof requestBanner>>;
  action: 'restored' | 'inserted' | null;
  blocked: boolean;
  restore: () => void;
  insert: () => void;
}) {
  return (
    <div className="rq-banner">
      <span className="ki">希</span>
      <div className="txt">
        <b>
          {action === 'restored'
            ? '元のシフトに戻しました。「保存する」で確定します。'
            : action === 'inserted'
              ? '希望の時間を入れました。「保存する」で確定します。'
              : banner.title}
        </b>
        <dl>
          <dt>希望</dt>
          <dd>
            {banner.request}
            {banner.memo && <small>（メモ：{banner.memo}）</small>}
          </dd>
          {banner.before && (
            <>
              <dt>元のシフト</dt>
              <dd>{banner.before}</dd>
            </>
          )}
          {banner.overlap && (
            <>
              <dt className="warn">重複</dt>
              <dd>{banner.overlap}</dd>
            </>
          )}
        </dl>
      </div>
      {banner.replaced && !action && (
        <button
          className="btn btn-sub btn-small"
          type="button"
          disabled={blocked}
          onClick={restore}
        >
          <Undo2 size={18} strokeWidth={2.2} />
          元のシフトに戻す
        </button>
      )}
      {banner.canInsert && !action && (
        <button className="btn btn-sub btn-small" type="button" disabled={blocked} onClick={insert}>
          <Plus size={18} strokeWidth={2.2} />
          この時間で勤務を入れる
        </button>
      )}
    </div>
  );
}
export function OtherShiftConfirmation({
  context,
  question,
  saving,
  open,
  close,
  confirm,
}: {
  context: CellContext;
  question: NonNullable<ReturnType<typeof otherConfirmation>>;
  saving: boolean;
  open: boolean;
  close: () => void;
  confirm: () => void;
}) {
  const bands = (slots: readonly WorkSlotTime[]) =>
    slots.length ? (
      slots.map((slot, index) => (
        <span className={`other-shift-band c${question.building}`} key={index}>
          <span className="daily-area">{slot.facility}</span>
          <span>
            {shortTime(slot.start_time)}〜{shortTime(slot.end_time)}
          </span>
          {slot.is_office && <span className="daily-role y">Y</span>}
        </span>
      ))
    ) : (
      <span className="other-shift-none">なし</span>
    );
  return (
    <ConfirmDialog
      title={question.title}
      subtitle={`${context.person.name} ／ ${dayLabel(context.date)}`}
      message={question.message}
      detail={
        <div className="other-shift-change">
          <div>
            <span className="name-badge">
              <UserRound size={18} strokeWidth={2.4} />
              {context.person.name}
            </span>
            <div className="other-shift-transition">
              <div className="other-shift-bands other-shift-before">
                {bands(question.beforeSlots)}
              </div>
              <ArrowRight size={22} />
              <div className="other-shift-bands">{bands(question.afterSlots)}</div>
            </div>
          </div>
        </div>
      }
      icon={<ArrowLeftRight size={24} />}
      cancelLabel="いいえ"
      confirmLabel="はい、書き換える"
      saving={saving}
      open={open}
      close={close}
      confirm={confirm}
    />
  );
}
export function CellDialog({
  context,
  close,
  reload,
}: {
  context: CellContext;
  close: () => void;
  reload: () => Promise<PeriodLoadResponse | undefined>;
}) {
  const focus = useDialogFocus();
  const frame = useAppFrame();
  const [otherEdit] = useState(() =>
    otherEditMark(
      context.person.id,
      context.date,
      context.building,
      frame.loading.kind === 'ready' ? frame.loading.data.identity.role : 'maintenance',
      context.data,
    ),
  );
  const [base, setBase] = useState(context);
  const [initial, setInitial] = useState(() => initialCell(context));
  const [form, setForm] = useState(initial.form);
  const [drawWarning, setDrawWarning] = useState<string | null>(null);
  const setWorkForm = (change: (current: CellForm) => CellForm) => {
    setDrawWarning(null);
    setForm((current) => changeCellWork(base, current, change(current)));
  };
  const [requestAction, setRequestAction] = useState<'restored' | 'inserted' | null>(null);
  const [workInitialized, setWorkInitialized] = useState(form.status === 'none');
  const [selected, setSelected] = useState(context.building === 1 ? 0 : 2);
  const selectSlot = (id: number) => {
    setDrawWarning(null);
    setSelected(id);
  };
  const [checked, setChecked] = useState<number[]>([]);
  const [startValid, setStartValid] = useState(true),
    [endValid, setEndValid] = useState(true);
  const [open, setOpen] = useState(true),
    [checking, setChecking] = useState(false),
    [replacement, setReplacement] = useState(0);
  const [conflicts, setConflicts] = useState<CurrentRevision[]>([]);
  const [comparison, setComparison] = useState<CellContext | null>(null);
  const [confirmation, setConfirmation] = useState<
    ({ input: SaveInput } & NonNullable<ReturnType<typeof otherConfirmation>>) | null
  >(null);
  const { save, saving, showSpinner, outcome } = useSave();
  const root = useRef<HTMLDivElement>(null),
    startRef = useRef<HTMLInputElement>(null),
    endRef = useRef<HTMLInputElement>(null);
  const conflictBase = useRef(base);
  const initialFocus = useCallback(
    () =>
      initial.form.status === 'none'
        ? startRef.current
        : root.current?.closest('.dlg')?.querySelector<HTMLButtonElement>('.dlg-close'),
    [initial.form.status, replacement],
  );
  useEffect(() => {
    if (outcome?.kind === 'saved') setOpen(false);
    if (outcome?.kind === 'conflict') {
      conflictBase.current = base;
      setConfirmation(null);
      setConflicts(outcome.conflicts);
    }
  }, [outcome]);
  const row = form.slots.find((slot) => slot.id === selected)!;
  const index = form.slots.indexOf(row),
    working = form.status === 'none';
  const populated = form.slots.filter(hasTime),
    office = populated.some((slot) => slot.is_office);
  const totalHours =
    populated.reduce(
      (sum, slot) =>
        sum +
        Number(slot.end_time.slice(0, 2)) * 60 +
        Number(slot.end_time.slice(3)) -
        Number(slot.start_time.slice(0, 2)) * 60 -
        Number(slot.start_time.slice(3)),
      0,
    ) / 60;
  const problems = form.slots.map((slot) => slotProblem(slot, form.slots));
  const invalid = working && (problems.some(Boolean) || !startValid || !endValid);
  const changed = cellChanged(form, initial.form, false);
  const history = historyForPeriod(base.person.history, base.periods, base.period.start_date)!;
  const restView = staffCells(
    base.person,
    base.period,
    base.periods,
    base.building,
    base.data,
    base.rules,
  ).get(base.date)!;
  const allClosed = allFacilitiesClosed(base.date, base.rules, base.data.facilityDays);
  const banner = requestBanner(base);
  const closed = closedFacilityDays(base, [{ date: base.date, slots: working ? form.slots : [] }]);
  const blocked = showSpinner || checking;
  const send = (input: SaveInput | null) => {
    if (!input || saving || checking) {
      if (!input && !saving && !checking) setOpen(false);
      return;
    }
    const question = otherConfirmation(
      base,
      input,
      frame.loading.kind === 'ready' ? frame.loading.data.identity.role : 'maintenance',
    );
    if (question) setConfirmation({ input, ...question });
    else void save(input);
  };
  const confirmOther = async () => {
    if (saving || checking) return;
    setChecking(true);
    try {
      const [data, first] = await Promise.all([reload(), frame.refresh()]);
      if (data && first.kind === 'ready') {
        const person = first.data.staff.find((person) => person.id === base.person.id);
        if (person) setComparison({ ...base, data, person });
      }
    } finally {
      setChecking(false);
    }
  };
  const qualification = { certified: '資格1', assistant: '資格2', none: 'なし' }[
    history.qualification
  ];
  const employment = { full_time: '常勤', part_time: '非常勤', casual: 'アルバイト' }[
    history.employment_type
  ];
  return (
    <>
      <Dialog
        title={`${dayLabel(base.date)} ${base.person.name}のシフト入力`}
        icon={null}
        className="cell-dialog"
        long
        changed={changed}
        open={open}
        close={close}
        initialFocus={initialFocus}
        initialScrollTo={
          closed.length ? { selector: '.cell-closed-facility', bottomGap: 16 } : undefined
        }
        header={
          <>
            <div className="cell-when">
              <span>
                <CalendarDays size={24} />
                {dayLabel(base.date)}
              </span>
              <span>
                <UserRound size={22} />
                {base.person.name}
              </span>
            </div>
            <Segmented
              value={form.status === null ? null : statuses[statusValues.indexOf(form.status)]}
              options={statuses}
              disabledOptions={allClosed ? ['有給'] : []}
              onChange={(status) => {
                const next = statusValues[statuses.indexOf(status)];
                setWorkForm((current) =>
                  next === 'none' && !workInitialized
                    ? { ...defaults(base, current), status: next }
                    : { ...current, status: next },
                );
                if (next === 'none') setWorkInitialized(true);
              }}
            />
          </>
        }
        notice={
          conflicts.length ? (
            <SaveConflictNotice
              disabled={blocked}
              confirmLabel="変更内容を確認"
              confirm={() => {
                void confirmOther();
              }}
            />
          ) : undefined
        }
        footerStart={
          <button
            className="btn btn-danger"
            type="button"
            disabled={blocked || !cellCancel(base)}
            onClick={() => send(cellCancel(base, conflicts))}
          >
            <Trash2 size={22} />
            シフトを取り消す
          </button>
        }
        footer={
          <SaveButton
            disabled={blocked || invalid}
            showSpinner={showSpinner}
            conflict={conflicts.length > 0}
            submit={() => {
              if (!invalid)
                send(
                  cellSave(base, form, initial.form, initial.seeded, conflicts, Boolean(otherEdit)),
                );
            }}
          />
        }
      >
        <div ref={root} className="cell-content" key={replacement}>
          <Reveal open={form.status === null} className="cell-rest-notice">
            <div className="notice info">
              <span>
                この日は、{restView.kind === 'closure' && '休業日の'}
                <span className="cell-rest-label">
                  {restView.kind === 'closure' ? restView.label : '公休'}
                </span>
                です。
              </span>
            </div>
          </Reveal>
          {banner && (
            <RequestBanner
              banner={banner}
              action={requestAction}
              blocked={blocked}
              restore={() => {
                setWorkForm((current) => restoreRequestedShift(current, banner.replaced!));
                setWorkInitialized(true);
                setRequestAction('restored');
                setChecked([]);
              }}
              insert={() => {
                const next = insertRequestedWork(base, form);
                setWorkForm(() => next);
                setWorkInitialized(true);
                setRequestAction('inserted');
                setChecked([]);
                selectSlot(next.slots.find(hasTime)!.id);
              }}
            />
          )}
          <div className="cell-upper">
            <Panel
              placement="inside"
              className="cell-section"
              contentClassName="cell-section-content"
              icon={<ClipboardList size={22} />}
              title="スタッフ情報"
            >
              <FieldGroup className="cell-kvs">
                <div className="cell-kv">
                  <span className="k">資格</span>
                  <span className="v">
                    {qualification}／{employment}
                  </span>
                </div>
                {otherEdit && (
                  <div className="cell-kv cell-other-edit">
                    <span className="k">変更</span>
                    <span className="v">
                      <OtherEditMark status />
                      <span>{otherEdit.who}が</span>
                      <span>{otherEdit.date}に変更</span>
                    </span>
                  </div>
                )}
                <label className="cell-note">
                  <span className="k">
                    備考 <small>（スタッフ情報と同じ）</small>
                  </span>
                  <textarea
                    className="field"
                    value={form.notes}
                    onChange={(event) => setForm({ ...form, notes: event.target.value })}
                  />
                </label>
              </FieldGroup>
            </Panel>
            <Panel
              placement="raised"
              className={`cell-section cell-work${working ? '' : ' cell-rest'}`}
              contentClassName="cell-section-content"
              inert={!working}
              icon={<Clock3 size={22} />}
              title="編集するシフト"
            >
              <FieldGroup className="cell-work-fields">
                <Segmented
                  options={slotNames}
                  value={slotNames[index]}
                  errors={slotNames.filter(
                    (_, i) => checked.includes(form.slots[i].id) && Boolean(problems[i]),
                  )}
                  prefix={(name) =>
                    form.slots[slotNames.indexOf(name)].is_office ? (
                      <i className="cell-office-dot" />
                    ) : null
                  }
                  onChange={(name) => selectSlot(form.slots[slotNames.indexOf(name)].id)}
                />
                <div
                  className="cell-times"
                  onChangeCapture={(event) => {
                    if (event.target instanceof HTMLInputElement) setDrawWarning(null);
                  }}
                  onBlurCapture={(event) => {
                    if (
                      !(event.target instanceof Element) ||
                      !event.target.closest('.time-field, .time-popup')
                    )
                      return;
                    if (
                      event.relatedTarget instanceof Element &&
                      ((event.currentTarget.contains(event.relatedTarget) &&
                        event.relatedTarget.closest('.time-field')) ||
                        event.relatedTarget.closest('.time-popup'))
                    )
                      return;
                    setChecked((current) => [...new Set([...current, selected])]);
                    setForm((current) => ({ ...current, slots: orderSlots(current.slots) }));
                  }}
                >
                  <TimeField
                    arrivalKey={selected}
                    label="出勤"
                    inputRef={startRef}
                    value={row.start_time}
                    onValidityChange={setStartValid}
                    onCommit={(start_time) =>
                      setWorkForm((current) => updateSlot(current, selected, { start_time }))
                    }
                    onConfirmed={() => focus(endRef.current)}
                  />
                  <TimeField
                    arrivalKey={selected}
                    label="退勤"
                    inputRef={endRef}
                    value={row.end_time}
                    onValidityChange={setEndValid}
                    onCommit={(end_time) =>
                      setWorkForm((current) => updateSlot(current, selected, { end_time }))
                    }
                  />
                  <div>
                    <span className="lab">担当</span>
                    <Segmented
                      value={row.facility}
                      options={row.building === 1 ? ['A', 'B'] : ['C', 'D']}
                      onChange={(facility) =>
                        setWorkForm((current) => updateSlot(current, selected, { facility }))
                      }
                    />
                  </div>
                </div>
                <Reveal
                  open={
                    working &&
                    Boolean(problems[index]) &&
                    (checked.includes(selected) ||
                      !form.slots.some((slot) => slot.start_time || slot.end_time) ||
                      Boolean(row.start_time && row.end_time && row.end_time <= row.start_time))
                  }
                >
                  <p className="cell-time-warning">
                    <WarningMark size={22} />
                    {problems[index]}
                  </p>
                </Reveal>
                <Reveal
                  open={closed.length > 0}
                  scrollToShow="target"
                  className="closed-facility-reveal cell-closed-facility"
                >
                  <ClosedFacilityNotice days={closed} />
                </Reveal>
              </FieldGroup>
            </Panel>
          </div>
          <Panel
            placement="inside"
            className={`cell-section${working ? '' : ' cell-rest'}`}
            inert={!working}
            icon={<ArrowLeftRight size={22} />}
            title="マウスで勤務時間を調整"
            headingEnd={
              <>
                <p className="cell-timebar-description">
                  帯を動かすか、左右の端をつかんで15分ごとに直せます。
                </p>
                <div className="cell-sum">
                  勤務時間 <b>{totalHours < 0 ? 'ー' : totalHours.toFixed(1)}</b>
                  {totalHours >= 0 && ' 時間'}
                </div>
              </>
            }
          >
            <TimeBar
              slots={form.slots}
              names={form.slots.map((_, index) => slotNames[index])}
              selected={selected}
              select={selectSlot}
              drawOverlap={(id) =>
                setDrawWarning(
                  id === null
                    ? null
                    : slotOverlapProblem(form.slots.findIndex((slot) => slot.id === id)),
                )
              }
              drawWarning={
                drawWarning && (
                  <p className="cell-time-warning">
                    <WarningMark size={22} />
                    {drawWarning}
                  </p>
                )
              }
              change={(slots) =>
                setWorkForm((current) =>
                  slots.reduce(
                    (next, slot) =>
                      updateSlot(next, slot.id, {
                        start_time: slot.start_time,
                        end_time: slot.end_time,
                      }),
                    current,
                  ),
                )
              }
              finish={() =>
                setForm((current) => ({ ...current, slots: orderSlots(current.slots) }))
              }
            />
          </Panel>
          <Reveal open={form.status !== null}>
            <Panel
              placement="inside"
              className={`cell-section${working && populated.length ? '' : ' cell-rest'}`}
              inert={!working || !populated.length}
              icon={<Tag size={22} />}
              title="役割と勤務情報"
            >
              <FieldGroup>
                <RoleButtons
                  value={form.roles}
                  onChange={(roles) => setForm({ ...form, roles })}
                  cell={{
                    office,
                    movement: movement(form),
                    allowedMovement: movementRole(workBuildings(form)),
                    toggleOffice: () => setForm(toggleOffice(form)),
                  }}
                />
                <OfficeWorkSelector
                  slots={form.slots}
                  choose={(id) => setForm(chooseOffice(form, id))}
                />
                <label className="chk cell-special-care">
                  <input
                    className="visually-hidden"
                    type="checkbox"
                    checked={form.specialCare}
                    onChange={(event) => setForm({ ...form, specialCare: event.target.checked })}
                  />
                  <span className={`cell-check${form.specialCare ? ' on' : ''}`}>
                    {form.specialCare && <Check size={20} />}
                  </span>
                  特別対応
                </label>
              </FieldGroup>
            </Panel>
          </Reveal>
        </div>
      </Dialog>
      {comparison && (
        <SaveConflictDialog
          rows={cellConflictRows(form, comparedCell(comparison).form)}
          description={cellConflictDescription(conflictBase.current, comparison)}
          target={
            <>
              <span>
                <CalendarDays size={24} />
                {dayLabel(comparison.date)}
              </span>
              <span>
                <UserRound size={22} />
                {comparison.person.name}
              </span>
            </>
          }
          close={() => setComparison(null)}
          keep={() => {
            setBase(comparison);
            setConflicts((current) => cellConflictRevisions(comparison, current));
            setComparison(null);
          }}
          take={() => {
            const initial = comparedCell(comparison);
            setBase(comparison);
            setInitial(initial);
            setForm(initial.form);
            setWorkInitialized(initial.form.status === 'none');
            setRequestAction(null);
            selectSlot(comparison.building === 1 ? 0 : 2);
            setChecked([]);
            setConflicts([]);
            setReplacement((value) => value + 1);
            setComparison(null);
          }}
        />
      )}
      {confirmation && (
        <OtherShiftConfirmation
          context={base}
          question={confirmation}
          saving={saving || checking}
          open={open}
          close={() => setConfirmation(null)}
          confirm={() => {
            if (!saving && !checking) void save(confirmation.input);
          }}
        />
      )}
    </>
  );
}
