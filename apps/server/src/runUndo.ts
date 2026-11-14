import type { ReadStore, ToolDef } from "@boni/agent";
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
 * of none (a route, a test) keeps nothing. Only `withKept` calls it: an action says its keys in its definition.
 */
async function keepingSettingsAsync<T>(
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

/**
 * The action as the server runs it (`serverRegistry`): with what it declares it rewrites beside the log
 * (`ToolDef.keeps`), kept for its run around its own `run`. The run is the service's (`meta.run`, the mail's `run`): a
 * route or a test runs it with none and keeps nothing.
 */
export function withKept(def: ToolDef): ToolDef {
  const keeps = def.keeps;
  if (!keeps) return def;
  return {
    ...def,
    run(c, a, extra) {
      const at = keptAt((c as { service?: unknown }).service);
      let keys: readonly string[] = [];
      try {
        keys = at ? keeps({ store: (c as { store: ReadStore }).store }, a) : [];
      } catch {
        // What it cannot name (a collection that is not there) its own run refuses, with its own error.
      }
      if (!at || !keys.length) return def.run(c, a, extra);
      return keepingSettingsAsync(at.store, at.run, keys, async () => def.run(c, a, extra));
    },
  };
}
function keptAt(s: unknown): { store: UserStore; run: string | undefined } | null {
  if (!s || typeof s !== "object" || !("store" in s)) return null;
  const x = s as { store: UserStore; run?: unknown; meta?: { run?: unknown } };
  const run =
    typeof x.meta?.run === "string" ? x.meta.run : typeof x.run === "string" ? x.run : undefined;
  return { store: x.store, run };
}

/** Whether the run kept something its Undo has not taken back yet. */
export function undoable(store: UserStore, run: string): boolean {
  return listOf(store, run).length > 0;
}

/**
 * Whether something the run kept can no longer be taken back, a change since then standing on it: a setting rewritten
 * again, a flow deleted since. What is already as before is not in the way. A correction (§3.1), all or nothing, asks
 * first.
 */
export function keptInTheWay(
  store: UserStore,
  run: string,
  flow: (k: Extract<Kept, { flow: string }>) => boolean = () => false,
): boolean {
  return listOf(store, run).some((k) => {
    if ("setting" in k) {
      const now = store.setting(k.setting) ?? null;
      return now !== k.after && now !== k.before;
    }
    if ("extension" in k) return false;
    return flow(k);
  });
}

/** How to put back what taking `k` back changed (`k` was back: it was as the run left it). */
const inverse = (k: Kept): Kept =>
  "setting" in k
    ? { setting: k.setting, before: k.after, after: k.before }
    : "extension" in k
      ? { extension: k.extension, enabled: !k.enabled }
      : k.deleted !== undefined
        ? { flow: k.flow, deleted: !k.deleted }
        : { flow: k.flow, enabled: !k.enabled };

/**
 * Takes back what the run kept, newest first: a setting only if it is still as the run left it; a flow by `flow`
 * (the host's, which knows how to switch one back). How many came back; what did not (a change since then stands on
 * it) stays kept, so Undo of the later change first lets this one be taken back after.
 *
 * `into`: the run that takes it back (a correction by `turns.undo`, §3.1). It keeps how to put back each thing that
 * came back, and the run's own list as it was, so its Undo, or its stop after (task 120: all or nothing), leaves
 * the corrected run as it was, its Undo included.
 */
export function undoKept(
  store: UserStore,
  run: string,
  flow: (k: Extract<Kept, { flow: string }>) => boolean = () => false,
  into?: string,
): number {
  let n = 0;
  const left: Kept[] = [];
  const key = `${RUN_UNDO}${run}`;
  const was = store.setting(key) ?? null;
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
    if (back) {
      n++;
      if (into) keep(store, into, inverse(k));
    } else left.unshift(k);
  }
  const now = left.length ? JSON.stringify(left) : null;
  store.setSetting(key, now);
  if (into && n) keep(store, into, { setting: key, before: was, after: now });
  return n;
}
