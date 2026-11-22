import { useEffect, useMemo, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import qrcode from 'qrcode-generator';
import type { CurrentRevision, PeriodSummary, PeriodsChangedData } from '../../../shared/protocol';
import { japanToday } from '../../../shared/staff';
import { useAppFrame } from '../app/context';
import { ConfirmDialog } from '../parts/ConfirmDialog';
import { Dialog, SaveConflictNotice } from '../parts/Dialog';
import { useSave } from '../saving/useSave';
import {
  addDays,
  requestClosedLabel,
  requestClosedMessage,
  requestState,
  unsubmittedRequestStaff,
} from './model';
import { WarningMark } from '../parts/icons';
import { dayLabel } from '../format/date';
import { loadSheet } from '../loading/request-sheet';
import { CopyCode } from '../parts/CopyCode';
import { FieldGroup } from '../parts/FieldGroup';

export function RequestQrIcon({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4M20 17v3" />
    </svg>
  );
}
function RegenerateIcon({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 12a9 9 0 0 1 15.5-6.2L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-15.5 6.2L3 16" />
      <path d="M3 21v-5h5" />
    </svg>
  );
}
function LockIcon({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

export function UrlDialog({ period, close }: { period: PeriodSummary; close: () => void }) {
  const [current, setCurrent] = useState(period);
  const [confirming, setConfirming] = useState<'regenerate' | 'close' | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [conflict, setConflict] = useState<CurrentRevision | null>(null);
  const [checkingOther, setCheckingOther] = useState(false);
  const [readingSubmissions, setReadingSubmissions] = useState(false);
  const [readFailed, setReadFailed] = useState(false);
  const [unsubmitted, setUnsubmitted] = useState<ReturnType<typeof unsubmittedRequestStaff>>([]);
  const readController = useRef<AbortController | null>(null);
  const [today, setToday] = useState(japanToday);
  const { loading, refresh } = useAppFrame();
  const { save, saving, showSpinner, outcome } = useSave();
  const state = requestState(current, today);
  const closedMessage = requestClosedMessage(current);
  const address = `${location.origin}/kibo/${current.request_url_key}`;
  const qr = useMemo(() => {
    const code = qrcode(0, 'M');
    code.addData(address);
    code.make();
    const count = code.getModuleCount();
    const modules: string[] = [];
    for (let row = 0; row < count; row++)
      for (let col = 0; col < count; col++) {
        if (code.isDark(row, col)) modules.push(`M${col + 4} ${row + 4}h1v1h-1z`);
      }
    return { size: count + 8, path: modules.join('') };
  }, [address]);
  useEffect(() => () => readController.current?.abort(), []);
  useEffect(() => {
    if (loading.kind !== 'ready') return;
    const next = loading.data.periods.find((item) => item.id === current.id);
    if (next && next.revision >= current.revision) setCurrent(next);
  }, [loading, current.id, current.revision]);
  useEffect(() => {
    if (state !== 'open') {
      readController.current?.abort();
      setReadingSubmissions(false);
      setConfirmOpen(false);
      setConflict(null);
      setReadFailed(false);
      return;
    }
    const updateDate = () => {
      const nextToday = japanToday();
      setToday(nextToday);
      if (requestState(current, nextToday) !== 'open') void refresh();
    };
    const midnight = new Date(`${addDays(today, 1)}T00:00:00+09:00`).getTime();
    const timer = setTimeout(updateDate, Math.max(0, midnight - Date.now()));
    window.addEventListener('focus', updateDate);
    document.addEventListener('visibilitychange', updateDate);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('focus', updateDate);
      document.removeEventListener('visibilitychange', updateDate);
    };
  }, [state, today, current, refresh]);
  useEffect(() => {
    if (outcome?.kind === 'saved') {
      const next = (outcome.data as unknown as PeriodsChangedData).periods.find(
        (item) => item.id === current.id,
      );
      if (next) setCurrent(next);
      setConflict(null);
      setConfirmOpen(false);
    }
    if (outcome?.kind === 'conflict') {
      setConfirmOpen(false);
      setConflict(
        outcome.conflicts.find(
          (item) => item.target.unit === 'period' && item.target.id === current.id,
        ) ?? null,
      );
    }
    if (outcome?.kind === 'input-error') {
      setConfirmOpen(false);
      void refresh();
    }
  }, [outcome, current.id, refresh]);
  const regenerate = () => {
    if (saving || checkingOther || readingSubmissions || state !== 'open') return;
    void save(
      {
        operation: 'period.request-url.regenerate',
        label: `「${current.name}」の希望`,
        data: { id: current.id },
        revisions: [
          {
            target: { unit: 'period', id: current.id },
            revision: conflict ? conflict.revision : current.revision,
          },
        ],
      },
      '作り直しました',
    );
  };
  const prepareClose = async () => {
    if (saving || checkingOther || readingSubmissions || state !== 'open') return;
    const controller = new AbortController();
    readController.current = controller;
    setReadingSubmissions(true);
    try {
      const sheet = await loadSheet(current.request_url_key, controller.signal);
      if (controller.signal.aborted) return;
      if (sheet.requestsClosed || requestState(current, japanToday()) !== 'open') {
        setToday(japanToday());
        await refresh();
        return;
      }
      setUnsubmitted(unsubmittedRequestStaff(sheet));
      setReadFailed(false);
      setConfirming('close');
      setConfirmOpen(true);
    } catch {
      if (!controller.signal.aborted) setReadFailed(true);
    } finally {
      if (!controller.signal.aborted) setReadingSubmissions(false);
    }
  };
  const closeNow = () => {
    if (saving || checkingOther || readingSubmissions || state !== 'open') return;
    void save(
      {
        operation: 'period.requests.close',
        label: `「${current.name}」の希望`,
        data: { id: current.id },
        revisions: [
          {
            target: { unit: 'period', id: current.id },
            revision: conflict ? conflict.revision : current.revision,
          },
        ],
      },
      '締め切りました',
    );
  };
  const confirmOther = async () => {
    if (saving || checkingOther) return;
    setCheckingOther(true);
    try {
      const result = await refresh();
      if (result.kind !== 'ready') return;
      const next = result.data.periods.find((item) => item.id === current.id);
      if (!next) {
        close();
        return;
      }
      setCurrent(next);
      setToday(japanToday());
      setConflict(null);
    } finally {
      setCheckingOther(false);
    }
  };
  return (
    <>
      <Dialog
        title=""
        icon={
          <>
            <RequestQrIcon size={24} />
            <span>「{current.name}」の希望のURL</span>
            <span className={`url-state ${state === 'open' ? 'open' : 'closed'}`}>
              {state === 'open' ? '受付中' : '締め切りました'}
            </span>
          </>
        }
        className="url-dialog"
        close={close}
        subtitle={state !== 'open' ? requestClosedLabel(current) : undefined}
        notice={
          conflict ? (
            <SaveConflictNotice
              disabled={saving || checkingOther || readingSubmissions}
              confirm={() => {
                void confirmOther();
              }}
              confirmLabel="変更を確認する"
            />
          ) : undefined
        }
        footerStart={
          state === 'open' && (
            <button
              className="btn btn-danger btn-small url-foot-left"
              type="button"
              disabled={saving || checkingOther || readingSubmissions}
              onClick={() => {
                setConfirming('regenerate');
                setConfirmOpen(true);
              }}
            >
              {showSpinner && confirming === 'regenerate' ? (
                <span className="spinner" />
              ) : (
                <RegenerateIcon size={20} />
              )}
              URLを作り直す
            </button>
          )
        }
        footer={state === 'open' ? <></> : undefined}
      >
        {state === 'open' && (
          <FieldGroup className={`url-deadline${readFailed ? ' warn' : ''}`}>
            {readFailed ? (
              <b className="url-deadline-failure">
                <WarningMark size={22} />
                提出の様子を読み込めませんでした。
              </b>
            ) : (
              <>
                <span>締め切り</span>
                <b>{dayLabel(current.request_deadline_date!)}の24時</b>
              </>
            )}
            <button
              className={`btn ${readFailed ? 'btn-sub' : 'btn-danger'} btn-small`}
              type="button"
              disabled={saving || checkingOther || readingSubmissions}
              onClick={() => {
                void prepareClose();
              }}
            >
              {readingSubmissions ? (
                <span className="spinner" />
              ) : readFailed ? (
                <RegenerateIcon size={18} />
              ) : (
                <LockIcon size={18} />
              )}
              {readFailed ? 'もう一度読み込む' : '今すぐ締め切る'}
            </button>
          </FieldGroup>
        )}
        <FieldGroup className="url-share">
          <div className={`url-qr${state === 'open' ? '' : ' off'}`}>
            <svg viewBox={`0 0 ${qr.size} ${qr.size}`} shapeRendering="crispEdges">
              <rect width={qr.size} height={qr.size} fill="var(--surface)" />
              <path d={qr.path} fill="currentColor" />
            </svg>
            {state !== 'open' && (
              <span className="lock">
                <LockIcon size={32} />
              </span>
            )}
          </div>
          {state === 'open' ? (
            <div>
              <ol className="url-steps">
                <li>
                  <span className="n">1</span>
                  <span>
                    自分のスマホのカメラで、左のQRコードを読む
                    <small>スマホに、スタッフが希望を提出するページが開きます。</small>
                  </span>
                </li>
                <li>
                  <span className="n">2</span>
                  <span>
                    そのアドレスを、グループLINEに貼って送る
                    <small>QRコードの画像ではなく、アドレスの文字を送ります。</small>
                  </span>
                </li>
              </ol>
              <div className="url-addr">
                <b>アドレス</b>
                <CopyCode value={address} codeClassName="url-address" />
              </div>
            </div>
          ) : (
            <div className="url-closed">
              <b>
                {closedMessage.title[0]}
                {closedMessage.title[1] && <span>{closedMessage.title[1]}</span>}
              </b>
              <p>{closedMessage.detail}</p>
            </div>
          )}
        </FieldGroup>
      </Dialog>
      {confirming === 'regenerate' && (
        <ConfirmDialog
          title="URLを作り直しますか？"
          subtitle={`「${current.name}」の希望`}
          icon={<RegenerateIcon size={24} />}
          message="今のURLは使えなくなります。"
          detail={
            <>
              新しいURLを、もう一度グループLINEで送ってください。
              <br />
              提出された希望は、そのまま残ります。
            </>
          }
          confirmLabel="はい、作り直す"
          cancelLabel="いいえ"
          open={confirmOpen}
          saving={saving || checkingOther}
          close={() => {
            setConfirming(null);
            setConfirmOpen(false);
          }}
          confirm={regenerate}
        />
      )}
      {confirming === 'close' && (
        <Dialog
          title="今すぐ締め切りますか？"
          subtitle={`「${current.name}」の希望`}
          icon={<LockIcon size={24} />}
          className="confirm-dialog request-close-confirm"
          hideClose
          open={confirmOpen}
          dismissible={!saving && !checkingOther}
          close={() => {
            setConfirming(null);
            setConfirmOpen(false);
          }}
          footer={
            <>
              <button
                className="btn btn-danger"
                type="button"
                disabled={saving || checkingOther}
                onClick={closeNow}
              >
                {showSpinner && <span className="spinner" />}はい、締め切る
              </button>
              <button
                className="btn btn-sub"
                type="button"
                disabled={saving || checkingOther}
                onClick={() => setConfirmOpen(false)}
              >
                いいえ
              </button>
            </>
          }
        >
          <p className="confirm-message">
            スタッフは、シフト希望を提出できなくなります。
            <br />
            提出された希望が、シフト（一覧）に入ります。
            <br />
            締め切った後は、元に戻せません。
          </p>
          {unsubmitted.length ? (
            <div className="notice warn close-warn">
              <WarningMark size={22} />
              <div>
                <b>まだ提出していない人が、{unsubmitted.length}人います</b>
                <div className="close-names">
                  {unsubmitted.map((person) => (
                    <span key={person.id}>{person.name}</span>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="notice info">
              <Check size={22} strokeWidth={2.6} />
              <span>全員が提出しました（「希望なし」を含む）</span>
            </div>
          )}
        </Dialog>
      )}
    </>
  );
}
