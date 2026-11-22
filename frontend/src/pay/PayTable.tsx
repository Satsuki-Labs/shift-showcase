import type { PeriodStaff } from '../../../shared/period-snapshot';
import {
  BriefcaseBusiness,
  CalendarCheck,
  ChevronDown,
  ChevronUp,
  CircleDollarSign,
  Coffee,
  Users,
} from 'lucide-react';
import { Fragment, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { periodPay, type PayDay, type PayTotals, type PersonPay } from '../../../shared/pay';
import type { PeriodLoadResponse, PeriodSummary, Staff } from '../../../shared/protocol';
import { Skeleton } from '../parts/Skeleton';
import { FacilityCircles } from '../parts/FacilityCircle';
import { Reveal } from '../parts/Reveal';
import { motionMs, motionEasing } from '../parts/motion';
import { payBarLevel, payPercentage } from './model';
import { WarningMark } from '../parts/icons';
import { shortTime, hoursMinutes } from '../format/time';
import { yen } from '../format/number';
import { slashDayParts } from '../format/date';
import { employmentTypes, workRoleLabels } from '../format/labels';
import { payStaff } from '../../../shared/pay';
import { PayExcelExport } from './PayExcelExport';
import { NumberUnits } from '../parts/NumberUnits';
import { usePayRowSwitch } from './usePayRowSwitch';

const employmentClass = { full_time: 'e1', part_time: 'e2', casual: 'e3' };
const noAverage = (pay: PersonPay) =>
  pay.days.some((day) => day.kind === 'paid_leave' && day.noAverage);
function PayBar({ pay }: { pay: Pick<PayTotals, 'amount' | 'budget'> | null }) {
  if (!pay) return <Skeleton />;
  const { amount, budget } = pay;
  return (
    <span
      className={`bar ${payBarLevel(amount, budget)}`}
      style={{ '--w': `${payPercentage(amount, budget).toFixed(1)}%` } as CSSProperties}
    />
  );
}
function Over({ amount }: { amount: number }) {
  return (
    <span className="ov">
      <NumberUnits>{yen(amount)}</NumberUnits> 超過
    </span>
  );
}
function buildingTimes(day: Extract<PayDay, { kind: 'work' }>, building: 1 | 2) {
  const slots = day.work
    .filter((row) => row.building === building)
    .flatMap((row) => row.slots)
    .sort((a, b) => a.start_time.localeCompare(b.start_time));
  return slots.length
    ? slots.map((slot, index) => (
        <Fragment key={index}>
          {index > 0 && '、'}
          <b className="da">{slot.facility}</b>
          {shortTime(slot.start_time)}〜{shortTime(slot.end_time)}
        </Fragment>
      ))
    : '―';
}
function PayDetails({
  person,
  period,
  pay,
  data,
  exporting,
  output,
  close,
}: {
  person: PeriodStaff;
  period: PeriodSummary;
  pay: PersonPay;
  data: PeriodLoadResponse;
  exporting: boolean;
  output: (outputDate: string) => void;
  close: () => void;
}) {
  return (
    <div className="dbox">
      <div className="pay-factrow">
        <div className="facts">
          <div>
            <small>
              <BriefcaseBusiness size={20} strokeWidth={2.2} />
              雇用区分
            </small>
            <span className={`pill ${employmentClass[pay.employment_type]}`}>
              {employmentTypes.find((row) => row.value === pay.employment_type)!.label}
            </span>
          </div>
          <div>
            <small>
              <CircleDollarSign size={20} strokeWidth={2.2} />
              15分給
            </small>
            <b>
              <NumberUnits>{yen(pay.quarter_hour_pay)}</NumberUnits>
            </b>
          </div>
          <div>
            <small>
              <CalendarCheck size={20} strokeWidth={2.2} />
              出勤
            </small>
            <b>
              <NumberUnits>{`${pay.workDays}日`}</NumberUnits>
            </b>
          </div>
          <div>
            <small>
              <Coffee size={20} strokeWidth={2.2} />
              有給
            </small>
            <b>
              <NumberUnits>{`${pay.paidLeaveDays}日`}</NumberUnits>
            </b>
          </div>
        </div>
        <PayExcelExport
          period={period}
          target={person.name}
          disabled={false}
          busy={exporting}
          output={output}
        />
      </div>
      {noAverage(pay) && (
        <div className="rq-banner nopay">
          <div className="txt">
            <b>このピリオドに勤務が無いため、有給の金額は入っていません</b>
          </div>
        </div>
      )}
      <table className="dtab">
        <thead>
          <tr>
            <th>日付</th>
            <th>第一</th>
            <th>第二</th>
            <th>役割</th>
            <th className="r">時間</th>
            <th className="r">金額</th>
          </tr>
        </thead>
        <tbody>
          {pay.days.map((day) => {
            const date = slashDayParts(day.date);
            const roles =
              day.kind === 'work'
                ? workRoleLabels(
                    data.dayStates.find(
                      (row) => row.staff_id === person.id && row.date === day.date,
                    ),
                    day.work,
                  )
                : null;
            return (
              <tr key={day.date}>
                <td>
                  <span className="pay-date-month">{date.month}</span>/
                  <span className="pay-date-day">{date.day}</span>（{date.weekday}）
                </td>
                {day.kind === 'paid_leave' ? (
                  <td colSpan={3}>
                    <span className="pl">有給</span>
                  </td>
                ) : (
                  <>
                    <td>{buildingTimes(day, 1)}</td>
                    <td>{buildingTimes(day, 2)}</td>
                    <td>{[...roles!.topRoles, ...roles!.bottomRoles].join(' ') || '―'}</td>
                  </>
                )}
                <td className="r">
                  <NumberUnits>
                    {day.kind === 'paid_leave' && day.noAverage ? '―' : hoursMinutes(day.minutes)}
                  </NumberUnits>
                </td>
                <td className="r">
                  <NumberUnits>
                    {day.kind === 'paid_leave' && day.noAverage ? '―' : yen(day.amount)}
                  </NumberUnits>
                </td>
              </tr>
            );
          })}
          <tr className="tot">
            <td colSpan={4}>合計（有給を含む）</td>
            <td className="r">
              <NumberUnits>
                {hoursMinutes(pay.days.reduce((sum, day) => sum + day.minutes, 0))}
              </NumberUnits>
            </td>
            <td className="r">
              <NumberUnits>{yen(pay.amount)}</NumberUnits>
            </td>
          </tr>
        </tbody>
      </table>
      <div className="pay-details-footer">
        <button className="btn pay-details-close" type="button" onClick={close}>
          <ChevronUp size={20} strokeWidth={2.4} />
          閉じる
        </button>
      </div>
    </div>
  );
}
function PayRow({
  person,
  period,
  currentPerson,
  personPay,
  data,
  open,
  toggle,
  exporting,
  output,
}: {
  person: PeriodStaff;
  period: PeriodSummary;
  currentPerson?: Staff;
  personPay: PersonPay | null;
  data: PeriodLoadResponse | null;
  open: boolean;
  toggle: (id: string) => void;
  exporting: boolean;
  output: (outputDate: string) => void;
}) {
  const row = useRef<HTMLButtonElement>(null);
  const cancelReturn = useRef<(() => void) | null>(null);
  const [previousOpen, setPreviousOpen] = useState(open);
  const [closing, setClosing] = useState(false);
  // Attach the closing class in the same render that removes .op.
  if (previousOpen !== open) {
    setPreviousOpen(open);
    setClosing(!open);
  }
  useLayoutEffect(() => {
    if (!closing) return;
    const timer = setTimeout(() => setClosing(false), motionMs(row.current!, '--motion-reveal'));
    return () => clearTimeout(timer);
  }, [closing]);
  useLayoutEffect(() => () => cancelReturn.current?.(), [open]);
  const closeFromEnd = () => {
    const button = row.current;
    if (!button || !open || cancelReturn.current) return;
    const close = () => {
      button.focus({ preventScroll: true });
      toggle(person.id);
    };
    const bounds = button.getBoundingClientRect();
    if (bounds.top >= 0 && bounds.bottom <= window.innerHeight) {
      close();
      return;
    }
    const detailHeight = button
      .parentElement!.querySelector('.pay-details')!
      .getBoundingClientRect().height;
    const from = window.scrollY;
    const maximum = Math.max(
      0,
      document.scrollingElement!.scrollHeight - detailHeight - window.innerHeight,
    );
    const target = Math.max(0, Math.min(from + bounds.top - 16, maximum));
    const duration = motionMs(button, '--motion-reveal');
    if (duration === 0 || target === from) {
      window.scrollTo({ top: target, behavior: 'instant' });
      close();
      return;
    }
    const ease = motionEasing(button, '--ease-pay-return');
    const closeButton = button.parentElement!.querySelector('.pay-details-close');
    const events = [
      'wheel',
      'touchstart',
      'touchmove',
      'mousedown',
      'pointerdown',
      'keydown',
    ] as const;
    let frame: number | undefined;
    const cancel = () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      events.forEach((event) => document.removeEventListener(event, interrupt, true));
      window.removeEventListener('resize', cancel);
      cancelReturn.current = null;
    };
    const interrupt = (event: Event) => {
      const activating =
        event.type === 'mousedown' ||
        event.type === 'pointerdown' ||
        event.type === 'touchstart' ||
        (event instanceof KeyboardEvent && (event.key === 'Enter' || event.key === ' '));
      if (activating && event.target instanceof Node && closeButton?.contains(event.target)) return;
      cancel();
    };
    cancelReturn.current = cancel;
    events.forEach((event) =>
      document.addEventListener(event, interrupt, { capture: true, passive: true }),
    );
    window.addEventListener('resize', cancel);
    const started = performance.now();
    const tick = (time: number) => {
      if (!button.isConnected || !button.classList.contains('op')) {
        cancel();
        return;
      }
      const progress = Math.max(0, Math.min(1, (time - started) / duration));
      window.scrollTo({ top: from + (target - from) * ease(progress), behavior: 'instant' });
      if (progress < 1) frame = requestAnimationFrame(tick);
      else {
        cancel();
        close();
      }
    };
    frame = requestAnimationFrame(tick);
  };
  return (
    <div className={`pp${closing ? ' closing' : ''}`}>
      <button
        type="button"
        ref={row}
        className={`pr${personPay?.over ? ' over' : ''}${open ? ' op' : ''}${closing ? ' closing' : ''}`}
        disabled={!data}
        onClick={() => toggle(person.id)}
      >
        <span className="pay-name">
          {!data ? (
            <>
              <span className="facility-circles">
                <Skeleton circle />
              </span>
              <span className="n">
                <Skeleton width="88px" />
              </span>
            </>
          ) : (
            <>
              <FacilityCircles staff={currentPerson ?? person} />
              <span className="n">{person.name}</span>
            </>
          )}
        </span>
        <span className="h">
          {personPay ? (
            <NumberUnits>{hoursMinutes(personPay.workMinutes)}</NumberUnits>
          ) : (
            <Skeleton width="104px" />
          )}
        </span>
        <PayBar pay={personPay} />
        <span className="m">
          {personPay ? (
            <>
              <b>
                <NumberUnits>{yen(personPay.amount)}</NumberUnits>
              </b>
              <i>／</i>
              <NumberUnits>{yen(personPay.budget)}</NumberUnits>
            </>
          ) : (
            <Skeleton width="210px" />
          )}
        </span>
        <span className="o">
          {personPay &&
            (personPay.over > 0 ? (
              <>
                <span className="tri">
                  <WarningMark size={22} />
                </span>
                <Over amount={personPay.over} />
              </>
            ) : noAverage(personPay) ? (
              <span className="np">有給の金額なし</span>
            ) : null)}
        </span>
        <span className="cv">
          <ChevronDown size={22} strokeWidth={3} />
        </span>
      </button>
      {data && personPay && (
        <div id={`pay-details-${person.id}`} className="pay-details">
          <Reveal open={open} className="dwrap">
            <PayDetails
              person={person}
              period={period}
              pay={personPay}
              data={data}
              exporting={exporting}
              output={output}
              close={closeFromEnd}
            />
          </Reveal>
        </div>
      )}
    </div>
  );
}
export function PayTable({
  staff,
  period,
  periods,
  data,
  today,
  openStaffId,
  toggle,
  exporting,
  outputPerson,
}: {
  staff: readonly Staff[];
  period: PeriodSummary;
  periods: readonly PeriodSummary[];
  data: PeriodLoadResponse | null;
  today: string;
  openStaffId: string | null;
  toggle: (id: string) => void;
  exporting: ReadonlySet<string>;
  outputPerson: (id: string, name: string, outputDate: string) => void;
}) {
  const list = useRef<HTMLElement>(null);
  const toggleRow = usePayRowSwitch(list, openStaffId, toggle);
  const people = payStaff(staff, period, data, today);
  const pay = data ? periodPay({ staff: people, period, periods, data }) : null;
  const payById = new Map(pay?.people.map((row) => [row.staff_id, row]));
  const currentById = new Map(staff.map((person) => [person.id, person]));
  return (
    <>
      <div className={`pay-budget${pay?.all.over ? ' over' : ''}`}>
        <span className="pay-budget-label">
          <CircleDollarSign size={26} strokeWidth={2.2} />
          <small>全体の予算</small>
        </span>
        <span className="h">
          {pay ? (
            <NumberUnits>{hoursMinutes(pay.all.workMinutes)}</NumberUnits>
          ) : (
            <Skeleton width="104px" />
          )}
        </span>
        <PayBar pay={pay?.all ?? null} />
        <span className="m">
          {pay ? (
            <>
              <b>
                <NumberUnits>{yen(pay.all.amount)}</NumberUnits>
              </b>
              <i>／</i>
              <NumberUnits>{yen(pay.all.budget)}</NumberUnits>
            </>
          ) : (
            <Skeleton width="210px" />
          )}
        </span>
        <span className="o">
          {pay && pay.all.over > 0 && (
            <>
              <span className="tri">
                <WarningMark size={22} />
              </span>
              <Over amount={pay.all.over} />
            </>
          )}
        </span>
        <span />
      </div>
      <section className="pay-list" ref={list}>
        <header className="band nv">
          <Users size={22} strokeWidth={2.4} />
          <b>スタッフ</b>
          <span>
            {data ? (
              <NumberUnits>{`${people.length}人`}</NumberUnits>
            ) : (
              <Skeleton width="40px" onNavy />
            )}
          </span>
        </header>
        <div className="pr head list-head">
          <span className="pay-name">
            <span className="facility-circles" />
            <span className="n">氏名</span>
          </span>
          <span className="h">勤務時間</span>
          <span />
          <span className="m">給与見込み／予算</span>
          <span />
          <span />
        </div>
        {people.map((person) => {
          const personPay = payById.get(person.id) ?? null,
            open = Boolean(data && openStaffId === person.id);
          return (
            <PayRow
              key={person.id}
              person={person}
              period={period}
              currentPerson={currentById.get(person.id)}
              personPay={personPay}
              data={data}
              open={open}
              toggle={toggleRow}
              exporting={exporting.has(person.id)}
              output={(outputDate) => outputPerson(person.id, person.name, outputDate)}
            />
          );
        })}
      </section>
    </>
  );
}
