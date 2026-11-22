import { fiscalYearOf } from '../../../shared/calendar';
import type { CalendarRows, YearLoadResponse } from '../../../shared/protocol';
import type { ReadTransport } from '../loading/client';
import { observeDataResponse } from '../app/data-generation';

export interface YearLoadState {
  kind: 'loading' | 'ready' | 'unreachable';
  year?: number;
  data?: YearLoadResponse;
}
export interface RuleCalendar {
  data?: CalendarRows;
  reload: (date?: string) => Promise<YearLoadResponse | undefined>;
}
export class YearLoadClient {
  state: YearLoadState = { kind: 'loading' };
  private sequence = 0;
  private requestedYear?: number;
  private readonly listeners = new Set<(state: YearLoadState) => void>();
  constructor(private readonly transport: ReadTransport = (url, init) => fetch(url, init)) {}
  subscribe(listener: (state: YearLoadState) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  cancel() {
    this.sequence++;
  }
  private publish(state: YearLoadState) {
    this.state = state;
    this.listeners.forEach((listener) => listener(state));
  }
  applyDay(date: string, rows: CalendarRows) {
    this.applyDays([date], rows);
  }
  applyDays(dates: string[], rows: CalendarRows) {
    if (!this.state.data || this.state.year !== this.requestedYear) return;
    const changed = new Set(dates.filter((date) => fiscalYearOf(date) === this.state.year));
    if (!changed.size) return;
    this.sequence++;
    this.publish({
      ...this.state,
      kind: 'ready',
      data: {
        ...this.state.data,
        facilityDays: [
          ...this.state.data.facilityDays.filter((row) => !changed.has(row.date)),
          ...rows.facilityDays.filter((row) => changed.has(row.date)),
        ],
        buildingDays: [
          ...this.state.data.buildingDays.filter((row) => !changed.has(row.date)),
          ...rows.buildingDays.filter((row) => changed.has(row.date)),
        ],
      },
    });
  }
  async load(year: number, background = false): Promise<YearLoadResponse | undefined> {
    if (background && this.requestedYear !== undefined && this.requestedYear !== year) return;
    this.requestedYear = year;
    const sequence = ++this.sequence;
    if (!background) this.publish({ ...this.state, kind: 'loading' });
    let result: YearLoadState;
    try {
      const response = await this.transport(`/api/year-load?year=${year}`, {
        credentials: 'same-origin',
        cache: 'no-store',
      });
      await observeDataResponse(response);
      const data = (await response.json()) as YearLoadResponse;
      result =
        response.ok &&
        typeof data.appVersion === 'string' &&
        typeof data.dataGeneration === 'string' &&
        typeof data.requestId === 'string' &&
        Array.isArray(data.facilityDays) &&
        Array.isArray(data.buildingDays)
          ? { kind: 'ready', year, data }
          : { ...this.state, kind: 'unreachable' };
    } catch {
      result = { ...this.state, kind: 'unreachable' };
    }
    if (sequence === this.sequence) {
      if (!background || result.kind === 'ready') this.publish(result);
      return result.kind === 'ready' ? result.data : undefined;
    }
  }
}
