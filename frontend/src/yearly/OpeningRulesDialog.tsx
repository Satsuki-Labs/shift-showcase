import { useEffect, useState } from 'react';
import { Clock } from 'lucide-react';
import { fiscalYearLabel } from '../../../shared/calendar';
import type { AnnualRules, Revision } from '../../../shared/protocol';
import { useAppFrame } from '../app/context';
import { Dialog, SaveButton, SaveConflictNotice } from '../parts/Dialog';
import { SaveConflictDialog } from '../parts/SaveConflictDialog';
import { conflictRows } from '../parts/save-conflict';
import { Reveal } from '../parts/Reveal';
import { Segmented } from '../parts/Segmented';
import { FieldGroup } from '../parts/FieldGroup';
import { TimeSelect } from '../parts/TimeSelect';
import { useSave } from '../saving/useSave';
import {
  facilities,
  openingForms,
  openingKinds,
  openingPayload,
  openingProblem,
  type Facility,
  type OpeningForm,
} from './opening-model';
import { WarningMark } from '../parts/icons';
import { handlesOpeningConflict, openingConflictMessage } from './closure-confirm';

const modes = ['時刻', '長さ'] as const;
const headings = { normal: '平日', peak: '繁忙期', saturday: '土曜' };
function CellHeading({ title, empty }: { title: string; empty: boolean }) {
  return (
    <div className="opening-cell-head">
      <span className="lab">{title}</span>
      <span className={`opening-cell-message${empty ? ' open' : ''}`}>
        <WarningMark size={20} />
        選んでください
      </span>
    </div>
  );
}
export function OpeningRulesDialog({
  year,
  rules,
  close,
}: {
  year: number;
  rules: AnnualRules;
  close: () => void;
}) {
  const [forms, setForms] = useState(() => openingForms(rules, year));
  const [before, setBefore] = useState(forms);
  const { loading, refresh } = useAppFrame();
  const [revisions, setRevisions] = useState(() =>
    loading.kind === 'ready' ? loading.data.annualRuleRevisions : undefined,
  );
  const [conflict, setConflict] = useState(false),
    [checking, setChecking] = useState(false);
  const [comparison, setComparison] = useState<{
    forms: OpeningForm[];
    revisions: Revision[];
  } | null>(null);
  const [facility, setFacility] = useState<Facility>('A');
  const [changed, setChanged] = useState(false),
    [open, setOpen] = useState(true);
  const [openingConflict, setOpeningConflict] = useState(false);
  const { save, saving, showSpinner, outcome } = useSave({
    handlesInputError: handlesOpeningConflict,
  });
  const payload = openingPayload(year, forms),
    base = openingPayload(year, before);
  const changedRules = payload.rules.filter(
    (row, index) => JSON.stringify(row) !== JSON.stringify(base.rules[index]),
  );
  const busy = saving || checking || !revisions;
  const confirmOther = async () => {
    if (busy) return;
    setChecking(true);
    try {
      const result = await refresh();
      if (result.kind === 'ready' && result.data.annualRuleRevisions)
        setComparison({
          forms: openingForms(result.data.annualRules, year),
          revisions: result.data.annualRuleRevisions,
        });
    } finally {
      setChecking(false);
    }
  };
  useEffect(() => {
    if (outcome?.kind === 'saved') setOpen(false);
    if (outcome?.kind === 'conflict') setConflict(true);
    if (outcome?.kind === 'input-error' && handlesOpeningConflict(outcome.field))
      setOpeningConflict(true);
  }, [outcome]);
  const update = (facility: Facility, patch: Partial<OpeningForm>) => {
    setOpeningConflict(false);
    setChanged(true);
    setForms((current) =>
      current.map((form) => (form.facility === facility ? { ...form, ...patch } : form)),
    );
  };
  const errors = forms
    .filter((form) => form.facility !== facility && openingProblem(form))
    .map((form) => form.facility as Facility);
  const form = forms.find((form) => form.facility === facility)!;
  const duration = form.arrival_end_mode === 'duration';
  const arrivalValue = duration
    ? form.hours === ''
      ? ''
      : `${form.hours.padStart(2, '0')}:${(form.minutes || '0').padStart(2, '0')}`
    : (form.arrival_end_time ?? '');
  return (
    <>
      <Dialog
        title="営業の時間"
        icon={<Clock size={24} />}
        subtitle={fiscalYearLabel(year)}
        className="opening-rules-dialog"
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
        changed={changed}
        open={open}
        close={close}
        footer={
          <SaveButton
            conflict={conflict}
            showSpinner={showSpinner}
            disabled={busy || forms.some(openingProblem)}
            submit={() => {
              if (busy) return;
              if (!changedRules.length) {
                setOpen(false);
                return;
              }
              void save({
                operation: 'calendar.opening-rules.save',
                revisions: changedRules.map((row) => ({
                  target: {
                    unit: 'opening-rule',
                    fiscalYear: year,
                    facility: row.facility as Facility,
                  },
                  revision:
                    revisions?.find(
                      (item) =>
                        item.target.unit === 'opening-rule' &&
                        item.target.fiscalYear === year &&
                        item.target.facility === row.facility,
                    )?.revision ?? null,
                })),
                data: { fiscal_year: year, rules: changedRules },
                label: `営業の時間（${fiscalYearLabel(year)}）`,
              });
            }}
          />
        }
      >
        <div className="opening-rules-fields">
          <Segmented value={facility} options={facilities} errors={errors} onChange={setFacility} />
          <div className="opening-grid">
            {openingKinds.map((kind) => {
              const start = form[`${kind}_start_time`],
                end = form[`${kind}_end_time`];
              return (
                <FieldGroup key={kind}>
                  <CellHeading title={headings[kind]} empty={!start || !end} />
                  <div className="opening-cell-row">
                    <TimeSelect
                      value={start}
                      allowed={(time) => !end || time < end}
                      onCommit={(value) => update(facility, { [`${kind}_start_time`]: value })}
                    />
                    <span>〜</span>
                    <TimeSelect
                      value={end}
                      allowed={(time) => !start || time > start}
                      onCommit={(value) => update(facility, { [`${kind}_end_time`]: value })}
                    />
                  </div>
                </FieldGroup>
              );
            })}
            <FieldGroup>
              <CellHeading title="受付開始から締めまで" empty={!arrivalValue} />
              <div className="opening-cell-row opening-arrival-row">
                <Segmented
                  value={duration ? '長さ' : '時刻'}
                  options={modes}
                  onChange={(value) =>
                    update(facility, {
                      arrival_end_mode: value === '時刻' ? 'fixed_time' : 'duration',
                    })
                  }
                />
                <TimeSelect
                  value={arrivalValue}
                  duration={duration}
                  onCommit={(value) => {
                    if (duration) {
                      const [hours, minutes] = value.split(':');
                      update(facility, {
                        hours: String(Number(hours)),
                        minutes: String(Number(minutes)),
                      });
                    } else update(facility, { arrival_end_time: value });
                  }}
                />
              </div>
            </FieldGroup>
          </div>
        </div>
        <Reveal open={openingConflict} scrollToShow className="rule-preview-notice">
          <div className="notice warn">
            <WarningMark size={22} />
            <span>{openingConflictMessage}</span>
          </div>
        </Reveal>
      </Dialog>
      {comparison && (
        <SaveConflictDialog
          target={`営業の時間（${fiscalYearLabel(year)}）`}
          rows={conflictRows(
            forms
              .filter((row) => changedRules.some((changed) => changed.facility === row.facility))
              .flatMap((row) => {
                const other = comparison.forms.find((item) => item.facility === row.facility)!;
                return [
                  ...openingKinds.map((kind) => ({
                    label: `${row.facility} ${headings[kind]}`,
                    yours: [row[`${kind}_start_time`], '〜', row[`${kind}_end_time`]],
                    theirs: [other[`${kind}_start_time`], '〜', other[`${kind}_end_time`]],
                    separators: ['〜'],
                  })),
                  {
                    label: `${row.facility} 受付開始から締めまで`,
                    yours:
                      row.arrival_end_mode === 'fixed_time'
                        ? `${modes[0]} ${row.arrival_end_time ?? ''}`
                        : `${modes[1]} ${row.hours}:${row.minutes.padStart(2, '0')}`,
                    theirs:
                      other.arrival_end_mode === 'fixed_time'
                        ? `${modes[0]} ${other.arrival_end_time ?? ''}`
                        : `${modes[1]} ${other.hours}:${other.minutes.padStart(2, '0')}`,
                  },
                ];
              }),
          )}
          close={() => setComparison(null)}
          keep={() => {
            setForms(
              comparison.forms.map((row) =>
                changedRules.some((changed) => changed.facility === row.facility)
                  ? forms.find((item) => item.facility === row.facility)!
                  : row,
              ),
            );
            setBefore(comparison.forms);
            setRevisions(comparison.revisions);
            setComparison(null);
          }}
          take={() => {
            setForms(comparison.forms);
            setBefore(comparison.forms);
            setRevisions(comparison.revisions);
            setConflict(false);
            setChanged(false);
            setOpeningConflict(false);
            setComparison(null);
          }}
        />
      )}
    </>
  );
}
