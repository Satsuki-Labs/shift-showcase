import type { Draft, StoredPendingSave } from '../saving/types';
import type { SaveWindow } from '../saving/window';

interface RestoreInput {
  operation: string;
  label: string;
  order: number;
}
export interface RestoreState {
  mode: 'reload' | 'close';
  restoredTo: string;
  inputs: RestoreInput[];
}
const rememberedGenerationKey = 'shift-showcase-data-generation';
type ResponseListener = (
  response: Response,
  firstGeneration?: string,
  code?: string,
) => Promise<void>;
const responses = new Set<ResponseListener>();
export function watchDataResponses(listener: ResponseListener) {
  responses.add(listener);
  return () => {
    responses.delete(listener);
  };
}
export async function observeDataResponse(
  response: Response,
  firstGeneration?: string,
  code?: string,
) {
  await Promise.all([...responses].map((listener) => listener(response, firstGeneration, code)));
}
const header = (response: Response, name: string) => {
  const value = response.headers.get(name);
  return value && value !== 'null' ? value : null;
};

/** Owns the generation of this screen and the one notice shown on this screen. */
export class DataGeneration {
  private generation?: string;
  private restoredTo: string | null = null;
  private saving?: SaveWindow;
  private shown = false;
  private notice: RestoreState | null = null;
  private readonly listeners = new Set<() => void>();
  constructor(
    private readonly storage: () => Pick<Storage, 'getItem' | 'setItem'> = () => localStorage,
  ) {}
  getSnapshot = () => this.notice;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  close = () => {
    if (this.notice?.mode === 'close') this.publish(null);
  };
  private publish(notice: RestoreState | null) {
    this.notice = notice;
    this.listeners.forEach((listener) => listener());
  }
  private remember(generation: string) {
    try {
      this.storage().setItem(rememberedGenerationKey, generation);
    } catch {
      /* Storage is optional. */
    }
  }
  async initialize(saving: SaveWindow, stale: Draft[]) {
    this.saving = saving;
    if (this.shown) {
      const inputs = [
        ...stale.map((draft) => ({
          operation: draft.request.operation,
          label: draft.label,
          order: draft.order,
        })),
        ...saving.getPending(),
      ];
      await saving.discardForRestore();
      this.publish({ ...this.notice!, inputs: inputs.sort((a, b) => a.order - b.order) });
      return;
    }
    let remembered: string | null = null;
    try {
      remembered = this.storage().getItem(rememberedGenerationKey);
    } catch {
      /* Treat as a first visit. */
    }
    if (
      this.restoredTo &&
      ((remembered !== null && remembered !== this.generation) || stale.length > 0)
    ) {
      this.shown = true;
      this.publish({
        mode: 'close',
        restoredTo: this.restoredTo,
        inputs: stale.map((draft) => ({
          operation: draft.request.operation,
          label: draft.label,
          order: draft.order,
        })),
      });
    }
    if (this.generation) this.remember(this.generation);
  }
  receive: ResponseListener = async (response, firstGeneration, code) => {
    const generation = header(response, 'X-Data-Generation');
    const restoredTo = header(response, 'X-Restored-To');
    if (this.generation === undefined) {
      if (firstGeneration) {
        this.generation = firstGeneration;
        this.restoredTo = restoredTo;
      }
      return;
    }
    if (
      this.shown ||
      restoredTo === null ||
      !(code === 'E-42' || (generation !== null && generation !== this.generation))
    )
      return;
    this.shown = true;
    if (generation) this.remember(generation);
    const inputs: StoredPendingSave[] = this.saving?.getPending() ?? [];
    this.publish({ mode: 'reload', restoredTo, inputs });
    await this.saving?.discardForRestore();
  };
}
