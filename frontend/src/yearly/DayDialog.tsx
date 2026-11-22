import './yearly.css';
import { useEffect, useLayoutEffect, useRef, useState, type FocusEvent } from 'react';
import {
  CalendarDays,
  Clock,
  House,
  MessageSquare,
  MoveHorizontal,
  Trash2,
  UserRound,
} from 'lucide-react';
import { fiscalYearLabel, fiscalYearOf, type Facility } from '../../../shared/calendar';
import type { AnnualRules, CalendarRows, CurrentRevision } from '../../../shared/protocol';
import { useAppFrame } from '../app/context';
import { useLoadingIndicator } from '../loading/useLoadingIndicator';
import { Dialog, dialogScrollTop, SaveButton, SaveConflictNotice } from '../parts/Dialog';
import { ConfirmDialog } from '../parts/ConfirmDialog';
import { FieldHelp, FieldHelpContent } from '../parts/FieldHelp';
import { FieldGroup } from '../parts/FieldGroup';
import { SaveConflictDialog } from '../parts/SaveConflictDialog';
import { Reveal, scrollToShow } from '../parts/Reveal';
import { Panel } from '../parts/Panel';
import { Segmented } from '../parts/Segmented';
import { TextField } from '../parts/TextField';
import { TimeField } from '../parts/TimeField';
import { TimeSelect } from '../parts/TimeSelect';
import { useSave } from '../saving/useSave';
import {
  changeDayTime,
  changeArrival,
  dayDeleteInput,
  dayDeleteMessage,
  daySaveInput,
  eventProblem,
  facilityProblem,
  openingProblem,
  initialDay,
  type DayBuilding,
  type DayFacility,
} from './day-model';
import { FacilityBadge } from './format';
import {
  closureConfirmation,
  handlesPreviewError,
  needsDayPreview,
  type PreviewDecision,
} from './closure-confirm';
import { readDayPreview, repreviewDay } from './save-preview';
import type { SaveInput } from '../saving/types';
import { WarningMark } from '../parts/icons';
import { dayLabel } from '../format/date';
import { dayConflictRevisions, dayConflictRows, retainedDay } from './day-conflict';

const openingOptions = ['営業', '休業'] as const;
function leftFields(event: FocusEvent<HTMLDivElement>): boolean {
  const next = event.relatedTarget;
  return (
    !(next instanceof Node && event.currentTarget.contains(next)) &&
    !(next instanceof Element && next.closest('.time-popup'))
  );
}
function Warning({ children }: { children: string }) {
  return (
    <>
      <WarningMark size={22} />
      {children}
    </>
  );
}
function FacilityRow({ row, change }: { row: DayFacility; change: (row: DayFacility) => void }) {
  return (
    <div className="day-facility-row" data-facility={row.facility}>
      <FacilityBadge facility={row.facility} />
      <Segmented
        value={row.is_open ? '営業' : '休業'}
        options={openingOptions}
        onChange={(value) => {
          change({ ...row, is_open: value === '営業' });
        }}
      />
      <Reveal reserveSpace open={row.is_open} className="day-times">
        <div>
          <div className="day-time-pair">
            <TimeSelect
              value={row.start_time}
              allowed={(time) => !row.end_time || time < row.end_time}
              onCommit={(value) => change(changeDayTime(row, 'start_time', value))}
            />
            <span>〜</span>
            <TimeSelect
              value={row.end_time}
              allowed={(time) => !row.start_time || time > row.start_time}
              onCommit={(value) => change(changeDayTime(row, 'end_time', value))}
            />
          </div>
        </div>
      </Reveal>
    </div>
  );
}
function BuildingFields({
  date,
  group,
  data,
  rules,
  change,
  onValidityChange,
}: {
  date: string;
  group: DayBuilding;
  data: CalendarRows;
  rules: AnnualRules;
  change: (group: DayBuilding) => void;
  onValidityChange: (valid: boolean) => void;
}) {
  const name = group.building === 1 ? '第一' : '第二';
  const [checked, setChecked] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const showProblem = checked && eventProblem(group);
  const timeProblem = openingProblem(group.facilities);
  return (
    <Panel
      placement="raised"
      className={`day-building ${group.building === 1 ? 'first' : 'second'}`}
      icon={<i className={`dot ${group.building === 1 ? 'c1' : 'c2'}`} />}
      title={`${name}（${group.building === 1 ? 'A・B' : 'C・D'}）`}
    >
      <FieldHelpContent open={helpOpen}>
        <p>受付開始時刻を入れると、下の営業時間も変わります。</p>
        <p>手動で変更した時刻は、そのまま残ります。</p>
      </FieldHelpContent>
      <FieldGroup>
        <div
          className="day-event-row"
          onBlurCapture={(event) => {
            if (leftFields(event)) setChecked(true);
          }}
        >
          <div className="day-event-field">
            <div className={`lab day-heading${showProblem ? ' bad' : ''}`}>
              {showProblem ? (
                <Warning>行事を入れてください</Warning>
              ) : (
                <>
                  <House size={20} />
                  行事
                </>
              )}
            </div>
            <TextField
              label={`${name}の行事`}
              maxLength={100}
              value={group.event}
              placeholder="なし"
              onChange={(event) => change({ ...group, event })}
            />
          </div>
          <TimeField
            label="受付開始時刻（あれば）"
            labelEnd={
              <FieldHelp open={helpOpen} toggle={() => setHelpOpen((current) => !current)} />
            }
            value={group.arrival}
            onValidityChange={onValidityChange}
            onCommit={(arrival) => {
              if (arrival === group.arrival) return;
              change(changeArrival(date, group, arrival, data, rules));
            }}
          />
        </div>
        <div className="day-memo-field">
          <div className="lab day-heading">
            <MessageSquare size={20} />
            メモ
          </div>
          <TextField
            label={`${name}のメモ`}
            maxLength={100}
            value={group.memo}
            placeholder="なし"
            onChange={(memo) => change({ ...group, memo })}
          />
        </div>
      </FieldGroup>
      <FieldGroup className="day-opening-group">
        <div className={`lab day-heading${timeProblem ? ' bad' : ''}`}>
          {timeProblem ? (
            <Warning>{timeProblem}</Warning>
          ) : (
            <>
              <Clock size={20} />
              営業時間
            </>
          )}
        </div>
        {group.facilities.map((row) => (
          <FacilityRow
            key={row.facility}
            row={row}
            change={(next) =>
              change({
                ...group,
                facilities: group.facilities.map((item) =>
                  item.facility === next.facility ? next : item,
                ),
              })
            }
          />
        ))}
      </FieldGroup>
    </Panel>
  );
}
export function DayDialog({
  date,
  data,
  rules,
  close,
  reload,
  conflictFacilities,
  saved,
}: {
  date: string;
  data: CalendarRows;
  rules: AnnualRules;
  close: () => void;
  reload: () => Promise<CalendarRows | undefined>;
  conflictFacilities?: Facility[];
  saved?: () => void;
}) {
  const [base, setBase] = useState(data);
  const [initial, setInitial] = useState(() => initialDay(date, data, rules));
  const [form, setForm] = useState(initial);
  const [arrivalValid, setArrivalValid] = useState({ 1: true, 2: true });
  const contentStart = useRef<HTMLFieldSetElement>(null);
  const warningFacilities = form.flatMap((group) =>
    group.facilities.filter(facilityProblem).map((row) => row.facility),
  );
  const previousWarnings = useRef(warningFacilities);
  const stopWarningScroll = useRef<(() => void) | undefined>(undefined);
  useLayoutEffect(() => {
    const added = warningFacilities.filter(
      (facility) => !previousWarnings.current.includes(facility),
    );
    previousWarnings.current = warningFacilities;
    if (!added.length) return;
    stopWarningScroll.current?.();
    const body = contentStart.current!.closest<HTMLElement>('.dlg-body')!;
    const top = dialogScrollTop(body, {
      selector: added.map((facility) => `[data-facility="${facility}"]`).join(','),
      bottomGap: 16,
    });
    if (top !== undefined) stopWarningScroll.current = scrollToShow(body, top);
  });
  useLayoutEffect(() => () => stopWarningScroll.current?.(), []);
  const [changed, setChanged] = useState(false),
    [open, setOpen] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [conflicts, setConflicts] = useState<CurrentRevision[]>([]);
  const [comparison, setComparison] = useState<CalendarRows | null>(null);
  const [checking, setChecking] = useState(false),
    [replacement, setReplacement] = useState(0);
  const { loading } = useAppFrame();
  const [preview, setPreview] = useState<Exclude<PreviewDecision, { kind: 'save' }> | null>(null);
  const [previewRequest, setPreviewRequest] = useState<object | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const sequence = useRef(0),
    lastInput = useRef<SaveInput | null>(null);
  const { save, saving, showSpinner, outcome } = useSave({
    handlesInputError: handlesPreviewError,
  });
  const previewSpinner = useLoadingIndicator(previewRequest);
  const busy = saving || checking || previewRequest !== null;
  const spinner = showSpinner || previewSpinner;
  useEffect(
    () => () => {
      sequence.current++;
    },
    [],
  );
  const inspect = async (input: SaveInput, field?: string) => {
    const request = ++sequence.current;
    lastInput.current = input;
    setPreview(null);
    setPreviewError(null);
    setPreviewRequest({});
    const result = field
      ? await repreviewDay(field, date, input)
      : await readDayPreview(date, input);
    if (request !== sequence.current) return;
    setPreviewRequest(null);
    if (!result) return;
    if (result.kind === 'error') setPreviewError(result.message);
    else if (result.kind === 'save') void save(result.input);
    else setPreview(result);
  };
  useEffect(() => {
    if (outcome?.kind === 'saved') {
      setOpen(false);
      saved?.();
    }
    if (outcome?.kind === 'conflict') {
      setConfirming(false);
      setPreview(null);
      setConflicts(outcome.conflicts);
    }
    if (outcome?.kind === 'input-error' && handlesPreviewError(outcome.field) && lastInput.current)
      void inspect(lastInput.current, outcome.field);
  }, [outcome]);
  const invalid = form.some(
    (group) =>
      !arrivalValid[group.building] ||
      eventProblem(group) ||
      group.facilities.some(facilityProblem),
  );
  const submit = () => {
    if (busy || invalid) return;
    const input = daySaveInput(date, form, initial, base, conflicts);
    if (needsDayPreview(form, initial)) void inspect(input);
    else void save(input);
  };
  const confirmOther = async () => {
    if (busy) return;
    setChecking(true);
    try {
      const current = await reload();
      if (current) setComparison(current);
    } finally {
      setChecking(false);
    }
  };
  return (
    <>
      <Dialog
        title={dayLabel(date)}
        subtitle={fiscalYearLabel(fiscalYearOf(date))}
        icon={<CalendarDays size={26} />}
        className="day-dialog"
        long
        changed={changed}
        open={open}
        close={close}
        initialScrollTo={
          conflictFacilities?.length
            ? {
                selector: conflictFacilities
                  .map((facility) => `[data-facility="${facility}"]`)
                  .join(','),
                bottomGap: 16,
              }
            : undefined
        }
        notice={
          previewError ? (
            <div className="notice warn staff-conflict without-confirm">
              <WarningMark size={22} />
              <span>{previewError}</span>
            </div>
          ) : conflicts.length ? (
            <SaveConflictNotice
              disabled={busy}
              confirmLabel="変更内容を確認"
              confirm={() => {
                void confirmOther();
              }}
            />
          ) : undefined
        }
        footerStart={
          initial.some((group) => group.event || group.memo) && (
            <button
              className="btn btn-danger footer-delete"
              type="button"
              disabled={busy}
              onClick={() => setConfirming(true)}
            >
              <Trash2 size={22} />
              行事とメモを削除
            </button>
          )
        }
        footer={
          <SaveButton
            disabled={spinner || checking || previewRequest !== null || invalid}
            showSpinner={spinner}
            conflict={conflicts.length > 0}
            submit={submit}
          />
        }
      >
        {form.map((group) => (
          <fieldset
            ref={group.building === 1 ? contentStart : undefined}
            disabled={previewRequest !== null}
            className="day-fields"
            key={`${replacement}-${group.building}`}
            onChangeCapture={() => setChanged(true)}
          >
            <BuildingFields
              date={date}
              group={group}
              data={base}
              rules={rules}
              onValidityChange={(valid) =>
                setArrivalValid((current) =>
                  current[group.building] === valid
                    ? current
                    : { ...current, [group.building]: valid },
                )
              }
              change={(next) => {
                if (JSON.stringify(next) !== JSON.stringify(group)) setChanged(true);
                sequence.current++;
                setPreview(null);
                setPreviewRequest(null);
                setForm((current) =>
                  current.map((item) => (item.building === next.building ? next : item)),
                );
              }}
            />
          </fieldset>
        ))}
      </Dialog>
      {comparison && (
        <SaveConflictDialog
          rows={dayConflictRows(form, initialDay(date, comparison, rules))}
          target={
            <span>
              <CalendarDays size={24} />
              {dayLabel(date)}
            </span>
          }
          close={() => setComparison(null)}
          keep={() => {
            const next = initialDay(date, comparison, rules);
            setBase(comparison);
            setInitial(next);
            setForm(retainedDay(form, next));
            setConflicts((current) => dayConflictRevisions(comparison, current));
            setComparison(null);
          }}
          take={() => {
            const next = initialDay(date, comparison, rules);
            setBase(comparison);
            setInitial(next);
            setForm(next);
            setChanged(false);
            setConflicts([]);
            setPreviewError(null);
            setReplacement((value) => value + 1);
            setComparison(null);
          }}
        />
      )}
      {confirming && (
        <ConfirmDialog
          title="行事とメモを削除しますか？"
          subtitle={dayLabel(date)}
          message={dayDeleteMessage(initial)}
          icon={<Trash2 size={24} />}
          cancelLabel="いいえ"
          confirmLabel="はい、削除する"
          open={open}
          close={() => setConfirming(false)}
          saving={saving || checking}
          confirm={() => {
            if (!busy)
              void save(dayDeleteInput(date, initial, rules, base, conflicts), '削除しました');
          }}
        />
      )}
      {preview &&
        loading.kind === 'ready' &&
        (() => {
          const content = closureConfirmation(preview.day, loading.data.staff);
          const icon =
            content.kind === 'blocked' ? (
              <WarningMark size={26} />
            ) : content.kind === 'both' ? (
              <MoveHorizontal size={24} strokeWidth={2.4} />
            ) : (
              <svg
                width={24}
                height={24}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2.4}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx={12} cy={12} r={9} />
                <path d={content.kind === 'add' ? 'M8 12h8M12 8v8' : 'M8 12h8'} />
              </svg>
            );
          return (
            <ConfirmDialog
              className="closure-confirm"
              key={JSON.stringify(preview)}
              title={content.title}
              subtitle={dayLabel(date)}
              message={content.message}
              icon={icon}
              cancelLabel={content.cancelLabel}
              confirmLabel={content.confirmLabel}
              open={open}
              close={() => setPreview(null)}
              saving={busy}
              confirm={() => {
                if (!busy && preview.kind === 'confirm') void save(preview.input);
              }}
            >
              {content.sections.map((section, index) => (
                <div className="closure-part" key={index}>
                  {'text' in section && <p className="closure-section-title">{section.text}</p>}
                  <div className="closure-names">
                    {section.names.map((name, index) => (
                      <span className="name-badge" key={index}>
                        <UserRound size={18} strokeWidth={2.4} />
                        {name}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
              {'after' in content && <p className="closure-after">{content.after}</p>}
            </ConfirmDialog>
          );
        })()}
    </>
  );
}
