import { useState, type ReactNode } from 'react';
import { SquareCheckBig, Pencil, UserRoundCheck } from 'lucide-react';
import { Dialog } from './Dialog';
import { Panel } from './Panel';
import { FieldGroup } from './FieldGroup';
import { WarningMark } from './icons';
import type { ConflictRow } from './save-conflict';
import './SaveConflictDialog.css';

interface ConflictContentProps {
  rows: readonly ConflictRow[];
  target: ReactNode;
  description?: string;
  keep: () => void;
  take: () => void;
}
function SaveConflictContent({ rows, target, description, keep, take }: ConflictContentProps) {
  return (
    <>
      {description && <div>{description}</div>}
      <div className="notice warn save-conflict-warning">
        <WarningMark size={22} />
        <span>相手の入力を取り入れると、あなたの入力内容は失われます。</span>
      </div>
      <div className="save-conflict-target">{target}</div>
      <div
        className="save-conflict-cards"
        style={{ gridTemplateRows: `repeat(${rows.length + 2}, auto)` }}
      >
        {(['yours', 'theirs'] as const).map((side) => (
          <Panel
            placement="inside"
            className="save-conflict-card"
            contentClassName="save-conflict-values"
            key={side}
            icon={<Pencil size={22} />}
            title={side === 'yours' ? 'あなたの入力' : '相手の入力'}
          >
            <dl>
              {rows.map((row) => (
                <FieldGroup className="save-conflict-field" key={row.label}>
                  <dt>{row.label}</dt>
                  <dd>
                    {row[side].map((part, index) => (
                      <span
                        key={index}
                        className={part.changed ? 'save-conflict-difference' : undefined}
                      >
                        {part.text}
                      </span>
                    ))}
                  </dd>
                </FieldGroup>
              ))}
            </dl>
            <button className="btn btn-sub" type="button" onClick={side === 'yours' ? keep : take}>
              {side === 'yours' ? <Pencil size={22} /> : <UserRoundCheck size={22} />}
              {side === 'yours' ? '保持する' : '取り入れる'}
            </button>
          </Panel>
        ))}
      </div>
    </>
  );
}
export function SaveConflictDialog({
  rows,
  target,
  description,
  close,
  keep,
  take,
}: ConflictContentProps & { close: () => void }) {
  const [choice, setChoice] = useState<'keep' | 'take' | null>(null);
  return (
    <Dialog
      title="変更内容を確認"
      icon={<SquareCheckBig size={24} />}
      className="save-conflict-dialog"
      open={choice === null}
      close={() => {
        if (choice === 'take') take();
        else if (choice === 'keep') keep();
        else close();
      }}
    >
      <SaveConflictContent
        rows={rows}
        target={target}
        description={description}
        keep={() => setChoice('keep')}
        take={() => setChoice('take')}
      />
    </Dialog>
  );
}
