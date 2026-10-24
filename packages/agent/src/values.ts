import { atLeast, join, type Label, label, type SourceRef } from "@boni/entities";

/**
 * The values a plan works with (docs/nucleo.md, 4.2): every one carries its label, and lists and
 * records carry one per item, so a list of tasks where one came from an e-mail hides only that one
 * from the planner. `derived` marks what a plan function made: never a destination (A1).
 */
export type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

/** The entity (and its version) a value was read from: a confirmation is bound to it (A7). */
export interface From {
  e: string;
  v: number;
  /** For the audit (store's audit.ts): the field it is (its id, or `$body` for the note's text) and the type. */
  f?: string;
  t?: string;
}

export type Val =
  | {
      t: "v";
      value: Json;
      label: Label;
      derived: boolean;
      from?: From;
      /** Entities whose fields code put into this value (an option naming some titles): only for the audit. */
      refs?: From[];
    }
  | { t: "list"; items: Val[]; label: Label; derived: boolean }
  | { t: "rec"; fields: Record<string, Val>; label: Label; derived: boolean };

export const leaf = (value: Json, l: Label, derived = false): Val => ({
  t: "v",
  value,
  label: l,
  derived,
});
export const leafFrom = (value: Json, l: Label, from: From): Val => ({
  t: "v",
  value,
  label: l,
  derived: false,
  from,
});
export const list = (items: Val[], l: Label, derived = false): Val => ({
  t: "list",
  items,
  label: l,
  derived,
});
export const rec = (fields: Record<string, Val>, l: Label, derived = false): Val => ({
  t: "rec",
  fields,
  label: l,
  derived,
});

/** The label of everything in `v`: its own and all of its items'. */
export function deepLabel(v: Val): Label {
  if (v.t === "v") return v.label;
  const parts = v.t === "list" ? v.items : Object.values(v.fields);
  return parts.length ? join(v.label, ...parts.map(deepLabel)) : v.label;
}

/** `v` with `extra` joined into every label in it (a control label, the label of the call's inputs). */
export function taint(v: Val, extra: Label): Val {
  if (v.t === "v") return { ...v, label: join(v.label, extra) };
  if (v.t === "list")
    return { ...v, label: join(v.label, extra), items: v.items.map((i) => taint(i, extra)) };
  return {
    ...v,
    label: join(v.label, extra),
    fields: Object.fromEntries(Object.entries(v.fields).map(([k, f]) => [k, taint(f, extra)])),
  };
}

/** The plain JSON of `v` (labels dropped: only for code that already decided it may use it). */
export function plain(v: Val): Json {
  if (v.t === "v") return v.value;
  if (v.t === "list") return v.items.map(plain);
  return Object.fromEntries(Object.entries(v.fields).map(([k, f]) => [k, plain(f)]));
}

/** Whether anything in `v` is below `min` integrity. */
export const anyBelow = (v: Val, min: Parameters<typeof atLeast>[1]) => !atLeast(deepLabel(v), min);

/** The code's own label for what it computes from trusted inputs. */
export const codeLabel = (id: string): Label => label("own", "public", [{ kind: "code", id }]);
export const modelLabel = (run: string): Label =>
  label("model", "public", [{ kind: "model", id: run }]);
export const userLabel = (turn: string): Label =>
  label("user", "public", [{ kind: "turn", id: turn }]);
export const sourcesOf = (v: Val): readonly SourceRef[] => deepLabel(v).sources;

/** A path into a value: "$s2", "$s2.items[0].title", "$item.f_email". */
export function at(v: Val, path: (string | number)[]): Val | null {
  let cur: Val | null = v;
  for (const p of path) {
    if (!cur) return null;
    if (typeof p === "number") cur = cur.t === "list" ? (cur.items[p] ?? null) : null;
    else if (p === "items" && cur.t === "list") continue;
    else cur = cur.t === "rec" ? (cur.fields[p] ?? null) : null;
  }
  return cur;
}

/** "$s2.items[0].f_titulo" -> ["s2", "items", 0, "f_titulo"], or null when it is not a reference. */
export function parseRef(ref: string): (string | number)[] | null {
  const m = /^\$([A-Za-z_][A-Za-z0-9_]*)((?:\.[A-Za-z_$][A-Za-z0-9_$]*|\[\d{1,4}\])*)$/.exec(ref);
  if (!m) return null;
  const out: (string | number)[] = [m[1] as string];
  for (const part of (m[2] ?? "").matchAll(/\.([A-Za-z_$][A-Za-z0-9_$]*)|\[(\d{1,4})\]/g))
    out.push(part[1] !== undefined ? part[1] : Number(part[2]));
  return out;
}

/** Every entity version `v` was read from (a confirmation becomes stale when one of them changes). */
export function originsOf(v: Val, out: From[] = []): From[] {
  if (v.t === "v") {
    if (v.from) out.push({ e: v.from.e, v: v.from.v });
  } else for (const c of v.t === "list" ? v.items : Object.values(v.fields)) originsOf(c, out);
  return out;
}

/** Whether `v` counts as true in a condition: anything but null, false, 0, "" and an empty list. */
export function truthy(v: Val): boolean {
  if (v.t === "list") return v.items.length > 0;
  if (v.t === "rec") return true;
  const x = v.value;
  return !(
    x === null ||
    x === false ||
    x === 0 ||
    x === "" ||
    (Array.isArray(x) && x.length === 0)
  );
}

/**
 * Like `at`, but a path that does not exist gives null with the label of the deepest part that does
 * (whether an item exists depends on its list): for conditions, where "is there a second one?" is a
 * fair question.
 */
export function atOrNull(v: Val, path: (string | number)[]): Val {
  let cur: Val = v;
  for (const p of path) {
    if (p === "items" && cur.t === "list") continue;
    const next: Val | undefined =
      typeof p === "number"
        ? cur.t === "list"
          ? cur.items[p]
          : undefined
        : cur.t === "rec"
          ? cur.fields[p]
          : undefined;
    if (!next) return leaf(null, deepLabel(cur), true);
    cur = next;
  }
  return cur;
}

/** Size of `v` as JSON, to keep runs inside their limits. */
export const sizeOf = (v: Val) => JSON.stringify(plain(v)).length;

/**
 * The ASCII key a model meant: "Valoración" or "fecha fin" is "valoracion", "fecha_fin" (a model writes
 * keys like names, and that slip is not worth failing a request over). Empty when nothing is left.
 */
export function asKey(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 41);
}
