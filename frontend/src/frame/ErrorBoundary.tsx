import '../parts/controls.css';
import '../loading/LoadStatus.css';
import { Component, type ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';
import { LoadClient } from '../loading/client';

export class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch() {
    void new LoadClient().reportScreenError('app-frame').catch(() => {});
  }
  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <main className="load-status load-page">
        <div className="notice warn">
          <span>画面を表示できませんでした。アプリ製作者に連絡してください。</span>
          <span className="code">E-72</span>
        </div>
        <button className="btn btn-sub" onClick={() => window.location.reload()}>
          <RefreshCw size={22} />
          もう一度読み込む
        </button>
      </main>
    );
  }
}
