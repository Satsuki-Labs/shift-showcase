import './LoadStatus.css';
import { RefreshCw } from 'lucide-react';
import type { LoadState } from './client';
import { useLoadingIndicator } from './useLoadingIndicator';

export function LoadStatus({ state, reload }: { state: LoadState; reload: () => void }) {
  const showLoading = useLoadingIndicator(state.kind === 'loading' ? state : null);
  if (state.kind === 'ready') return null;
  if (state.kind === 'loading')
    return showLoading ? (
      <div className="loading-center">
        <span className="spinner dark" />
      </div>
    ) : null;
  const message =
    state.kind === 'unregistered'
      ? 'このアドレスは登録されていません。アプリ製作者に連絡してください。'
      : state.kind === 'fatal'
        ? '読み込めませんでした。アプリ製作者に連絡してください。'
        : '読み込めませんでした';
  return (
    <div className="load-status">
      <div className="notice warn">
        <span>{message}</span>
        {'code' in state && <span className="code">{state.code}</span>}
      </div>
      {state.kind !== 'unregistered' && (
        <button className="btn btn-sub" onClick={reload}>
          <RefreshCw size={22} />
          もう一度読み込む
        </button>
      )}
    </div>
  );
}
