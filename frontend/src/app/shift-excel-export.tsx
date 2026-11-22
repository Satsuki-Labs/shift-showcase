import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { PeriodsChangedData, PrintedCells } from '../../../shared/protocol';
import type { ShiftSheetInput } from '../excel/shift-sheet';
import { shiftExcelFileName } from '../format/labels';
import { PeriodLoadClient } from '../loading/period-client';
import { useAppFrame } from './context';
import type { LoadState } from '../loading/client';
import { useSave, type SaveOutcome } from '../saving/useSave';
import { Toast } from '../parts/Toast';
import { WarningMark } from '../parts/icons';
import {
  ExcelExportNotice,
  excelExportFailureMessage,
  type ExcelNotice,
} from '../parts/ExcelExportNotice';

interface ExportFile {
  bytes: Uint8Array;
  fileName: string;
}
interface PendingExport extends ExportFile {
  input: ShiftSheetInput;
  cells: PrintedCells;
  client: PeriodLoadClient;
  download: (bytes: Uint8Array, fileName: string) => void;
}
interface ExportState {
  busy: boolean;
  settled: number;
  output: (
    input: Omit<ShiftSheetInput, 'contactNames'>,
    client: PeriodLoadClient,
    cells: PrintedCells,
  ) => Promise<void>;
}
const Context = createContext<ExportState | null>(null);

function createShiftExcelExporter({
  current,
  setBusy,
  settle,
  setNotice,
  setConflict,
}: {
  current: () => {
    loading: LoadState;
    save: ReturnType<typeof useSave>['save'];
    refresh: () => Promise<LoadState>;
  };
  setBusy: (busy: boolean) => void;
  settle: () => void;
  setNotice: (notice: ExcelNotice | null) => void;
  setConflict: (file: string | null) => void;
}) {
  let pending: PendingExport | null = null,
    active = false;
  const finish = () => {
    pending = null;
    active = false;
    setBusy(false);
    settle();
  };
  const receive = (outcome: SaveOutcome | null) => {
    const item = pending;
    const { refresh } = current();
    if (!item || !outcome) return;
    // Clear before applying data or clicking the link: a repeated render cannot download twice.
    pending = null;
    if (outcome.kind === 'saved') {
      const site = item.input.site === 1 ? 'first' : 'second';
      const data = outcome.data as unknown as PeriodsChangedData;
      const period = data.periods.find((period) => period.id === item.input.period.id)!;
      item.client.applyDistributedSheet(period.id, site, {
        cells: item.cells,
        distributed_at: period[`${site}_last_distributed_at`]!,
      });
      item.download(item.bytes, item.fileName);
    } else if (outcome.kind === 'conflict') {
      setConflict(item.fileName);
      void refresh();
      // Refresh the exported period without replacing a different period now on screen.
      if (
        item.client.state.kind === 'ready' &&
        item.client.state.data.periodId === item.input.period.id
      )
        void item.client.load(item.input.period.id, true);
    }
    finish();
  };
  const output = async (
    source: Omit<ShiftSheetInput, 'contactNames'>,
    client: PeriodLoadClient,
    sourceCells: PrintedCells,
  ) => {
    const { loading, save } = current();
    if (active || loading.kind !== 'ready') return;
    active = true;
    setBusy(true);
    setNotice(null);
    setConflict(null);
    const input = structuredClone({ ...source, contactNames: loading.data.contactNames });
    const cells = structuredClone(sourceCells);
    const name = input.site === 1 ? '第一' : '第二';
    const message = `${name}のシフト表をExcelに出力しました`;
    const file = shiftExcelFileName(input.period.name, input.site, input.kind, input.outputDate);
    let item: PendingExport;
    try {
      const { buildShiftSheet } = await import('../excel/shift-sheet');
      const { downloadExcel } = await import('../excel/download');
      const result = await buildShiftSheet(input);
      item = { ...result, input, cells, client, download: downloadExcel };
    } catch (error) {
      setNotice({ file, failed: true, message: excelExportFailureMessage(error) });
      finish();
      return;
    }
    if (input.kind === 'draft') {
      item.download(item.bytes, item.fileName);
      setNotice({ file: item.fileName, failed: false, message });
      finish();
      return;
    }
    pending = item;
    await save(
      {
        operation: input.kind === 'initial' ? 'period.publish' : 'period.redistribute',
        revisions: [
          { target: { unit: 'period', id: input.period.id }, revision: input.period.revision },
        ],
        data: {
          id: input.period.id,
          site: input.site === 1 ? 'first' : 'second',
          cells: item.cells,
        },
        label: item.fileName,
      },
      message,
    );
  };
  return { output, receive };
}

/** The application owns the bytes and save progress even after a tab is unmounted. */
export function ShiftExcelExportProvider({ children }: { children: ReactNode }) {
  const save = useSave();
  const { refresh, saving, loading } = useAppFrame();
  const [busy, setBusy] = useState(false),
    [settled, setSettled] = useState(0);
  const [notice, setNotice] = useState<ExcelNotice | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);
  useEffect(
    () =>
      saving?.subscribe((event) => {
        if (event.kind === 'state' && event.pending.state.kind === 'queued') setConflict(null);
      }),
    [saving],
  );
  const current = useRef({ loading, save: save.save, refresh });
  current.current = { loading, save: save.save, refresh };
  const [exporter] = useState(() =>
    createShiftExcelExporter({
      current: () => current.current,
      setBusy,
      settle: () => setSettled((value) => value + 1),
      setNotice,
      setConflict,
    }),
  );
  useEffect(() => exporter.receive(save.outcome), [exporter, save.outcome]);
  return (
    <Context.Provider value={{ busy: busy || !saving, settled, output: exporter.output }}>
      {children}
      <ExcelExportNotice notice={notice} clear={() => setNotice(null)} />
      {conflict !== null && (
        <Toast
          placement="navigation"
          raised
          warn
          icon={<WarningMark size={26} />}
          message="保存できませんでした。相手から変更がありました。"
          label={conflict}
        />
      )}
    </Context.Provider>
  );
}

export function useShiftExcelExport() {
  return useContext(Context);
}
