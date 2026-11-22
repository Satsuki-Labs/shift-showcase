import { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { WarningMark } from './icons';
import { copyText } from './copy-text';
import './CopyCode.css';

const COPIED_VISIBLE_MS = 1_500;

export function CopyCode({ value, codeClassName }: { value: string; codeClassName: string }) {
  const addressElement = useRef<HTMLElement | null>(null);
  const [copyState, setCopyState] = useState<{
    address: string;
    kind: 'copying' | 'copied' | 'failed';
    copying: boolean;
  } | null>(null);
  const copySession = useRef<{
    active: boolean;
    timer: ReturnType<typeof setTimeout> | undefined;
  } | null>(null);
  const copying = copyState?.address === value && copyState.copying;
  const copied = copyState?.address === value && copyState.kind === 'copied';
  const copyFailed = copyState?.address === value && copyState.kind === 'failed';
  useEffect(() => {
    const session = { active: true, timer: undefined as ReturnType<typeof setTimeout> | undefined };
    copySession.current = session;
    setCopyState(null);
    return () => {
      session.active = false;
      clearTimeout(session.timer);
    };
  }, [value]);
  const copyAddress = async () => {
    const session = copySession.current;
    if (copying || !session?.active || !addressElement.current) return;
    clearTimeout(session.timer);
    const pressedAt = Date.now();
    setCopyState({ address: value, kind: copied ? 'copied' : 'copying', copying: true });
    const succeeded = await copyText(addressElement.current);
    if (!session.active) return;
    setCopyState({ address: value, kind: succeeded ? 'copied' : 'failed', copying: false });
    const remaining =
      succeeded && copied
        ? Math.max(0, COPIED_VISIBLE_MS - (Date.now() - pressedAt))
        : COPIED_VISIBLE_MS;
    session.timer = setTimeout(() => {
      setCopyState(null);
    }, remaining);
  };
  return (
    <div className="copy-code">
      <pre>
        <code className={codeClassName} ref={addressElement}>
          {value}
        </code>
      </pre>
      <button
        className={`icon-button copy-code-button${copyFailed ? ' failed' : ''}`}
        type="button"
        disabled={copying}
        title={copied ? 'コピーしました' : 'アドレスをコピー'}
        onClick={() => {
          void copyAddress();
        }}
      >
        {copied ? (
          <Check size={20} strokeWidth={2.4} />
        ) : copyFailed ? (
          <WarningMark size={20} />
        ) : (
          <Copy size={20} strokeWidth={2.4} />
        )}
      </button>
    </div>
  );
}
