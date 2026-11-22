import { cellDisplay, type CellView } from './model';
import { shortTime } from '../format/time';

export function OtherEditMark({
  status = false,
  dark = false,
}: {
  status?: boolean;
  dark?: boolean;
}) {
  return (
    <svg className="other-edit-mark" viewBox="0 0 26 26">
      <circle
        cx="13"
        cy="13"
        r={status ? 12 : 13}
        fill={dark ? 'var(--text-sub)' : 'var(--surface)'}
        stroke={status ? 'var(--line)' : undefined}
        strokeWidth={status ? 2 : undefined}
      />
      <text
        x="13"
        y="13"
        textAnchor="middle"
        dominantBaseline="central"
        dx="-0.11"
        dy="-0.34"
        fontSize="var(--shift-status-mark-size)"
        fontWeight="var(--weight-strong)"
        fill={dark ? 'var(--warn-bg)' : 'var(--warn-mark)'}
      >
        ！
      </text>
    </svg>
  );
}
export function RequestMark() {
  return (
    <svg className="other-edit-mark" viewBox="0 0 26 26">
      <circle cx="13" cy="13" r="13" fill="var(--surface)" />
      <text
        x="13"
        y="13"
        textAnchor="middle"
        dominantBaseline="central"
        dy="-0.7"
        fontSize="var(--shift-request-mark-size)"
        fontWeight="var(--weight-strong)"
        fill="var(--text)"
      >
        希
      </text>
    </svg>
  );
}
export function ShiftCell({
  cell,
  building,
  open,
  changed = false,
}: {
  cell: CellView;
  building: 1 | 2;
  open: () => void;
  changed?: boolean;
}) {
  return (
    <button className="shift-cell-button" type="button" onClick={open}>
      <ShiftCellContent cell={cell} building={building} changed={changed} />
    </button>
  );
}
export function ShiftCellContent({
  cell,
  building,
  changed = false,
}: {
  cell: CellView;
  building: 1 | 2;
  changed?: boolean;
}) {
  const working = cell.kind === 'work' || cell.kind === 'other';
  const display = cellDisplay(cell);
  return (
    <div
      className={`shift-cell-view ${cell.requestRest ? 'holiday sand' : cell.kind}${cell.kind === 'work' ? ` site${building}` : ''}${changed ? ' changed' : ''}`}
      title={display.title}
    >
      {working ? (
        <>
          {display.times.map((time, index) => (
            <span
              key={index}
              className={`shift-time${time.other ? ` other site${time.building}` : ''}${time.is_office ? ' office' : ''}`}
            >
              {shortTime(time.start_time)}–
              {time.underline ? <u>{shortTime(time.end_time)}</u> : shortTime(time.end_time)}
            </span>
          ))}
          <div className="shift-roles">
            <div className="shift-role-row">
              {cell.topRoles.map((role) => (
                <span className="shift-role" key={role}>
                  {role}
                </span>
              ))}
            </div>
            <div
              className={`shift-role-row lower${cell.otherEdit || cell.requestMark ? ' with-other-edit' : ''}`}
            >
              {display.bottomRoles.map((role) => (
                <span className={`shift-role${role === 'Y' ? ' y' : ''}`} key={role}>
                  {role}
                </span>
              ))}
              {(cell.requestMark || cell.otherEdit) && (
                <span className="shift-other-edit">
                  {cell.requestMark && (
                    <span title="提出された希望">
                      <RequestMark />
                    </span>
                  )}
                  {cell.otherEdit && (
                    <span title={cell.otherEdit.text}>
                      <OtherEditMark />
                    </span>
                  )}
                </span>
              )}
            </div>
          </div>
        </>
      ) : cell.kind === 'blank' && !cell.requestRest ? (
        <span className="shift-cell-plus">＋</span>
      ) : (
        <span className="shift-rest-label">{cell.requestRest ? '休' : cell.label}</span>
      )}
      {!working && (
        <span className="shift-other-edit rest">
          {cell.requestMark && (
            <span title="提出された希望">
              <RequestMark />
            </span>
          )}
          {cell.otherEdit && (
            <span title={cell.otherEdit.text}>
              <OtherEditMark dark={cell.kind === 'blank' && !cell.requestRest} />
            </span>
          )}
        </span>
      )}
    </div>
  );
}
