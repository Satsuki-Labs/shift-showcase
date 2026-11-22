import type { SaveRequest } from '../../../shared/protocol';
import type { Draft } from './types';

export class DraftStore {
  private readonly database: Promise<IDBDatabase>;
  constructor(factory: IDBFactory = indexedDB, name = 'shift-showcase-unsaved') {
    this.database = new Promise((resolve, reject) => {
      const open = factory.open(name, 1);
      open.onupgradeneeded = () => {
        open.result.createObjectStore('drafts', { keyPath: 'order', autoIncrement: true });
      };
      open.onerror = () => reject(open.error);
      open.onblocked = () => reject(new Error('Draft storage is blocked'));
      open.onsuccess = () => {
        open.result.onversionchange = () => open.result.close();
        resolve(open.result);
      };
    });
  }
  private async transaction<T>(
    mode: IDBTransactionMode,
    action: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    const db = await this.database;
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('drafts', mode, { durability: 'strict' });
      const request = action(transaction.objectStore('drafts'));
      let result: T;
      request.onsuccess = () => {
        result = request.result;
      };
      transaction.oncomplete = () => resolve(result);
      transaction.onabort = () => reject(transaction.error ?? request.error);
      transaction.onerror = () => reject(transaction.error ?? request.error);
    });
  }
  async add(request: SaveRequest, label: string): Promise<Draft> {
    const entry = { request, label, state: { kind: 'queued' } as const };
    const order = await this.transaction('readwrite', (store) => store.add(entry));
    return { ...entry, order: order as number };
  }
  list(): Promise<Draft[]> {
    return this.transaction('readonly', (store) => store.getAll());
  }
  async put(entry: Draft): Promise<void> {
    await this.transaction('readwrite', (store) => store.put(entry));
  }
  async remove(order: number): Promise<void> {
    await this.transaction('readwrite', (store) => store.delete(order));
  }
  async close(): Promise<void> {
    (await this.database).close();
  }
}
