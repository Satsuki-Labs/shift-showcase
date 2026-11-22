import './periods.css';
import { useCallback, useState } from 'react';
import { Plus } from 'lucide-react';
import { RaisedPanel } from '../parts/RaisedPanel';
import type { PeriodSummary, Staff } from '../../../shared/protocol';
import { japanToday } from '../../../shared/staff';
import { PeriodTable } from './PeriodTable';
import { PeriodDialog } from './PeriodDialog';
import { UrlDialog } from './UrlDialog';
import { shouldOpenUrl } from './model';

export function PeriodTab({ periods, staff }: { periods: PeriodSummary[]; staff: Staff[] }) {
  const [editing, setEditing] = useState<PeriodSummary | null>();
  const [urlPeriod, setUrlPeriod] = useState<PeriodSummary | null>(null);
  const close = useCallback(() => setEditing(undefined), []);
  const saved = (before: PeriodSummary | undefined, after: PeriodSummary) => {
    if (shouldOpenUrl(before, after, japanToday())) setUrlPeriod(after);
  };
  return (
    <div className="period-tab">
      <div className="toolbar">
        <h1>ピリオド管理</h1>
      </div>
      <RaisedPanel
        className="period-panel"
        left={null}
        raised="navy"
        padding={false}
        bandSelector=".period-list > .band"
        actions={
          <button className="btn" type="button" onClick={() => setEditing(null)}>
            <Plus size={22} strokeWidth={2.4} />
            新規追加
          </button>
        }
      >
        <PeriodTable periods={periods} edit={setEditing} showUrl={setUrlPeriod} />
      </RaisedPanel>
      {editing !== undefined && (
        <PeriodDialog
          key={editing?.id ?? 'new'}
          period={editing ?? undefined}
          periods={periods}
          staff={staff}
          close={close}
          saved={saved}
        />
      )}
      {urlPeriod && (
        <UrlDialog key={urlPeriod.id} period={urlPeriod} close={() => setUrlPeriod(null)} />
      )}
    </div>
  );
}
