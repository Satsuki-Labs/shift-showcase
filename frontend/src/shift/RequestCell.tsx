import { OtherEditMark } from './ShiftCell';
import type { RequestCellView } from './model';

export function RequestMemoMark() {
  return (
    <svg className="request-view-mark" viewBox="0 0 26 26">
      <circle cx="13" cy="13" r="13" fill="var(--surface)" />
      <path
        d="M19 15.5a1.5 1.5 0 0 1-1.5 1.5H10l-3 3V8.5A1.5 1.5 0 0 1 8.5 7h9A1.5 1.5 0 0 1 19 8.5z"
        fill="none"
        stroke="var(--action)"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  );
}
export function RequestCell({
  cell,
  building,
  open,
}: {
  cell: RequestCellView;
  building: 1 | 2;
  open: () => void;
}) {
  if (cell.kind === 'blank') return <div className="request-view-cell empty" />;
  if (cell.kind === 'closure')
    return (
      <div className="shift-cell-view closure" title={cell.label}>
        <span className="shift-rest-label">{cell.label}</span>
      </div>
    );
  const split = cell.kind === 'am_unavailable' || cell.kind === 'pm_unavailable';
  const unavailableHalf = <div className="request-view-half sand">{cell.label}</div>;
  const workHalf = (
    <div className={`request-view-half${cell.workTime ? ` work site${building}` : ''}`}>
      {cell.workTime}
    </div>
  );
  return (
    <button type="button" className="shift-cell-button" onClick={open}>
      <div
        className={`request-view-cell${split ? ` split${cell.kind === 'am_unavailable' ? ' am' : ''}` : cell.kind === 'available' ? ' can' : ' sand'}`}
      >
        {(cell.overlap || cell.memo) && (
          <span className="request-view-marks">
            {cell.overlap && (
              <span title="重複があります">
                <OtherEditMark />
              </span>
            )}
            {cell.memo && (
              <span title={`メモ：${cell.memo}`}>
                <RequestMemoMark />
              </span>
            )}
          </span>
        )}
        {split ? (
          cell.kind === 'am_unavailable' ? (
            <>
              {unavailableHalf}
              {workHalf}
            </>
          ) : (
            <>
              {workHalf}
              {unavailableHalf}
            </>
          )
        ) : (
          <>
            <b>{cell.label}</b>
            {cell.kind === 'available' && <small>勤務可</small>}
          </>
        )}
      </div>
    </button>
  );
}
