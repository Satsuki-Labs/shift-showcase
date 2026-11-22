export function WarningMark({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24">
      <path
        d="M12 3.5 2.5 20h19L12 3.5z"
        fill="var(--warn-mark)"
        stroke="var(--warn-mark)"
        strokeWidth="3"
        strokeLinejoin="round"
      />
      <path d="M12 9.5v4.5" stroke="var(--surface)" strokeWidth="2.4" strokeLinecap="round" />
      <circle cx="12" cy="17.2" r="1.4" fill="var(--surface)" />
    </svg>
  );
}

export function FailureMark({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="11" fill="var(--warn-mark)" />
      <path
        d="M8 8l8 8M16 8l-8 8"
        stroke="var(--surface)"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
    </svg>
  );
}
