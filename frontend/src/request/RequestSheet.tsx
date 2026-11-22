import './request-sheet.css';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { motionMs } from '../parts/motion';
import type {
  RequestSheetDailyRequest,
  RequestSheetResponse,
  RequestSheetStaff,
  SaveRequest,
} from '../../../shared/protocol';
import { holidayName } from '../../../shared/holidays';
import {
  deadlineStatus,
  loadFailure,
  otherRequests,
  rememberedStaff,
  rememberedStaffKey,
  requestKey,
  timeFrom,
  weekdays,
  type LoadFailure,
} from './model';
import { Check, FailureIcon, Flag, Lock, Person, Shape } from './icons';
import { RequestDialog } from './RequestDialog';
import { createRequestSubmit, type SubmitRequest } from './request-submit';
import { useRequestArrival } from './useRequestArrival';
import { SubmissionGuide } from './SubmissionGuide';
import {
  buildRequest,
  conflictMessage,
  noRequestState,
  requestWasApplied,
  retryRequest,
  uncertainMessage,
} from './submission';
import { slashDayLabel } from '../format/date';
import { periodDates } from '../../../shared/period';
import { loadSheet, readChangeNumber, readRequests } from '../loading/request-sheet';

function Top({ sheet }: { sheet?: RequestSheetResponse }) {
  const deadline =
    sheet && deadlineStatus(sheet.period.request_deadline_date, sheet.requestsClosed);
  return (
    <header className={`rq-top${sheet ? '' : ' rq-loading'}`}>
      <div className="rq-logo">テスト事業所</div>
      {sheet && (
        <>
          <div className="rq-title">{sheet.period.name}の希望</div>
          <div className="rq-period">
            {slashDayLabel(sheet.period.start_date)}〜{slashDayLabel(sheet.period.end_date)}
          </div>
          <div className={`rq-deadline rq-${deadline!.kind}`}>
            <span>締め切り {slashDayLabel(sheet.period.request_deadline_date)}</span>
            <span className="rq-left">{deadline!.text}</span>
          </div>
        </>
      )}
    </header>
  );
}

function Mine({
  request,
  part,
  onClick,
  just,
}: {
  request?: RequestSheetDailyRequest;
  part: boolean;
  onClick?: () => void;
  just: boolean;
}) {
  if (!request && !onClick) return <div className="rq-mine-none" />;
  const label = !request
    ? '＋'
    : part
      ? `${request.start_time}〜${request.end_time}`
      : request.kind === 'time_unavailable'
        ? timeFrom(request.start_time)
        : { unavailable: '終日', am_unavailable: '午前', pm_unavailable: '午後', available: '' }[
            request.kind
          ];
  const content = (
    <>
      {request && <Shape kind={part ? 'available' : request.kind} />}
      <span>{label}</span>
    </>
  );
  const className = `rq-mine${part ? ' rq-wide' : ''}${request ? '' : ' rq-empty'}${just ? ' rq-just' : ''}`;
  return onClick ? (
    <button className={className} onClick={onClick}>
      {content}
    </button>
  ) : (
    <div className={className}>{content}</div>
  );
}

function SheetTable({
  sheet,
  me,
  fresh,
  pick,
  just,
}: {
  sheet: RequestSheetResponse;
  me: RequestSheetStaff;
  fresh: Set<string>;
  pick: (date: string) => void;
  just?: string;
}) {
  const part = me.employment_type === 'casual';
  const closedDates = new Set(sheet.closedDates);
  return (
    <>
      <div className={`rq-colhead${part ? ' rq-part' : ''}`}>
        <span>日</span>
        {part ? (
          <span>自分が入れる時間</span>
        ) : (
          <>
            <span>入れない他の人</span>
            <span>自分</span>
          </>
        )}
      </div>
      {periodDates(sheet.period).map((date) => {
        const value = new Date(`${date}T00:00:00Z`),
          weekday = value.getUTCDay();
        const rest = closedDates.has(date),
          red = weekday === 0 || holidayName(date) !== undefined;
        const color = red ? ' rq-sun' : weekday === 6 ? ' rq-sat' : '';
        const events = sheet.events.filter((event) => event.date === date);
        const mine = sheet.dailyRequests.find(
          (request) => request.date === date && request.staff_id === me.id,
        );
        const onClick = sheet.requestsClosed ? undefined : () => pick(date);
        return (
          <div className={`rq-day${color}${rest ? ' rq-rest' : part ? ' rq-part' : ''}`} key={date}>
            <div className="rq-date">
              {value.getUTCDate()}
              <span className="rq-dow">{weekdays[weekday]}</span>
            </div>
            {rest ? (
              <div className="rq-day-body">お休みの日</div>
            ) : (
              <>
                <div className="rq-day-body">
                  {events.map((event, index) => (
                    <div
                      className={`rq-event rq-c${event.building}`}
                      key={`${event.building}/${index}`}
                    >
                      <Flag />
                      <span>{event.name}</span>
                      <span className="rq-site">{event.building === 1 ? '第一' : '第二'}</span>
                    </div>
                  ))}
                  {part ? (
                    <Mine request={mine} part onClick={onClick} just={just === date} />
                  ) : (
                    <div className="rq-groups">
                      {otherRequests(sheet.dailyRequests, sheet.staff, me.id, date).map((group) => (
                        <div className="rq-grp" key={group.kind}>
                          <span className="rq-gh">
                            <Shape kind={group.kind} />
                          </span>
                          <span className="rq-gn">
                            {group.names.map((person) => (
                              <span
                                className={fresh.has(person.key) ? 'rq-fresh' : undefined}
                                key={person.key}
                              >
                                {person.name}
                                {person.time && <small>{person.time}</small>}
                              </span>
                            ))}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                {!part && (
                  <Mine request={mine} part={false} onClick={onClick} just={just === date} />
                )}
              </>
            )}
          </div>
        );
      })}
    </>
  );
}

function NoneButton({
  sheet,
  me,
  submit,
}: {
  sheet: RequestSheetResponse;
  me: RequestSheetStaff;
  submit: SubmitRequest;
}) {
  const state = noRequestState(sheet, me.id),
    part = me.employment_type === 'casual';
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string>();
  const previous = useRef<SaveRequest>(undefined);
  useEffect(() => {
    if (
      previous.current &&
      error === uncertainMessage &&
      requestWasApplied(sheet, previous.current)
    ) {
      previous.current = undefined;
      setError(undefined);
    }
  }, [sheet, error]);
  const press = async () => {
    if (busy || state === 'disabled') return;
    const clearing = state === 'submitted';
    setBusy(true);
    setError(undefined);
    try {
      const request = retryRequest(
        previous.current,
        buildRequest(
          sheet,
          me.id,
          clearing ? 'request.none.clear' : 'request.none.set',
          crypto.randomUUID(),
        ),
      );
      previous.current = request;
      const result = await submit(request);
      previous.current = undefined;
      if (typeof result === 'object') setError(conflictMessage);
    } catch {
      setError(uncertainMessage);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="rq-none-top">
      <button
        className={`rq-submit-btn ${state === 'submitted' ? 'rq-btn-main rq-none-done' : 'rq-btn-sub'}`}
        disabled={busy || state === 'disabled'}
        onClick={() => void press()}
      >
        {busy ? <span className="rq-spinner" /> : state === 'submitted' && <Check />}
        {state === 'submitted'
          ? '「希望なし」で提出しました'
          : part
            ? '入れる日がない（希望なしで提出）'
            : '入れない日はない（希望なしで提出）'}
      </button>
      {state !== 'empty' && (
        <p className="rq-none-note">
          {state === 'submitted' ? '押すと、取り消します' : '希望を提出してあるので、押せません'}
        </p>
      )}
      {error && (
        <p className="rq-none-error">
          {error}
          {error === uncertainMessage && (
            <>
              <br />
              もう一度押してください。
            </>
          )}
        </p>
      )}
    </div>
  );
}

function Toast({
  text,
  detail,
  closing,
  dismiss,
}: {
  text: string;
  detail: string;
  closing?: boolean;
  dismiss: () => void;
}) {
  const [open, setOpen] = useState(false);
  const toast = useRef<HTMLDivElement>(null);
  const dismissRef = useRef(dismiss);
  dismissRef.current = dismiss;
  useEffect(() => {
    const duration = motionMs(toast.current!, '--rq-motion-duration');
    if (closing) setOpen(false);
    const frame = closing ? undefined : requestAnimationFrame(() => setOpen(true));
    const hide = closing ? undefined : setTimeout(() => setOpen(false), 2000);
    const remove = setTimeout(() => dismissRef.current(), (closing ? 0 : 2000) + duration);
    return () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      clearTimeout(hide);
      clearTimeout(remove);
    };
  }, [closing]);
  return (
    <div className={`rq-toast${open ? ' rq-open' : ''}`} ref={toast}>
      <span className="rq-mark">
        <Check />
      </span>
      <span>
        <b>{text}</b>
        <small>{detail}</small>
      </span>
    </div>
  );
}

export function RequestSheet() {
  const [key] = useState(() => {
    try {
      return decodeURIComponent(window.location.pathname.slice('/kibo/'.length));
    } catch {
      return '';
    }
  });
  const [sheet, setSheet] = useState<RequestSheetResponse>();
  const [failure, setFailure] = useState<LoadFailure>();
  const [attempt, setAttempt] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [fresh, setFresh] = useState(new Set<string>());
  const [picked, setPicked] = useState<string>();
  const [just, setJust] = useState<string>();
  const [toast, setToast] = useState<{
    text: string;
    detail: string;
    id: string;
    closing?: boolean;
  }>();
  const page = useRef<HTMLDivElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const prepareArrival = useRequestArrival(scroll, sheet?.dailyRequests, selectedId);
  const latest = useRef<RequestSheetResponse>(undefined);
  const pollController = useRef<AbortController>(undefined);
  const writes = useRef(0);
  const updateSheet = (data: RequestSheetResponse) => {
    latest.current = data;
    setSheet(data);
  };

  useLayoutEffect(() => {
    const backgrounds = [document.documentElement, document.body].map((element) => ({
      element,
      value: element.style.getPropertyValue('background-color'),
      priority: element.style.getPropertyPriority('background-color'),
    }));
    backgrounds.forEach(({ element }) =>
      element.style.setProperty('background-color', 'var(--action)'),
    );
    const existing = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    const theme = existing ?? document.createElement('meta');
    const content = theme.getAttribute('content');
    theme.name = 'theme-color';
    theme.content = getComputedStyle(page.current!).getPropertyValue('--action').trim();
    if (!existing) document.head.append(theme);
    return () => {
      backgrounds.forEach(({ element, value, priority }) => {
        if (value) element.style.setProperty('background-color', value, priority);
        else element.style.removeProperty('background-color');
      });
      if (!existing) theme.remove();
      else if (content === null) theme.removeAttribute('content');
      else theme.setAttribute('content', content);
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setFailure(undefined);
    if (!key) {
      setFailure('badurl');
      return () => controller.abort();
    }
    void loadSheet(key, controller.signal)
      .then((data) => {
        if (controller.signal.aborted) return;
        let id: string | null = null;
        try {
          id = localStorage.getItem(rememberedStaffKey);
        } catch {
          /* 名前は、この画面で選べる。 */
        }
        setSelectedId(rememberedStaff(data.staff, id)?.id ?? null);
        setFresh(new Set());
        updateSheet(data);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setFailure(loadFailure(error));
      });
    return () => controller.abort();
  }, [key, attempt]);

  const periodId = sheet?.period.id;
  useEffect(() => {
    if (!sheet) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let active: AbortController | undefined;
    let disposed = false;
    const schedule = () => {
      if (!disposed && document.visibilityState === 'visible')
        timer = setTimeout(() => void poll(), 10000);
    };
    const poll = async () => {
      if (disposed || document.visibilityState !== 'visible') return;
      const controller = new AbortController();
      active = controller;
      pollController.current = controller;
      try {
        if (writes.current) return;
        const change = await readChangeNumber(key, controller.signal);
        if (controller.signal.aborted) return;
        let current = { ...latest.current!, requestsClosed: change.requestsClosed };
        updateSheet(current);
        if (change.requestChangeNumber !== current.requestChangeNumber) {
          const requests = await readRequests(key, controller.signal);
          if (controller.signal.aborted) return;
          const previous = new Set(current.dailyRequests.map(requestKey));
          setFresh(
            new Set(
              requests.dailyRequests
                .filter((request) => !previous.has(requestKey(request)))
                .map(requestKey),
            ),
          );
          prepareArrival();
          current = { ...current, ...requests };
          updateSheet(current);
        }
      } catch {
        /* 電波が戻ったら、次の回で確かめる。 */
      } finally {
        if (active === controller) {
          active = undefined;
          schedule();
        }
      }
    };
    const visibility = () => {
      clearTimeout(timer);
      active?.abort();
      active = undefined;
      if (document.visibilityState === 'visible') void poll();
    };
    schedule();
    document.addEventListener('visibilitychange', visibility);
    return () => {
      disposed = true;
      clearTimeout(timer);
      active?.abort();
      document.removeEventListener('visibilitychange', visibility);
    };
    // 希望の更新でタイマーを作り直さず、最初に読んだピリオドごとに開始する。
  }, [periodId, key]);

  useEffect(() => {
    scroll.current?.scrollTo(0, 0);
  }, [selectedId]);
  useEffect(() => {
    const element = page.current!;
    const wheel = (event: WheelEvent) => {
      if (
        event.ctrlKey ||
        !(event.target instanceof Node) ||
        scroll.current?.contains(event.target) ||
        !element.isSameNode(event.target)
      )
        return;
      event.preventDefault();
      if (!picked)
        scroll.current?.scrollBy({
          top:
            event.deltaY *
            (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1),
        });
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, [picked]);
  useEffect(() => {
    if (sheet?.requestsClosed || failure) setPicked(undefined);
  }, [sheet?.requestsClosed, failure]);
  useEffect(() => {
    if (!just) return;
    const timer = setTimeout(() => setJust(undefined), 1200);
    return () => clearTimeout(timer);
  }, [just]);

  const submit = createRequestSubmit({
    key,
    latest,
    writes,
    pollController,
    setFresh,
    updateSheet,
    setPicked,
    setFailure,
  });

  const choose = (id: string | null) => {
    setSelectedId(id);
    setFresh(new Set());
    setPicked(undefined);
    setToast(undefined);
    setJust(undefined);
    try {
      if (id) localStorage.setItem(rememberedStaffKey, id);
      else localStorage.removeItem(rememberedStaffKey);
    } catch {
      /* 保存できない場合も、その場で表は開ける。 */
    }
  };
  const me = sheet && rememberedStaff(sheet.staff, selectedId);
  return (
    <div className="rq-page" ref={page}>
      <div className="rq-frame">
        <div className="rq-scroll" ref={scroll}>
          {failure ? (
            <div className="rq-whole">
              <FailureIcon badUrl={failure === 'badurl'} />
              <b>{failure === 'badurl' ? 'このURLは使えません' : '読み込めませんでした'}</b>
              <p>
                {failure === 'badurl'
                  ? '担当者から届いた、いちばん新しいURLを開いてください。'
                  : '電波の良い所で、もう一度お試しください。'}
              </p>
              {failure === 'loaderr' && (
                <button className="rq-btn" onClick={() => setAttempt((value) => value + 1)}>
                  もう一度読み込む
                </button>
              )}
            </div>
          ) : (
            <>
              <Top sheet={sheet} />
              {!sheet && (
                <div className="rq-load-progress" role="status" aria-label="読み込み中">
                  <span className="rq-spinner" />
                </div>
              )}
              {sheet &&
                (me ? (
                  <>
                    <div className="rq-me">
                      <span className="rq-name">
                        {me.name}さん
                        <span className="rq-kind">
                          {me.employment_type === 'casual' ? 'アルバイト' : 'スタッフ'}
                        </span>
                      </span>
                      <button className="rq-link-btn" onClick={() => choose(null)}>
                        別の人を選ぶ
                      </button>
                    </div>
                    {!sheet.requestsClosed && (
                      <>
                        <SubmissionGuide part={me.employment_type === 'casual'} />
                        <NoneButton key={me.id} sheet={sheet} me={me} submit={submit} />
                      </>
                    )}
                    {sheet.requestsClosed && (
                      <div className="rq-closed-note">
                        <b>
                          <Lock />
                          締め切りました
                        </b>
                        <p>もう提出できません。変更は、担当者に直接伝えてください。</p>
                      </div>
                    )}
                    <SheetTable
                      key={me.id}
                      sheet={sheet}
                      me={me}
                      fresh={fresh}
                      pick={(date) => {
                        setToast((current) => current && { ...current, closing: true });
                        setPicked(date);
                      }}
                      just={just}
                    />
                  </>
                ) : (
                  <>
                    <p className="rq-sec-t">
                      <Person />
                      1. 名前を選ぶ
                    </p>
                    <div className="rq-names">
                      {sheet.staff.map((person) => (
                        <button key={person.id} onClick={() => choose(person.id)}>
                          {person.name}
                        </button>
                      ))}
                    </div>
                  </>
                ))}
            </>
          )}
        </div>
        {sheet && me && picked && !sheet.requestsClosed && !failure && (
          <RequestDialog
            key={`${me.id}/${picked}`}
            sheet={sheet}
            me={me}
            date={picked}
            submit={submit}
            dismiss={() => setPicked(undefined)}
            complete={(text, detail, date) => {
              setToast({ text, detail, id: crypto.randomUUID() });
              setJust(date);
            }}
          />
        )}
        {toast && <Toast key={toast.id} {...toast} dismiss={() => setToast(undefined)} />}
      </div>
    </div>
  );
}
