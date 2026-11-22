import './staff.css';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CircleDollarSign, MessageSquare, Trash2, UserRound } from 'lucide-react';
import type { CurrentRevision, PeriodSummary, Staff } from '../../../shared/protocol';
import { MAX_STAFF_NOTES_LENGTH } from '../../../shared/limits';
import { staffAssignments } from '../../../shared/staff';
import { SaveButton, SaveConflictNotice } from '../parts/Dialog';
import { SelectBox } from '../parts/SelectBox';
import { Segmented } from '../parts/Segmented';
import { TextField } from '../parts/TextField';
import { FieldGroup } from '../parts/FieldGroup';
import { RequiredLegend } from '../parts/RequiredLegend';
import { Reveal } from '../parts/Reveal';
import { useSave } from '../saving/useSave';
import { registerChangedEditor } from '../saving/window';
import { useAppFrame } from '../app/context';
import { ConfirmDialog } from '../parts/ConfirmDialog';
import { SaveConflictDialog } from '../parts/SaveConflictDialog';
import {
  amountProblems,
  formAssignments,
  cleanStaffNamePart,
  hasRequiredStaffName,
  hasWorkProblems,
  historyChanges,
  initialForm,
  saveInput,
  statusProblem,
  validStaffAmounts,
  type HistoryField,
  type SinceSelections,
  type StaffForm,
} from './model';
import { DefaultShifts } from './DefaultShifts';
import { StaffStatus } from './StaffStatus';
import { StaffSince } from './StaffSince';
import {
  orderSinceChanges,
  pendingSinceField,
  sinceChanges,
  sinceOptions,
  sinceProblem,
} from './since';
import { employmentTypes, qualifications } from '../format/labels';
import { staffConflictRows } from './staff-conflict';
import { WarningMark } from '../parts/icons';

const firstFacilities = ['なし', 'A', 'B'] as const;
const secondFacilities = ['なし', 'C', 'D'] as const;
const handlesInputError = (field: string) => field === 'in_use';
export const staffViews = ['基本情報', '既定のシフト'] as const;
export type StaffView = (typeof staffViews)[number];
export type StaffEditorExit = 'saved' | 'cancelled' | 'deleted' | 'missing';
export function StaffEditor({
  staff,
  missing = false,
  close,
  view = '基本情報',
  fromBulkEdit = false,
}: {
  staff?: Staff;
  missing?: boolean;
  close: (reason: StaffEditorExit) => void;
  view?: StaffView;
  fromBulkEdit?: boolean;
}) {
  const [editingChanged, setEditingChanged] = useState(false);
  const [original, setOriginal] = useState(staff);
  const [initial, setInitial] = useState(() => initialForm(staff));
  const [form, setForm] = useState(initial);
  const assigned = staffAssignments(formAssignments(form));
  const composingName = useRef(false);
  const [checkedAmounts, setCheckedAmounts] = useState({
    pay: initial.pay,
    budget: initial.budget,
  });
  const [since, setSince] = useState<SinceSelections>({});
  const [keptHistory, setKeptHistory] = useState<HistoryField[]>([]);
  const [sinceOrder, setSinceOrder] = useState<HistoryField[]>([]);
  const [conflict, setConflict] = useState<CurrentRevision | null>(null);
  const [comparison, setComparison] = useState<{ person: Staff; periods: PeriodSummary[] } | null>(
    null,
  );
  const [checkingOther, setCheckingOther] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [replacement, setReplacement] = useState(0);
  const [checkedTimes, setCheckedTimes] = useState(form.workTimes);
  const [timesValid, setTimesValid] = useState(true);
  const workInvalid = !timesValid || hasWorkProblems(checkedTimes, formAssignments(form));
  const [id] = useState(() => staff?.id ?? crypto.randomUUID());
  const deleting = useRef(false);
  const [confirming, setConfirming] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const { refresh, loading, setNavigationLocked } = useAppFrame();
  const periods = loading.kind === 'ready' ? loading.data.periods : [];
  const changes = orderSinceChanges(
    sinceChanges({ ...form, ...checkedAmounts }, original, periods, keptHistory),
    sinceOrder,
  );
  const options = sinceOptions(periods);
  const pendingField = pendingSinceField(changes, since, periods);
  const locked = (field: HistoryField) => pendingField !== null && pendingField !== field;
  const sinceInvalid = sinceProblem(changes, since, periods) !== null;
  const statusInvalid = statusProblem(form) !== null;
  const nameValid = hasRequiredStaffName(form);
  const amounts = amountProblems(form);
  const amountsValid = validStaffAmounts(form);
  const removed = missing || deleted || Boolean(original && conflict && conflict.revision === null);
  const { save, saving, showSpinner, outcome } = useSave({ handlesInputError });
  useEffect(() => {
    if (outcome?.kind === 'saved') {
      setConfirmOpen(false);
      close(deleting.current ? 'deleted' : 'saved');
    }
    if (outcome?.kind === 'input-error' && outcome.field === 'in_use') {
      setConfirmOpen(false);
      void refresh();
    }
    if (outcome?.kind === 'conflict')
      setConflict(
        outcome.conflicts.find((item) => item.target.unit === 'staff' && item.target.id === id) ??
          null,
      );
  }, [outcome, refresh, id, close]);
  useEffect(() => (editingChanged ? registerChangedEditor() : undefined), [editingChanged]);
  useLayoutEffect(() => {
    setNavigationLocked(fromBulkEdit || editingChanged);
    return () => setNavigationLocked(false);
  }, [fromBulkEdit, editingChanged, setNavigationLocked]);
  useEffect(() => {
    const needed = sinceChanges({ ...form, ...checkedAmounts }, original, periods, keptHistory).map(
      (item) => item.field,
    );
    setSinceOrder((current) => {
      const next = [
        ...current.filter((field) => needed.includes(field)),
        ...needed.filter((field) => !current.includes(field)),
      ];
      return next.length === current.length &&
        next.every((field, index) => field === current[index])
        ? current
        : next;
    });
    setSince((current) =>
      Object.keys(current).some((field) => !needed.includes(field as HistoryField))
        ? Object.fromEntries(
            Object.entries(current).filter(([field]) => needed.includes(field as HistoryField)),
          )
        : current,
    );
  }, [form.employmentType, form.qualification, checkedAmounts, original, periods, keptHistory]);
  const change = (patch: Partial<StaffForm>) => {
    if (!editingChanged && JSON.stringify({ ...form, ...patch }) !== JSON.stringify(initial))
      setEditingChanged(true);
    setForm((current) => ({ ...current, ...patch }));
  };
  const nameChanged = (field: 'familyName' | 'givenName', value: string) => {
    const composing = composingName.current;
    change({
      [field]: cleanStaffNamePart(
        value,
        form[field === 'familyName' ? 'givenName' : 'familyName'],
        composing,
      ),
    });
  };
  const facilityChanged = (side: 'first' | 'second', value: string) => {
    change({
      [side === 'first' ? 'firstFacility' : 'secondFacility']: value === 'なし' ? null : value,
    });
    setCheckedTimes(form.workTimes);
  };
  const submit = () => {
    if (
      removed ||
      !nameValid ||
      !amountsValid ||
      saving ||
      checkingOther ||
      workInvalid ||
      statusInvalid ||
      sinceProblem(sinceChanges(form, original, periods, keptHistory), since, periods)
    )
      return;
    const input = saveInput(id, form, original, periods.length ? since : {}, keptHistory);
    if (conflict) input.revisions = [{ target: conflict.target, revision: conflict.revision }];
    deleting.current = false;
    void save(input);
  };
  const confirmOther = async () => {
    if (saving || checkingOther) return;
    setCheckingOther(true);
    try {
      const result = await refresh();
      if (result.kind !== 'ready') return;
      const person = result.data.staff.find((item) => item.id === id);
      if (!person) {
        setDeleted(true);
        setComparison(null);
        return;
      }
      setComparison({ person, periods: result.data.periods });
    } finally {
      setCheckingOther(false);
    }
  };
  const notice = removed ? (
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
  ) : undefined;
  const basicItems = [
    {
      key: 'names',
      content: (
        <FieldGroup className="staff-name-fields">
          {(['familyName', 'givenName'] as const).map((field) => (
            <div
              key={field}
              className="staff-cell"
              onCompositionStartCapture={() => {
                composingName.current = true;
              }}
              onCompositionEndCapture={(event) => {
                composingName.current = false;
                nameChanged(field, (event.target as HTMLInputElement).value);
              }}
            >
              <TextField
                label={field === 'familyName' ? '名字' : '名前'}
                required
                value={form[field]}
                onChange={(value) => nameChanged(field, value)}
              />
            </div>
          ))}
        </FieldGroup>
      ),
    },
    {
      key: 'history',
      content: (
        <FieldGroup className="staff-history-fields">
          <fieldset className="staff-cell" disabled={locked('employment_type')}>
            <SelectBox
              label="雇用区分"
              value={form.employmentType}
              options={employmentTypes}
              onChange={(employmentType) => change({ employmentType })}
            />
          </fieldset>
          <fieldset className="staff-cell" disabled={locked('qualification')}>
            <SelectBox
              label="資格"
              value={form.qualification}
              options={qualifications}
              onChange={(qualification) => change({ qualification })}
            />
          </fieldset>
          <fieldset className="staff-cell" disabled={locked('quarter_hour_pay')}>
            <div
              className="money-field"
              onBlur={() => setCheckedAmounts((current) => ({ ...current, pay: form.pay }))}
            >
              <TextField
                label="15分給"
                required
                numeric
                value={form.pay}
                onChange={(pay) => {
                  if (/^\d*$/.test(pay)) change({ pay });
                }}
              />
              <span className="currency">円</span>
            </div>
            <Reveal open={Boolean(amounts.pay)} className="form-message">
              <div className="msg">
                <WarningMark size={22} />
                {amounts.pay}
              </div>
            </Reveal>
          </fieldset>
        </FieldGroup>
      ),
    },
    ...changes.map((item) => ({
      key: item.field,
      content: (
        <StaffSince
          change={item}
          value={since[item.field] ?? ''}
          options={options}
          noOptions={options.length === 0}
          onChange={(value) => setSince((current) => ({ ...current, [item.field]: value }))}
        />
      ),
    })),
    {
      key: 'areas',
      content: (
        <FieldGroup fitContent className="staff-cell">
          <span className="lab">主な担当区分</span>
          <div className="areas">
            <div className="site-choice">
              <span className="site-label">第一</span>
              <Segmented
                key={replacement}
                value={form.firstFacility ?? 'なし'}
                options={firstFacilities}
                disabledOptions={!assigned.second ? ['なし'] : []}
                onChange={(value) => facilityChanged('first', value)}
              />
            </div>
            <div className="site-choice">
              <span className="site-label">第二</span>
              <Segmented
                key={replacement}
                value={form.secondFacility ?? 'なし'}
                options={secondFacilities}
                disabledOptions={!assigned.first ? ['なし'] : []}
                onChange={(value) => facilityChanged('second', value)}
              />
            </div>
          </div>
        </FieldGroup>
      ),
    },
  ];
  const footerStart = staff && !staff.in_use && (
    <button
      className="btn btn-danger footer-delete"
      type="button"
      disabled={removed || saving}
      onClick={() => {
        setConfirming(true);
        setConfirmOpen(true);
      }}
    >
      <Trash2 size={22} strokeWidth={2} />
      スタッフを削除
    </button>
  );
  const footer = (
    <SaveButton
      disabled={
        removed ||
        !nameValid ||
        !amountsValid ||
        showSpinner ||
        checkingOther ||
        workInvalid ||
        statusInvalid ||
        sinceInvalid
      }
      showSpinner={showSpinner}
      conflict={Boolean(conflict)}
      submit={submit}
    />
  );
  const body = (
    <>
      <div className="staff-editor-views">
        <div className="staff-editor-view" inert={view !== '基本情報'}>
          <div className="staff-editor-columns">
            <div className="sec-wrap">
              <p className="sec-t staff-basic-heading">
                <UserRound size={22} strokeWidth={2.2} />
                基本情報
                <RequiredLegend />
              </p>
              <section className="sec">
                <Reveal items={basicItems} className="staff-fields" />
              </section>
            </div>
            <div className="view-col">
              <div className="sec-wrap">
                <p className="sec-t">
                  <CircleDollarSign size={22} strokeWidth={2.2} />
                  予算と在籍状況
                </p>
                <section className="sec pair">
                  <FieldGroup>
                    <fieldset className="pair-cell staff-cell" disabled={locked('budget')}>
                      <div
                        className="money-field"
                        onBlur={() =>
                          setCheckedAmounts((current) => ({ ...current, budget: form.budget }))
                        }
                      >
                        <TextField
                          label="1ピリオドの予算"
                          required
                          numeric
                          grouped
                          value={form.budget}
                          onChange={(budget) => change({ budget })}
                        />
                        <span className="currency">円</span>
                      </div>
                      <Reveal open={Boolean(amounts.budget)} className="form-message">
                        <div className="msg">
                          <WarningMark size={22} />
                          {amounts.budget}
                        </div>
                      </Reveal>
                    </fieldset>
                  </FieldGroup>
                  <StaffStatus key={replacement} form={form} onChange={change} />
                </section>
              </div>
              <div className="sec-wrap">
                <p className="sec-t">
                  <MessageSquare size={22} strokeWidth={2.2} />
                  備考
                </p>
                <section className="sec note">
                  <TextField
                    multiline
                    maxLength={MAX_STAFF_NOTES_LENGTH}
                    value={form.notes}
                    onChange={(notes) => change({ notes })}
                  />
                </section>
              </div>
            </div>
          </div>
        </div>
        <div className="staff-editor-view" inert={view !== '既定のシフト'}>
          <DefaultShifts
            key={replacement}
            form={form}
            checkedTimes={checkedTimes}
            onChange={change}
            onValidityChange={setTimesValid}
            onCommit={(workTimes) => {
              change({ workTimes });
              setCheckedTimes(workTimes);
            }}
          />
        </div>
      </div>
    </>
  );
  return (
    <>
      <div className="staff-editor">
        <div className="staff-editor-content">{body}</div>
        <div className="staff-island">
          <div className="staff-island-start">
            <button className="btn btn-sub" type="button" onClick={() => close('cancelled')}>
              キャンセル
            </button>
            {footerStart}
          </div>
          <div className="staff-island-notice">{notice}</div>
          <div className="staff-island-end">{footer}</div>
        </div>
      </div>
      {comparison && (
        <SaveConflictDialog
          rows={staffConflictRows(
            form,
            original,
            comparison.person,
            comparison.periods,
            since,
            keptHistory,
          )}
          target={
            <span>
              <UserRound size={22} />
              {comparison.person.name}
            </span>
          }
          close={() => setComparison(null)}
          keep={() => {
            setKeptHistory(historyChanges(form, original, keptHistory));
            setOriginal(comparison.person);
            setInitial(initialForm(comparison.person));
            setConflict((current) =>
              current ? { ...current, revision: comparison.person.revision } : current,
            );
            setComparison(null);
          }}
          take={() => {
            const next = initialForm(comparison.person);
            setOriginal(comparison.person);
            setInitial(next);
            setForm(next);
            setCheckedTimes(next.workTimes);
            setCheckedAmounts({ pay: next.pay, budget: next.budget });
            setSince({});
            setSinceOrder([]);
            setKeptHistory([]);
            setConflict(null);
            setEditingChanged(false);
            setReplacement((current) => current + 1);
            setComparison(null);
          }}
        />
      )}
      {confirming && staff && (
        <ConfirmDialog
          title="スタッフを削除しますか？"
          subtitle={staff.name}
          message="この人の記録を消します。元に戻せません。"
          cancelLabel="いいえ"
          confirmLabel="はい、削除する"
          icon={<Trash2 size={24} strokeWidth={2.2} />}
          open={confirmOpen}
          saving={saving}
          close={() => setConfirming(false)}
          confirm={() => {
            if (removed || saving) return;
            deleting.current = true;
            void save(
              {
                operation: 'staff.delete',
                revisions: [{ target: { unit: 'staff', id: staff.id }, revision: staff.revision }],
                data: { id: staff.id },
                label: `${staff.name}さん`,
              },
              '削除しました',
            );
          }}
        />
      )}
    </>
  );
}
