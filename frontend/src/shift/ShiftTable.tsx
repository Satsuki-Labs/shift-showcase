import type { PeriodStaff } from '../../../shared/period-snapshot';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { layoutRect, viewport } from '../parts/viewport';
import { MessageSquare } from 'lucide-react';
import { Skeleton } from '../parts/Skeleton';
import { ShiftBand } from './ShiftBand';
import { holidayName } from '../../../shared/holidays';
import type {
  AnnualRules,
  PeriodLoadResponse,
  PeriodSummary,
  Role,
} from '../../../shared/protocol';
import { historyForPeriod } from '../../../shared/staff';
import { ShiftPersonRow, focusableShiftDates } from './ShiftPersonRow';
import { nameColumnWidth, useVisibleShiftDays } from './useVisibleShiftDays';
import {
  dailyCounts,
  requestCellView,
  requestSubmissionLabel,
  staffCells,
  tableStaff,
  loadingTableStaff,
} from './model';
import { printedCellChanged } from './printed';
import { Reveal } from '../parts/Reveal';
import { floatingHost, useFloating } from '../parts/Floating';
import { FacilityCircle } from '../parts/FacilityCircle';
import type { DateProblemSelection, DayProblems } from './date-problems';
import { shortTime } from '../format/time';
import { WarningMark } from '../parts/icons';
import { yen } from '../format/number';
import { monthDay } from '../format/date';
import { periodDates } from '../../../shared/period';
import { type BudgetOverage } from '../../../shared/pay';
import { NumberUnits } from '../parts/NumberUnits';

export interface BudgetWarningSelection {
  staffId: string;
  building: 1 | 2;
}

const qualifications = { certified: '資格1', assistant: '資格2', none: 'なし' };
function dateColor(date: string): string {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return weekday === 0 || holidayName(date) ? 'sunday' : weekday === 6 ? 'saturday' : '';
}
export function ShiftTable({
  building,
  staff,
  period,
  periods,
  data,
  rules,
  today,
  role,
  requestView = false,
  openCell,
  openDay,
  openBulk,
  problems,
  warning,
  selectWarning,
  warningRequest,
  warningOpened,
  openDaily,
  overBudget,
  budgetWarning,
  selectBudgetWarning,
  openPay,
}: {
  building: 1 | 2;
  staff: readonly PeriodStaff[];
  period: PeriodSummary;
  periods: readonly PeriodSummary[];
  data: PeriodLoadResponse | null;
  rules: AnnualRules;
  today: string;
  role: Role;
  requestView?: boolean;
  openCell: (person: PeriodStaff, date: string, building: 1 | 2) => void;
  openDay: (date: string) => void;
  openBulk: (person: PeriodStaff, building: 1 | 2) => void;
  problems: readonly DayProblems[];
  warning: DateProblemSelection | null;
  selectWarning: (selection: DateProblemSelection | null) => void;
  warningRequest: DateProblemSelection | null;
  warningOpened: () => void;
  openDaily: (date: string) => void;
  overBudget: readonly BudgetOverage[];
  budgetWarning: BudgetWarningSelection | null;
  selectBudgetWarning: (selection: BudgetWarningSelection | null) => void;
  openPay: () => void;
}) {
  const dates = useMemo(() => periodDates(period), [period]);
  const dateColors = useMemo(() => new Map(dates.map((date) => [date, dateColor(date)])), [dates]);
  const people = useMemo(
    () =>
      (data
        ? tableStaff(staff, period, building, data, today)
        : loadingTableStaff(staff, period, building, today)
      ).map((person) => {
        const cells = data
          ? staffCells(person, period, periods, building, data, rules, role)
          : null;
        const days = dates.map((date) => {
          const cell = cells?.get(date) ?? null;
          return {
            date,
            color: dateColors.get(date)!,
            cell,
            request:
              cell && data && requestView
                ? requestCellView(cell, person.id, date, period, data)
                : null,
            changed: Boolean(
              cell &&
              data &&
              !requestView &&
              printedCellChanged(cell, person.id, date, building, period, data, today),
            ),
          };
        });
        return {
          person,
          days,
          focusDates: focusableShiftDates(days, requestView),
          submission: data && requestView ? requestSubmissionLabel(person.id, period, data) : null,
          qualification: data
            ? historyForPeriod(person.history, periods, period.start_date)!.qualification
            : null,
        };
      }),
    [staff, period, periods, building, data, rules, today, role, dates, dateColors, requestView],
  );
  const counts = useMemo(
    () => (data ? dates.map((date) => dailyCounts(data, building, date)) : null),
    [data, dates, building],
  );
  const events = useMemo(
    () =>
      dates.map((date) => {
        const entries =
          data?.buildingDays.find((row) => row.building === building && row.date === date)
            ?.entries ?? [];
        return {
          entries,
          texts: entries.map((entry) =>
            entry.kind === 'event' && entry.arrival_time
              ? `${entry.content} ${shortTime(entry.arrival_time)}`
              : entry.content,
          ),
          event: entries.find((entry) => entry.kind === 'event'),
          memo: entries.find((entry) => entry.kind === 'memo'),
        };
      }),
    [data, dates, building],
  );
  const name = building === 1 ? '第一事業所' : '第二事業所';
  const section = useRef<HTMLElement>(null);
  const visible = useVisibleShiftDays(dates, !data || people.length > 0);
  const {
    scroll,
    window: { width: dayWidth, start, end },
  } = visible;
  const headers = useRef(new Map<string, HTMLTableCellElement>());
  const budgetButtons = useRef(new Map<string, HTMLButtonElement>());
  const overByStaff = useMemo(
    () => new Map(overBudget.map((person) => [person.staff_id, person])),
    [overBudget],
  );
  const activeBudget =
    !requestView && budgetWarning?.building === building
      ? overByStaff.get(budgetWarning.staffId)
      : undefined;
  const [popupBudget, setPopupBudget] = useState<BudgetOverage | null>(null);
  const byDate = useMemo(
    () =>
      new Map(
        problems.filter((row) => row.building === building).map((row) => [row.date, row.problems]),
      ),
    [problems, building],
  );
  const activeDate = !requestView && warning?.building === building ? warning.date : null;
  const activeProblems = activeDate ? byDate.get(activeDate) : undefined;
  const [popupDate, setPopupDate] = useState<string | null>(null);
  useEffect(() => {
    if (!data || requestView || warningRequest?.building !== building) return;
    const root = section.current,
      scroller = scroll.current,
      header = headers.current.get(warningRequest.date);
    if (!root || !scroller || !header) return;
    root.scrollIntoView({ block: 'start' });
    const edge = layoutRect(scroller),
      day = layoutRect(header);
    if (day.left < edge.left + nameColumnWidth)
      scroller.scrollLeft += day.left - edge.left - nameColumnWidth;
    else if (day.right > edge.right) scroller.scrollLeft += day.right - edge.right;
    visible.refresh();
    selectWarning({ date: warningRequest.date, building });
    warningOpened();
  }, [data, requestView, warningRequest, building, selectWarning, warningOpened]);
  useLayoutEffect(() => {
    if (!activeDate) return;
    if (!activeProblems?.length) {
      selectWarning(null);
      return;
    }
    setPopupDate(activeDate);
  }, [activeDate, activeProblems, selectWarning]);
  const popupProblems = popupDate ? byDate.get(popupDate) : undefined;
  const coverageProblems = popupProblems?.filter((problem) => problem.kind === 'coverage') ?? [];
  useLayoutEffect(() => {
    if (requestView || budgetWarning?.building !== building) return;
    if (!activeBudget || !budgetButtons.current.has(budgetWarning.staffId)) {
      selectBudgetWarning(null);
      return;
    }
    setPopupBudget(activeBudget);
  }, [requestView, budgetWarning, building, activeBudget, selectBudgetWarning]);

  const datePopup = useRef<HTMLDivElement>(null),
    budgetPopup = useRef<HTMLDivElement>(null);
  const datePopupScroll = useRef<HTMLDivElement>(null);
  const [datePopupHost, setDatePopupHost] = useState<Element | null>(null);
  useEffect(() => {
    setDatePopupHost(floatingHost(section.current));
  }, []);
  const origin = () => {
    const root = section.current!,
      bounds = layoutRect(root);
    return { left: bounds.left + root.clientLeft, top: bounds.top + root.clientTop };
  };
  const bounds = () => {
    const root = section.current!,
      edge = layoutRect(root);
    return {
      left: edge.left + root.clientLeft + 8,
      right: edge.left + root.clientLeft + root.clientWidth - 8,
      top: 8,
      bottom: viewport().height - 8,
    };
  };
  useFloating(datePopup, {
    open: Boolean(datePopupHost && activeProblems?.length && popupDate === activeDate),
    placement: 'reveal-below',
    scrollContainer: datePopupScroll,
    anchor: () =>
      activeDate
        ? headers.current.get(activeDate)?.querySelector<HTMLButtonElement>('.date-warn')
        : null,
    anchorBounds: (button) => {
      const mark = layoutRect(button),
        day = layoutRect(button.closest('th')!);
      return { left: mark.left, right: mark.right, top: day.top, bottom: day.bottom };
    },
    left: (anchor) => (anchor.left + anchor.right) / 2 - 297,
    bounds,
    visibleAnchor: () => (activeDate ? headers.current.get(activeDate) : null),
    visibleBounds: () => {
      const edge = layoutRect(scroll.current!);
      return { left: edge.left + nameColumnWidth + 26, right: edge.right };
    },
    onAnchorHidden: () => selectWarning(null),
  });
  useFloating(budgetPopup, {
    open: Boolean(activeBudget && popupBudget?.staff_id === activeBudget.staff_id),
    anchor: () => (activeBudget ? budgetButtons.current.get(activeBudget.staff_id) : null),
    direction: 'right',
    left: (anchor) => anchor.left - 12,
    origin,
    bounds,
  });
  return (
    <section
      ref={section}
      className={`shift-table-section shift-list-section site${building}`}
      data-loading={!data || undefined}
      style={{ '--shift-day-width': `${dayWidth}px` } as CSSProperties}
    >
      <ShiftBand
        building={building}
        name={name}
        count={data ? people.length : null}
        view={requestView ? '希望' : '一覧'}
        requestsClosed={Boolean(period.requests_closed_at)}
      />
      <div className="shift-list-body">
        {data && !people.length ? (
          <div className="empty-state">スタッフが登録されていません</div>
        ) : (
          <div
            className="shift-table-scroll scrollbar-thin"
            ref={scroll}
            onFocusCapture={visible.onFocusCapture}
            onClickCapture={(event) => visible.parkForDialog(event.target)}
          >
            <span
              ref={visible.proxy}
              className="shift-focus-bridge"
              tabIndex={-1}
              onFocus={visible.restoreFocus}
              onKeyDown={visible.resumeKeyboard}
            />
            <table
              className="shift-grid"
              style={{ width: nameColumnWidth + dates.length * dayWidth }}
            >
              <colgroup>
                <col style={{ width: nameColumnWidth }} />
                {dates.map((date) => (
                  <col key={date} style={{ width: dayWidth }} />
                ))}
              </colgroup>
              <thead>
                <tr>
                  <th scope="col" className="shift-name">
                    スタッフ名
                  </th>
                  {dates.map((date) => (
                    <th
                      key={date}
                      scope="col"
                      className={`shift-day-link ${dateColors.get(date)}`}
                      ref={(node) => {
                        if (node) headers.current.set(date, node);
                        else headers.current.delete(date);
                      }}
                      tabIndex={0}
                      onClick={() => openDay(date)}
                      onKeyDown={(event) => {
                        if (event.target === event.currentTarget && event.key === 'Enter')
                          openDay(date);
                      }}
                    >
                      <div className="shift-date-number">{Number(date.slice(8))}</div>
                      <div className="shift-date-weekday">
                        ({'日月火水木金土'[new Date(`${date}T00:00:00Z`).getUTCDay()]})
                      </div>
                      {data && !requestView && Boolean(byDate.get(date)?.length) && (
                        <button
                          type="button"
                          className={`date-warn${activeDate === date ? ' open' : ''}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            selectWarning(activeDate === date ? null : { date, building });
                          }}
                        >
                          <WarningMark size={26} />
                        </button>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr className="shift-event-row">
                  <th scope="row" className="shift-name">
                    行事
                  </th>
                  {dates.map((date, index) => {
                    const { entries, texts, event, memo } = events[index];
                    return (
                      <td
                        key={date}
                        className="shift-day-link"
                        tabIndex={0}
                        onClick={() => openDay(date)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') openDay(date);
                        }}
                      >
                        {!data ? (
                          <Skeleton width="60%" />
                        ) : (
                          <div
                            className={`shift-event${entries.length ? ' filled' : ' placeholder'}${entries.length && entries.every((entry) => entry.kind === 'memo') ? ' memo-only' : ''}${event && memo ? ' split' : ''}`}
                            title={texts.join('、')}
                          >
                            {event && memo ? (
                              <>
                                <span className="shift-event-text">{event.content}</span>
                                <span className="shift-memo">
                                  <MessageSquare size={16} />
                                  <span>{memo.content}</span>
                                </span>
                              </>
                            ) : (
                              <span>
                                {entries.map((entry, index) => (
                                  <span
                                    className={
                                      entry.kind === 'memo' ? 'shift-memo' : 'shift-event-text'
                                    }
                                    key={index}
                                  >
                                    {index > 0 && '、'}
                                    {entry.kind === 'memo' && <MessageSquare size={16} />}
                                    {texts[index]}
                                  </span>
                                ))}
                                {!texts.length && '—'}
                              </span>
                            )}
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
                {(['support', 'office'] as const).map((kind) => (
                  <tr className="shift-count-row" key={kind}>
                    <th scope="row" className="shift-name">
                      {kind === 'support' ? '現場業務' : '周辺業務'}
                    </th>
                    {dates.map((date, index) => (
                      <td key={date} className={counts && counts[index][kind] === 0 ? 'zero' : ''}>
                        {counts ? counts[index][kind] : <Skeleton width="22px" />}
                      </td>
                    ))}
                  </tr>
                ))}
                {people.map(({ person, qualification, days, focusDates, submission }) => {
                  const nameContent = (
                    <>
                      <b>{person.name}</b>
                      <span className="shift-qualification">{qualifications[qualification!]}</span>
                    </>
                  );
                  return (
                    <ShiftPersonRow
                      key={person.id}
                      person={person}
                      days={days}
                      focusDates={focusDates}
                      start={start}
                      end={end}
                      building={building}
                      requestView={requestView}
                      focusCell={visible.focusCell}
                      openCell={openCell}
                      name={
                        <th scope="row" className="shift-name">
                          {!data ? (
                            <div className="shift-skeleton-name">
                              <Skeleton width="96px" />
                              <Skeleton width="52px" />
                            </div>
                          ) : requestView ? (
                            <>
                              {nameContent}
                              {submission && (
                                <span
                                  className={`request-submission-tag ${submission === '未提出' ? 'yet' : 'none'}`}
                                >
                                  {submission}
                                </span>
                              )}
                            </>
                          ) : (
                            <div className="shift-name-actions">
                              <button
                                type="button"
                                className="shift-bulk-name"
                                onClick={() => openBulk(person, building)}
                              >
                                {nameContent}
                              </button>
                              {overByStaff.has(person.id) && (
                                <button
                                  type="button"
                                  className={`budget-warn${activeBudget?.staff_id === person.id ? ' open' : ''}`}
                                  ref={(node) => {
                                    if (node) budgetButtons.current.set(person.id, node);
                                    else budgetButtons.current.delete(person.id);
                                  }}
                                  onClick={() =>
                                    selectBudgetWarning(
                                      activeBudget?.staff_id === person.id
                                        ? null
                                        : { staffId: person.id, building },
                                    )
                                  }
                                >
                                  <WarningMark size={24} />
                                </button>
                              )}
                            </div>
                          )}
                        </th>
                      }
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {datePopupHost &&
        createPortal(
          <div
            className="date-pop shift-date-pop"
            ref={datePopup}
            style={{
              left: 8,
              top: 0,
              visibility:
                !popupDate || budgetWarning || (warning && warning.building !== building)
                  ? 'hidden'
                  : undefined,
            }}
          >
            <Reveal reserveSpace open={Boolean(activeProblems?.length && popupDate === activeDate)}>
              {popupDate && (
                <>
                  <div className="ph">
                    <b>
                      {monthDay(popupDate)}（{building === 1 ? '第一' : '第二'}）
                    </b>
                    <button
                      type="button"
                      className="go"
                      onClick={() => {
                        setPopupDate(null);
                        openDaily(popupDate);
                      }}
                    >
                      日別で見る ›
                    </button>
                  </div>
                  <div className="shift-date-pop-scroll scrollbar-thin" ref={datePopupScroll}>
                    {coverageProblems.length > 0 && (
                      <div className="pt hd">
                        <span />
                        <span />
                        <span className="c">人数</span>
                      </div>
                    )}
                    {(building === 1 ? (['A', 'B'] as const) : (['C', 'D'] as const)).map(
                      (facility) => {
                        const rows = coverageProblems.filter(
                          (problem) => problem.facility === facility,
                        );
                        return (
                          rows.length > 0 && (
                            <div className="pt" key={facility}>
                              {rows.map((problem, index) => (
                                <div className="pr" key={problem.startTime}>
                                  {index === 0 ? (
                                    <FacilityCircle facility={facility} building={building} />
                                  ) : (
                                    <span />
                                  )}
                                  <span className="tm">
                                    {shortTime(problem.startTime)}〜{shortTime(problem.endTime)}
                                  </span>
                                  <span className={`n${problem.totalMissing ? '' : ' z'}`}>
                                    {problem.totalMissing ? `${problem.totalMissing}人不足` : '—'}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )
                        );
                      },
                    )}
                    {popupProblems?.some((problem) => problem.kind === 'closing') && (
                      <div className="pcl">
                        <WarningMark size={22} />
                        締め作業の担当がいない
                      </div>
                    )}
                  </div>
                </>
              )}
            </Reveal>
          </div>,
          datePopupHost,
        )}
      <div
        className="date-pop budget-pop"
        ref={budgetPopup}
        style={{
          left: 8,
          top: 0,
          visibility:
            warning || (budgetWarning && budgetWarning.building !== building)
              ? 'hidden'
              : undefined,
        }}
      >
        <Reveal
          reserveSpace
          open={Boolean(activeBudget && popupBudget?.staff_id === activeBudget.staff_id)}
        >
          {popupBudget && (
            <>
              <div className="ph">
                <b>{popupBudget.name}さん</b>
                <button type="button" className="go" onClick={openPay}>
                  給与管理で見る ›
                </button>
              </div>
              <div className="bp">
                <span>給与見込み</span>
                <b>
                  <NumberUnits>{yen(popupBudget.amount)}</NumberUnits>
                </b>
                <span>予算</span>
                <b>
                  <NumberUnits>{yen(popupBudget.budget)}</NumberUnits>
                </b>
              </div>
              <div className="bov">
                <span className="ov">
                  <NumberUnits>{yen(popupBudget.over)}</NumberUnits> 超過
                </span>
              </div>
            </>
          )}
        </Reveal>
      </div>
    </section>
  );
}
