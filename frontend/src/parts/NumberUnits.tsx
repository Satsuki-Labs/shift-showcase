import { Fragment } from 'react';
import './NumberUnits.css';

/** Keep the existing formatted text and make only its numeric units smaller. */
export function NumberUnits({ children }: { children: string }) {
  return (
    <>
      {children.split(/(円|時間|分|日間|日|人|件)/).map((part, index) =>
        index % 2 ? (
          <span className="number-unit" key={index}>
            {part}
          </span>
        ) : (
          <Fragment key={index}>{part}</Fragment>
        ),
      )}
    </>
  );
}
