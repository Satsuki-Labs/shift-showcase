import type { ReactNode } from 'react';
import './Panel.css';

interface PanelProps {
  placement: 'raised' | 'inside' | 'outside';
  icon: ReactNode;
  title: ReactNode;
  headingEnd?: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  inert?: boolean;
}
export function Panel({
  placement,
  icon,
  title,
  headingEnd,
  children,
  className = '',
  contentClassName = '',
  inert,
}: PanelProps) {
  return (
    <section className={`panel panel-${placement} ${className}`} inert={inert}>
      <div className="panel-head">
        <div className="panel-heading-row">
          <h2 className="panel-title">
            {icon}
            {title}
          </h2>
          {headingEnd}
        </div>
      </div>
      <div className={`panel-content ${contentClassName}`}>{children}</div>
    </section>
  );
}
