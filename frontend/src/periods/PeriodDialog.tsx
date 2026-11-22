import { useEffect, useState } from 'react';
import { CalendarDays, LockKeyhole, Pencil, Plus, Trash2, Users } from 'lucide-react';
import type {
  CurrentRevision,
  JsonValue,
  PeriodSummary,
  PeriodsChangedData,
  Staff,
} from '../../../shared/protocol';
import { japanToday } from '../../../shared/staff';
import { useAppFrame } from '../app/context';
import { ConfirmDialog } from '../parts/ConfirmDialog';
import { SaveConflictDialog } from '../parts/SaveConflictDialog';
import { DateField } from '../parts/DateField';
import { Dialog, SaveButton, SaveConflictNotice } from '../parts/Dialog';
import { Panel } from '../parts/Panel';
import { TextField } from '../parts/TextField';
import { RequiredLegend } from '../parts/RequiredLegend';
import { FieldGroup } from '../parts/FieldGroup';
import { useSave } from '../saving/useSave';
import { BudgetSummary } from './BudgetSummary';
import { PeriodDeleteBackup } from './PeriodDeleteBackup';
import {
  canSave,
  coverageProblems,
  dayCount,
  deadlineHint,
  deadlineProblem,
  facilities,
  initialForm,
  periodInput,
  previousPeriod,
  rangeProblem,
  requestClosedLabel,
  requestState,
  shorteningMessage,
  type Facility,
  type PeriodForm,
} from './model';
import { WarningMark } from '../parts/icons';
import { dayLabel, monthDay, dayLabelWithYear } from '../format/date';
import { NumberUnits } from '../parts/NumberUnits';
import { periodConflictRows } from './period-conflict';
import { confirmPeriodDelete } from './period-delete';

export function PeriodDialog({
  period,
  periods,
  staff,
  close,
  saved,
}: {
  period?: PeriodSummary;
  periods: PeriodSummary[];
  staff: Staff[];
  close: () => void;
  saved: (before: PeriodSummary | undefined, after: PeriodSummary) => void;
}) {
  const [original, setOriginal] = useState(period);
  const [initial, setInitial] = useState(() => initialForm(periods, period));
  const [form, setForm] = useState(initial);
  const [id] = useState(() => period?.id ?? crypto.randomUUID());
  const [open, setOpen] = useState(true);
  const [confirmation, setConfirmation] = useState<'shorten' | 'delete' | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleteAnyway, setDeleteAnyway] = useState(false);
  const [conflict, setConflict] = useState<CurrentRevision | null>(null);
  const [comparison, setComparison] = useState<{
    period: PeriodSummary;
    periods: PeriodSummary[];
  } | null>(null);
  const [checkingOther, setCheckingOther] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [replacement, setReplacement] = useState(0);
  const { refresh } = useAppFrame();
  const { save, saving, showSpinner, outcome } = useSave();
  const today = japanToday();
  const ended = Boolean(original && original.end_date < today);
  const deadlineLocked = requestState(original, today) === 'closed-with-submissions';
  const hint = deadlineHint(original, form.deadline, today);
  const changed = JSON.stringify(form) !== JSON.stringify(initial);
  const problem = rangeProblem(form, periods, id);
  const deadlineError = deadlineProblem(form);
  const removed = Boolean(
    original &&
    (!periods.some((item) => item.id === id) ||
      deleted ||
      (conflict && conflict.revision === null)),
  );
  const valid = !removed && canSave(form, periods, id);
  const previous = previousPeriod(periods, form.startDate, id);
  const days =
    form.startDate && form.endDate && form.endDate >= form.startDate
      ? dayCount(form.startDate, form.endDate)
      : '―';
  const shortening =
    original && form.startDate && form.endDate
      ? shorteningMessage(original, form.startDate, form.endDate)
      : null;
  useEffect(() => {
    if (outcome?.kind === 'saved') {
      setConfirmOpen(false);
      setOpen(false);
    }
    if (outcome?.kind === 'conflict') {
      setConfirmOpen(false);
      setConflict(
        outcome.conflicts.find((item) => item.target.unit === 'period' && item.target.id === id) ??
          null,
      );
    }
    if (outcome?.kind === 'input-error') setConfirmOpen(false);
  }, [outcome, id]);
  const change = (patch: Partial<PeriodForm>) => setForm((current) => ({ ...current, ...patch }));
  const changeCoverage = (facility: Facility, field: 'total', value: string) =>
    setForm((current) => ({
      ...current,
      coverage: {
        ...current.coverage,
        [facility]: { ...current.coverage[facility], [field]: value },
      },
    }));
  const submit = () => {
    if (!valid || saving || checkingOther) return;
    void save({
      operation: original ? 'period.update' : 'period.create',
      label: form.name.trim(),
      revisions: [
        {
          target: { unit: 'period', id },
          revision: conflict ? conflict.revision : (original?.revision ?? null),
        },
      ],
      data: periodInput(
        id,
        deadlineLocked ? { ...form, deadline: original!.request_deadline_date } : form,
      ) as unknown as JsonValue,
    });
  };
  const requestSave = () => {
    if (!valid || saving || checkingOther) return;
    if (shortening) {
      setConfirmation('shorten');
      setConfirmOpen(true);
    } else submit();
  };
  const remove = () => {
    if (removed || !original || saving || checkingOther) return;
    void save(
      {
        operation: 'period.delete',
        label: original.name,
        data: { id },
        revisions: [
          {
            target: { unit: 'period', id },
            revision: conflict ? conflict.revision : original.revision,
          },
        ],
      },
      '削除しました',
    );
  };
  const confirmOther = async () => {
    if (saving || checkingOther) return;
    setCheckingOther(true);
    try {
      const result = await refresh();
      if (result.kind !== 'ready') return;
      const next = result.data.periods.find((item) => item.id === id);
      if (!next) {
        setDeleted(true);
        setComparison(null);
        return;
      }
      setComparison({ period: next, periods: result.data.periods });
    } finally {
      setCheckingOther(false);
    }
  };
  const dateField = (field: 'startDate' | 'endDate', label: string) => (
    <DateField
      key={`${field}-${replacement}`}
      label={label}
      required
      hideRequiredMark
      hideYear
      value={form[field]}
      onChange={(value) => change({ [field]: value })}
      emptyMonth={form.startDate ?? undefined}
      stableCalendarPosition
    />
  );
  const finish = () => {
    close();
    if (outcome?.kind === 'saved') {
      const next = (outcome.data as unknown as PeriodsChangedData).periods.find(
        (item) => item.id === id,
      );
      if (next) saved(original, next);
    }
  };
  return (
    <>
      <Dialog
        title={original ? 'ピリオドを編集' : '新しいピリオド'}
        icon={
          original ? <Pencil size={24} strokeWidth={2.4} /> : <Plus size={24} strokeWidth={2.4} />
        }
        className="period-dialog"
        open={open}
        changed={changed}
        close={finish}
        subtitle={ended ? '終わったピリオドは名前だけを変更できます' : undefined}
        notice={
          removed ? (
            <div className="notice warn staff-conflict without-confirm">
              <WarningMark size={22} />
              <span>ほかの担当者が削除しました。</span>
            </div>
          ) : conflict ? (
            <SaveConflictNotice
              disabled={saving || checkingOther}
              confirmLabel="変更内容を確認"
              confirm={() => {
                void confirmOther();
              }}
            />
          ) : undefined
        }
        footerStart={
          original && (
            <button
              className="btn btn-danger footer-delete"
              type="button"
              disabled={removed || saving || checkingOther}
              onClick={() => {
                setConfirmation('delete');
                setConfirmOpen(true);
              }}
            >
              <Trash2 size={22} strokeWidth={2} />
              ピリオドを削除
            </button>
          )
        }
        footer={
          original ? (
            <SaveButton
              disabled={!valid || showSpinner || checkingOther}
              showSpinner={showSpinner}
              conflict={Boolean(conflict)}
              submit={requestSave}
            />
          ) : (
            <button
              className="btn btn-main"
              type="button"
              disabled={!valid || showSpinner || checkingOther}
              onClick={requestSave}
            >
              {showSpinner ? <span className="spinner" /> : <Plus size={22} strokeWidth={2.4} />}
              ピリオドを作る
            </button>
          )
        }
      >
        <Panel
          placement="raised"
          className="period-basic"
          contentClassName="period-content"
          icon={<CalendarDays size={22} strokeWidth={2.2} />}
          title="基本情報"
        >
          <div className="period-required">
            <RequiredLegend />
          </div>
          <div className="period-fields">
            <FieldGroup className="period-full period-name-field">
              <TextField
                label="名前"
                required
                maxLength={20}
                value={form.name}
                onChange={(name) => change({ name })}
              />
              {previous && (
                <span className="period-previous">
                  前回のピリオド：{previous.name}（{monthDay(previous.start_date)}〜
                  {monthDay(previous.end_date)}）
                </span>
              )}
            </FieldGroup>
            {!ended && (
              <>
                <FieldGroup className="period-full">
                  <div className="period-range">
                    {dateField('startDate', '開始日')}
                    <span className="period-to">〜</span>
                    {dateField('endDate', '終了日')}
                    <span className="period-sum">
                      <b>
                        <NumberUnits>{`${days}日間`}</NumberUnits>
                      </b>
                    </span>
                    {problem && (
                      <div className="form-message">
                        <div className="msg">
                          <WarningMark size={22} />
                          {problem}
                        </div>
                      </div>
                    )}
                  </div>
                </FieldGroup>
                <FieldGroup fitContent className="period-full period-deadline-group">
                  {deadlineLocked ? (
                    <>
                      <span className="lab">希望の締め切り</span>
                      <div className="period-deadline-locked">
                        <LockKeyhole size={20} strokeWidth={2.4} />
                        <span>{requestClosedLabel(original!)}</span>
                      </div>
                    </>
                  ) : (
                    <DateField
                      key={`deadline-${replacement}`}
                      label="希望の締め切り"
                      value={form.deadline}
                      onChange={(deadline) => change({ deadline })}
                      min={!original ? today : undefined}
                      max={form.endDate ?? undefined}
                      emptyMonth={form.startDate ?? undefined}
                    />
                  )}
                  {deadlineError ? (
                    <p className="period-range-warning">
                      <WarningMark size={22} />
                      {deadlineError}
                    </p>
                  ) : (
                    hint && <p className="period-hint">{hint}</p>
                  )}
                </FieldGroup>
              </>
            )}
            {ended && (
              <>
                <FieldGroup className="period-full period-ended-field">
                  <span>期間</span>
                  <b>
                    {dayLabel(form.startDate!)} 〜 {dayLabel(form.endDate!)}
                  </b>
                  <span className="period-sum">
                    <b>
                      <NumberUnits>{`${days}日間`}</NumberUnits>
                    </b>
                  </span>
                </FieldGroup>
                <FieldGroup className="period-full period-ended-field">
                  <span>希望の締め切り</span>
                  <b>{form.deadline ? dayLabelWithYear(form.deadline) : 'なし'}</b>
                </FieldGroup>
              </>
            )}
          </div>
        </Panel>
        <Panel
          placement="inside"
          className="period-coverage"
          contentClassName="period-content"
          icon={<Users size={22} strokeWidth={2.2} />}
          title="体制チェックの必要人数"
          headingEnd={
            !original && (
              <BudgetSummary staff={staff} startDate={form.startDate} periods={periods} />
            )
          }
        >
          <table>
            <thead>
              <tr>
                <th>施設</th>
                <th>人数</th>
              </tr>
            </thead>
            <tbody>
              {facilities.map((facility, index) => (
                <tr key={facility}>
                  <th scope="row">
                    <span className={`dot c${index < 2 ? 1 : 2}`} />
                    {facility}
                  </th>
                  {(['total'] as const).map((field) => (
                    <td key={field}>
                      {ended ? (
                        <span className="period-coverage-value">
                          <NumberUnits>
                            {form.coverage[facility][field] === ''
                              ? '―'
                              : `${form.coverage[facility][field]}人`}
                          </NumberUnits>
                        </span>
                      ) : (
                        <div className="period-number">
                          <TextField
                            value={form.coverage[facility][field]}
                            onChange={(value) => changeCoverage(facility, field, value)}
                          />
                          <span>人</span>
                        </div>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {!ended &&
            facilities.flatMap((facility) =>
              Object.entries(coverageProblems(form.coverage[facility])).map(
                ([field, message]) =>
                  message && (
                    <div key={`${facility}-${field}`} className="form-message">
                      <div className="msg">
                        <WarningMark size={22} />
                        {facility}：{message}
                      </div>
                    </div>
                  ),
              ),
            )}
        </Panel>
      </Dialog>
      {comparison && (
        <SaveConflictDialog
          rows={periodConflictRows(form, initialForm(comparison.periods, comparison.period))}
          target={
            <span>
              <CalendarDays size={24} />
              {comparison.period.name}
            </span>
          }
          close={() => setComparison(null)}
          keep={() => {
            setOriginal(comparison.period);
            setInitial(initialForm(comparison.periods, comparison.period));
            setConflict((current) =>
              current ? { ...current, revision: comparison.period.revision } : current,
            );
            setComparison(null);
          }}
          take={() => {
            const next = initialForm(comparison.periods, comparison.period);
            setOriginal(comparison.period);
            setInitial(next);
            setForm(next);
            setConflict(null);
            setReplacement((current) => current + 1);
            setComparison(null);
          }}
        />
      )}
      {confirmation === 'shorten' && original && (
        <ConfirmDialog
          title="期間を短くしますか？"
          icon={<Pencil size={24} strokeWidth={2.2} />}
          subtitle={`${form.name.trim()}（${monthDay(original.start_date)}〜${monthDay(original.end_date)} → ${monthDay(form.startDate!)}〜${monthDay(form.endDate!)}）`}
          message={shortening!}
          confirmLabel="はい、短くする"
          cancelLabel="いいえ"
          open={confirmOpen}
          close={() => {
            setConfirmation(null);
            setConfirmOpen(false);
          }}
          confirm={submit}
          saving={saving || checkingOther}
        />
      )}
      {confirmation === 'delete' && original && (
        <PeriodDeleteBackup period={original}>
          {(backup, remaining) => (
            <>
              <ConfirmDialog
                className="period-delete-confirm"
                title="ピリオドを削除しますか？"
                icon={<Trash2 size={24} strokeWidth={2.2} />}
                subtitle={`${original.name}（${monthDay(original.start_date)}〜${monthDay(original.end_date)}）`}
                message="ピリオドに含まれる以下のものが全て削除されます。"
                detail={
                  <>
                    <p>削除後は元に戻すことはできません。</p>
                    <ul className="period-delete-items">
                      <li>対象のピリオド</li>
                      <li>入力されたシフト</li>
                      <li>提出されたシフト希望</li>
                    </ul>
                  </>
                }
                confirmLabel="はい、削除する"
                cancelLabel="いいえ"
                open={confirmOpen}
                close={() => {
                  setConfirmation(null);
                  setConfirmOpen(false);
                  setDeleteAnyway(false);
                }}
                confirm={() => {
                  confirmPeriodDelete(remaining, () => setDeleteAnyway(true), remove);
                }}
                saving={saving || checkingOther}
              >
                {backup}
              </ConfirmDialog>
              {deleteAnyway && (
                <ConfirmDialog
                  title="このまま削除しますか？"
                  icon={<Trash2 size={24} strokeWidth={2.2} />}
                  subtitle={`${original.name}（${monthDay(original.start_date)}〜${monthDay(original.end_date)}）`}
                  message="次の控えを、まだダウンロードしていません。"
                  detail={
                    <ul className="period-delete-items">
                      {remaining.map((name) => (
                        <li key={name}>{name}</li>
                      ))}
                    </ul>
                  }
                  confirmLabel="はい、このまま削除する"
                  cancelLabel="いいえ"
                  open={confirmOpen}
                  close={() => setDeleteAnyway(false)}
                  confirm={remove}
                  saving={saving || checkingOther}
                />
              )}
            </>
          )}
        </PeriodDeleteBackup>
      )}
    </>
  );
}
