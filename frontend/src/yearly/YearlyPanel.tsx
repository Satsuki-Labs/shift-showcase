import type { ReactNode } from 'react';
import { RaisedPanel } from '../parts/RaisedPanel';

export function YearlyPanel({
  view,
  switcher,
  actions,
  children,
}: {
  view: 'カレンダー' | '行事一覧' | '年間予定';
  switcher: ReactNode;
  actions: ReactNode;
  children: ReactNode;
}) {
  return (
    <RaisedPanel
      className="yearly-panel"
      data-view={view}
      back
      animateWidth={false}
      left={switcher}
      actions={actions}
      raised={view === '年間予定' ? false : view === '行事一覧' ? 'navy' : 'white'}
      padding={view !== '行事一覧'}
      bandSelector=".event-list > .reveal-frame > .reveal-item:not(.leaving) .band"
    >
      {children}
    </RaisedPanel>
  );
}
