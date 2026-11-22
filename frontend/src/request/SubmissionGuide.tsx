import { Shape } from './icons';
import { unavailableKinds } from './model';

export function SubmissionGuide({ part }: { part: boolean }) {
  return (
    <div className="rq-legend">
      <div className="rq-step">
        <span className="rq-num">1</span>
        <div className="rq-vis">
          <span className="rq-demo-plus">
            ＋
            <svg className="rq-finger" width="56" height="56" viewBox="0 0 48 48">
              <circle
                cx="12"
                cy="11"
                r="9.5"
                fill="none"
                stroke="var(--action)"
                strokeWidth="2.5"
                opacity=".6"
              />
              <circle cx="12" cy="11" r="5" fill="var(--action)" opacity=".6" />
              <path
                d="M11.6 9.6c1.7-.9 3.6-.2 4.4 1.5L22.6 24l1.3-2.3c.8-1.4 2.6-1.8 3.9-.9l.7.6 1-1.3c.9-1.2 2.7-1.4 3.8-.4l.5.5.9-1c1-1 2.7-1 3.6.1L41.8 26c2.2 4 2.6 8.4 1 11.9l2.2 4.1-10.3 5-1.9-3.9c-3.1.1-6.1-1.2-8-3.6l-5.3-6c-2.1-1.1-5-1.4-7-2.1-2.4-.8-2.9-3.7-.8-4.9 1.9-1.1 5.1-.6 7.4.4L9.9 14c-.8-1.7-.2-3.6 1.7-4.4z"
                fill="var(--surface)"
                stroke="var(--text)"
                strokeWidth="2.6"
                strokeLinejoin="round"
              />
            </svg>
          </span>
        </div>
        <div className="rq-cap">{part ? '入れる' : '入れない'}日の枠を押す</div>
        <div className="rq-arrow">▼</div>
      </div>
      <div className="rq-step">
        <span className="rq-num">2</span>
        <div className="rq-vis">
          {part ? (
            <span>時間を選ぶ（例：14:00〜18:00）</span>
          ) : (
            <div className="rq-tiles rq-demo-tiles">
              {unavailableKinds.map((kind, index) => (
                <span className="rq-demo-tile" key={kind}>
                  <Shape kind={kind} />
                  <span>
                    {['終日', '午前', '午後', '時間指定'][index]}
                    <span className="rq-sub">
                      {['1日すべて', '12時まで', '12時から', '何時〜何時'][index]}
                    </span>
                  </span>
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="rq-cap">{!part && '4つから選ぶ'}</div>
        <div className="rq-arrow">▼</div>
      </div>
      <div className="rq-step">
        <span className="rq-num">3</span>
        <div className="rq-vis">
          <span className="rq-demo-mine">
            <Shape kind={part ? 'available' : 'unavailable'} />
            {part ? '14:00〜18:00' : '終日'}
          </span>
        </div>
        <div className="rq-cap">提出完了</div>
      </div>
    </div>
  );
}
