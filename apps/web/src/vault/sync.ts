import type { VaultBridge } from "../vaultBridge.ts";
import { parseIndex, serializeIndex, type VaultIndex } from "./index.ts";
import { loadVault, type VaultLoad } from "./loadVault.ts";

/**
 * Keeps the app's picture of the vault current: the first read starts from the index saved on disk,
 * every later one from the index in memory, so only notes whose modification time or size changed are
 * read and parsed. A watcher (and window focus, which also covers synced changes) triggers re-reads.
 */
let index: VaultIndex | null = null;
let busy = false;
let again = false;
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
  if (changed) void bridge.cacheWrite?.(serializeIndex(r.index));
  return r;
}

/**
 * Runs `task` now, or after the running one finishes if there is one (changes that arrive meanwhile
 * must not be lost, and two reads must not overlap).
 */
export async function serialized(task: () => Promise<void>): Promise<void> {
  if (busy) {
    again = true;
    return;
  }
  busy = true;
  try {
    do {
      again = false;
      await task();
    } while (again);
  } finally {
    busy = false;
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
