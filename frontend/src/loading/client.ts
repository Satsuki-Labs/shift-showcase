import { ERROR_CODES, type ErrorCode } from '../../../shared/error-codes';
import type {
  AnnualRules,
  ContactNames,
  FirstLoadResponse,
  PeriodSummary,
  Revision,
  Staff,
} from '../../../shared/protocol';
import { observeDataResponse } from '../app/data-generation';

export type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; data: FirstLoadResponse & { dataGeneration: string } }
  | { kind: 'unreachable' }
  | { kind: 'fatal'; code: ErrorCode }
  | { kind: 'unregistered'; code: 'E-25' };
export type ReadTransport = (url: string, init: RequestInit) => Promise<Response>;

function errorState(value: unknown): LoadState | undefined {
  if (!value || typeof value !== 'object') return;
  const code = (value as { code?: unknown }).code;
  if (typeof code !== 'string' || !Object.prototype.hasOwnProperty.call(ERROR_CODES, code)) return;
  if (code === 'E-25') return { kind: 'unregistered', code };
  return ERROR_CODES[code as ErrorCode].display === 'always'
    ? { kind: 'fatal', code: code as ErrorCode }
    : { kind: 'unreachable' };
}
function isFirstLoad(value: unknown): value is FirstLoadResponse & { dataGeneration: string } {
  if (!value || typeof value !== 'object') return false;
  const data = value as FirstLoadResponse;
  return (
    typeof data.identity?.email === 'string' &&
    ['first', 'second', 'maintenance'].includes(data.identity.role) &&
    typeof data.appVersion === 'string' &&
    typeof data.dataGeneration === 'string' &&
    Number.isSafeInteger(data.dataChangeNumber) &&
    data.dataChangeNumber >= 0 &&
    typeof data.contactNames?.first === 'string' &&
    typeof data.contactNames?.second === 'string' &&
    Array.isArray(data.staff) &&
    Array.isArray(data.periods) &&
    Array.isArray(data.annualRules?.openingRules) &&
    Array.isArray(data.annualRules?.peaks) &&
    Array.isArray(data.annualRules?.annualClosures) &&
    Array.isArray(data.notifications) &&
    data.notifications.every(
      (item) =>
        (item?.kind === 'backup_failure' &&
          ['E-52', 'E-62', 'E-63', 'E-64', 'E-92'].includes(item.code)) ||
        (item?.kind === 'schedule_stalled' && item.code === 'E-94'),
    )
  );
}

export class LoadClient {
  state: LoadState = { kind: 'loading' };
  private readonly listeners = new Set<(state: LoadState) => void>();
  private readonly refreshListeners = new Set<() => Promise<unknown>>();
  private contentPending = false;
  private checking?: Promise<void>;
  private checkRequested = false;
  private sequence = 0;
  constructor(private readonly transport: ReadTransport = (url, init) => fetch(url, init)) {}
  subscribe(listener: (state: LoadState) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  subscribeRefresh = (listener: () => Promise<unknown>) => {
    this.refreshListeners.add(listener);
    return () => {
      this.refreshListeners.delete(listener);
    };
  };
  watchVisible(
    page: Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>,
  ) {
    let timer: ReturnType<typeof setInterval> | undefined;
    const update = () => {
      clearInterval(timer);
      timer =
        page.visibilityState === 'visible'
          ? setInterval(() => {
              void this.checkChange();
            }, 180_000)
          : undefined;
    };
    update();
    page.addEventListener('visibilitychange', update);
    return () => {
      clearInterval(timer);
      page.removeEventListener('visibilitychange', update);
    };
  }
  private publish(state: LoadState) {
    this.state = state;
    this.listeners.forEach((listener) => listener(state));
  }
  async load(): Promise<LoadState> {
    return this.readFirstLoad(false);
  }
  async refresh(): Promise<LoadState> {
    return this.readFirstLoad(true);
  }
  private async readFirstLoad(background: boolean): Promise<LoadState> {
    const sequence = ++this.sequence;
    if (!background) this.publish({ kind: 'loading' });
    let result: LoadState;
    try {
      const response = await this.transport('/api/first-load', {
        credentials: 'same-origin',
        cache: 'no-store',
      });
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        body = undefined;
      }
      await observeDataResponse(
        response,
        response.ok && isFirstLoad(body) ? body.dataGeneration : undefined,
      );
      result =
        errorState(body) ??
        (response.ok && isFirstLoad(body)
          ? { kind: 'ready', data: body }
          : response.status >= 500 || response.status === 429
            ? { kind: 'unreachable' }
            : { kind: 'fatal', code: 'E-73' });
    } catch {
      result = { kind: 'unreachable' };
    }
    if (sequence === this.sequence && !(background && result.kind === 'unreachable')) {
      this.publish(result);
    }
    return result;
  }
  noteOwnSave(number: number) {
    this.sequence++;
    if (this.state.kind === 'ready' && number === this.state.data.dataChangeNumber + 1) {
      this.state = { kind: 'ready', data: { ...this.state.data, dataChangeNumber: number } };
    }
  }
  applyStaff(staff: Staff[], revisions: Revision[] = []) {
    if (this.state.kind !== 'ready') return;
    // A read started before this save must not replace its confirmed result.
    this.sequence++;
    const order = revisions.find((item) => item.target.unit === 'staff-order');
    this.publish({
      kind: 'ready',
      data: {
        ...this.state.data,
        staff,
        staffOrderRevision: order?.revision ?? this.state.data.staffOrderRevision,
      },
    });
  }
  applyContactNames(contactNames: ContactNames, revisions: Revision[] = []) {
    if (this.state.kind !== 'ready') return;
    this.sequence++;
    const contactNameRevisions = { ...this.state.data.contactNameRevisions };
    for (const item of revisions)
      if (item.target.unit === 'contact-name' && item.revision !== null)
        contactNameRevisions[item.target.site] = item.revision;
    this.publish({
      kind: 'ready',
      data: { ...this.state.data, contactNames, contactNameRevisions },
    });
  }
  applyAnnualRules(annualRules: AnnualRules, revisions: Revision[] = []) {
    if (this.state.kind !== 'ready') return;
    this.sequence++;
    const updated = new Map(
      (this.state.data.annualRuleRevisions ?? []).map((item) => [
        JSON.stringify(item.target),
        item,
      ]),
    );
    for (const item of revisions) {
      const key = JSON.stringify(item.target);
      if (item.revision === null) updated.delete(key);
      else updated.set(key, item);
    }
    this.publish({
      kind: 'ready',
      data: { ...this.state.data, annualRules, annualRuleRevisions: [...updated.values()] },
    });
  }
  applyPeriods(periods: PeriodSummary[]) {
    if (this.state.kind !== 'ready') return;
    this.sequence++;
    this.publish({ kind: 'ready', data: { ...this.state.data, periods } });
  }
  private publishBackgroundError(state: LoadState) {
    if (state.kind === 'fatal' || state.kind === 'unregistered') this.publish(state);
  }
  checkChange(): Promise<void> {
    this.checkRequested = true;
    if (!this.checking) this.checking = this.checkChanges();
    return this.checking;
  }
  private async checkChanges(): Promise<void> {
    try {
      do {
        this.checkRequested = false;
        await this.readChange();
      } while (this.checkRequested);
    } finally {
      this.checking = undefined;
    }
  }
  private async readChange(): Promise<void> {
    if (this.state.kind !== 'ready') return;
    const sequence = this.sequence;
    try {
      const response = await this.transport('/api/change-number', {
        credentials: 'same-origin',
        cache: 'no-store',
      });
      await observeDataResponse(response);
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        body = undefined;
      }
      if (sequence !== this.sequence) return;
      const error = errorState(body);
      if (error) this.publishBackgroundError(error);
      else if (response.ok && Number.isSafeInteger(body) && (body as number) >= 0) {
        if (this.state.kind !== 'ready') return;
        if (body !== this.state.data.dataChangeNumber) {
          const result = await this.readFirstLoad(true);
          if (result.kind !== 'ready' || this.state !== result) return;
          this.contentPending = true;
        }
        if (this.contentPending) {
          const results = await Promise.all(
            [...this.refreshListeners].map((listener) => listener()),
          );
          this.contentPending = results.some((result) => result === undefined);
        }
      } else
        this.publishBackgroundError(
          response.status >= 500 || response.status === 429
            ? { kind: 'unreachable' }
            : { kind: 'fatal', code: 'E-73' },
        );
    } catch {
      /* A background connection failure keeps the current display. */
    }
  }
  async reportScreenError(screen: string): Promise<void> {
    const response = await this.transport('/api/screen-error', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'E-72', screen }),
    });
    await observeDataResponse(response);
    if (!response.ok) throw new Error('Screen error report failed');
  }
}
