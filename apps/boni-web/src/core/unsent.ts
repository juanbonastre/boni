/**
 * What was typed on a page or a note and has no answer from the server yet (task 100, D-65): the writes in flight, the
 * one waiting for its pause, and those the server could not take. As the window goes they are kept on the device at
 * once (the desktop's main process takes each out when its answer comes, even with the window gone); the next start
 * sends them again, and what the device shows meanwhile is them. Calendar's queue does the same (task 98).
 */
import type { PageSpec } from "@boni/views";
import type { DataRow, DataValue, Page } from "./agent.ts";

export interface PagePatch {
  title?: string;
  icon?: string;
  spec?: PageSpec;
}

/**
 * `path` and `at` are what the desktop's main process reads (`apps/boni-desktop/unsent.cjs`). A page made here and
 * not yet on the server (task 109, D-70) is two entries: its `new-page` (that it exists, with the id this device gave
 * it, which the server keeps) first, and its `page` write (what was typed in it), sent only once the page exists.
 */
export type UnsentWrite = {
  /**
   * Where it goes, with PUT: `api/pages/<id>` or `api/data/rows/<id>`. A `new-page` goes with POST to `api/pages`; its
   * path is that and its id after a `#`, one per page.
   */
  path: string;
  /** When it last changed here (epoch ms): an answer to a request that left after it means it arrived. */
  at: number;
  id: string;
} & (
  | { kind: "page"; patch: PagePatch }
  | { kind: "row"; values: Record<string, DataValue>; body?: string }
  | { kind: "new-page"; parent: string | null }
);

/** A page made here, to be made on the server with this `id` (the server answers the same page if it already is). */
export const newPageWrite = (id: string, parent: string | null, at: number): UnsentWrite => ({
  path: `api/pages#${id}`,
  at,
  id,
  kind: "new-page",
  parent,
});

/** The page `id` is made here and not yet on the server: its writes wait for it. */
export const creating = (list: readonly UnsentWrite[], id: string) =>
  list.some((x) => x.kind === "new-page" && x.id === id);

/** The list once the server has made page `id`: its `new-page` entry leaves, and its writes may go. */
export const made = (list: readonly UnsentWrite[], id: string): UnsentWrite[] =>
  list.filter((x) => !(x.kind === "new-page" && x.id === id));

/**
 * The list once page `from` turned out to be `to` on the server (a server before task 109 gives a page its own id):
 * what was typed in it goes to `to`, the later fields over the earlier ones if `to` has a write already.
 */
export function renamed(list: readonly UnsentWrite[], from: string, to: string): UnsentWrite[] {
  const mine = list.find((x) => x.kind === "page" && x.id === from);
  if (mine?.kind !== "page" || from === to) return [...list];
  const moved = pageWrite(to, mine.patch, mine.at);
  const rest = list.filter((x) => x !== mine);
  const there = rest.find((x) => x.kind === "page" && x.id === to);
  if (there?.kind !== "page") return [...rest, moved];
  const late = there.at > mine.at ? there : moved;
  const early = late === there ? moved : there;
  if (late.kind !== "page" || early.kind !== "page") return rest;
  return rest.map((x) => (x === there ? { ...late, patch: { ...early.patch, ...late.patch } } : x));
}

export const pageWrite = (id: string, patch: PagePatch, at: number): UnsentWrite => ({
  path: `api/pages/${encodeURIComponent(id)}`,
  at,
  id,
  kind: "page",
  patch,
});

export const rowWrite = (
  id: string,
  values: Record<string, DataValue>,
  body: string | undefined,
  at: number,
): UnsentWrite => ({
  path: `api/data/rows/${encodeURIComponent(id)}`,
  at,
  id,
  kind: "row",
  values,
  ...(body !== undefined ? { body } : {}),
});

/** The list with `w` in it: a page's or a row's earlier write takes the later one's fields over its own. */
export function merged(list: readonly UnsentWrite[], w: UnsentWrite): UnsentWrite[] {
  const i = list.findIndex((x) => x.path === w.path && x.kind === w.kind);
  if (i < 0) return [...list, w];
  const a = list[i] as UnsentWrite;
  const next: UnsentWrite =
    a.kind === "page" && w.kind === "page"
      ? { ...w, patch: { ...a.patch, ...w.patch } }
      : a.kind === "row" && w.kind === "row"
        ? {
            ...w,
            values: { ...a.values, ...w.values },
            ...((w.body ?? a.body) !== undefined ? { body: w.body ?? a.body } : {}),
          }
        : w;
  return list.map((x, j) => (j === i ? next : x));
}

/**
 * The list once the server answered a write of `path` that left at `sent`: what changed after it stays. `carried`:
 * what that request held when it was not the page's or row's whole kept write (another part of the app writing the
 * same note, a task ticked: task 106); then only its fields are taken out.
 */
export const answered = (
  list: readonly UnsentWrite[],
  path: string,
  sent: number,
  carried?: UnsentWrite,
): UnsentWrite[] =>
  list.flatMap((x) => {
    if (x.path !== path || x.at > sent) return [x];
    const left = carried ? without(x, carried) : null;
    return left ? [left] : [];
  });

/**
 * The page's list once it is back on a phone (task 109): with the page hidden, Boni Android's worker sends what was
 * kept (`keptAt`: when the page last kept its list) and takes out of the device's list (`kept`) what the server
 * answered. What was kept and the device no longer holds was answered, so it goes here too, field by field: sent again
 * it could write over what another device changed since. What changed here after `keptAt` stays as it is.
 */
export const stillKept = (
  list: readonly UnsentWrite[],
  kept: readonly UnsentWrite[],
  keptAt: number,
): UnsentWrite[] =>
  list.flatMap((x) => {
    if (x.at > keptAt) return [x];
    const there = kept.find((k) => k.path === x.path && k.kind === x.kind);
    if (!there) return [];
    const left = only(x, there);
    return left ? [left] : [];
  });

/** `w` with only the fields `k` still holds; null when none is left. */
function only(w: UnsentWrite, k: UnsentWrite): UnsentWrite | null {
  if (w.kind === "page" && k.kind === "page") {
    const patch = Object.fromEntries(
      Object.entries(w.patch).filter(([f]) => f in k.patch),
    ) as PagePatch;
    return Object.keys(patch).length ? { ...w, patch } : null;
  }
  if (w.kind === "row" && k.kind === "row") {
    const values = Object.fromEntries(Object.entries(w.values).filter(([f]) => f in k.values));
    const body = k.body === undefined ? undefined : w.body;
    if (!Object.keys(values).length && body === undefined) return null;
    return rowWrite(w.id, values, body, w.at);
  }
  return w;
}

/** `w` without the fields `c` carries; null when nothing of it is left. */
function without(w: UnsentWrite, c: UnsentWrite): UnsentWrite | null {
  if (w.kind === "page" && c.kind === "page") {
    const patch = Object.fromEntries(
      Object.entries(w.patch).filter(([k]) => !(k in c.patch)),
    ) as PagePatch;
    return Object.keys(patch).length ? { ...w, patch } : null;
  }
  if (w.kind === "row" && c.kind === "row") {
    const values = Object.fromEntries(Object.entries(w.values).filter(([k]) => !(k in c.values)));
    const body = c.body === undefined ? w.body : undefined;
    if (!Object.keys(values).length && body === undefined) return null;
    return rowWrite(w.id, values, body, w.at);
  }
  return w;
}

/**
 * A kept write the server fails (5xx) this many times in a row when it is resent (at the start and every minute: the
 * saves made while typing do not count, so a server restarting under a burst of saves is not taken for a broken one)
 * is said once, by its name, and the minute's resend tries it once an hour from then on (task 106); it stays kept, on
 * the screen and on the device, and goes at every start.
 */
export const FAILING_AFTER = 5;
export const FAILING_RETRY_MS = 60 * 60_000;

/** A kept write's 5xx answers in a row in this run, and when the minute's resend may try it again (0: any minute). */
export interface Failing {
  times: number;
  next: number;
  said: boolean;
}

/** One more 5xx for a write at `now`: how it stands, and whether to say it now (once, when it reaches the bound). */
export function failedAgain(
  f: Failing | undefined,
  now: number,
): { failing: Failing; say: boolean } {
  const times = (f?.times ?? 0) + 1;
  const bound = times >= FAILING_AFTER;
  const say = bound && !f?.said;
  return {
    failing: { times, next: bound ? now + FAILING_RETRY_MS : 0, said: Boolean(f?.said) || say },
    say,
  };
}

export function parseUnsent(text: string | null): UnsentWrite[] {
  if (!text) return [];
  try {
    const list: unknown = JSON.parse(text);
    if (!Array.isArray(list)) return [];
    return list.filter(
      (w): w is UnsentWrite =>
        Boolean(w) &&
        typeof w === "object" &&
        typeof w.path === "string" &&
        typeof w.at === "number" &&
        typeof w.id === "string" &&
        ((w.kind === "page" && w.patch && typeof w.patch === "object") ||
          (w.kind === "row" && w.values && typeof w.values === "object") ||
          (w.kind === "new-page" && (w.parent === null || typeof w.parent === "string"))),
    );
  } catch {
    return [];
  }
}

/** A page as the server or the device gave it, with what was typed here and has not reached the server. */
export function overPage(page: Page, list: readonly UnsentWrite[]): Page {
  const w = list.find((x) => x.kind === "page" && x.id === page.id);
  return w?.kind === "page" ? { ...page, ...w.patch } : page;
}

/** The same for a note: its properties and its text. */
export function overRow(row: DataRow, list: readonly UnsentWrite[]): DataRow {
  const w = list.find((x) => x.kind === "row" && x.id === row.id);
  if (w?.kind !== "row") return row;
  return {
    ...row,
    values: { ...row.values, ...w.values },
    ...(w.body !== undefined ? { body: w.body } : {}),
  };
}
