import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from 'react';
import { motionMs } from '../parts/motion';
import { usePressGuard } from '../parts/usePressGuard';
import type {
  RequestSheetResponse,
  RequestSheetStaff,
  SaveRequest,
} from '../../../shared/protocol';
import { Check, Flag, Shape } from './icons';
import { otherRequests, unavailableKinds } from './model';
import {
  buildRequest,
  conflictMessage,
  dayTitle,
  draftStatus,
  formatTime,
  normalizeTime,
  requestWasApplied,
  retryRequest,
  submissionDetail,
  uncertainMessage,
  type RequestDraft,
} from './submission';
import { WarningMark } from '../parts/icons';
import { dismissRequest } from './request-dismiss';
import { beginRequestDrag } from './request-drag';
import type { SubmitRequest } from './request-submit';

export function RequestDialog({
  sheet,
  me,
  date,
  submit,
  dismiss,
  complete,
}: {
  sheet: RequestSheetResponse;
  me: RequestSheetStaff;
  date: string;
  submit: SubmitRequest;
  dismiss: () => void;
  complete: (text: string, detail: string, just?: string) => void;
}) {
  const part = me.employment_type === 'casual';
  const [saved, setSaved] = useState(() =>
    sheet.dailyRequests.find((row) => row.staff_id === me.id && row.date === date),
  );
  const [draft, setDraft] = useState<RequestDraft>(() => ({
    kind: saved?.kind ?? (part ? 'available' : null),
    from: saved?.start_time ? formatTime(saved.start_time)! : '14:00',
    to: saved?.end_time ? formatTime(saved.end_time)! : '18:00',
    memo: '',
  }));
  const [editingMemo, setEditingMemo] = useState(!saved?.has_memo);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<'idle' | 'saving' | 'deleting' | 'done'>('idle');
  const [error, setError] = useState<'save' | 'delete' | 'conflict'>();
  const [errorVisible, setErrorVisible] = useState(false);
  const [dragOffset, setDragOffset] = useState<number>();
  const drag = useRef<{ pointerId: number; startY: number; handle: HTMLDivElement }>(undefined);
  const panel = useRef<HTMLDivElement>(null),
    from = useRef<HTMLInputElement>(null),
    to = useRef<HTMLInputElement>(null);
  const memoInput = useRef<HTMLInputElement>(null);
  const previous = useRef<SaveRequest>(undefined);
  const sentDraft = useRef(draft);
  const pressGuard = usePressGuard();
  const sending = useRef(false);
  const finishRef = useRef<() => void>(undefined);
  const alive = useRef(true),
    closing = useRef(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const dismissRef = useRef(dismiss);
  dismissRef.current = dismiss;
  const successTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const focusTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const locked = status !== 'idle';
  const validation = draftStatus(draft);
  const typed = part || draft.kind === 'time_unavailable';
  const fixed = [
    { kind: null, from: '', to: '' },
    { kind: 'unavailable', from: '始業', to: '終業' },
    { kind: 'am_unavailable', from: '始業', to: '12:00' },
    { kind: 'pm_unavailable', from: '12:00', to: '終業' },
  ];

  useLayoutEffect(() => {
    alive.current = true;
    let first = 0,
      second = 0;
    if (!motionMs(panel.current!, '--rq-motion-duration')) setOpen(true);
    else
      first = requestAnimationFrame(() => {
        second = requestAnimationFrame(() => setOpen(true));
      });
    return () => {
      alive.current = false;
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
      clearTimeout(closeTimer.current);
      clearTimeout(successTimer.current);
      clearTimeout(focusTimer.current);
      const current = drag.current;
      drag.current = undefined;
      if (current?.handle.hasPointerCapture(current.pointerId))
        current.handle.releasePointerCapture(current.pointerId);
    };
  }, [date]);

  useLayoutEffect(() => {
    if (saved?.has_memo && editingMemo) memoInput.current?.focus();
  }, [editingMemo, saved]);

  const resetToCurrent = (current: RequestSheetResponse) => {
    const value = current.dailyRequests.find((row) => row.staff_id === me.id && row.date === date);
    setSaved(value);
    setDraft({
      kind: value?.kind ?? (part ? 'available' : null),
      from: value?.start_time ? formatTime(value.start_time)! : '14:00',
      to: value?.end_time ? formatTime(value.end_time)! : '18:00',
      memo: '',
    });
    setEditingMemo(!value?.has_memo);
  };

  useEffect(() => {
    if (error === 'conflict') {
      const value = sheet.dailyRequests.find((row) => row.staff_id === me.id && row.date === date);
      if (value?.revision !== saved?.revision) resetToCurrent(sheet);
    } else if (error && previous.current && requestWasApplied(sheet, previous.current)) {
      const deleting = previous.current.operation === 'request.day.delete';
      previous.current = undefined;
      setError(undefined);
      setErrorVisible(false);
      close();
      complete(
        deleting ? '取り消しました' : '提出しました',
        deleting ? dayTitle(date) : submissionDetail(date, sentDraft.current),
        deleting ? undefined : date,
      );
    }
  }, [sheet, error]);

  const resetDrag = () => {
    const current = drag.current;
    drag.current = undefined;
    setDragOffset(undefined);
    if (current?.handle.hasPointerCapture(current.pointerId))
      current.handle.releasePointerCapture(current.pointerId);
  };
  const startDrag = (event: PointerEvent<HTMLDivElement>) =>
    beginRequestDrag(event, {
      drag,
      locked,
      closing: closing.current,
      open,
      stopFocus: () => clearTimeout(focusTimer.current),
      setDragOffset,
    });
  const moveDrag = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    setDragOffset(Math.max(0, event.clientY - current.startY));
  };
  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const distance = Math.max(0, event.clientY - current.startY);
    resetDrag();
    if (distance >= panel.current!.getBoundingClientRect().height / 4) close();
  };
  const close = () => {
    if (closing.current) return;
    resetDrag();
    closing.current = true;
    clearTimeout(focusTimer.current);
    setOpen(false);
    closeTimer.current = setTimeout(
      () => dismissRef.current(),
      motionMs(panel.current!, '--rq-motion-duration'),
    );
  };
  const dismissOutside = () => {
    dismissRequest(sending.current, status, finishRef.current, pressGuard.blocked, close);
  };
  const send = async (deleting: boolean) => {
    if (sending.current || locked || closing.current || (!deleting && !validation.canSubmit))
      return;
    sending.current = true;
    resetDrag();
    setError(undefined);
    setErrorVisible(false);
    setStatus(deleting ? 'deleting' : 'saving');
    try {
      const request = retryRequest(
        previous.current,
        buildRequest(
          sheet,
          me.id,
          deleting ? 'request.day.delete' : 'request.day.save',
          crypto.randomUUID(),
          date,
          draft,
        ),
      );
      previous.current = request;
      sentDraft.current = draft;
      const result = await submit(request);
      if (!alive.current || closing.current || result === 'dismissed') return;
      previous.current = undefined;
      if (typeof result === 'object') {
        resetToCurrent(result.sheet);
        setStatus('idle');
        setError('conflict');
        setErrorVisible(true);
        return;
      }
      const finish = () => {
        if (closing.current) return;
        clearTimeout(successTimer.current);
        close();
        complete(
          deleting ? '取り消しました' : '提出しました',
          deleting ? dayTitle(date) : submissionDetail(date, draft),
          deleting ? undefined : date,
        );
      };
      if (deleting) finish();
      else {
        finishRef.current = finish;
        setStatus('done');
        successTimer.current = setTimeout(finish, 800);
      }
    } catch {
      if (alive.current && !closing.current) {
        setStatus('idle');
        setError(deleting ? 'delete' : 'save');
        setErrorVisible(true);
      }
    } finally {
      sending.current = false;
    }
  };
  const changeTime = (field: 'from' | 'to', value: string) => {
    value = normalizeTime(value);
    const digits = value.replace(/[^0-9]/g, '');
    const formatted = digits.length === 4 ? formatTime(value) : null;
    setDraft((current) => ({ ...current, [field]: formatted || value }));
    if (formatted && field === 'from') to.current?.focus();
  };
  const timeField = (field: 'from' | 'to') => (
    <input
      className="rq-time-input"
      ref={field === 'from' ? from : to}
      value={draft[field]}
      inputMode="numeric"
      maxLength={5}
      disabled={locked}
      tabIndex={typed ? 0 : -1}
      onFocus={(event) => event.currentTarget.select()}
      onClick={(event) => event.currentTarget.select()}
      onChange={(event) => changeTime(field, event.target.value)}
      onBlur={(event) => {
        const value = formatTime(event.currentTarget.value);
        if (value) setDraft((current) => ({ ...current, [field]: value }));
      }}
    />
  );

  return (
    <>
      <div className={`rq-dim${open ? ' rq-open' : ''}`} onClick={dismissOutside} />
      <div
        className={`rq-sheet${part ? ' rq-part-sheet' : ''}${open ? ' rq-open' : ''}${dragOffset !== undefined ? ' rq-dragging' : ''}`}
        ref={panel}
        style={dragOffset === undefined ? undefined : { transform: `translateY(${dragOffset}px)` }}
        onPointerDownCapture={(event) => {
          if (drag.current && event.pointerId !== drag.current.pointerId) resetDrag();
        }}
      >
        <div
          className="rq-grab-area"
          onPointerDown={startDrag}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={(event) => {
            if (drag.current?.pointerId === event.pointerId) resetDrag();
          }}
          onLostPointerCapture={(event) => {
            if (drag.current?.pointerId === event.pointerId) resetDrag();
          }}
        >
          <div className="rq-grab" />
        </div>
        <div className="rq-sheet-scroll">
          <div className="rq-sheet-title">
            <div className="rq-head">
              <h3>{dayTitle(date)}</h3>
              {(sheet.events.some((event) => event.date === date) ||
                (!part &&
                  otherRequests(sheet.dailyRequests, sheet.staff, me.id, date).length > 0)) && (
                <div className="rq-day-body">
                  {sheet.events
                    .filter((event) => event.date === date)
                    .map((event, index) => (
                      <div
                        className={`rq-event rq-c${event.building}`}
                        key={`${event.building}/${index}`}
                      >
                        <Flag />
                        <span>{event.name}</span>
                        <span className="rq-site">{event.building === 1 ? '第一' : '第二'}</span>
                      </div>
                    ))}
                  {!part && (
                    <div className="rq-groups">
                      {otherRequests(sheet.dailyRequests, sheet.staff, me.id, date).map((group) => (
                        <div className="rq-grp" key={group.kind}>
                          <span className="rq-gh">
                            <Shape kind={group.kind} />
                          </span>
                          <span className="rq-gn">
                            {group.names.map((person) => (
                              <span key={person.key}>
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
              )}
            </div>
          </div>
          {!part && (
            <div className="rq-choice-group">
              <p className="rq-ask">入れない時間帯を選んでください</p>
              <div className="rq-tiles">
                {unavailableKinds.map((kind, index) => (
                  <button
                    type="button"
                    key={kind}
                    className={`rq-tile${draft.kind === kind ? ' rq-on' : ''}`}
                    disabled={locked}
                    onClick={() => {
                      setDraft((current) => ({ ...current, kind }));
                      clearTimeout(focusTimer.current);
                      if (kind === 'time_unavailable')
                        focusTimer.current = setTimeout(() => from.current?.focus(), 150);
                    }}
                  >
                    <Shape kind={kind} />
                    <span>
                      {['終日', '午前', '午後', '時間指定'][index]}
                      <span className="rq-sub">
                        {['1日すべて', '12時まで', '12時から', '何時〜何時'][index]}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className={part ? 'rq-part-time-group' : 'rq-time-group'}>
            {part && <p className="rq-ask">入れる時間を入れてください</p>}
            <div className={`rq-when${part ? ' rq-part-time' : ''}`}>
              {!part &&
                fixed.map((range) => (
                  <div
                    key={range.kind ?? 'empty'}
                    className={`rq-when-fixed${draft.kind === range.kind ? ' rq-open' : ''}`}
                  >
                    <div className="rq-range-row">
                      <span className="rq-time-input">{range.from}</span>
                      <span>から</span>
                      <span className="rq-time-input">{range.to}</span>
                      <span>まで</span>
                    </div>
                  </div>
                ))}
              <div className={`rq-when-typed${typed ? ' rq-open' : ''}`}>
                <div className="rq-range-row">
                  {timeField('from')}
                  <span>から</span>
                  {timeField('to')}
                  <span>まで</span>
                </div>
                <p className={`rq-time-help${validation.problem ? ' rq-bad' : ''}`}>
                  {validation.problem ? (
                    <>
                      <WarningMark size={22} />
                      <span>{validation.problem}</span>
                    </>
                  ) : (
                    '数字だけで打てます　例：1800 → 18:00'
                  )}
                </p>
              </div>
            </div>
          </div>
          <div className="rq-memo-group">
            <label className="rq-label" htmlFor="rq-memo">
              メモ（任意）
            </label>
            {editingMemo ? (
              <input
                ref={memoInput}
                className="rq-memo"
                id="rq-memo"
                maxLength={100}
                value={draft.memo}
                placeholder="例：通院のため"
                disabled={locked}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, memo: event.target.value }))
                }
              />
            ) : (
              <button
                type="button"
                id="rq-memo"
                className="rq-memo rq-memo-sent"
                disabled={locked}
                onClick={() => setEditingMemo(true)}
              >
                <span>メモは送信済みです。</span>
                <small>（タップで再度入力することができます）</small>
              </button>
            )}
          </div>
        </div>
        <div className="rq-sheet-actions">
          <button
            className={`rq-submit-btn rq-btn-sub${saved ? ' rq-del' : ''}`}
            disabled={locked}
            onClick={() => (saved ? void send(true) : close())}
          >
            {status === 'deleting' && <span className="rq-spinner" />}
            {status === 'deleting' ? '取り消し中' : saved ? '取り消す' : '閉じる'}
          </button>
          <button
            className={`rq-submit-btn rq-btn-main${status === 'done' ? ' rq-done' : ''}`}
            disabled={locked || !validation.canSubmit}
            onClick={() => void send(false)}
          >
            {status === 'saving' ? (
              <>
                <span className="rq-spinner" />
                提出中
              </>
            ) : status === 'done' ? (
              <>
                <Check />
                提出しました
              </>
            ) : error === 'save' ? (
              'もう一度、提出'
            ) : (
              '提出'
            )}
          </button>
          {error && errorVisible && (
            <div className="rq-send-error">
              <WarningMark size={24} />
              <span>
                {error === 'conflict' ? (
                  conflictMessage
                ) : (
                  <>
                    {uncertainMessage}
                    <br />
                    <span>もう一度押してください。</span>
                  </>
                )}
              </span>
              <button className="rq-err-close" onClick={() => setErrorVisible(false)}>
                ×
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
