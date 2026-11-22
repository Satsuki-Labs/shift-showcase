import type { RequestSheetDailyRequest } from '../../../shared/protocol';

export function Check() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

export function Shape({ kind }: { kind: RequestSheetDailyRequest['kind'] }) {
  if (kind === 'time_unavailable')
    return (
      <svg className="rq-shape-svg" width="18" height="18" viewBox="0 0 18 18">
        <rect
          x="1"
          y="1"
          width="16"
          height="16"
          rx="2"
          fill="var(--surface)"
          stroke="var(--text)"
          strokeWidth="2"
        />
        <path
          d="M9 4.5V9l3.2 2.2"
          stroke="var(--text)"
          strokeWidth="2"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  const shape = {
    unavailable: 'full',
    am_unavailable: 'am',
    pm_unavailable: 'pm',
    available: 'can',
  }[kind];
  return <i className={`rq-shape rq-${shape}`} />;
}

export function Person() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="8" r="4.5" />
      <path d="M3.5 21a8.5 8.5 0 0 1 17 0" />
    </svg>
  );
}

export function Flag() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16">
      <path d="M3 15V1.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M4 2h9l-2.5 3.5L13 9H4z" fill="currentColor" />
    </svg>
  );
}

export function Lock() {
  return (
    <svg
      width="28"
      height="28"
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

export function FailureIcon({ badUrl }: { badUrl: boolean }) {
  return (
    <svg
      width="56"
      height="56"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {badUrl ? (
        <>
          <path d="M9 17H7A5 5 0 0 1 7 7h2" />
          <path d="M15 7h2a5 5 0 0 1 4 8" />
          <path d="M8 12h4" />
        </>
      ) : (
        <path d="M17.5 19H9a7 7 0 1 1 6.7-9h1.8a4.5 4.5 0 0 1 2.6 8.2" />
      )}
      <path d="m3 3 18 18" />
    </svg>
  );
}
