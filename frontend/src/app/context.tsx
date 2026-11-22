import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import {
  APP_VERSION,
  type AnnualRulesChangedData,
  type ContactNames,
  type PeriodsChangedData,
  type ShiftCellChangedData,
  type Staff,
} from '../../../shared/protocol';
import { LoadClient, type LoadState } from '../loading/client';
import { SaveWindow } from '../saving/window';
import { DataGeneration, watchDataResponses, type RestoreState } from './data-generation';
import { ShiftExcelExportProvider } from './shift-excel-export';

interface AppFrameState {
  navigationLocked: boolean;
  setNavigationLocked: (locked: boolean) => void;
  loading: LoadState;
  primarySite: 'first' | 'second';
  saving: SaveWindow | null;
  newAppVersion: string | null;
  reload: () => void;
  refresh: () => Promise<LoadState>;
  checkChange: () => void;
  subscribeRefresh: (listener: () => Promise<unknown>) => () => void;
  restoreNotice: RestoreState | null;
  closeRestoreNotice: () => void;
}
const Context = createContext<AppFrameState | null>(null);
export function AppFrameProvider({ children }: { children: ReactNode }) {
  const [navigationLocked, setNavigationLocked] = useState(false);
  const [client] = useState(() => new LoadClient());
  const [generation] = useState(() => new DataGeneration());
  const restoreNotice = useSyncExternalStore(generation.subscribe, generation.getSnapshot);
  const [loading, setLoading] = useState<LoadState>(client.state);
  const [primarySite, setPrimarySite] = useState<'first' | 'second'>('first');
  const [saving, setSaving] = useState<SaveWindow | null>(null);
  const [newAppVersion, setNewAppVersion] = useState<string | null>(null);
  const refresh = useCallback(() => client.refresh(), [client]);
  const checkChange = useCallback(() => {
    void client.checkChange();
  }, [client]);
  useEffect(() => client.watchVisible(document), [client]);
  useEffect(() => {
    let active = true;
    let savingPromise: Promise<SaveWindow> | undefined;
    const stopResponses = watchDataResponses(generation.receive);
    const unsubscribe = client.subscribe((state) => {
      setLoading(state);
      if (state.kind !== 'ready') return;
      setPrimarySite(state.data.identity.role === 'second' ? 'second' : 'first');
      if (state.data.appVersion !== APP_VERSION) setNewAppVersion(state.data.appVersion);
      if (!savingPromise) {
        savingPromise = SaveWindow.create({
          appVersion: APP_VERSION,
          dataGeneration: state.data.dataGeneration,
          onReady: (window, stale) => generation.initialize(window, stale),
          onEvent: (event) => {
            if (!active) return;
            if (event.kind === 'saved') {
              client.noteOwnSave(event.result.dataChangeNumber);
              // Also apply saves that finish after their dialog has been closed.
              if (event.operation === 'settings.contact-names.save')
                client.applyContactNames(
                  event.result.data as unknown as ContactNames,
                  event.result.revisions,
                );
              if (event.operation.startsWith('staff.')) {
                client.applyStaff(event.result.data as unknown as Staff[], event.result.revisions);
              }
              if (event.operation === 'shift.cell.save') {
                const changed = (event.result.data as unknown as ShiftCellChangedData).staff;
                if (changed && client.state.kind === 'ready')
                  client.applyStaff(
                    client.state.data.staff.map((person) =>
                      person.id === changed.id ? changed : person,
                    ),
                  );
              }
              if (event.operation.startsWith('period.')) {
                const data = event.result.data as unknown as PeriodsChangedData;
                client.applyPeriods(data.periods);
                client.applyStaff(data.staff);
              }
              if (
                [
                  'calendar.opening-rules.save',
                  'calendar.peak.save',
                  'calendar.annual-closure.save',
                ].includes(event.operation)
              ) {
                const data = event.result.data as unknown as AnnualRulesChangedData;
                client.applyAnnualRules(data.rules, event.result.revisions);
              }
              queueMicrotask(checkChange);
            }
            if (event.kind === 'version-changed') setNewAppVersion(event.appVersion);
          },
        });
        void savingPromise
          .then((window) => {
            if (active) setSaving(window);
            else void window.dispose();
          })
          .catch(() => {
            if (active) setLoading({ kind: 'fatal', code: 'E-93' });
          });
      }
    });
    void client.load();
    return () => {
      active = false;
      unsubscribe();
      stopResponses();
      void savingPromise?.then((window) => window.dispose()).catch(() => {});
    };
  }, [client, generation, checkChange]);
  return (
    <Context.Provider
      value={{
        loading,
        primarySite,
        saving,
        newAppVersion,
        refresh,
        navigationLocked,
        setNavigationLocked,
        restoreNotice,
        closeRestoreNotice: generation.close,
        reload: () => {
          void client.load();
        },
        checkChange,
        subscribeRefresh: client.subscribeRefresh,
      }}
    >
      <ShiftExcelExportProvider>{children}</ShiftExcelExportProvider>
    </Context.Provider>
  );
}
export function useAppFrame() {
  const state = useContext(Context);
  if (!state) throw new Error('App frame provider is missing');
  return state;
}
