import type { PeriodStaff } from '../../../shared/period-snapshot';
import { layoutRect, layoutValue, viewport, scrollWindow } from '../parts/viewport';
import '../parts/TimeBar.css';
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
} from 'react';
import { motionMs } from '../parts/motion';
import { floatingHost, useFloating } from '../parts/Floating';
import { createPortal, flushSync } from 'react-dom';
import { Pencil } from 'lucide-react';
import { Skeleton } from '../parts/Skeleton';
import { ShiftBand } from './ShiftBand';
import { resolvedDayOpening, type Facility } from '../../../shared/calendar';
import {
  coverageShortage,
  facilityCoverage,
  type CoverageInput,
  type CoverageSegment,
} from '../../../shared/coverage';
import type {
  AnnualRules,
  PeriodLoadResponse,
  PeriodSummary,
  Role,
} from '../../../shared/protocol';
import { historyForPeriod } from '../../../shared/staff';
import { FacilityCircle } from '../parts/FacilityCircle';
import {
  dailyBands,
  dailyDragSave,
  dailyHourWidth,
  dailyInset,
  dailyLaneWidth,
  dailyNameWidth,
  dailyPosition,
  dailyPreview,
  dailyRange,
  dailyScrollPosition,
  dailyStart,
  type DailyBand,
  type ShiftView,
} from './daily-model';
import { initialCell, otherConfirmation, type CellContext, type SlotDraft } from './cell-model';
import { OtherShiftConfirmation } from './CellDialog';
import { getOpenDialogCount } from '../parts/Dialog';
import {
  beginTimebarDrag,
  moveTimebarDrag,
  type TimebarDrag,
  type TimebarPart,
} from '../parts/timebar-model';
import { createSaveController, type SaveOutcome } from '../saving/useSave';
import { getSavePresentation, type SavePresentation } from '../saving/presentation';
import type { SaveWindow } from '../saving/window';
import type { SaveInput } from '../saving/types';
import { useAppFrame } from '../app/context';
import { staffCells, tableStaff, loadingTableStaff } from './model';
import { OtherEditMark } from './ShiftCell';
import { WarningMark, FailureMark } from '../parts/icons';
import { Toast } from '../parts/Toast';
import { shortTime } from '../format/time';

const hours = Array.from({ length: 16 }, (_, index) => `${index + 7}:00`);
const qualifications = { certified: '資格1', assistant: '資格2', none: 'なし' };
interface SelectedBand {
  table: 1 | 2;
  person: string;
  id: number;
}
interface DailyDraft {
  context: CellContext;
  slots: SlotDraft[];
}
interface DailyAttempt {
  context: CellContext;
  input: SaveInput;
}
/** Release the optimistic band when this save goes offline; the saving owner keeps retrying it. */
function createDailySaveController(
  saving: Pick<
    SaveWindow,
    'save' | 'resend' | 'discard' | 'subscribe' | 'closeDialog' | 'getPending'
  >,
  presentation: SavePresentation,
  offline: () => void,
) {
  let operationId: string | undefined;
  return createSaveController(
    {
      save: async (input, dialogOpen) => {
        operationId = await saving.save(input, dialogOpen);
        // The first offline event may arrive before save() returns its operation number.
        if (
          saving
            .getPending()
            .some((item) => item.operationId === operationId && item.state.kind === 'offline')
        )
          offline();
        return operationId;
      },
      resend: (id) => saving.resend(id),
      discard: (id) => saving.discard(id),
      closeDialog: (id) => saving.closeDialog(id),
      subscribe: (receive) =>
        saving.subscribe((event) => {
          receive(event);
          if (
            event.kind === 'state' &&
            event.pending.operationId === operationId &&
            event.pending.state.kind === 'offline'
          )
            offline();
        }),
    },
    presentation,
  );
}
function DailySave({
  attempt,
  done,
  offline,
}: {
  attempt: DailyAttempt;
  done: (outcome: SaveOutcome) => void;
  offline: () => void;
}) {
  const { saving } = useAppFrame();
  const callbacks = useRef({ done, offline });
  callbacks.current = { done, offline };
  const controller = useMemo(
    () =>
      saving
        ? createDailySaveController(saving, getSavePresentation(saving), () =>
            callbacks.current.offline(),
          )
        : null,
    [saving],
  );
  const started = useRef(false),
    finished = useRef(false);
  useEffect(() => {
    if (!started.current && controller) {
      started.current = true;
      void controller.save(attempt.input);
    }
  }, [attempt, controller]);
  useEffect(() => {
    if (!controller) return;
    const update = () => {
      const { outcome } = controller.getSnapshot();
      if (outcome && !finished.current) {
        finished.current = true;
        callbacks.current.done(outcome);
      }
    };
    const unsubscribe = controller.subscribe(update);
    update();
    return () => {
      unsubscribe();
      controller.dispose();
    };
  }, [controller]);
  return null;
}
function DailySaveNotice({ outcome, label }: { outcome: SaveOutcome; label: string }) {
  const failed = outcome.kind === 'failed';
  return createPortal(
    <Toast
      raised
      warn
      icon={failed ? <FailureMark size={26} /> : <WarningMark size={26} />}
      message={
        '保存できませんでした。' +
        (failed
          ? 'アプリ製作者にご連絡ください。'
          : outcome.kind === 'conflict'
            ? '相手から変更がありました。'
            : '入力を確認してください。')
      }
      label={label}
      code={failed ? outcome.code : undefined}
    />,
    document.body,
  );
}

/** Both tables share one selection, optimistic draft and save owner, including while the view changes. */
export function useDailyDrag({
  periodId,
  date,
  view,
  reload,
}: {
  periodId: string | undefined;
  date: string;
  view: ShiftView;
  reload: (id: string) => Promise<PeriodLoadResponse | undefined>;
}) {
  const { saving } = useAppFrame();
  const [selected, setSelected] = useState<SelectedBand | null>(null);
  const [draft, setDraft] = useState<DailyDraft | null>(null);
  const [attempt, setAttempt] = useState<DailyAttempt | null>(null);
  const [confirmation, setConfirmation] = useState<
    (DailyAttempt & NonNullable<ReturnType<typeof otherConfirmation>>) | null
  >(null);
  const [notice, setNotice] = useState<{ outcome: SaveOutcome; label: string } | null>(null);
  const blocked = Boolean(attempt || confirmation);
  const locked = useRef(blocked);
  locked.current = blocked;
  const drag = useRef<{
    calculation: TimebarDrag<SlotDraft>;
    context: CellContext;
    pointer: number;
    clientX: number;
    lane: HTMLElement;
    capture: HTMLElement;
    slots: SlotDraft[];
    cleanup: () => void;
  } | null>(null);
  const [dragging, setDragging] = useState(false);
  const cancelDrag = () => {
    const active = drag.current;
    drag.current = null;
    setDragging(false);
    active?.cleanup();
    if (active?.capture.hasPointerCapture(active.pointer))
      active.capture.releasePointerCapture(active.pointer);
  };
  useEffect(() => () => cancelDrag(), []);
  useLayoutEffect(() => {
    setSelected(null);
    setNotice(null);
    setConfirmation(null);
    cancelDrag();
    if (!attempt) setDraft(null);
  }, [periodId, date, view]);
  useEffect(() => {
    const outside = (event: globalThis.PointerEvent) => {
      if (locked.current || getOpenDialogCount() > 0) return;
      if (!(event.target instanceof Element) || !event.target.closest('.daily-work'))
        setSelected(null);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || getOpenDialogCount() > 0) return;
      setSelected(null);
      if (drag.current) {
        cancelDrag();
        setDraft(null);
      }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, []);
  useEffect(
    () =>
      saving?.subscribe((event) => {
        if (event.kind === 'state' && event.pending.state.kind === 'queued') setNotice(null);
      }),
    [saving],
  );
  const minuteAt = (clientX: number, lane: HTMLElement) =>
    dailyStart +
    ((layoutValue(clientX) - layoutRect(lane).left - dailyInset) * 60) / dailyHourWidth;
  const updateDrag = () => {
    const active = drag.current;
    if (!active) return;
    active.slots = moveTimebarDrag(active.calculation, minuteAt(active.clientX, active.lane));
    setDraft({ context: active.context, slots: active.slots });
  };
  const start = (
    event: PointerEvent<HTMLElement>,
    context: CellContext,
    id: number,
    part: TimebarPart,
  ) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    if (blocked || !saving) return;
    if (
      selected?.table !== context.building ||
      selected.person !== context.person.id ||
      selected.id !== id
    ) {
      setSelected({ table: context.building, person: context.person.id, id });
      return;
    }
    const slots = initialCell(context).form.slots,
      lane = event.currentTarget.closest<HTMLElement>('.daily-lane')!;
    const calculation = beginTimebarDrag(slots, id, part, minuteAt(event.clientX, lane));
    if (!calculation) return;
    const scroller = lane.closest<HTMLElement>('.daily-body')!;
    // Scroll events run before painting; commit the corrected band in that same frame.
    const scroll = () => flushSync(updateDrag);
    scroller.addEventListener('scroll', scroll);
    drag.current = {
      calculation,
      context,
      pointer: event.pointerId,
      clientX: event.clientX,
      lane,
      capture: event.currentTarget,
      slots,
      cleanup: () => scroller.removeEventListener('scroll', scroll),
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDraft({ context, slots });
    setDragging(true);
  };
  const move = (event: PointerEvent) => {
    const active = drag.current;
    if (!active || active.pointer !== event.pointerId) return;
    active.clientX = event.clientX;
    updateDrag();
  };
  const finish = (event: PointerEvent, role: Role, cancelled = false) => {
    const active = drag.current;
    if (!active || active.pointer !== event.pointerId) return;
    if (!cancelled)
      active.slots = moveTimebarDrag(active.calculation, minuteAt(event.clientX, active.lane));
    cancelDrag();
    const input = cancelled ? null : dailyDragSave(active.context, active.slots);
    if (!input) {
      setDraft(null);
      return;
    }
    setDraft({ context: active.context, slots: active.slots });
    setNotice(null);
    const question = otherConfirmation(active.context, input, role);
    const next = { context: active.context, input };
    if (question) setConfirmation({ ...next, ...question });
    else setAttempt(next);
  };
  const done = async (outcome: SaveOutcome) => {
    if (!attempt) return;
    if (outcome.kind === 'conflict') await reload(attempt.context.period.id);
    if (outcome.kind !== 'saved') {
      setSelected(null);
      if (outcome.kind !== 'reload-required') setNotice({ outcome, label: attempt.input.label });
    }
    setDraft(null);
    setAttempt(null);
  };
  return {
    selected,
    dragging,
    blocked,
    start,
    move,
    finish,
    dismissSelection: () => setSelected(null),
    preview: (data: PeriodLoadResponse) =>
      draft ? dailyPreview(data, draft.context, draft.slots) : data,
    controls: (
      <>
        {attempt && (
          <DailySave
            attempt={attempt}
            done={(outcome) => {
              void done(outcome);
            }}
            offline={() => {
              setDraft(null);
              setAttempt(null);
            }}
          />
        )}
        {confirmation && (
          <OtherShiftConfirmation
            context={confirmation.context}
            question={confirmation}
            saving={false}
            open
            close={() => {
              setConfirmation(null);
              setDraft(null);
            }}
            confirm={() => {
              setAttempt(confirmation);
              setConfirmation(null);
            }}
          />
        )}
        {notice && <DailySaveNotice {...notice} />}
      </>
    ),
  };
}

type DailyDrag = ReturnType<typeof useDailyDrag>;
function HourLines() {
  return (
    <>
      {hours.map((time) => (
        <i key={time} className="daily-vl" style={{ left: dailyInset + dailyPosition(time) }} />
      ))}
    </>
  );
}
function CoverageRow({
  facility,
  building,
  input,
  dragging,
}: {
  facility: Facility;
  building: 1 | 2;
  input: CoverageInput | null;
  dragging: boolean;
}) {
  const result = input ? facilityCoverage(facility, input) : null;
  const required = input?.period.coverage.find((row) => row.facility === facility);
  const opening = input ? resolvedDayOpening(input.date, facility, input.data, input.rules) : null;
  const [tip, setTip] = useState<{ segment: CoverageSegment; anchor: HTMLElement } | null>(null);
  const tipPopup = useRef<HTMLDivElement>(null);
  useFloating(tipPopup, { open: Boolean(tip && required && !dragging), anchor: () => tip?.anchor });
  useEffect(() => {
    if (dragging) setTip(null);
  }, [dragging]);
  const segments =
    result?.kind === 'checked'
      ? result.segments
      : result?.kind === 'not-configured' && opening
        ? [
            {
              startTime: opening.startTime,
              endTime: opening.endTime,
              sufficient: true,
              total: 0,
            },
          ]
        : [];
  return (
    <div className="daily-row daily-cover">
      <div className="daily-name">
        {!input ? (
          <Skeleton width="80px" />
        ) : (
          <>
            <FacilityCircle facility={facility} building={building} />
            <span
              className={`daily-need${result?.kind === 'not-configured' || result?.kind === 'unknown' ? ' placeholder' : ''}`}
            >
              {result?.kind === 'checked' && required ? (
                <>必要{required.total_required}人</>
              ) : result?.kind === 'closed' ? (
                '休業'
              ) : (
                '—'
              )}
            </span>
          </>
        )}
      </div>
      <div className="daily-lane">
        <HourLines />
        {segments.map((segment, index) => {
          const range = dailyRange(segment.startTime, segment.endTime);
          const previous = segments[index - 1],
            next = segments[index + 1];
          const joinedLeft = previous?.endTime === segment.startTime,
            joinedRight = next?.startTime === segment.endTime;
          const shortage =
            result?.kind === 'checked' && !segment.sufficient && required
              ? coverageShortage(required, segment)
              : null;
          return (
            <div
              key={segment.startTime}
              className={`daily-open${joinedLeft ? ' joined-left' : ''}${joinedRight ? ' joined-right' : ''}${joinedLeft && !previous.sufficient && !segment.sufficient ? ' shortage-divider' : ''}`}
              style={range}
            >
              <i
                className={segment.sufficient ? 'ok' : 'ng'}
                onMouseEnter={(event) => {
                  if (segment.sufficient || dragging) return;
                  setTip({ segment, anchor: event.currentTarget });
                }}
                onMouseLeave={() => setTip(null)}
              >
                {shortage !== null && (
                  <>
                    {range.width >= 40 && <WarningMark size={18} />}
                    {range.width >= 104 && <span>{shortage}人不足</span>}
                  </>
                )}
              </i>
            </div>
          );
        })}
      </div>
      {tip &&
        required &&
        !dragging &&
        createPortal(
          <div className="daily-tip" ref={tipPopup}>
            <b>
              {shortTime(tip.segment.startTime)}〜{shortTime(tip.segment.endTime)}
            </b>
            <br />
            {tip.segment.total}人
            {tip.segment.total < required.total_required &&
              `（${required.total_required - tip.segment.total}人不足）`}
          </div>,
          floatingHost(null),
        )}
    </div>
  );
}
function DailyWorkContent({ band }: { band: DailyBand }) {
  const content = useRef<HTMLSpanElement>(null),
    time = useRef<HTMLSpanElement>(null),
    measure = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(band.roles.length);
  const rolesKey = band.roles.join(',');
  useLayoutEffect(() => {
    const node = content.current,
      clock = time.current,
      samples = measure.current;
    if (!node || !clock) return;
    const fit = () => {
      const timeWidth = Math.max(...Array.from(clock.children, (child) => layoutRect(child).width));
      const facilityWidth = layoutRect(clock.previousElementSibling!).width;
      const timeGap = parseFloat(getComputedStyle(clock.parentElement!).columnGap);
      const padding =
        (layoutRect(node.parentElement!).width - facilityWidth - timeGap - timeWidth) / 2;
      node.style.setProperty('--daily-work-fit-padding', `${Math.max(6, padding)}px`);
      if (!samples) return;
      const widths = Array.from(samples.children, (child) => layoutRect(child).width);
      const more = widths.pop()!;
      const style = getComputedStyle(node);
      const available =
        node.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      const gap = parseFloat(getComputedStyle(samples).columnGap);
      let count = band.roles.length,
        width = widths.reduce((sum, value) => sum + value, 0);
      if (width + Math.max(0, count - 1) * gap > available) {
        do {
          width -= widths[--count];
        } while (count > 0 && width + count * gap + more > available);
      }
      setVisible(count);
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(node);
    for (const span of clock.children) observer.observe(span);
    if (samples) observer.observe(samples);
    return () => observer.disconnect();
  }, [rolesKey, band.start_time, band.end_time]);
  const hidden = band.roles.slice(visible);
  return (
    <span className="daily-work-in" ref={content}>
      <span className="daily-work-top">
        <span className="daily-area">{band.facility}</span>
        <span className="daily-time" ref={time}>
          <span>{shortTime(band.start_time)}</span>
          <span>
            〜{band.underline ? <u>{shortTime(band.end_time)}</u> : shortTime(band.end_time)}
          </span>
        </span>
      </span>
      {band.roles.length > 0 && (
        <>
          <span className="daily-roles">
            {band.roles.slice(0, visible).map((label) => (
              <span key={label} className={`daily-role${label === 'Y' ? ' y' : ''}`}>
                {label}
              </span>
            ))}
            {hidden.length > 0 && (
              <span className="daily-role" title={hidden.join('、')}>
                +{hidden.length}
              </span>
            )}
          </span>
          <span className="daily-roles daily-role-measure" ref={measure} aria-hidden="true">
            {band.roles.map((label) => (
              <span key={label} className={`daily-role${label === 'Y' ? ' y' : ''}`}>
                {label}
              </span>
            ))}
            <span className="daily-role">+{band.roles.length}</span>
          </span>
        </>
      )}
    </span>
  );
}
export function DailyTable({
  building,
  staff,
  period,
  periods,
  data,
  rules,
  today,
  date,
  role,
  openCell,
  openBulk,
  drag,
  arrive,
}: {
  building: 1 | 2;
  staff: readonly PeriodStaff[];
  period: PeriodSummary;
  periods: readonly PeriodSummary[];
  data: PeriodLoadResponse | null;
  rules: AnnualRules;
  today: string;
  date: string;
  role: Role;
  openCell: (person: PeriodStaff, date: string, building: 1 | 2) => void;
  openBulk: (person: PeriodStaff, building: 1 | 2) => void;
  drag: DailyDrag;
  arrive: boolean;
}) {
  const section = useRef<HTMLElement>(null),
    head = useRef<HTMLDivElement>(null),
    headScroll = useRef<HTMLDivElement>(null),
    body = useRef<HTMLDivElement>(null);
  const headDrag = useRef<{ pointer: number; x: number; left: number } | null>(null);
  const dismissing = useRef(false);
  const people = useMemo(
    () =>
      (data
        ? tableStaff(staff, period, building, data, today)
        : loadingTableStaff(staff, period, building, today)
      ).map((person) => {
        if (!data) return { person, cell: null, bands: [], qualification: null };
        const cells = new Map(
          ([1, 2] as const).map((site) => [
            site,
            staffCells(person, period, periods, site, data, rules, role).get(date)!,
          ]),
        );
        const cell = cells.get(building)!;
        return {
          person,
          cell,
          bands: dailyBands(cell, cells),
          qualification: historyForPeriod(person.history, periods, period.start_date)!
            .qualification,
        };
      }),
    [staff, period, periods, building, data, rules, today, date, role],
  );
  useLayoutEffect(() => {
    headDrag.current = null;
    if (!headScroll.current || !body.current) return;
    body.current.scrollLeft = data ? dailyScrollPosition(building, date, data, rules) : 0;
    headScroll.current.scrollLeft = body.current.scrollLeft;
  }, [building, date, period.id, Boolean(data)]);
  const scrollDailyTo = (left: number) => {
    if (!body.current || !headScroll.current) return;
    body.current.scrollLeft = left;
    headScroll.current.scrollLeft = body.current.scrollLeft;
  };
  useEffect(() => {
    const header = head.current;
    if (!header) return;
    const wheel = (event: WheelEvent) => {
      if (event.defaultPrevented) return;
      const delta = event.deltaX || (event.shiftKey ? event.deltaY : 0);
      if (!delta || !body.current) return;
      scrollDailyTo(body.current.scrollLeft + layoutValue(delta));
      event.preventDefault();
    };
    header.addEventListener('wheel', wheel, { passive: false });
    return () => header.removeEventListener('wheel', wheel);
  }, []);
  useLayoutEffect(() => {
    const node = section.current;
    if (!drag.dragging || !node) return;
    headDrag.current = null;
    const wheel = (event: WheelEvent) => {
      if (event.deltaX || (event.shiftKey && event.deltaY)) event.preventDefault();
    };
    node.addEventListener('wheel', wheel, { passive: false, capture: true });
    return () => node.removeEventListener('wheel', wheel, true);
  }, [drag.dragging]);
  useLayoutEffect(() => {
    const node = section.current,
      header = headScroll.current,
      scroller = body.current;
    if (!arrive || !node || !header || !scroller) return;
    const band = node.querySelector<HTMLElement>('.band')!;
    scrollWindow(layoutRect(band).top + viewport().scrollY - 12);
    const shortages = Array.from(node.querySelectorAll<HTMLElement>('.daily-open i.ng'));
    if (!shortages.length) return;
    const left = Math.min(
      ...shortages.map(
        (shortage) => layoutRect(shortage).left - layoutRect(shortage.closest('.daily-lane')!).left,
      ),
    );
    scroller.scrollLeft =
      Math.max(0, Math.floor((left - dailyInset) / dailyHourWidth) - 1) * dailyHourWidth;
    header.scrollLeft = scroller.scrollLeft;
    shortages.forEach((shortage) => shortage.classList.remove('arrive'));
    const on = setTimeout(
      () => shortages.forEach((shortage) => shortage.classList.add('arrive')),
      motionMs(node, '--motion-daily-arrive-delay'),
    );
    const off = setTimeout(
      () => shortages.forEach((shortage) => shortage.classList.remove('arrive')),
      motionMs(node, '--motion-daily-arrive-delay') + motionMs(node, '--motion-daily-arrive'),
    );
    return () => {
      clearTimeout(on);
      clearTimeout(off);
      shortages.forEach((shortage) => shortage.classList.remove('arrive'));
    };
  }, [arrive, building, date, period.id]);
  useLayoutEffect(() => {
    const node = section.current,
      header = head.current;
    if (!node || !header) return;
    header.classList.remove('lift', 'gone');
    if (people.length <= 2) return;
    const place = () => {
      const rows = node.querySelectorAll<HTMLElement>('.daily-person');
      const lifted =
        layoutRect(node).top + node.querySelector<HTMLElement>('.band')!.offsetHeight < 12;
      header.classList.toggle('lift', lifted);
      header.classList.toggle(
        'gone',
        lifted && layoutRect(rows[rows.length - 2]).top < 12 + header.offsetHeight - 1,
      );
    };
    place();
    document.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    const observer = new ResizeObserver(place);
    observer.observe(node);
    return () => {
      document.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
      observer.disconnect();
    };
  }, [people.length]);
  const name = building === 1 ? '第一事業所' : '第二事業所';
  return (
    <section
      ref={section}
      className={`shift-table-section daily-section site${building}${people.length > 2 ? ' island' : ''}${drag.dragging ? ' dragging' : ''}`}
      style={
        {
          '--daily-hour-width': `${dailyHourWidth}px`,
          '--daily-inset': `${dailyInset}px`,
          '--daily-name-width': `${dailyNameWidth}px`,
          '--daily-lane-width': `${dailyLaneWidth}px`,
        } as CSSProperties
      }
      onPointerDownCapture={() => {
        dismissing.current = Boolean(drag.selected);
      }}
    >
      <ShiftBand
        building={building}
        name={name}
        count={data ? people.length : null}
        view="日別"
        requestsClosed={Boolean(period.requests_closed_at)}
      />
      <div
        className="daily-head"
        ref={head}
        onPointerDown={(event) => {
          if (drag.dragging || event.button !== 0 || event.pointerType !== 'mouse' || !body.current)
            return;
          event.preventDefault();
          headDrag.current = {
            pointer: event.pointerId,
            x: layoutValue(event.clientX),
            left: body.current.scrollLeft,
          };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const active = headDrag.current;
          if (active?.pointer === event.pointerId)
            scrollDailyTo(active.left - (layoutValue(event.clientX) - active.x));
        }}
        onPointerUp={() => {
          headDrag.current = null;
        }}
        onPointerCancel={() => {
          headDrag.current = null;
        }}
        onLostPointerCapture={() => {
          headDrag.current = null;
        }}
      >
        <div
          className="daily-head-scroll"
          ref={headScroll}
          onScroll={() => {
            if (body.current && headScroll.current)
              body.current.scrollLeft = headScroll.current.scrollLeft;
          }}
        >
          <div className="daily-grid">
            <div className="daily-row daily-axis">
              <div className="daily-name">スタッフ名</div>
              <div className="daily-lane">
                {hours.map((time) => {
                  const [hour, minute] = time.split(':');
                  return (
                    <time
                      key={time}
                      dateTime={time.padStart(5, '0')}
                      className="daily-axis-time"
                      style={{ left: dailyInset + dailyPosition(time) }}
                    >
                      <b>{hour}</b>
                      <small>:{minute}</small>
                    </time>
                  );
                })}
                <HourLines />
              </div>
            </div>
            {(building === 1 ? (['A', 'B'] as const) : (['C', 'D'] as const)).map((facility) => (
              <CoverageRow
                key={`${date}-${facility}`}
                facility={facility}
                building={building}
                input={data ? { date, period, periods, staff, rules, data } : null}
                dragging={drag.dragging}
              />
            ))}
          </div>
        </div>
      </div>
      <div
        className="daily-body"
        ref={body}
        onScroll={() => {
          if (headScroll.current && body.current)
            headScroll.current.scrollLeft = body.current.scrollLeft;
        }}
      >
        <div className="daily-grid">
          {people.map(({ person, qualification, cell, bands }, index) => (
            <div key={person.id} className={`daily-row daily-person${index % 2 ? ' alt' : ''}`}>
              <button
                type="button"
                className="daily-name"
                disabled={drag.blocked}
                onClick={(event) => {
                  if (event.detail === 0 && drag.selected) {
                    drag.dismissSelection();
                    return;
                  }
                  if (event.detail === 0 || !dismissing.current) openBulk(person, building);
                }}
              >
                {!data ? (
                  <div className="shift-skeleton-name">
                    <Skeleton width="96px" />
                    <Skeleton width="52px" />
                  </div>
                ) : (
                  <>
                    <b>{person.name}</b>
                    <span>{qualifications[qualification!]}</span>
                  </>
                )}
              </button>
              <div
                className="daily-lane"
                tabIndex={drag.blocked ? -1 : 0}
                onClick={(event) => {
                  if (!drag.blocked && (event.detail === 0 || !dismissing.current))
                    openCell(person, date, building);
                }}
                onKeyDown={(event) => {
                  if (
                    !drag.blocked &&
                    event.target === event.currentTarget &&
                    ['Enter', ' '].includes(event.key)
                  ) {
                    event.preventDefault();
                    openCell(person, date, building);
                  }
                }}
              >
                <HourLines />
                {!data || !cell ? null : bands.length ? (
                  bands.map((band) => (
                    <span
                      key={band.id}
                      data-slot={band.id}
                      className={`daily-work c${band.building}${drag.selected?.table === building && drag.selected.person === person.id && drag.selected.id === band.id ? ' sel' : ''}${drag.dragging && drag.selected?.table === building && drag.selected.person === person.id && drag.selected.id === band.id ? ' drag' : ''}`}
                      style={dailyRange(band.start_time, band.end_time)}
                      onClick={(event) => event.stopPropagation()}
                      onPointerDown={(event) => {
                        if (
                          !(event.target instanceof Element) ||
                          !event.target.closest('.daily-edit')
                        )
                          drag.start(
                            event,
                            { person, date, building, period, periods, data, rules },
                            band.id,
                            'move',
                          );
                      }}
                      onPointerMove={drag.move}
                      onPointerUp={(event) => drag.finish(event, role)}
                      onPointerCancel={(event) => drag.finish(event, role, true)}
                    >
                      <DailyWorkContent band={band} />
                      {band.otherEdit && (
                        <span
                          className="daily-mark"
                          title={drag.dragging ? undefined : band.otherEdit.text}
                        >
                          <OtherEditMark />
                        </span>
                      )}
                      <i
                        className="daily-h timebar-handle start"
                        onPointerDown={(event) =>
                          drag.start(
                            event,
                            { person, date, building, period, periods, data, rules },
                            band.id,
                            'start',
                          )
                        }
                      />
                      <i
                        className="daily-h timebar-handle end"
                        onPointerDown={(event) =>
                          drag.start(
                            event,
                            { person, date, building, period, periods, data, rules },
                            band.id,
                            'end',
                          )
                        }
                      />
                      <button
                        type="button"
                        className="daily-edit"
                        disabled={drag.blocked}
                        onClick={(event) => {
                          event.stopPropagation();
                          if (!drag.blocked) openCell(person, date, building);
                        }}
                      >
                        <Pencil size={18} />
                        編集
                      </button>
                    </span>
                  ))
                ) : cell.kind === 'blank' ? (
                  <span className="daily-plus">＋</span>
                ) : (
                  <span
                    className={`daily-off${cell.kind === 'paid_leave' ? ' paid' : cell.kind === 'empty' ? ' empty' : ''}`}
                    title={cell.kind === 'closure' ? cell.label : undefined}
                    style={dailyRange('07:00', '22:00')}
                    onClick={(event) => event.stopPropagation()}
                  >
                    <span className="shift-rest-label">{cell.label}</span>
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
