/**
 * Pointing (docs/sistema.md §4.7, F9; task 85): what `Ctrl+Shift+E` marks on the screen for the next message, by
 * reference, never as pixels. A component that can be pointed at carries its reference and the words of its chip
 * (`pointAttrs`); the pointer finds it under a click, or the ones a dragged rectangle takes (`inBox`). The server
 * makes each reference a value from what the store holds (apps/server/src/screen.ts): the app only says which.
 */

/**
 * Something pointed at: a block of a page, a row, a card of the Bandeja, a paragraph of a note (its words' key and
 * which of the identical ones it is, `@boni/views` partOf), a collection, a flow, a chart on its own screen, a node of
 * the map that is none of these (a connector, a piece of Boni) and a step of a flow.
 */
export type PointedRef =
  | { kind: "block"; page: string; block: string }
  | { kind: "row"; id: string }
  | { kind: "proposal" | "question"; id: string }
  | { kind: "part"; id: string; part: string; n: number }
  | { kind: "collection" | "flow" | "chart" | "node"; id: string }
  | { kind: "step"; flow: string; step: string };

/** A reference with the words its chip says («Gráfica: Gasto por día»). */
export interface Pointed {
  ref: PointedRef;
  title: string;
}

/** The most things one message carries (the server takes no more). */
export const MAX_POINTED = 20;

export const pointKey = (r: PointedRef): string =>
  r.kind === "block"
    ? `block:${r.page}/${r.block}`
    : r.kind === "step"
      ? `step:${r.flow}/${r.step}`
      : r.kind === "part"
        ? `part:${r.id}/${r.part}/${r.n}`
        : `${r.kind}:${r.id}`;

/** What a component that can be pointed at carries: its reference and its chip's words. */
export const pointAttrs = (ref: PointedRef, title: string) => ({
  "data-boni-ref": JSON.stringify(ref),
  "data-boni-title": title,
});

const id = (x: unknown): x is string => typeof x === "string" && x.length > 0 && x.length <= 80;
/** A node of the map that is none of the account's records (the server takes these only). */
export const MAP_NODE = /^(conn|boni|actor|dev)(:[A-Za-z0-9_.-]{1,60}){0,2}$/;

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
  if (r.kind === "step")
    return id(r.flow) && id(r.step) ? { kind: "step", flow: r.flow, step: r.step } : null;
  if (r.kind === "part")
    return id(r.id) &&
      typeof r.part === "string" &&
      /^[0-9a-f]{8}$/.test(r.part) &&
      typeof r.n === "number" &&
      Number.isInteger(r.n) &&
      r.n >= 0 &&
      r.n < 1000
      ? { kind: "part", id: r.id, part: r.part, n: r.n }
      : null;
  if (
    r.kind === "row" ||
    r.kind === "proposal" ||
    r.kind === "question" ||
    r.kind === "collection" ||
    r.kind === "flow" ||
    r.kind === "chart"
  )
    return id(r.id) ? { kind: r.kind, id: r.id } : null;
  if (r.kind === "node") return id(r.id) && MAP_NODE.test(r.id) ? { kind: "node", id: r.id } : null;
  return null;
}

/**
 * What a node of «Flujos» → «Mapa» stands for, from its id (FlowMap's): a collection, a flow, a page as a row, a
 * flow's step (`step:flow:<id>:<step>`, its trigger as the step «trigger», which the server tells as what starts it) and any other as a node; null for none.
 */
export function mapRef(nodeId: string): PointedRef | null {
  const [head, ...rest] = nodeId.split(":");
  const tail = rest.join(":");
  if (head === "col" && id(tail)) return { kind: "collection", id: tail };
  if (head === "flow" && id(tail)) return { kind: "flow", id: tail };
  if (head === "page" && id(tail)) return { kind: "row", id: tail };
  if (head === "step" && rest[0] === "flow" && rest.length >= 3) {
    const step = rest[rest.length - 1] ?? "";
    const flow = rest.slice(1, -1).join(":");
    if (!id(flow) || !id(step)) return null;
    return { kind: "step", flow, step };
  }
  return MAP_NODE.test(nodeId) ? { kind: "node", id: nodeId } : null;
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

/** Boni's own window, its circle and the app's notices: never part of what is on the screen. */
export const OWN = ".boni-window, .boni-docked, .boni-circle, .toast";
/** The most things in view one message carries (the server takes no more). */
export const MAX_VISIBLE = 30;
/** What is said of the screen without pointing: blocks, rows and paragraphs (what Juan reads). */
const QUIET = new Set(["block", "row", "part"]);

/**
 * What is in view as he writes (§4.7): what carries a reference of a block, a row or a paragraph and is inside the
 * window's bounds, outside Boni's own window, from the top, at most `MAX_VISIBLE`. Only references: the server says
 * what each is.
 */
/** The app's places to go (the sidebar): pointable, never «in view». */
const PLACES = ".sidebar";

export function visibleRefs(doc: Document = document): PointedRef[] {
  const view = doc.defaultView;
  const w = view?.innerWidth ?? 0;
  const h = view?.innerHeight ?? 0;
  const seen = new Set<string>();
  return (
    [...doc.querySelectorAll<HTMLElement>("[data-boni-ref]")]
      // Not Boni's own window, nor the sidebar: its pages are where to go, not what is in view.
      .filter((el) => !el.closest(OWN) && !el.closest(PLACES))
      .flatMap((el) => {
        const ref = readRef(el.getAttribute("data-boni-ref"));
        if (!ref || !QUIET.has(ref.kind)) return [];
        const r = el.getBoundingClientRect();
        if (
          r.width <= 0 ||
          r.height <= 0 ||
          r.bottom <= 0 ||
          r.right <= 0 ||
          r.top >= h ||
          r.left >= w
        )
          return [];
        return [{ ref, top: r.top, left: r.left }];
      })
      .sort((a, b) => a.top - b.top || a.left - b.left)
      .filter((x) => {
        const k = pointKey(x.ref);
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .slice(0, MAX_VISIBLE)
      .map((x) => x.ref)
  );
}

/** The last thing outside Boni's window that took the focus or a press (`watchFocus`). */
let focused: Element | null = null;
/**
 * Follows what has the focus outside Boni's window (a row, a block, a paragraph he was on): writing to Boni moves the
 * focus to its window, and what he was on stays the focus. A press or a focus on something that cannot be pointed at
 * clears it. Returns what stops following.
 */
export function watchFocus(doc: Document = document): () => void {
  const on = (e: Event) => {
    const t = e.target;
    if (!(t instanceof Element) || t.closest(OWN)) return;
    focused = t.closest("[data-boni-ref]");
  };
  doc.addEventListener("focusin", on, true);
  doc.addEventListener("pointerdown", on, true);
  return () => {
    doc.removeEventListener("focusin", on, true);
    doc.removeEventListener("pointerdown", on, true);
    focused = null;
  };
}
/** What had the focus, while it is still on the screen. */
export function focusRef(): PointedRef | null {
  return focused?.isConnected ? readRef(focused.getAttribute("data-boni-ref")) : null;
}

/**
 * What the right panel shows, by reference: a record by its id, a block of the open page by its page and id; any
 * other panel only by its kind. A note's own page (`row:…`) has no blocks of a page to say.
 */
export function panelRef(
  p: { kind: string; id?: string } | null,
  page: string | null,
): { kind: string; ref?: PointedRef } | null {
  if (!p) return null;
  if (p.kind === "row" && p.id) return { kind: "row", ref: { kind: "row", id: p.id } };
  if ((p.kind === "block" || p.kind === "rows") && p.id && page && !page.startsWith("row:"))
    return { kind: p.kind, ref: { kind: "block", page, block: p.id } };
  return { kind: p.kind };
}
