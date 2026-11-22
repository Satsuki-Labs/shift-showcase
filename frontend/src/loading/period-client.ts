import type {
  DistributedSheet,
  PeriodLoadResponse,
  ShiftCellChangedData,
} from '../../../shared/protocol';
import type { ReadTransport } from './client';
import { applyCellData } from '../../../shared/period';
import { observeDataResponse } from '../app/data-generation';

export type PeriodLoadState =
  { kind: 'loading' | 'unreachable' } | { kind: 'ready'; data: PeriodLoadResponse };
export class PeriodLoadClient {
  state: PeriodLoadState = { kind: 'loading' };
  private sequence = 0;
  private requestedId?: string;
  private readonly distributed = new Map<
    string,
    Partial<Record<'first' | 'second', DistributedSheet>>
  >();
  private readonly listeners = new Set<(state: PeriodLoadState) => void>();
  constructor(private readonly transport: ReadTransport = (url, init) => fetch(url, init)) {}
  subscribe(listener: (state: PeriodLoadState) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  cancel() {
    this.sequence++;
  }
  private publish(state: PeriodLoadState) {
    this.state = state;
    this.listeners.forEach((listener) => listener(state));
  }
  apply(changed: ShiftCellChangedData) {
    if (this.state.kind === 'ready') {
      this.sequence++;
      this.publish({ kind: 'ready', data: applyCellData(this.state.data, changed) });
    }
  }
  applyDistributedSheet(id: string, site: 'first' | 'second', sheet: DistributedSheet) {
    this.distributed.set(id, { ...this.distributed.get(id), [site]: structuredClone(sheet) });
    if (this.state.kind === 'ready' && this.state.data.periodId === id) {
      this.sequence++;
      this.publish({
        kind: 'ready',
        data: {
          ...this.state.data,
          distributedSheets: {
            ...this.state.data.distributedSheets,
            [site]: structuredClone(sheet),
          },
        },
      });
    }
  }
  async load(id: string, background = false) {
    if (background && this.requestedId !== undefined && this.requestedId !== id) return;
    this.requestedId = id;
    const sequence = ++this.sequence;
    if (!background) this.publish({ kind: 'loading' });
    let result: PeriodLoadState;
    try {
      const response = await this.transport(`/api/period-load?id=${encodeURIComponent(id)}`, {
        credentials: 'same-origin',
        cache: 'no-store',
      });
      await observeDataResponse(response);
      const data = (await response.json()) as PeriodLoadResponse;
      for (const site of ['first', 'second'] as const) {
        const own = this.distributed.get(id)?.[site],
          loaded = data.distributedSheets?.[site];
        if (own && (!loaded || loaded.distributed_at <= own.distributed_at)) {
          data.distributedSheets = { ...data.distributedSheets, [site]: structuredClone(own) };
        }
      }
      result =
        response.ok &&
        data.periodId === id &&
        typeof data.appVersion === 'string' &&
        typeof data.dataGeneration === 'string' &&
        typeof data.requestId === 'string' &&
        Array.isArray(data.dayStates) &&
        Array.isArray(data.workSlots) &&
        Array.isArray(data.paidLeaveDates) &&
        Array.isArray(data.facilityDays) &&
        Array.isArray(data.buildingDays) &&
        (data.snapshot === null ||
          (data.snapshot &&
            Array.isArray(data.snapshot.staff) &&
            data.snapshot.staff.every((person) => person && Array.isArray(person.history)) &&
            Array.isArray(data.snapshot.annualClosures)))
          ? { kind: 'ready', data }
          : { kind: 'unreachable' };
    } catch {
      result = { kind: 'unreachable' };
    }
    if (sequence === this.sequence && (!background || result.kind === 'ready'))
      this.publish(result);
    return sequence === this.sequence && result.kind === 'ready' ? result.data : undefined;
  }
}
