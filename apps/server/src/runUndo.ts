import type { UserStore } from "@boni/store";
import { extension, setEnabled } from "./extensions.ts";

/**
 * What a run changed beside the store's operation log, kept with the run so that its Undo takes it back
 * (docs/sistema.md §4.1, F10): a flow it switched or deleted in «Flujos» (journal rows), an extension it switched on
 * or off, and a setting of the store
 * it rewrote (a calendar's definition, a collection's saved views or its notes in the tree, the mail's settings and
 * its guide). Undo of the run (`POST /api/agent/runs/:id/undo`, the MCP's `undo`) takes them back newest first,
 * and only what is still as the run left it: a change of Juan's since then wins.
 */

/** The setting that keeps them, by run (its name from when only flows were kept here). */
export const RUN_UNDO = "flows/undo/";

/**
 * One thing a run changed beside the log: a flow (agent.ts `undoKept`), an extension it switched (Boni's own collection,
 * which only the system writes: `enabled` is how it was) or a setting, with its value before and after.
 */
export type Kept =
  | { flow: string; enabled?: boolean; deleted?: boolean }
  | { extension: string; enabled: boolean }
  | { setting: string; before: string | null; after: string | null };

const listOf = (store: UserStore, run: string): Kept[] =>
  JSON.parse(store.setting(`${RUN_UNDO}${run}`) ?? "[]") as Kept[];

/** Keeps one more thing the run changed. */
export function keep(store: UserStore, run: string, k: Kept): void {
  store.setSetting(`${RUN_UNDO}${run}`, JSON.stringify([...listOf(store, run), k]));
}

/**
 * Runs `f`, which rewrites some of `keys` (settings of the store), and keeps for the run each one it changed. A run
 * of none (a route, a test) keeps nothing.
 */
export function keepingSettings<T>(
  store: UserStore,
  run: string | undefined,
  keys: readonly string[],
  f: () => T,
): T {
  const before = keys.map((k) => store.setting(k));
  const out = f();
  if (run)
    keys.forEach((k, i) => {
      const after = store.setting(k);
      if (after !== before[i]) keep(store, run, { setting: k, before: before[i] ?? null, after });
    });
  return out;
}

/** The same for a change that awaits (the mail's settings: its server is asked first). */
export async function keepingSettingsAsync<T>(
  store: UserStore,
  run: string | undefined,
  keys: readonly string[],
  f: () => Promise<T>,
): Promise<T> {
  const before = keys.map((k) => store.setting(k));
  const out = await f();
  if (run)
    keys.forEach((k, i) => {
      const after = store.setting(k);
      if (after !== before[i]) keep(store, run, { setting: k, before: before[i] ?? null, after });
    });
  return out;
}

/** Whether the run kept something its Undo has not taken back yet. */
export function undoable(store: UserStore, run: string): boolean {
  return listOf(store, run).length > 0;
}

/**
 * Takes back what the run kept, newest first: a setting only if it is still as the run left it; a flow by `flow`
 * (the host's, which knows how to switch one back). How many came back; what did not (a change since then stands on
 * it) stays kept, so Undo of the later change first lets this one be taken back after.
 */
export function undoKept(
  store: UserStore,
  run: string,
  flow: (k: Extract<Kept, { flow: string }>) => boolean = () => false,
): number {
  let n = 0;
  const left: Kept[] = [];
  for (const k of [...listOf(store, run)].reverse()) {
    let back = false;
    if ("setting" in k) {
      back = store.setting(k.setting) === k.after;
      if (back) store.setSetting(k.setting, k.before);
    } else if ("extension" in k) {
      const x = extension(store, k.extension);
      back = !!x && x.enabled !== k.enabled;
      if (back) setEnabled(store, k.extension, k.enabled);
    } else back = flow(k);
    if (back) n++;
    else left.unshift(k);
  }
  store.setSetting(`${RUN_UNDO}${run}`, left.length ? JSON.stringify(left) : null);
  return n;
}
