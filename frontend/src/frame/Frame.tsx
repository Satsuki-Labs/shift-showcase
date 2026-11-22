import './frame.css';
import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import {
  Bell,
  CalendarDays,
  CalendarRange,
  CircleDollarSign,
  ClipboardList,
  Settings,
  Users,
} from 'lucide-react';
import { useAppFrame } from '../app/context';
import { HeaderDate } from './HeaderDate';
import { SettingsDialog } from './SettingsDialog';
import { SavePopup } from './SavePopup';
import { UpdateNotice } from './UpdateNotice';
import { RestoreNotice } from './RestoreNotice';
import { PageScrollbar } from './PageScrollbar';
import {
  UnsavedDialog,
  UnsavedNotifications,
  useUnsavedNotifications,
} from './UnsavedNotifications';
import type { StoredPendingSave } from '../saving/types';
import { useDismissOutside } from '../parts/useDismissOutside';

const tabs = [
  { id: 'shift', label: 'シフト入力', icon: ClipboardList },
  { id: 'salary', label: '給与管理', icon: CircleDollarSign },
  { id: 'staff', label: 'スタッフ管理', icon: Users },
  { id: 'period', label: 'ピリオド管理', icon: CalendarRange },
  { id: 'yearly', label: '年間予定', icon: CalendarDays },
] as const;
export type Tab = (typeof tabs)[number]['id'];
export interface ClosingNotification {
  date: string;
  building: 1 | 2;
  label: string;
}

export function Frame({
  selected,
  selectTab,
  skipNavTransition = false,
  closing,
  budget,
  selectClosing,
  selectBudget,
  children,
}: {
  selected: Tab;
  selectTab: (id: Tab) => void;
  skipNavTransition?: boolean;
  closing: readonly ClosingNotification[];
  budget: string | null;
  selectClosing: (item: ClosingNotification) => void;
  selectBudget: () => void;
  children: ReactNode;
}) {
  const { loading, saving, newAppVersion, restoreNotice, closeRestoreNotice, navigationLocked } =
    useAppFrame();
  const unsaved = useUnsavedNotifications(saving);
  const [unsavedDialog, setUnsavedDialog] = useState<StoredPendingSave | null>(null);
  const [settings, setSettings] = useState(false);
  const [notifications, setNotifications] = useState(false);
  const serverNotifications = loading.kind === 'ready' ? loading.data.notifications : [];
  const notificationCount =
    serverNotifications.length + unsaved.length + closing.length + (budget ? 1 : 0);
  useLayoutEffect(() => setNotifications(false), [selected]);
  const navigation = useRef<HTMLDivElement>(null);
  const nav = useRef<HTMLElement>(null);
  const navShape = useRef<SVGPathElement>(null);
  const bell = useRef<HTMLButtonElement>(null);
  const closeNotifications = () => {
    setNotifications(false);
    bell.current?.focus({ preventScroll: true });
  };
  useDismissOutside(
    notifications,
    (target) => target instanceof Element && Boolean(target.closest('#notifications, .bell')),
    closeNotifications,
    { escape: true, restoreFocus: () => bell.current },
  );
  const closeSettings = useCallback(() => setSettings(false), []);
  useLayoutEffect(() => {
    const node = nav.current;
    if (!node) return;
    let active = true;
    const measure = () => {
      if (!active) return;
      const button = node.querySelector<HTMLElement>('.nav-btn.active');
      if (!button || !navShape.current) return;
      const style = getComputedStyle(node);
      const radius = parseFloat(style.getPropertyValue('--radius-facility'));
      const left = button.offsetLeft,
        right = left + button.offsetWidth;
      const top = parseFloat(style.paddingTop),
        bottom = node.offsetHeight;
      const outline = [
        `M ${left - radius} ${bottom}`,
        `A ${radius} ${radius} 0 0 0 ${left} ${bottom - radius} V ${top + radius}`,
        `A ${radius} ${radius} 0 0 1 ${left + radius} ${top} H ${right - radius}`,
        `A ${radius} ${radius} 0 0 1 ${right} ${top + radius} V ${bottom - radius}`,
        `A ${radius} ${radius} 0 0 0 ${right + radius} ${bottom} Z`,
      ].join(' ');
      navShape.current.style.setProperty('d', `path("${outline}")`);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    void document.fonts.ready.then(measure);
    return () => {
      active = false;
      observer.disconnect();
    };
  }, [selected, loading.kind === 'unregistered']);
  return (
    <>
      <header className="app-header">
        <h1>テスト事業所 ー シフト</h1>
        <span className="header-tools">
          <HeaderDate />
          <span className="header-tools-divider" />
          <button
            ref={bell}
            className={`bell${notifications ? ' open' : ''}`}
            type="button"
            disabled={navigationLocked}
            onClick={() => setNotifications(!notifications)}
          >
            <Bell size={22} strokeWidth={2.2} />
            通知{notificationCount > 0 && <span className="badge">{notificationCount}</span>}
          </button>
          <span className="header-tools-divider" />
          <button
            className="icon-button settings-trigger"
            type="button"
            disabled={navigationLocked || loading.kind !== 'ready'}
            onClick={() => {
              setSettings(true);
              setNotifications(false);
            }}
          >
            <Settings size={24} strokeWidth={2.2} />
            設定
          </button>
        </span>
      </header>
      <div className="navigation" ref={navigation}>
        <nav className={`app-nav${skipNavTransition ? ' no-slide' : ''}`} ref={nav}>
          <svg className="app-nav-shape" focusable="false">
            <path ref={navShape} />
          </svg>
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              id={`tab-${id}`}
              type="button"
              disabled={navigationLocked && selected !== id}
              className={`nav-btn${selected === id ? ' active' : ''}`}
              onClick={() => {
                setNotifications(false);
                if (selected !== id) selectTab(id);
              }}
            >
              <Icon size={20} strokeWidth={2.4} />
              {label}
            </button>
          ))}
        </nav>
        {notifications && (
          <UnsavedNotifications
            notifications={serverNotifications}
            items={unsaved}
            select={(item) => {
              closeNotifications();
              setUnsavedDialog(item);
            }}
            closing={closing}
            selectClosing={(item) => {
              closeNotifications();
              selectClosing(item);
            }}
            budget={budget}
            selectBudget={() => {
              closeNotifications();
              selectBudget();
            }}
          />
        )}
      </div>
      <main
        id="tab-content"
        className={
          loading.kind === 'fatal' || loading.kind === 'unreachable' ? 'load-page' : undefined
        }
      >
        {children}
      </main>
      <PageScrollbar band={nav} />
      {settings && loading.kind === 'ready' && (
        <SettingsDialog
          identity={loading.data.identity}
          contactNames={loading.data.contactNames}
          close={closeSettings}
        />
      )}
      <SavePopup anchor={navigation} hidden={notifications || Boolean(restoreNotice)} />
      {unsavedDialog && saving && (
        <UnsavedDialog saving={saving} item={unsavedDialog} close={() => setUnsavedDialog(null)} />
      )}
      {!restoreNotice && <UpdateNotice newAppVersion={newAppVersion} saving={saving} />}
      {restoreNotice && (
        <RestoreNotice notice={restoreNotice} saving={saving} close={closeRestoreNotice} />
      )}
    </>
  );
}
