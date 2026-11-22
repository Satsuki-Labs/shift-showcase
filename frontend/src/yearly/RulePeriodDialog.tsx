import { Fragment, useEffect, useRef, useState } from 'react';
import { CalendarDays, LockKeyhole, Sun, Trash2, UserRound } from 'lucide-react';
import { fiscalYearEnd, fiscalYearOf, fiscalYearStart } from '../../../shared/calendar';
import type {
  AnnualRules,
  CalendarRows,
  OpeningConflict,
  Revision,
  RevisionTarget,
} from '../../../shared/protocol';
import { japanToday } from '../../../shared/staff';
import { ConfirmDialog } from '../parts/ConfirmDialog';
import { DateField } from '../parts/DateField';
import { Dialog, SaveButton, SaveConflictNotice } from '../parts/Dialog';
import { SaveConflictDialog } from '../parts/SaveConflictDialog';
import { conflictRows } from '../parts/save-conflict';
import { TextField } from '../parts/TextField';
import { FieldGroup } from '../parts/FieldGroup';
import { useSave } from '../saving/useSave';
import { getSavePresentation } from '../saving/presentation';
import type { SaveInput } from '../saving/types';
import { useAppFrame } from '../app/context';
import { useLoadingIndicator } from '../loading/useLoadingIndicator';
import { Reveal } from '../parts/Reveal';
import {
  handlesOpeningConflict,
  handlesRuleInputError,
  handlesRulePreviewError,
  openingConflictConfirmation,
  openingConflictFacility,
  openingConflictField,
  openingConflictMessage,
  ruleClosureConfirmation,
  type RulePreviewDecision,
} from './closure-confirm';
import {
  previewMessages,
  readOpeningConflictPreview,
  readRulePreview,
  repreviewRule,
} from './save-preview';
import { WarningMark } from '../parts/icons';
import { dateRange, monthDay } from '../format/date';
import { DayDialog } from './DayDialog';
import type { RuleCalendar } from './client';

type Break = AnnualRules['peaks'][number];
type Closure = AnnualRules['annualClosures'][number];
function periodTarget(row: Break | Closure): RevisionTarget {
  return 'start_date' in row
    ? { unit: 'peak', startDate: row.start_date, endDate: row.end_date }
    : {
        unit: 'annual-closure',
        startMonth: row.start_month,
        startDay: row.start_day,
        endMonth: row.end_month,
        endDay: row.end_day,
      };
}
type Props = { year: number; close: () => void } & (
  | { kind: 'break'; before: Break | null; rules: AnnualRules; calendar: RuleCalendar }
  | { kind: 'closure'; before: Closure | null }
);
function closureDate(year: number, month: number, day: number) {
  return `${month >= 4 ? year : year + 1}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
function peakProblem(
  name: string,
  start: string | null,
  end: string | null,
  before: Break | null,
  rows: readonly Break[],
): string {
  if (!name.trim()) return '名前を入れてください。';
  if (!start || !end || end < start) return '';
  const others = rows.filter(
    (row) => !before || row.start_date !== before.start_date || row.end_date !== before.end_date,
  );
  if (others.some((row) => row.start_date === start && row.end_date === end))
    return '同じ期間の繁忙期が、すでにあります。';
  return others.some((row) => row.start_date <= end && start <= row.end_date)
    ? 'ほかの繁忙期と期間が重なっています。'
    : '';
}
function OpeningConflictContent({
  rows,
  loadingDate,
  openDay,
  error,
}: {
  rows: OpeningConflict[];
  loadingDate: string | null;
  openDay: (date: string) => void;
  error: string | null;
}) {
  const content = openingConflictConfirmation(rows);
  return (
    <>
      <p className="confirm-message rule-opening-conflict-message">{content.message}</p>
      <ul className="rule-change-days rule-opening-conflicts">
        {content.rows.map((row) => (
          <li key={row.date}>
            <b>{row.label}</b>
            <div className="rule-opening-conflict-row">
              <span className="rule-day-text">
                {row.facilities.map((item, index) => (
                  <Fragment key={item.facility}>
                    <span>
                      {openingConflictFacility(item)}　{openingConflictField(item)}
                      {item.time}
                      {index < row.facilities.length - 1 ? '、' : ''}
                    </span>
                  </Fragment>
                ))}
              </span>
              <button
                className="btn btn-sub btn-small"
                type="button"
                disabled={loadingDate !== null}
                onClick={() => openDay(row.date)}
              >
                {loadingDate === row.date ? (
                  <span className="spinner dark" />
                ) : (
                  <CalendarDays size={18} />
                )}
                {monthDay(row.date)}を開く
              </button>
            </div>
          </li>
        ))}
      </ul>
      <Reveal open={error !== null} className="rule-preview-notice">
        <div className="notice warn">
          <WarningMark size={22} />
          <span>{error}</span>
        </div>
      </Reveal>
    </>
  );
}
export function RulePeriodDialog(props: Props) {
  const { year, close, kind } = props,
    isBreak = kind === 'break',
    word = isBreak ? '繁忙期' : '毎年の休業日';
  const [before, setBefore] = useState<Break | Closure | null>(props.before);
  const initialStart =
    before === null
      ? null
      : 'start_date' in before
        ? before.start_date
        : closureDate(year, before.start_month, before.start_day);
  const initialEnd =
    before === null
      ? null
      : 'end_date' in before
        ? before.end_date
        : closureDate(year, before.end_month, before.end_day);
  const [name, setName] = useState(before?.name ?? ''),
    [start, setStart] = useState(initialStart),
    [end, setEnd] = useState(initialEnd);
  const [checked, setChecked] = useState(false);
  const [changed, setChanged] = useState(false),
    [open, setOpen] = useState(true),
    [confirming, setConfirming] = useState(false);
  const { loading, refresh, saving: saveWindow } = useAppFrame();
  const offlinePreview = useRef<string | null>(null);
  const clearOfflinePreview = () => {
    if (saveWindow && offlinePreview.current)
      getSavePresentation(saveWindow).receive({
        kind: 'discarded',
        operationId: offlinePreview.current,
      });
    offlinePreview.current = null;
  };
  const showPreviewError = (message: string, input: SaveInput) => {
    if (message !== previewMessages.offline) {
      setPreviewError(message);
      setOpeningError(message);
      return;
    }
    if (!saveWindow) return;
    clearOfflinePreview();
    const operationId = crypto.randomUUID();
    offlinePreview.current = operationId;
    const presentation = getSavePresentation(saveWindow);
    presentation.requested(operationId, input.label, Date.now());
    presentation.receive({
      kind: 'state',
      pending: { operationId, label: input.label, state: { kind: 'offline' } },
    });
  };
  const [revisions, setRevisions] = useState(() =>
    loading.kind === 'ready' ? loading.data.annualRuleRevisions : undefined,
  );
  const [conflict, setConflict] = useState(false),
    [checking, setChecking] = useState(false);
  const [comparison, setComparison] = useState<{
    row: Break | Closure | null;
    revisions: Revision[];
  } | null>(null);
  const [preview, setPreview] = useState<Exclude<RulePreviewDecision, { kind: 'error' }> | null>(
    null,
  );
  const [openingPreview, setOpeningPreview] = useState<{
    input: SaveInput;
    rows: OpeningConflict[];
  } | null>(null);
  const [openingError, setOpeningError] = useState<string | null>(null);
  const [repair, setRepair] = useState<{
    date: string;
    data: CalendarRows;
    facilities: OpeningConflict['facility'][];
  } | null>(null);
  const [loadingDate, setLoadingDate] = useState<string | null>(null);
  const daySaved = useRef(false);
  const [previewRequest, setPreviewRequest] = useState<{ deleting: boolean } | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const sequence = useRef(0),
    lastInput = useRef<SaveInput | null>(null);
  const { save, saving, showSpinner, outcome } = useSave({
    handlesInputError: isBreak ? handlesOpeningConflict : handlesRuleInputError,
  });
  const previewSpinner = useLoadingIndicator(previewRequest);
  const busy = saving || checking || previewRequest !== null || !revisions;
  const ruleRevisions = (after: Break | Closure | null): Revision[] => {
    const targets = [before, after]
      .filter((row): row is Break | Closure => row !== null)
      .map(periodTarget);
    const unique = [...new Map(targets.map((target) => [JSON.stringify(target), target])).values()];
    return unique.map((target) => ({
      target,
      revision:
        before && JSON.stringify(target) === JSON.stringify(periodTarget(before))
          ? (revisions?.find((item) => JSON.stringify(item.target) === JSON.stringify(target))
              ?.revision ?? null)
          : null,
    }));
  };
  const confirmOther = async () => {
    if (busy) return;
    setChecking(true);
    try {
      const result = await refresh();
      if (result.kind !== 'ready' || !result.data.annualRuleRevisions) return;
      const target = before ? periodTarget(before) : lastInput.current?.revisions[0]?.target;
      const rows = isBreak ? result.data.annualRules.peaks : result.data.annualRules.annualClosures;
      setComparison({
        row:
          rows.find((row) => JSON.stringify(periodTarget(row)) === JSON.stringify(target)) ?? null,
        revisions: result.data.annualRuleRevisions,
      });
    } finally {
      setChecking(false);
    }
  };
  const deleting = (input: SaveInput) => (input.data as { after: unknown }).after === null;
  const saveRule = (input: SaveInput) => {
    clearOfflinePreview();
    lastInput.current = input;
    void save(input, deleting(input) ? '削除しました' : undefined);
  };
  const inspectOpenings = async (input: SaveInput) => {
    const request = ++sequence.current;
    clearOfflinePreview();
    setOpeningError(null);
    setPreviewRequest({ deleting: deleting(input) });
    const result = await readOpeningConflictPreview(input);
    if (request !== sequence.current) return;
    setPreviewRequest(null);
    if (result.kind === 'error') {
      showPreviewError(result.message, input);
    } else setOpeningPreview(result.rows.length ? { input, rows: result.rows } : null);
  };
  const openRepair = async (date: string) => {
    if (props.kind !== 'break' || !openingPreview || loadingDate !== null || busy) return;
    const facilities = openingPreview.rows
      .filter((row) => row.date === date)
      .map((row) => row.facility);
    const request = ++sequence.current;
    setLoadingDate(date);
    setOpeningError(null);
    const data =
      fiscalYearOf(date) === year && props.calendar.data
        ? props.calendar.data
        : await props.calendar.reload(date);
    if (request !== sequence.current) return;
    setLoadingDate(null);
    if (!data) {
      showPreviewError(previewMessages.offline, openingPreview.input);
      return;
    }
    daySaved.current = false;
    setRepair({ date, data, facilities });
  };
  const closeRepair = async () => {
    if (props.kind !== 'break' || !repair) return;
    const date = repair.date;
    setRepair(null);
    if (!daySaved.current || !openingPreview) return;
    const request = ++sequence.current;
    setLoadingDate(date);
    setOpeningError(null);
    const data = await props.calendar.reload(date);
    if (request !== sequence.current) return;
    if (!data) {
      setLoadingDate(null);
      showPreviewError(previewMessages.offline, openingPreview.input);
      return;
    }
    await inspectOpenings(openingPreview.input);
    setLoadingDate(null);
  };
  const inspect = async (input: SaveInput, field?: string) => {
    const request = ++sequence.current;
    clearOfflinePreview();
    lastInput.current = input;
    setPreview(null);
    setPreviewError(null);
    setPreviewRequest({ deleting: deleting(input) });
    const result = field ? await repreviewRule(field, input) : await readRulePreview(input);
    if (request !== sequence.current) return;
    setPreviewRequest(null);
    if (!result) return;
    if (result.kind === 'error') showPreviewError(result.message, input);
    else if (result.kind === 'save') saveRule(result.input);
    else setPreview(result);
  };
  useEffect(
    () => () => {
      sequence.current++;
      clearOfflinePreview();
    },
    [saveWindow],
  );
  useEffect(() => {
    if (outcome?.kind === 'saved') setOpen(false);
    if (outcome?.kind === 'conflict') {
      setConflict(true);
      setConfirming(false);
      setPreview(null);
      setOpeningPreview(null);
    }
    if (
      outcome?.kind === 'input-error' &&
      handlesOpeningConflict(outcome.field) &&
      lastInput.current
    ) {
      if (isBreak) {
        setConfirming(false);
        void inspectOpenings(lastInput.current);
      } else {
        setPreview(null);
        setPreviewError(openingConflictMessage);
      }
    }
    if (
      !isBreak &&
      outcome?.kind === 'input-error' &&
      handlesRulePreviewError(outcome.field) &&
      lastInput.current
    )
      void inspect(lastInput.current, outcome.field);
  }, [outcome]);
  const invalid = Boolean(start && end && end < start),
    today = japanToday();
  const breakProblem =
    props.kind === 'break'
      ? peakProblem(name, start, end, before as Break | null, props.rules.peaks)
      : '';
  const emptyMonth = (
    today >= fiscalYearStart(year) && today <= fiscalYearEnd(year) ? today : fiscalYearStart(year)
  ).slice(0, 7);
  const icon = isBreak ? <Sun size={24} /> : <LockKeyhole size={24} />;
  const label = name.trim() || word;
  const operation = isBreak ? 'calendar.peak.save' : 'calendar.annual-closure.save';
  const changedInput = () => {
    clearOfflinePreview();
    setChanged(true);
    sequence.current++;
    setPreview(null);
    setPreviewRequest(null);
    setPreviewError(null);
  };
  const changeDate = (side: 'start' | 'end', value: string | null) => {
    changedInput();
    (side === 'start' ? setStart : setEnd)(value);
  };
  const range = initialStart && initialEnd ? dateRange(initialStart, initialEnd) : '';
  const submit = () => {
    setChecked(true);
    if (busy || !start || !end || invalid || breakProblem) return;
    clearOfflinePreview();
    const after: Break | Closure = isBreak
      ? { start_date: start, end_date: end, name: name.trim() }
      : {
          start_month: Number(start.slice(5, 7)),
          start_day: Number(start.slice(8)),
          end_month: Number(end.slice(5, 7)),
          end_day: Number(end.slice(8)),
          name: name.trim(),
        };
    const input = {
      operation,
      revisions: ruleRevisions(after),
      data: { before, after, ...(!isBreak ? { confirmed: null } : {}) },
      label,
    };
    if (isBreak) saveRule(input);
    else void inspect(input);
  };
  const fields = (
    <section className="period-rule-fields">
      <FieldGroup>
        <div onBlurCapture={() => setChecked(true)}>
          <TextField
            label="名前"
            maxLength={20}
            value={name}
            placeholder={isBreak ? '例：年末の繁忙期' : '例：お盆'}
            onChange={(value) => {
              changedInput();
              setName(value);
            }}
          />
        </div>
        {checked && breakProblem === '名前を入れてください。' && (
          <div className="form-message">
            <div className="msg">
              <WarningMark size={22} />
              {breakProblem}
            </div>
          </div>
        )}
      </FieldGroup>
      <FieldGroup>
        <div className="period-dates">
          <DateField
            label="開始日"
            value={start}
            onChange={(value) => changeDate('start', value)}
            required
            hideRequiredMark
            monthDayOnly={!isBreak}
            emptyMonth={emptyMonth}
            min={isBreak ? undefined : fiscalYearStart(year)}
            max={isBreak ? undefined : fiscalYearEnd(year)}
            stableCalendarPosition
          />
          <div className="period-end">
            <div className="lab period-end-heading">
              {invalid && isBreak ? (
                <span className="msg">
                  <WarningMark size={22} />
                  終了日が開始日より前になっています
                </span>
              ) : (
                '終了日'
              )}
            </div>
            <DateField
              label="終了日"
              value={end}
              onChange={(value) => changeDate('end', value)}
              required
              hideRequiredMark
              monthDayOnly={!isBreak}
              emptyMonth={emptyMonth}
              min={isBreak ? undefined : fiscalYearStart(year)}
              max={isBreak ? undefined : fiscalYearEnd(year)}
              stableCalendarPosition
            />
          </div>
        </div>
        {invalid && !isBreak && (
          <div className="form-message">
            <div className="msg">
              <WarningMark size={22} />
              毎年の休業日は、4月1日から3月31日の中で入れてください。
            </div>
          </div>
        )}
        {breakProblem && breakProblem !== '名前を入れてください。' && (
          <div className="form-message">
            <div className="msg">
              <WarningMark size={22} />
              {breakProblem}
            </div>
          </div>
        )}
      </FieldGroup>
    </section>
  );
  return (
    <>
      <Dialog
        title={`${word}を${before ? '編集' : '追加'}`}
        icon={icon}
        className="period-rule-dialog"
        changed={changed}
        open={open}
        close={close}
        notice={
          conflict ? (
            <SaveConflictNotice
              disabled={busy}
              confirmLabel="変更内容を確認"
              confirm={() => {
                void confirmOther();
              }}
            />
          ) : undefined
        }
        footer={
          <>
            {before && (
              <button
                className="btn btn-danger footer-delete"
                type="button"
                disabled={busy}
                onClick={() => {
                  if (isBreak) setConfirming(true);
                  else
                    void inspect({
                      operation,
                      revisions: ruleRevisions(null),
                      data: { before, after: null, confirmed: null },
                      label: before.name || word,
                    });
                }}
              >
                {previewSpinner && previewRequest?.deleting ? (
                  <span className="spinner dark" />
                ) : (
                  <Trash2 size={22} />
                )}
                削除
              </button>
            )}
            <SaveButton
              disabled={busy || !start || !end || invalid || Boolean(breakProblem)}
              showSpinner={showSpinner || (previewSpinner && !previewRequest?.deleting)}
              conflict={conflict}
              submit={submit}
            />
          </>
        }
      >
        {isBreak ? (
          fields
        ) : (
          <fieldset className="day-fields" disabled={previewRequest !== null}>
            {fields}
          </fieldset>
        )}
        <Reveal open={previewError !== null} scrollToShow className="rule-preview-notice">
          <div className="notice warn">
            <WarningMark size={22} />
            <span>{previewError}</span>
          </div>
        </Reveal>
      </Dialog>
      {confirming && before && (
        <ConfirmDialog
          title={`${word}を削除しますか？`}
          subtitle={before.name ? `${before.name}（${range}）` : range}
          icon={icon}
          open={open}
          close={() => setConfirming(false)}
          cancelLabel="いいえ"
          confirmLabel="はい、削除する"
          saving={saving}
          confirm={() => {
            saveRule({
              operation,
              revisions: ruleRevisions(null),
              data: { before, after: null, ...(!isBreak ? { confirmed: null } : {}) },
              label: before.name || word,
            });
          }}
        />
      )}
      {comparison && (
        <SaveConflictDialog
          target={word}
          rows={conflictRows([
            { label: '名前', yours: name, theirs: comparison.row?.name ?? '' },
            {
              label: '開始日',
              yours: start ?? '',
              theirs: comparison.row
                ? 'start_date' in comparison.row
                  ? comparison.row.start_date
                  : closureDate(year, comparison.row.start_month, comparison.row.start_day)
                : '',
            },
            {
              label: '終了日',
              yours: end ?? '',
              theirs: comparison.row
                ? 'end_date' in comparison.row
                  ? comparison.row.end_date
                  : closureDate(year, comparison.row.end_month, comparison.row.end_day)
                : '',
            },
          ])}
          close={() => setComparison(null)}
          keep={() => {
            setBefore(comparison.row);
            setRevisions(comparison.revisions);
            setComparison(null);
          }}
          take={() => {
            const row = comparison.row;
            setName(row?.name ?? '');
            setStart(
              row
                ? 'start_date' in row
                  ? row.start_date
                  : closureDate(year, row.start_month, row.start_day)
                : null,
            );
            setEnd(
              row
                ? 'end_date' in row
                  ? row.end_date
                  : closureDate(year, row.end_month, row.end_day)
                : null,
            );
            setBefore(row);
            setRevisions(comparison.revisions);
            setConflict(false);
            setChanged(false);
            setComparison(null);
          }}
        />
      )}
      {openingPreview &&
        (() => {
          const data = openingPreview.input.data as unknown as {
            before: Break | null;
            after: Break | null;
          };
          const period = data.after ?? data.before!;
          const shownRange = dateRange(period.start_date, period.end_date);
          return (
            <ConfirmDialog
              className="closure-confirm"
              title="保存できません"
              subtitle={period.name ? `${period.name}（${shownRange}）` : shownRange}
              icon={<WarningMark size={26} />}
              open={open}
              close={() => {
                sequence.current++;
                setOpeningPreview(null);
                setLoadingDate(null);
                setPreviewRequest(null);
              }}
              cancelLabel="閉じる"
              saving={busy}
            >
              <OpeningConflictContent
                rows={openingPreview.rows}
                loadingDate={loadingDate}
                openDay={(date) => {
                  void openRepair(date);
                }}
                error={openingError}
              />
            </ConfirmDialog>
          );
        })()}
      {repair && props.kind === 'break' && (
        <DayDialog
          date={repair.date}
          data={repair.data}
          rules={props.rules}
          conflictFacilities={repair.facilities}
          reload={() => props.calendar.reload(repair.date)}
          saved={() => {
            daySaved.current = true;
          }}
          close={() => {
            void closeRepair();
          }}
        />
      )}
      {preview &&
        loading.kind === 'ready' &&
        (() => {
          const content = ruleClosureConfirmation(
            preview.days,
            preview.deleting,
            loading.data.staff,
          );
          const shownName = preview.deleting ? (before?.name ?? '') : name.trim();
          const shownRange = preview.deleting ? range : start && end ? dateRange(start, end) : '';
          return (
            <ConfirmDialog
              className="closure-confirm"
              key={JSON.stringify(preview)}
              title={content.title}
              subtitle={shownName ? `${shownName}（${shownRange}）` : shownRange}
              icon={icon}
              message={content.message}
              open={open}
              close={() => setPreview(null)}
              cancelLabel={content.cancelLabel}
              confirmLabel={content.confirmLabel}
              saving={busy}
              confirm={() => {
                if (!busy) saveRule(preview.input);
              }}
            >
              {content.rows.length > 0 && (
                <>
                  <ul className="rule-change-days">
                    {content.rows.map((row) => (
                      <li key={row.date}>
                        <b>{row.label}</b>
                        {row.sections.map((section, index) => (
                          <Fragment key={index}>
                            <span className={`rule-day-text${section.keep ? ' keep' : ''}`}>
                              {section.text}
                            </span>
                            <div className="closure-names">
                              {section.names.map((name, index) => (
                                <span className="name-badge" key={index}>
                                  <UserRound size={18} strokeWidth={2.4} />
                                  {name}
                                </span>
                              ))}
                            </div>
                          </Fragment>
                        ))}
                      </li>
                    ))}
                  </ul>
                  {content.after && <p className="closure-after">{content.after}</p>}
                </>
              )}
            </ConfirmDialog>
          );
        })()}
    </>
  );
}
