import { Check, X } from 'lucide-react';
import { Fragment, type ReactElement } from 'react';
import { Reveal } from './Reveal';
import {
  DEFAULT_STAFF_ROLES,
  type DayRole,
  type DefaultStaffRole,
  type MovementRole,
} from '../../../shared/staff';

const labels = ['閉', '主', '副', '準備', '抜', 'α'];
type DayRoleButtons = { value: readonly DayRole[]; onChange: (value: DayRole[]) => void };
type DefaultRoleButtons = {
  value: readonly DefaultStaffRole[];
  onChange: (value: DefaultStaffRole[]) => void;
};
type WorkRoleButtons = DayRoleButtons &
  (
    | {
        cell: {
          office: boolean;
          movement: string | null;
          allowedMovement: MovementRole | null;
          toggleOffice: () => void;
        };
      }
    | {
        bulkMovement: MovementRole | null;
        office?: { enabled: boolean; toggle: () => void };
        remove?: boolean;
      }
  );
type RoleButtonsProps = DefaultRoleButtons | WorkRoleButtons;
export function RoleButtons(props: DefaultRoleButtons): ReactElement;
export function RoleButtons(props: WorkRoleButtons): ReactElement;
export function RoleButtons(props: RoleButtonsProps) {
  const value: readonly DayRole[] = props.value,
    cell = 'cell' in props ? props.cell : undefined;
  const Mark = 'remove' in props && props.remove ? X : Check;
  const office = 'office' in props ? props.office : undefined;
  const toggle = (role: DayRole) => {
    const other = role === 'lead' ? 'deputy' : role === 'deputy' ? 'lead' : null;
    const next = value.includes(role)
      ? value.filter((item) => item !== role)
      : [...value.filter((item) => item !== other), role];
    if ('cell' in props || 'bulkMovement' in props) props.onChange(next);
    else
      props.onChange(
        next.filter((item): item is DefaultStaffRole =>
          DEFAULT_STAFF_ROLES.some((role) => role === item),
        ),
      );
  };
  const button = (role: DayRole, label: string, disabled = false) => (
    <button
      type="button"
      key={role}
      disabled={disabled}
      className={value.includes(role) ? 'on' : ''}
      onClick={() => toggle(role)}
    >
      {value.includes(role) && <Mark size={18} strokeWidth={3.2} />}
      {label}
    </button>
  );
  return (
    <div className="roles-grid">
      {cell ? (
        <>
          {button('closing', labels[0])}
          <button type="button" className={cell.office ? 'on' : ''} onClick={cell.toggleOffice}>
            {cell.office && <Check size={18} strokeWidth={3.2} />}Y
          </button>
          {DEFAULT_STAFF_ROLES.slice(1).map((role, index) => button(role, labels[index + 1]))}
          {button('movement_first', 'Ⅰ', cell.allowedMovement !== 'movement_first')}
          {button('movement_second', 'Ⅱ', cell.allowedMovement !== 'movement_second')}
          <button
            type="button"
            disabled={!cell.movement}
            className={`auto${cell.movement ? ' on' : ''}`}
          >
            {cell.movement && <Check size={18} strokeWidth={3.2} />}Ⅰ→Ⅱ
          </button>
        </>
      ) : (
        <>
          {DEFAULT_STAFF_ROLES.map((role, index) => (
            <Fragment key={role}>
              {button(role, labels[index])}
              {index === 0 && office && (
                <button
                  type="button"
                  className={office.enabled ? 'on' : ''}
                  onClick={office.toggle}
                >
                  {office.enabled && <Check size={18} strokeWidth={3.2} />}Y
                </button>
              )}
            </Fragment>
          ))}
          {'bulkMovement' in props && (
            <Reveal
              swap
              className="roles-movement"
              items={
                props.bulkMovement
                  ? [
                      {
                        key: props.bulkMovement,
                        content: button(
                          props.bulkMovement,
                          props.bulkMovement === 'movement_first' ? 'Ⅰ' : 'Ⅱ',
                        ),
                      },
                    ]
                  : []
              }
            />
          )}
        </>
      )}
    </div>
  );
}
