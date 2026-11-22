import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, CalendarDays, ClipboardList, Eye, Save, UserRound } from 'lucide-react';
import type {
  CurrentRevision,
  PeriodLoadResponse,
  ShiftBulkChangedData,
} from '../../../shared/protocol';
import { useAppFrame } from '../app/context';
import { Dialog, SaveConflictNotice } from '../parts/Dialog';
import { Reveal } from '../parts/Reveal';
import { FieldGroup } from '../parts/FieldGroup';
import { WarningMark } from '../parts/icons';
import { monthDay } from '../format/date';
import { periodDates } from '../../../shared/period';
import type { SaveInput } from '../saving/types';
import { useSave } from '../saving/useSave';
import { usePressGuard } from '../parts/usePressGuard';
import { hasTime, type CellForm } from './cell-model';
import {
  bulkBlockedDates,
  bulkCalendarDays,
  bulkClosedFacilities,
  bulkDefaults,
  bulkDefaultKinds,
  bulkRefreshDraft,
  bulkPreview,
  bulkProblems,
  bulkSelection,
  bulkUnavailableReason,
  bulkUndo,
  excludeBulkConflicts,
  type BulkContext,
  type BulkMode,
  type BulkOperation,
  type BulkOptions,
  type BulkTarget,
} from './bulk-model';
import { BulkInput } from './BulkInput';
import { BulkCalendar, BulkLegend } from './BulkCalendar';
import { BulkReview, type BulkReviewState } from './BulkReview';
import { BulkSummary } from './BulkSummary';
import { ClosedFacilityNotice } from './ClosedFacilityNotice';

export function BulkDialog({
  context,
  target,
  close,
  reload,
  openStaff,
  appear = true,
}: {
  context: BulkContext;
  target: BulkTarget;
  close: () => void;
  reload: () => Promise<PeriodLoadResponse | undefined>;
  openStaff: () => void;
  appear?: boolean;
}) {
  const frame = useAppFrame();
  const [operation, setOperation] = useState<BulkOperation>('insert');
  const [operationChosen, setOperationChosen] = useState(false),
    [modeChosen, setModeChosen] = useState(false);
  const [screen, setScreen] = useState<'input' | 'dates'>('input');
  const [mode, setMode] = useState<BulkMode>('both');
  const [roleSelection, setRoleSelection] = useState<CellForm['roles']>([]),
    [specialCare, setSpecialCare] = useState(false);
  const [selectedDates, setSelected] = useState<string[]>([]),
    [draft, setDraft] = useState(() =>
      bulkDefaults(context, target, bulkDefaultKinds(context)[0] ?? 'normal'),
    );
  const [selectionPreset, setSelectionPreset] = useState<0 | 1 | null>(null);
  const [slotIndex, setSlotIndex] = useState(0);
  const [timeValid, setTimeValid] = useState(true);
  const reviewPressGuard = usePressGuard();
  const [explanation, setExplanation] = useState<string | null>(null);
  const clearExplanation = () => setExplanation(null);
  const calendar = useMemo(
    () => bulkCalendarDays(context, { target, operation, mode }),
    [context, target, operation, mode],
  );
  const selected = bulkSelection(selectedDates, calendar);
  useEffect(() => {
    setSelected((current) => {
      const next = bulkSelection(current, calendar);
      return next.length === current.length ? current : next;
    });
  }, [calendar]);
  const [review, setReview] = useState<BulkReviewState | null>(null);
  const [done, setDone] = useState<'saved' | 'undone' | null>(null),
    [skipped, setSkipped] = useState<string[]>([]);
  const [checking, setChecking] = useState(false),
    [open, setOpen] = useState(true);
  const [conflicts, setConflicts] = useState<CurrentRevision[]>([]);
  const { save, saving, outcome } = useSave();
  const undo = useRef<SaveInput | null>(null),
    pending = useRef<'save' | 'undo'>('save');
  const latestReview = useRef(review);
  latestReview.current = review;
  const previousOutcome = useRef(outcome);
  const blocked = saving || checking;
  const previousStaff = useRef(context.person);
  useEffect(() => {
    if (previousStaff.current.revision === context.person.revision) return;
    const previousPerson = previousStaff.current;
    previousStaff.current = context.person;
    setDraft((current) =>
      bulkRefreshDraft(
        context,
        target,
        current,
        bulkDefaults({ ...context, person: previousPerson }, target, current.kind),
      ),
    );
  }, [context, target]);
  useEffect(() => {
    if (!outcome || previousOutcome.current === outcome) return;
    previousOutcome.current = outcome;
    if (outcome.kind === 'saved') {
      setConflicts([]);
      if (pending.current === 'save' && latestReview.current) {
        const current = latestReview.current;
        undo.current = bulkUndo(
          current.context,
          current.preview,
          (outcome.data as unknown as ShiftBulkChangedData).cells,
        );
        setDone('saved');
      } else {
        undo.current = null;
        setDone('undone');
        void reload();
      }
    } else if (outcome.kind === 'conflict') {
      if (pending.current === 'undo' && undo.current) {
        const remaining = excludeBulkConflicts(undo.current, outcome.conflicts);
        setSkipped((current) => [...new Set([...current, ...remaining.dates])].sort());
        undo.current = remaining.input;
        if (remaining.input) void save(remaining.input);
        else {
          setDone('undone');
          void reload();
        }
      } else setConflicts(outcome.conflicts);
    }
  }, [outcome, reload, save]);
  const options: BulkOptions = {
    target,
    operation,
    mode,
    selected,
    draft,
    roleSelection,
    specialCare,
  };
  const closed = bulkClosedFacilities(context, options);
  const dates = periodDates(context.period),
    locked = bulkBlockedDates(context);
  const selectableDates = bulkSelection(dates, calendar);
  const presets = [
    selectableDates.filter((date) => new Date(`${date}T00:00:00Z`).getUTCDay() !== 6),
    selectableDates,
  ];
  const activePreset =
    selectionPreset !== null &&
    selected.length > 0 &&
    selected.length === presets[selectionPreset].length &&
    presets[selectionPreset].every((date) => selected.includes(date))
      ? selectionPreset
      : null;
  const problems = bulkProblems(options),
    invalid = problems.some(Boolean) || (operation === 'insert' && mode !== 'roles' && !timeValid);
  const empty =
    mode === 'roles'
      ? !roleSelection.length && !(operation === 'insert' && specialCare)
      : operation === 'insert' && !draft.slots.some(hasTime);
  const showReview = () => {
    if (blocked || invalid || empty || !selected.length) return;
    reviewPressGuard.restart();
    setReview({ context, options, preview: bulkPreview(context, options) });
  };
  const send = () => {
    if (reviewPressGuard.blocked() || blocked || !review?.preview.input || conflicts.length) return;
    pending.current = 'save';
    void save(review.preview.input);
  };
  const refresh = async () => {
    if (blocked || !review) return;
    setChecking(true);
    try {
      const [data, first] = await Promise.all([reload(), frame.refresh()]);
      if (!data || first.kind !== 'ready') return;
      const person = first.data.staff.find((row) => row.id === context.person.id);
      if (!person) return;
      const next = { ...context, data, person };
      const options = {
        ...review.options,
        draft: bulkRefreshDraft(
          next,
          target,
          review.options.draft,
          bulkDefaults(review.context, target, review.options.draft.kind),
        ),
      };
      setDraft(options.draft);
      setReview({ context: next, options, preview: bulkPreview(next, options) });
      setConflicts([]);
    } finally {
      setChecking(false);
    }
  };
  const excludeGroup = (groupDates: readonly string[], excluded: boolean) => {
    if (blocked || done || !review) return;
    const dates = review.options.excludedDates ?? [];
    const options = {
      ...review.options,
      excludedDates: excluded
        ? [...new Set([...dates, ...groupDates])]
        : dates.filter((date) => !groupDates.includes(date)),
    };
    setReview({ ...review, options, preview: bulkPreview(review.context, options) });
  };
  const ready = operationChosen && modeChosen && !invalid && !empty;
  const stage = review ? 'review' : screen;
  const changes = review?.preview.days.filter((day) => day.input).length ?? 0;
  return (
    <Dialog
      title={`${context.person.name}さんの一括入力`}
      icon={<ClipboardList size={26} />}
      className="bulk"
      long
      appear={appear}
      resetScrollOn={stage}
      changed={operationChosen}
      subtitle={`${context.period.name}（${monthDay(context.period.start_date)}〜${monthDay(context.period.end_date)}）`}
      close={close}
      open={open}
      dismissible={!blocked}
      hideClose={blocked}
      notice={
        conflicts.length ? (
          <SaveConflictNotice
            disabled={blocked}
            confirm={() => {
              void refresh();
            }}
            confirmLabel="変更内容を見直す"
          />
        ) : !review && screen === 'dates' && explanation ? (
          <div className="notice warn bulk-calendar-explanation">
            <WarningMark size={22} />
            <span>{explanation}</span>
          </div>
        ) : undefined
      }
      footerStart={
        review ? (
          !done && (
            <button
              type="button"
              className="btn btn-sub bulk-review-button"
              disabled={blocked}
              onClick={() => {
                setReview(null);
                setConflicts([]);
              }}
            >
              <ArrowLeft size={20} />
              選び直す
            </button>
          )
        ) : screen === 'dates' ? (
          <button
            type="button"
            className="btn btn-sub bulk-review-button"
            disabled={blocked}
            onClick={() => {
              clearExplanation();
              setScreen('input');
            }}
          >
            <ArrowLeft size={20} />
            入力内容に戻る
          </button>
        ) : (
          <button
            className="btn btn-sub bulk-staff-button"
            type="button"
            disabled={blocked}
            onClick={openStaff}
          >
            <UserRound size={20} />
            スタッフ情報を開く
          </button>
        )
      }
      footer={
        done ? (
          <button
            className="btn btn-sub bulk-review-button"
            type="button"
            disabled={blocked}
            onClick={() => setOpen(false)}
          >
            閉じる
          </button>
        ) : review ? (
          <button
            type="button"
            className={`btn ${operation === 'cancel' ? 'btn-danger' : 'btn-main'}`}
            disabled={blocked || !changes || Boolean(conflicts.length)}
            onClick={send}
          >
            <Save size={22} />
            {operation === 'cancel' ? 'この内容で取り消す' : 'この内容で保存する'}
          </button>
        ) : screen === 'dates' ? (
          <button
            type="button"
            className="btn btn-main"
            disabled={blocked || !selected.length || !ready}
            onClick={showReview}
          >
            <Eye size={20} />
            変更内容を見る
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-main"
            disabled={blocked || !ready}
            onClick={() => setScreen('dates')}
          >
            <CalendarDays size={20} />
            対象日を選ぶ
          </button>
        )
      }
    >
      <Reveal
        swap
        items={[
          {
            key: stage,
            content: (
              <div inert={blocked}>
                {review ? (
                  <BulkReview
                    review={review}
                    done={done}
                    skipped={skipped}
                    blocked={blocked}
                    dates={dates}
                    excludeGroup={excludeGroup}
                    undo={undo.current}
                    restore={() => {
                      if (blocked || !undo.current) return;
                      pending.current = 'undo';
                      void save(undo.current);
                    }}
                  />
                ) : screen === 'input' ? (
                  <BulkInput
                    context={context}
                    target={target}
                    options={options}
                    operationChosen={operationChosen}
                    modeChosen={modeChosen}
                    onValidityChange={setTimeValid}
                    slotIndex={slotIndex}
                    setSlotIndex={setSlotIndex}
                    setDraft={setDraft}
                    setRoleSelection={setRoleSelection}
                    setSpecialCare={setSpecialCare}
                    chooseOperation={(value) => {
                      if (operationChosen && operation === value) return;
                      clearExplanation();
                      setOperation(value);
                      setOperationChosen(true);
                      setModeChosen(false);
                      setMode('both');
                      setRoleSelection([]);
                      setSpecialCare(false);
                    }}
                    chooseMode={(value) => {
                      clearExplanation();
                      setMode(value);
                      setModeChosen(true);
                      setRoleSelection([]);
                      setSpecialCare(false);
                    }}
                  />
                ) : (
                  <div className="bulk-dates">
                    <FieldGroup className="bulk-calendar-section">
                      <p className="sec-t">
                        <CalendarDays size={20} />
                        対象の日を選ぶ
                      </p>
                      <div className="bulk-calendar">
                        <div className="bulk-pick-row">
                          <div className="pick">
                            <span className="pk-lab">まとめて選択：</span>
                            {['平日', '月〜土', '選択を外す'].map((label, index) => (
                              <button
                                type="button"
                                className={`btn ${activePreset === index ? 'btn-main' : 'btn-sub'} btn-small`}
                                key={label}
                                onClick={() => {
                                  clearExplanation();
                                  const preset =
                                    index === 2 || activePreset === index
                                      ? null
                                      : index === 0
                                        ? 0
                                        : 1;
                                  setSelectionPreset(preset);
                                  setSelected(preset === null ? [] : presets[preset]);
                                }}
                              >
                                {label}
                              </button>
                            ))}
                          </div>
                          <span className="bulk-selection-count">
                            <b>{selected.length}</b>日間を選択中
                          </span>
                        </div>
                        <BulkCalendar
                          legend={<BulkLegend />}
                          dates={dates}
                          blocked={locked}
                          calendar={calendar}
                          selected={selected}
                          choose={(date) => {
                            const day = calendar.get(date)!,
                              reason = bulkUnavailableReason(date, day, operation, mode, context);
                            clearExplanation();
                            if (reason) setExplanation(reason);
                            else if (day.selectable)
                              setSelected((current) =>
                                current.includes(date)
                                  ? current.filter((value) => value !== date)
                                  : [...current, date],
                              );
                          }}
                        />
                      </div>
                    </FieldGroup>
                    <div className="bulk-date-side">
                      <BulkSummary options={options} />
                      <Reveal
                        open={closed.length > 0}
                        scrollToShow="target"
                        className="closed-facility-reveal"
                      >
                        <ClosedFacilityNotice days={closed} />
                      </Reveal>
                    </div>
                  </div>
                )}
              </div>
            ),
          },
        ]}
      />
    </Dialog>
  );
}
