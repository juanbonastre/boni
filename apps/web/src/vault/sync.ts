import type { CollectionDef } from "@boni-calendar/core";
import type { VaultBridge } from "../vaultBridge.ts";
import { type IndexEntry, parseIndex, serializeIndex, type VaultIndex } from "./index.ts";
import { loadVault, type VaultLoad } from "./loadVault.ts";

/**
 * Keeps the app's picture of the vault current: the first read starts from the index saved on disk,
 * every later one from the index in memory, so only notes whose modification time or size changed are
 * read and parsed. A watcher (and window focus, which also covers synced changes) triggers re-reads.
 */
let index: VaultIndex | null = null;
let defs: CollectionDef[] = [];
let refreshing = false;
let again = false;
let lock: Promise<unknown> = Promise.resolve();
let persistTimer: ReturnType<typeof setTimeout> | undefined;

/** Ids the app gave to rows before their note existed, and the path the note got. */
export const aliases = new Map<string, string>();

/** Runs `task` after everything before it finished: reads and writes of the vault never overlap. */
export function withLock<T>(task: () => Promise<T>): Promise<T> {
  const run = lock.then(task, task);
  lock = run.catch(() => undefined);
  return run;
}

export const currentDefs = (): CollectionDef[] => defs;
/** The path of the note an event id stands for (it may be a temporary id), if that note exists. */
export function noteOf(id: string): string | null {
  const path = aliases.get(id) ?? id;
  return index?.has(path) ? path : null;
}

export const vaultEntries = (): VaultIndex => index ?? new Map();

/** Records what a write left on disk so the next scan sees nothing new. */
export function setEntry(path: string, entry: IndexEntry): void {
  index?.set(path, entry);
}
export function dropEntry(path: string): void {
  index?.delete(path);
}

/** Saves the index a moment after the last change (writes come in bursts). */
export function persistSoon(bridge: VaultBridge): void {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    if (index) void bridge.cacheWrite?.(serializeIndex(index));
  }, 800);
}
let stopListening: (() => void) | null = null;
let watched = "";

/** Forget what was read (the vault folder changed). */
export function resetVaultIndex(): void {
  index = null;
}

async function savedIndex(bridge: VaultBridge): Promise<VaultIndex> {
  const r = await bridge.cacheRead?.();
  return r?.ok ? parseIndex(r.value) : new Map();
}

/** One read of the vault with the best index available; saves the index when it changed. */
export async function readVault(
  bridge: VaultBridge,
  opts: { readOnly: boolean },
): Promise<VaultLoad> {
  const prev = index ?? (await savedIndex(bridge));
  const r = await loadVault(bridge, opts, prev);
  const changed = r.read > 0 || r.index.size !== prev.size || index === null;
  index = r.index;
  defs = r.defs;
  if (changed) void bridge.cacheWrite?.(serializeIndex(r.index));
  return r;
}

/**
 * Runs a refresh now, or once more after the running one finishes if there is one (changes that arrive
 * meanwhile must not be lost). Refreshes also wait for any write in progress.
 */
export async function serialized(task: () => Promise<void>): Promise<void> {
  if (refreshing) {
    again = true;
    return;
  }
  refreshing = true;
  try {
    do {
      again = false;
      await withLock(task);
    } while (again);
  } finally {
    refreshing = false;
  }
}

/** Watches the folders and the window focus; `onChange` is called when the vault may have changed. */
export function watchVault(bridge: VaultBridge, folders: string[], onChange: () => void): void {
  const key = folders.join("\n");
  if (key !== watched) {
    watched = key;
    void bridge.watch?.(folders);
  }
  if (stopListening) return;
  const offBridge = bridge.onChanged?.(onChange);
  const onFocus = () => onChange();
  window.addEventListener("focus", onFocus);
  stopListening = () => {
    offBridge?.();
    window.removeEventListener("focus", onFocus);
  };
}

export function stopWatchingVault(bridge: VaultBridge | null): void {
  stopListening?.();
  stopListening = null;
  watched = "";
  void bridge?.watch?.([]);
}
