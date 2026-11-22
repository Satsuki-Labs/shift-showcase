import type { ReactNode } from 'react';
import { Reveal } from './Reveal';
import './FieldHelp.css';

export function FieldHelp({ open, toggle }: { open: boolean; toggle: () => void }) {
  return (
    <button type="button" className="field-help" aria-expanded={open} onClick={toggle}>
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="12" cy="12" r="9.9" />
        <path d="M9.4 9.6a2.6 2.6 0 0 1 5.2 0c0 1.5-1.2 2-2 2.5-.4.25-.6.6-.6 1.1v.6" />
        <circle cx="12" cy="16.9" r="1.15" fill="currentColor" stroke="none" />
      </svg>
    </button>
  );
}

export function FieldHelpContent({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <Reveal open={open} className={`field-help-reveal${open ? ' field-help-open' : ''}`}>
      <div className="field-help-content">
        <div className="field-help-text">{children}</div>
      </div>
    </Reveal>
  );
}
