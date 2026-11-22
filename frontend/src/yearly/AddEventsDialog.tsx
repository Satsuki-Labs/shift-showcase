import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { CalendarDays, ClipboardList, House, MessageSquare, Plus, X } from 'lucide-react';
import { fiscalYearEnd, fiscalYearLabel, fiscalYearStart } from '../../../shared/calendar';
import type {
  AnnualRules,
  CalendarRows,
  OpeningConflict,
  YearLoadResponse,
} from '../../../shared/protocol';
import { japanToday } from '../../../shared/staff';
import { addDays } from '../../../shared/date';
import { DateField } from '../parts/DateField';
import { Dialog, SaveButton, SaveConflictNotice, useDialogFocus } from '../parts/Dialog';
import { FieldGroup } from '../parts/FieldGroup';
import { Reveal } from '../parts/Reveal';
import { Segmented } from '../parts/Segmented';
import { TextField } from '../parts/TextField';
import { TimeField } from '../parts/TimeField';
import { usePressGuard } from '../parts/usePressGuard';
import { useSave } from '../saving/useSave';
import {
  buildingChoices,
  buildingNumbers,
  canAddEvent,
  currentEntries,
  eventInputProblems,
  eventOpeningConflicts,
  eventSaveInput,
  type EventInput,
  type PlannedEvent,
} from './event-model';
import { BuildingName } from './EventList';
import { dayLabel, monthDay } from '../format/date';
import { NumberUnits } from '../parts/NumberUnits';
import { DayDialog } from './DayDialog';
import { WarningMark } from '../parts/icons';
import { facilityBuilding, openingConflictFacility, openingConflictField } from './closure-confirm';

function existingHint(values: string[]): string {
  const names = [...new Set(values.filter(Boolean))];
  return names.length ? `「${names.join('」「')}」が入っています` : '';
}
function eventFormChanged(initial: EventInput, form: EventInput): boolean {
  return (
    form.date !== initial.date ||
    form.building !== initial.building ||
    form.event !== initial.event ||
    form.arrival !== initial.arrival ||
    form.memo !== initial.memo
  );
}
function EventOpeningConflictNotice({
  rows,
  arrival,
}: {
  rows: readonly OpeningConflict[];
  arrival: string;
}) {
  return (
    <div className="notice warn event-inline-notice">
      <WarningMark size={22} />
      <div>
        {rows
          .map(
            (row) =>
              `${dayLabel(row.date)}${openingConflictFacility(row)}の${openingConflictField(row)}時刻は、手で${row.time}に変えてあります。`,
          )
          .join('')}
        <br />
        受付開始時刻{arrival}では、営業の開始が締めより後になります。
      </div>
    </div>
  );
}
export function AddEventsDialog({
  year,
  data,
  rules,
  reload,
  close,
}: {
  year: number;
  data: CalendarRows;
  rules: AnnualRules;
  reload: () => Promise<YearLoadResponse | undefined>;
  close: () => void;
}) {
  const focus = useDialogFocus();
  const [form, setForm] = useState<EventInput>(() => {
    const today = japanToday(),
      start = fiscalYearStart(year),
      end = fiscalYearEnd(year);
    return {
      date: today >= start && today <= end ? today : start,
      building: '両方',
      event: '',
      arrival: '',
      memo: '',
    };
  });
  const initialForm = useRef(form);
  const formRef = useRef(form);
  formRef.current = form;
  const eventField = useRef<HTMLDivElement>(null),
    arrivalInput = useRef<HTMLInputElement>(null);
  const composing = useRef(false),
    serial = useRef(0);
  const [pending, setPending] = useState<PlannedEvent[]>([]);
  const removalGuard = usePressGuard();
  const [arrivalValid, setArrivalValid] = useState(true);
  const [repairDate, setRepairDate] = useState<string | null>(null);
  const [open, setOpen] = useState(true),
    [conflict, setConflict] = useState(false),
    [checking, setChecking] = useState(false);
  const { save, saving, showSpinner, outcome } = useSave();
  useEffect(() => {
    if (outcome?.kind === 'saved') setOpen(false);
    if (outcome?.kind === 'conflict') setConflict(true);
  }, [outcome]);
  const update = (patch: Partial<EventInput>) => {
    formRef.current = { ...formRef.current, ...patch };
    setForm(formRef.current);
  };
  const current = currentEntries(data, form.date, form.building);
  const times = [...new Set(current.map((row) => row.arrival).filter(Boolean))];
  const problems = eventInputProblems([...pending, form], data);
  const canAdd = arrivalValid && canAddEvent(form, data, pending);
  const openingConflicts = eventOpeningConflicts(
    [...pending, ...(canAdd ? [form] : [])],
    data,
    rules,
  );
  const conflictDate = openingConflicts[0]?.date;
  const dayConflicts = openingConflicts.filter((row) => row.date === conflictDate);
  const conflictInput = [...pending, ...(canAdd ? [form] : [])]
    .reverse()
    .find(
      (input) =>
        input.date === conflictDate &&
        input.arrival &&
        (input.building === '両方' ||
          input.building === facilityBuilding(dayConflicts[0].facility)),
    );
  const empty = !form.event.trim() && !form.memo.trim() && !form.arrival;
  const canSave =
    arrivalValid && !problems.event && !problems.memo && (canAdd || (empty && pending.length > 0));
  const continueInput = () => {
    const input = formRef.current;
    if (
      !arrivalValid ||
      !canAddEvent(input, data, pending) ||
      saving ||
      checking ||
      eventOpeningConflicts([...pending, input], data, rules).length
    )
      return;
    setPending((rows) => [
      ...rows,
      { ...input, event: input.event.trim(), memo: input.memo.trim(), id: ++serial.current },
    ]);
    const date = addDays(input.date, 1);
    update({
      date: date <= fiscalYearEnd(year) ? date : input.date,
      event: '',
      arrival: '',
      memo: '',
    });
    focus(eventField.current?.querySelector('input'));
  };
  const enter = (event: KeyboardEvent<HTMLElement>) => {
    if (
      event.key !== 'Enter' ||
      event.nativeEvent.isComposing ||
      event.nativeEvent.keyCode === 229 ||
      composing.current ||
      !(event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)
    )
      return;
    event.preventDefault();
    event.target.blur();
    continueInput();
  };
  const submit = async () => {
    if (saving || checking || !canSave || openingConflicts.length) return;
    const inputs = [...pending, ...(canAdd ? [form] : [])];
    let currentData: CalendarRows = data;
    if (conflict) {
      setChecking(true);
      try {
        const latest = await reload();
        if (!latest) return;
        currentData = latest;
      } finally {
        setChecking(false);
      }
    }
    const latestProblems = eventInputProblems(inputs, currentData);
    if (latestProblems.event || latestProblems.memo) return;
    await save(eventSaveInput(inputs, currentData, rules));
  };
  const plannedRows = useMemo(
    () =>
      pending
        .slice()
        .reverse()
        .map((row) => ({
          key: String(row.id),
          content: (
            <div className="event-planned-row">
              <div className="event-planned-top">
                <span>
                  <CalendarDays size={18} />
                  {dayLabel(row.date)}
                </span>
                <BuildingName choice={row.building} />
              </div>
              <button
                className="icon-button"
                type="button"
                onClick={() => {
                  if (removalGuard.blocked()) return;
                  removalGuard.restart();
                  setPending((rows) => rows.filter((item) => item.id !== row.id));
                }}
              >
                <X size={20} strokeWidth={2.6} />
              </button>
              <div>
                {(row.event || row.arrival) && (
                  <div className="event-planned-line">
                    <House size={18} />
                    <span title={row.event}>{row.event || '（今の行事）'}</span>
                    <b>{row.arrival}</b>
                  </div>
                )}
                {row.memo && (
                  <div className="event-planned-line memo">
                    <MessageSquare size={18} />
                    <span title={row.memo}>{row.memo}</span>
                  </div>
                )}
              </div>
            </div>
          ),
        })),
    [pending, removalGuard],
  );
  return (
    <>
      <Dialog
        title="行事を追加"
        subtitle={fiscalYearLabel(year)}
        icon={<Plus size={26} />}
        close={close}
        open={open}
        changed={pending.length > 0 || eventFormChanged(initialForm.current, form)}
        className={`event-add-dialog${pending.length ? ' multi' : ''}`}
        notice={conflict ? <SaveConflictNotice disabled={showSpinner || checking} /> : undefined}
        footerStart={
          <div className="event-foot-stack">
            <Reveal reserveSpace open={canAdd && !conflictDate}>
              <button
                className="btn btn-sub"
                type="button"
                disabled={showSpinner || checking}
                onClick={continueInput}
              >
                <Plus size={20} />
                続けて入力する
              </button>
            </Reveal>
            <Reveal reserveSpace open={Boolean(conflictDate)}>
              <button
                className="btn btn-sub"
                type="button"
                onClick={() => setRepairDate(conflictDate)}
              >
                <CalendarDays size={20} />
                {conflictDate && monthDay(conflictDate)}を開く
              </button>
            </Reveal>
          </div>
        }
        footer={
          <SaveButton
            disabled={!canSave || showSpinner || checking || Boolean(conflictDate)}
            showSpinner={showSpinner || checking}
            conflict={conflict}
            submit={() => {
              void submit();
            }}
          />
        }
      >
        <section
          className="sec event-add-fields"
          onKeyDown={enter}
          onCompositionStart={() => {
            composing.current = true;
          }}
          onCompositionEnd={() => {
            composing.current = false;
          }}
        >
          <FieldGroup>
            <div className="event-add-row">
              <DateField
                label="日付"
                required
                hideRequiredMark
                value={form.date}
                min={fiscalYearStart(year)}
                max={fiscalYearEnd(year)}
                onChange={(date) => {
                  if (date) update({ date });
                }}
              />
              <div className="event-building-choice">
                <div className="lab">建物</div>
                <Segmented
                  value={form.building}
                  options={buildingChoices}
                  onChange={(building) => update({ building })}
                  prefix={(choice) => (
                    <span className="event-building-name" aria-hidden="true">
                      {buildingNumbers(choice).map((building) => (
                        <i key={building} className={`dot ${building === 1 ? 'c1' : 'c2'}`} />
                      ))}
                    </span>
                  )}
                />
              </div>
            </div>
          </FieldGroup>
          <FieldGroup>
            <div className="day-event-row">
              <div className="day-event-field" ref={eventField}>
                <div className="lab day-heading">
                  <House size={20} />
                  行事
                  <em title={existingHint(current.map((row) => row.event))}>
                    {existingHint(current.map((row) => row.event))}
                  </em>
                </div>
                <TextField
                  label="追加する行事"
                  maxLength={100}
                  value={form.event}
                  placeholder="なし"
                  onChange={(event) => update({ event })}
                />
                {problems.event && (
                  <div className="form-message">
                    <div className="msg">
                      <WarningMark size={22} />
                      {problems.event}
                    </div>
                  </div>
                )}
              </div>
              <TimeField
                label="受付開始時刻（あれば）"
                value={form.arrival}
                inputRef={arrivalInput}
                placeholder={times.length === 1 ? times[0] : ''}
                onValidityChange={setArrivalValid}
                onConfirmed={() => focus(arrivalInput.current)}
                onCommit={(arrival) => update({ arrival })}
              />
            </div>
            <Reveal open={Boolean(conflictDate)} scrollToShow>
              <EventOpeningConflictNotice
                rows={dayConflicts}
                arrival={conflictInput?.arrival ?? form.arrival}
              />
            </Reveal>
            <div className="day-memo-field">
              <div className="lab day-heading">
                <MessageSquare size={20} />
                メモ
                <em title={existingHint(current.map((row) => row.memo))}>
                  {existingHint(current.map((row) => row.memo))}
                </em>
              </div>
              <TextField
                label="追加するメモ"
                maxLength={100}
                value={form.memo}
                placeholder="なし"
                onChange={(memo) => update({ memo })}
              />
              {problems.memo && (
                <div className="form-message">
                  <div className="msg">
                    <WarningMark size={22} />
                    {problems.memo}
                  </div>
                </div>
              )}
            </div>
          </FieldGroup>
        </section>
        <Reveal reserveSpace open={pending.length > 0} className="event-planned-wrap">
          <section className="sec event-planned">
            <h2 className="sec-t">
              <ClipboardList size={22} />
              追加する予定のもの
              <span>
                <NumberUnits>{`${pending.length}件`}</NumberUnits>
              </span>
            </h2>
            <div className="event-planned-scroll scrollbar-thin">
              <Reveal items={plannedRows} />
            </div>
          </section>
        </Reveal>
      </Dialog>
      {repairDate && (
        <DayDialog
          date={repairDate}
          data={data}
          rules={rules}
          reload={reload}
          conflictFacilities={openingConflicts
            .filter((row) => row.date === repairDate)
            .map((row) => row.facility)}
          close={() => setRepairDate(null)}
        />
      )}
    </>
  );
}
