import './RangeWell.css';
import type { ReactNode } from 'react';

export function RangeWell({ children, period }: { children: ReactNode; period: ReactNode }) {
  return (
    <div className="range-well">
      {children}
      <span className="range-well-divider" />
      <span className="range-well-period">{period}</span>
    </div>
  );
}
