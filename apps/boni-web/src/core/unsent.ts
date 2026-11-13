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

/** `path` and `at` are what the desktop's main process reads (`apps/boni-desktop/unsent.cjs`). */
export type UnsentWrite = {
  /** Where it goes, with PUT: `api/pages/<id>` or `api/data/rows/<id>`. */
  path: string;
  /** When it last changed here (epoch ms): an answer to a request that left after it means it arrived. */
  at: number;
  id: string;
} & (
  | { kind: "page"; patch: PagePatch }
  | { kind: "row"; values: Record<string, DataValue>; body?: string }
);

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

/** The list once the server answered a write of `path` that left at `sent`: what changed after it stays. */
export const answered = (list: readonly UnsentWrite[], path: string, sent: number) =>
  list.filter((x) => x.path !== path || x.at > sent);

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
          (w.kind === "row" && w.values && typeof w.values === "object")),
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
