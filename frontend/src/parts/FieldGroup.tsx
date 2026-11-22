import type { ReactNode } from 'react';
import './FieldGroup.css';

export function FieldGroup({
  children,
  fitContent = false,
  className = '',
}: {
  children: ReactNode;
  fitContent?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`field-group${fitContent ? ' field-group-fit' : ''}${className ? ` ${className}` : ''}`}
    >
      {children}
    </div>
  );
}
