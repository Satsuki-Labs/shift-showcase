import './RestoreNotice.css';
import { CalendarDays, CalendarRange, ClipboardList, Settings, Users } from 'lucide-react';
import type { RestoreState } from '../app/data-generation';
import { japanDateTime } from '../format/date';
import { Dialog } from '../parts/Dialog';
import { FieldGroup } from '../parts/FieldGroup';
import { WarningMark } from '../parts/icons';
import type { SaveWindow } from '../saving/window';
import { updateApplication } from './UpdateNotice';

const kinds: Record<string, string> = {
  shift: 'シフト',
  staff: 'スタッフ情報',
  period: 'ピリオド',
  calendar: '年間予定',
  settings: '設定',
};
const kindIcons: Record<string, typeof ClipboardList> = {
  shift: ClipboardList,
  staff: Users,
  period: CalendarRange,
  calendar: CalendarDays,
  settings: Settings,
};
export function RestoreNotice({
  notice,
  saving,
  close,
}: {
  notice: RestoreState;
  saving: SaveWindow | null;
  close: () => void;
}) {
  return (
    <Dialog
      title="シフトのデータが復元されました"
      icon={<WarningMark size={26} />}
      className="restore-notice"
      hideClose
      dismissible={false}
      close={() => {}}
      footer={
        <button
          className="btn btn-main"
          type="button"
          onClick={() => (notice.mode === 'reload' ? updateApplication(saving) : close())}
        >
          {notice.mode === 'reload' && (
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 12a9 9 0 1 1-2.64-6.36" />
              <path d="M21 3v6h-6" />
            </svg>
          )}
          {notice.mode === 'reload' ? '読み込み直す' : '閉じる'}
        </button>
      }
    >
      <FieldGroup className="restore-facts">
        <div className="restore-fact">
          <span className="restore-fk">
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="10" />
              <path d="M12 7v5l3 2" />
            </svg>
            戻した時点
          </span>
          <span className="restore-fv restore-big">{japanDateTime(notice.restoredTo)}</span>
        </div>
        <div className="restore-fact">
          <span className="restore-fk">
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path
                d="M14.7 6.3a4 4 0 0 0 5 5L22 14l-8 8-2.3-2.3a4 4 0 0 0-5-5L4 12l8-8z"
                opacity="0"
              />
              <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9z" />
            </svg>
            理由
          </span>
          <span className="restore-fv">不具合を解消するため</span>
        </div>
        <p className="restore-gone">この時刻より後に保存した入力は、消えています。</p>
      </FieldGroup>
      {notice.inputs.length > 0 && (
        <FieldGroup>
          <p className="restore-lost-t">
            この画面で保存できなかった入力（{notice.inputs.length}件）
          </p>
          <div className="restore-lost">
            {notice.inputs.map((input) => {
              const kind = input.operation.split('.')[0];
              const Icon = kindIcons[kind];
              return (
                <div className="restore-who" key={input.order}>
                  <span className="restore-kind">
                    <Icon size={22} strokeWidth={2} />
                    {kinds[kind]}
                  </span>
                  <span>{input.label}</span>
                </div>
              );
            })}
          </div>
        </FieldGroup>
      )}
    </Dialog>
  );
}
