import './Skeleton.css';
import type { CSSProperties } from 'react';

export function Skeleton({
  width = '100%',
  circle = false,
  onNavy = false,
}: {
  width?: CSSProperties['width'];
  circle?: boolean;
  onNavy?: boolean;
}) {
  return (
    <span
      className={`skeleton${circle ? ' skeleton-circle' : ''}${onNavy ? ' skeleton-on-navy' : ''}`}
      style={circle ? undefined : { width }}
    />
  );
}
