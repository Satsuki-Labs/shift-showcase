import { Users } from 'lucide-react';
import type { ShiftView } from './daily-model';
import { OtherEditMark, RequestMark } from './ShiftCell';
import { RequestMemoMark } from './RequestCell';
import { WarningMark } from '../parts/icons';
import { Skeleton } from '../parts/Skeleton';
import { NumberUnits } from '../parts/NumberUnits';

function ShiftLegend({ view, requestsClosed }: { view: ShiftView; requestsClosed: boolean }) {
  return (
    <div className="shift-legend">
      {view === '希望' ? (
        <>
          <span className="request-unavailable">入れない</span>
          <span className="request-available">入れる（勤務可）</span>
          <span className="site1">その日の勤務</span>
          {requestsClosed && (
            <span className="request-view-legend-mark">
              <OtherEditMark />
              ＝重複あり
            </span>
          )}
          <span className="request-view-legend-mark">
            <RequestMemoMark />
            ＝メモ
          </span>
        </>
      ) : (
        <>
          <span className="site1">第一の勤務</span>
          <span className="site2">第二の勤務</span>
          <span className="y">Y＝事務</span>
          <span className="off">休＝公休</span>
          <span className="paid">有＝有給</span>
          {view === '一覧' && <span className="changed">修正</span>}
          {view === '一覧' && (
            <span className="request-legend">
              <RequestMark />
              ＝シフト希望
            </span>
          )}
          {view === '日別' && (
            <span className="short">
              <WarningMark size={20} />
              配置不足
            </span>
          )}
        </>
      )}
    </div>
  );
}

export function ShiftBand({
  building,
  name,
  count,
  view,
  requestsClosed,
}: {
  building: 1 | 2;
  name: string;
  count: number | null;
  view: ShiftView;
  requestsClosed: boolean;
}) {
  return (
    <header className="band nv">
      <b className="shift-band-name">
        <i className={`shift-band-dot site${building}`} />
        {name}
      </b>
      <ShiftLegend view={view} requestsClosed={requestsClosed} />
      <span className="shift-band-count">
        <Users size={22} strokeWidth={2.4} />
        {count === null ? (
          <Skeleton width="40px" onNavy />
        ) : (
          <span>
            <NumberUnits>{`${count}人`}</NumberUnits>
          </span>
        )}
      </span>
    </header>
  );
}
