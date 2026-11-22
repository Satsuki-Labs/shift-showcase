import { ClipboardList } from 'lucide-react';
import { FieldGroup } from '../parts/FieldGroup';
import type { WorkSlot } from '../../../shared/protocol';
import { workRoleLabels } from '../format/labels';
import { hasTime } from './cell-model';
import { bulkDefaultKindLabels, bulkInputTarget, type BulkOptions } from './bulk-model';
import { ShiftCellContent } from './ShiftCell';
import type { CellView } from './model';
import './BulkSummary.css';

export function BulkSummary({ options }: { options: BulkOptions }) {
  const { operation, mode, draft } = options,
    target = bulkInputTarget(options);
  const slots = (
    mode === 'roles' ? [] : draft.slots.filter((slot) => slot.building === target && hasTime(slot))
  ).map((slot) => ({ ...slot, is_office: mode === 'both' && slot.is_office }));
  const work: Pick<WorkSlot, 'building' | 'slots'>[] = slots[0]
    ? [{ building: target, slots: slots[1] ? [slots[0], slots[1]] : [slots[0]] }]
    : [];
  const roles = mode === 'roles' ? options.roleSelection : mode === 'time' ? [] : draft.roles;
  const cell: CellView = {
    kind: 'work',
    label: '',
    times: slots.map((slot) => ({ ...slot, other: false, underline: false })),
    ...workRoleLabels({ roles }, work),
  };
  const site = target === 1 ? '第一' : '第二',
    facility = slots[0]?.facility ?? (target === 1 ? 'A' : 'C');
  return (
    <FieldGroup className={`bulk-summary${operation === 'cancel' ? ' cancelling' : ''}`}>
      <p className="sec-t">
        <ClipboardList size={20} />
        {operation === 'cancel' ? '取り消し内容の確認' : '入力内容'}
        <span className={`pill bulk-summary-site c${target}`}>
          {site}
          {operation === 'insert' && mode !== 'roles' ? ` / ${facility}` : ''}
        </span>
      </p>
      <div className="bulk-summary-body">
        <div className="bulk-summary-fields">
          <div className="bulk-summary-field">
            <span className="bulk-summary-name">操作</span>
            <span className="bulk-summary-value">
              {operation === 'cancel'
                ? mode === 'roles'
                  ? '役割だけを取り消す'
                  : 'シフトを取り消す'
                : mode === 'roles'
                  ? '役割だけ'
                  : mode === 'time'
                    ? '時刻だけ'
                    : '時刻と役割'}
            </span>
          </div>
          {operation === 'insert' && mode !== 'roles' && (
            <div className="bulk-summary-field">
              <span className="bulk-summary-name">勤務の種類</span>
              <span className="bulk-summary-value">{bulkDefaultKindLabels[draft.kind]}</span>
            </div>
          )}
          {operation === 'insert' && mode === 'roles' && options.specialCare && (
            <div className="bulk-summary-field">
              <span className="bulk-summary-name">特別対応</span>
              <span className="bulk-summary-value">あり</span>
            </div>
          )}
        </div>
        {(operation === 'insert' || mode === 'roles') && (
          <div className="bulk-summary-sample shift-tab shift-list-section">
            <ShiftCellContent cell={cell} building={target} />
          </div>
        )}
      </div>
    </FieldGroup>
  );
}
