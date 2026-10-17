/**
 * A tiny key-value store in IndexedDB (per device and per origin, never in the vault): the last copy
 * of external calendars, the last snapshot from the server. Every call resolves (null on failure):
 * without IndexedDB the app works, it only loses its offline copies.
 */
export interface KvStore<T> {
  get(key: string): Promise<T | null>;
  put(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
}

export function kvStore<T>(db: string, store: string): KvStore<T> {
  const run = <R>(
    mode: IDBTransactionMode,
    op: (s: IDBObjectStore) => IDBRequest<R>,
  ): Promise<R | null> =>
    new Promise((resolve) => {
      let req: IDBOpenDBRequest;
      try {
        req = indexedDB.open(db, 1);
      } catch {
        return resolve(null);
      }
      req.onupgradeneeded = () => req.result.createObjectStore(store);
      req.onerror = () => resolve(null);
      req.onsuccess = () => {
        const conn = req.result;
        try {
          const tx = conn.transaction(store, mode);
          const r = op(tx.objectStore(store));
          tx.oncomplete = () => {
            conn.close();
            resolve(r.result);
          };
          tx.onerror = tx.onabort = () => {
            conn.close();
            resolve(null);
          };
        } catch {
          conn.close();
          resolve(null);
        }
      };
    });
  return {
    get: async (key) =>
      (await run("readonly", (s) => s.get(key) as IDBRequest<T | undefined>)) ?? null,
    put: async (key, value) => {
      await run("readwrite", (s) => s.put(value, key));
    },
    delete: async (key) => {
      await run("readwrite", (s) => s.delete(key));
    },
  };
}
