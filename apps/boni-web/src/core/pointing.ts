/**
 * Pointing (docs/sistema.md §4.7, F9; task 85): what `Ctrl+Shift+E` marks on the screen for the next message, by
 * reference, never as pixels. A component that can be pointed at carries its reference and the words of its chip
 * (`pointAttrs`); the pointer finds it under a click, or the ones a dragged rectangle takes (`inBox`). The server
 * makes each reference a value from what the store holds (apps/server/src/screen.ts): the app only says which.
 */

/** Something pointed at: a block of a page, a row, a card of the Bandeja. */
export type PointedRef =
  | { kind: "block"; page: string; block: string }
  | { kind: "row"; id: string }
  | { kind: "proposal" | "question"; id: string };

/** A reference with the words its chip says («Gráfica: Gasto por día»). */
export interface Pointed {
  ref: PointedRef;
  title: string;
}

/** The most things one message carries (the server takes no more). */
export const MAX_POINTED = 20;

export const pointKey = (r: PointedRef): string =>
  r.kind === "block" ? `block:${r.page}/${r.block}` : `${r.kind}:${r.id}`;

/** What a component that can be pointed at carries: its reference and its chip's words. */
export const pointAttrs = (ref: PointedRef, title: string) => ({
  "data-boni-ref": JSON.stringify(ref),
  "data-boni-title": title,
});

const id = (x: unknown): x is string => typeof x === "string" && x.length > 0 && x.length <= 80;

/** A reference as a component wrote it; null when it is not one. */
export function readRef(raw: string | null | undefined): PointedRef | null {
  if (!raw) return null;
  let x: unknown;
  try {
    x = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!x || typeof x !== "object") return null;
  const r = x as Record<string, unknown>;
  if (r.kind === "block")
    return id(r.page) && id(r.block) ? { kind: "block", page: r.page, block: r.block } : null;
  if (r.kind === "row" || r.kind === "proposal" || r.kind === "question")
    return id(r.id) ? { kind: r.kind, id: r.id } : null;
  return null;
}

/** A chip's words: the kind of thing and its name, or the kind alone when it has none. */
export const chipTitle = (kind: string, name: string): string => {
  const n = name.replace(/\s+/g, " ").trim();
  const cut = n.length > 48 ? `${n.slice(0, 47).trimEnd()}…` : n;
  return cut ? `${kind}: ${cut}` : kind;
};

/** What was pointed at with more added: each thing once, in the order it was first pointed at, the latest kept. */
export function addPointed(list: readonly Pointed[], more: readonly Pointed[]): Pointed[] {
  const out = [...list];
  for (const p of more) {
    const k = pointKey(p.ref);
    const i = out.findIndex((x) => pointKey(x.ref) === k);
    if (i >= 0) out[i] = p;
    else out.push(p);
  }
  return out.slice(-MAX_POINTED);
}

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
/** Something that can be pointed at, as the rectangle sees it: where it is, and the pointable it is inside. */
export interface Target {
  box: Box;
  /** Its index's nearest ancestor among the targets; null at the top. */
  parent: number | null;
}

/** Whether a thing is under the rectangle; one with no size (hidden, folded away) never is. */
const touches = (a: Box, b: Box) =>
  a.right > a.left &&
  a.bottom > a.top &&
  a.left < b.right &&
  a.right > b.left &&
  a.top < b.bottom &&
  a.bottom > b.top;
const holds = (outer: Box, inner: Box) =>
  inner.left >= outer.left &&
  inner.right <= outer.right &&
  inner.top >= outer.top &&
  inner.bottom <= outer.bottom;

/**
 * The targets a dragged rectangle takes (their indexes, in order). A thing wholly inside it stands for everything in
 * it (a table, not its rows); one it only crosses gives way to what it holds that the rectangle touches (three rows
 * of a table, not the table), and is taken itself when the rectangle touches nothing inside it.
 */
export function inBox(targets: readonly Target[], box: Box): number[] {
  const hit = targets.map((t) => touches(t.box, box));
  const inside = targets.map((t, i) => hit[i] && holds(box, t.box));
  const hitInside = targets.map(() => false);
  targets.forEach((t, i) => {
    if (!hit[i]) return;
    for (let p = t.parent; p !== null; p = targets[p]?.parent ?? null) hitInside[p] = true;
  });
  const under = (i: number): boolean => {
    for (let p = targets[i]?.parent ?? null; p !== null; p = targets[p]?.parent ?? null)
      if (inside[p]) return true;
    return false;
  };
  return targets.flatMap((_, i) =>
    hit[i] && !under(i) && (inside[i] || !hitInside[i]) ? [i] : [],
  );
}
