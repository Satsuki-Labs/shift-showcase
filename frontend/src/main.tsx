/// <reference types="vite/client" />
import { createRoot } from 'react-dom/client';
import './styles/tokens.css';
import './styles/base.css';
import { setupManagementViewport } from './parts/viewport';

const root = createRoot(document.getElementById('root')!);

if (window.location.pathname.startsWith('/kibo/')) {
  void import('./request/RequestSheet').then(({ RequestSheet }) => {
    root.render(<RequestSheet />);
  });
} else {
  setupManagementViewport();
  void Promise.all([import('./App'), import('./frame/ErrorBoundary')]).then(
    ([{ default: App }, { ErrorBoundary }]) => {
      root.render(
        <ErrorBoundary>
          <App />
        </ErrorBoundary>,
      );
    },
  );
}
