import type { IndexCache } from "./bridge.ts";

const DB = "boni-calendar";
const STORE = "vault-index";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function run<T>(
  mode: IDBTransactionMode,
  op: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = op(tx.objectStore(STORE));
        tx.oncomplete = () => {
          db.close();
          resolve(req.result);
        };
        tx.onerror = tx.onabort = () => {
          db.close();
          reject(tx.error ?? req.error);
        };
      }),
  );
}

/**
 * The index of parsed notes for one vault on this device, in IndexedDB. Not in the vault's config
 * folder (Syncthing would carry it to the phone) and not in localStorage: it is a few megabytes,
 * which localStorage would load into memory every time Obsidian starts and write synchronously.
 */
export function indexedDbCache(vaultId: string): IndexCache {
  return {
    read: async () => {
      const v = await run("readonly", (s) => s.get(vaultId) as IDBRequest<unknown>);
      return typeof v === "string" ? v : null;
    },
    write: async (text) => {
      await run("readwrite", (s) => s.put(text, vaultId));
    },
  };
}
