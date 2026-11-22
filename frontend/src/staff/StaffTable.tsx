import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpDown, ChevronDown, LogOut, PauseCircle, Pencil, Users } from 'lucide-react';
import type { Staff } from '../../../shared/protocol';
import { currentEmploymentStatus, japanToday } from '../../../shared/staff';
import { Reveal, type RevealItem } from '../parts/Reveal';
import { FacilityCircles } from '../parts/FacilityCircle';
import { latestHistory } from './model';
import { yen } from '../format/number';
import { monthDay } from '../format/date';
import { employmentTypes, qualifications } from '../format/labels';
import type { StaffReorder } from './StaffReorder';
import { NumberUnits } from '../parts/NumberUnits';

const qualificationClass = { certified: 'q1', assistant: 'q2', none: 'q0' };
const employmentClass = { full_time: 'e1', part_time: 'e2', casual: 'e3' };
function StaffRow({
  person,
  today,
  edit,
  sorting,
  returning = false,
}: {
  person: Staff;
  today: string;
  edit: (staff: Staff) => void;
  sorting?: ReturnType<StaffReorder['row']>;
  returning?: boolean;
}) {
  const { lead, arrows, className = '', ...rowAttributes } = sorting ?? {};
  const history = latestHistory(person),
    status = currentEmploymentStatus(person, today);
  const planned =
    person.employment_status === 'leave' &&
    Boolean(person.leave_start_date && person.leave_start_date > today);
  const note =
    status === 'retired'
      ? `退職（${monthDay(person.retirement_date!)}）`
      : status === 'leave' || planned
        ? `${planned ? '休職の予定' : '休職中'}（${monthDay(person.leave_start_date!)}〜${person.leave_expected_end_date ? monthDay(person.leave_expected_end_date) : '未定'}）`
        : person.notes || '―';
  return (
    <div
      {...rowAttributes}
      className={`staff-row${sorting ? ' staff-reorder-row' : returning ? ' staff-reorder-return' : ''}${className}${status === 'leave' ? ' leave' : status === 'retired' ? ' gone' : ''}`}
    >
      <div className="nm0">
        <FacilityCircles staff={person} />
        <b>{person.name}</b>
      </div>
      <div>
        <span className={`pill ${qualificationClass[history.qualification]}`}>
          {qualifications.find(({ value }) => value === history.qualification)!.label}
        </span>
      </div>
      <div>
        <span className={`pill ${employmentClass[history.employment_type]}`}>
          {employmentTypes.find(({ value }) => value === history.employment_type)!.label}
        </span>
      </div>
      {!sorting && (
        <>
          <div>
            <NumberUnits>{yen(history.quarter_hour_pay)}</NumberUnits>
          </div>
          <div>
            <NumberUnits>{yen(history.budget)}</NumberUnits>
          </div>
          <div className="memo" title={note}>
            {status === 'retired' || status === 'leave' || planned ? (
              <span className={`stt ${status === 'retired' ? 'gn' : 'lv'}`}>
                {status === 'retired' ? (
                  <LogOut size={16} strokeWidth={2.4} />
                ) : (
                  <PauseCircle size={16} strokeWidth={2.4} />
                )}
                <span>{note}</span>
              </span>
            ) : (
              <span className="memo-text">{note}</span>
            )}
          </div>
          <div>
            <button
              className="btn btn-sub btn-small"
              type="button"
              data-staff-id={person.id}
              onClick={() => edit(person)}
            >
              <Pencil size={18} strokeWidth={2.2} />
              編集
            </button>
          </div>
        </>
      )}
      {arrows && <div className="staff-reorder-controls">{arrows}</div>}
      {lead}
    </div>
  );
}
export function StaffTable({
  staff,
  edit,
  reorder,
  focusStaffId,
}: {
  staff: Staff[];
  edit: (staff: Staff) => void;
  reorder: StaffReorder;
  focusStaffId?: string;
}) {
  const [showRetired, setShowRetired] = useState(false);
  const previous = useRef(reorder.enabled);
  const returning = previous.current && !reorder.enabled;
  previous.current = reorder.enabled;
  const today = japanToday();
  const active = staff.filter((person) => currentEmploymentStatus(person, today) !== 'retired');
  const retired = staff.filter((person) => currentEmploymentStatus(person, today) === 'retired');
  useLayoutEffect(() => {
    if (!focusStaffId) return;
    if (retired.some((person) => person.id === focusStaffId) && !showRetired) {
      setShowRetired(true);
      return;
    }
    queueMicrotask(() =>
      reorder.root.current
        ?.querySelector<HTMLButtonElement>(`button[data-staff-id="${CSS.escape(focusStaffId)}"]`)
        ?.focus({ preventScroll: true }),
    );
  }, [focusStaffId, showRetired]);
  const items = useMemo(() => {
    const rows: RevealItem[] = (reorder.enabled ? reorder.order : active).map((person, index) => ({
      key: person.id,
      content: (
        <StaffRow
          person={person}
          today={today}
          edit={edit}
          returning={returning}
          sorting={reorder.enabled ? reorder.row(person, index) : undefined}
        />
      ),
    }));
    if (!rows.length)
      rows.push({
        key: 'empty',
        content: <div className="staff-empty">スタッフが登録されていません</div>,
      });
    if (retired.length && !reorder.enabled) {
      rows.push({
        key: 'retired-toggle',
        content: (
          <button
            className={`gone-t${showRetired ? ' open' : ''}`}
            type="button"
            onClick={() => setShowRetired(!showRetired)}
          >
            <ChevronDown size={18} strokeWidth={3} />
            <span className="lbl">
              <Reveal reserveSpace open={!showRetired}>
                辞めた人（{retired.length}人）を表示
              </Reveal>
              <Reveal reserveSpace open={showRetired}>
                辞めた人（{retired.length}人）を非表示
              </Reveal>
            </span>
          </button>
        ),
      });
      if (showRetired)
        rows.push(
          ...retired.map((person) => ({
            key: person.id,
            content: <StaffRow person={person} today={today} edit={edit} />,
          })),
        );
    }
    return rows;
  }, [staff, today, showRetired, edit, reorder]);
  return (
    <section className="staff-list" ref={reorder.root}>
      <header className="band nv">
        {reorder.enabled ? (
          <ArrowUpDown size={22} strokeWidth={2.2} />
        ) : (
          <Users size={22} strokeWidth={2.4} />
        )}
        <b>{reorder.enabled ? 'スタッフの並び替え' : 'スタッフ'}</b>
        {!reorder.enabled && (
          <span>
            <NumberUnits>{`${active.length}人`}</NumberUnits>
          </span>
        )}
      </header>
      {reorder.enabled && reorder.notice}
      <div className="stf">
        <div className="staff-row head list-head">
          {reorder.enabled ? (
            <div className="staff-reorder-note">
              この順番が、シフト表・スタッフ管理・給与管理・Excelの出力に使われます。
            </div>
          ) : (
            ['氏名', '資格', '雇用区分', '15分給', '予算', '備考', ''].map((label, index) => (
              <div key={index} className={index === 0 ? 'l' : ''}>
                {label}
              </div>
            ))
          )}
        </div>
        <Reveal
          key={String(reorder.enabled)}
          className={reorder.enabled ? 'staff-reorder-rows' : ''}
          items={items}
          scrollToShow={showRetired && !reorder.enabled}
        />
      </div>
      {reorder.enabled && reorder.comparison}
    </section>
  );
}
