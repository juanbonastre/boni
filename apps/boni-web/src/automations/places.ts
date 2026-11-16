/**
 * Where the boxes go when nobody has put them anywhere (docs/automatizaciones.md AU-05, which replaces I-26 for the
 * new format: a step stays where Juan leaves it, and nothing moves on its own). Pure: the same draft and the same
 * places give the same answer. A box Juan placed is never moved here except by «Ordenar», which he presses.
 */
import { type Automation, isTrigger, outputsOf } from "@boni/automations";

export type Places = Readonly<Record<string, { x: number; y: number }>>;

/** A card's size and the room between two, in the canvas's units (AU-63: the card has a fixed width). */
export const CARD = { width: 220, height: 72, gapX: 80, gapY: 32 } as const;
const STEP_X = CARD.width + CARD.gapX;
const STEP_Y = CARD.height + CARD.gapY;

/** Whether a box at `p` would lie on one of `boxes`. */
const taken = (boxes: readonly { x: number; y: number }[], p: { x: number; y: number }) =>
  boxes.some((b) => Math.abs(b.x - p.x) < CARD.width && Math.abs(b.y - p.y) < CARD.height);
/** `p`, or the first free place below it. */
function free(boxes: readonly { x: number; y: number }[], p: { x: number; y: number }) {
  let at = p;
  while (taken(boxes, at)) at = { x: at.x, y: at.y + STEP_Y };
  return at;
}

/**
 * The place of a step that has none: to the right of the step it hangs from, in its row; below it when that place
 * is taken (the next free one downwards). A trigger goes below the last trigger. A step that hangs from nothing,
 * added from the top «+», goes to the right of the rightmost box of the first row.
 */
export function placeFor(
  draft: Automation,
  places: Places,
  step: string,
): { x: number; y: number } {
  const others = draft.steps.filter((s) => s.id !== step && places[s.id]);
  const boxes = others.map((s) => places[s.id] as { x: number; y: number });
  const self = draft.steps.find((s) => s.id === step);
  if (self && isTrigger(self)) {
    const last = others.filter(isTrigger).at(-1);
    const at = last ? places[last.id] : undefined;
    return free(boxes, at ? { x: at.x, y: at.y + STEP_Y } : { x: 0, y: 0 });
  }
  const from = draft.arrows.find((a) => a.to.step === step && places[a.from.step]);
  const parent = from ? places[from.from.step] : undefined;
  if (parent) return free(boxes, { x: parent.x + STEP_X, y: parent.y });
  if (!boxes.length) return { x: 0, y: 0 };
  const top = Math.min(...boxes.map((b) => b.y));
  const row = boxes.filter((b) => b.y < top + CARD.height);
  return free(boxes, { x: Math.max(...row.map((b) => b.x)) + STEP_X, y: top });
}

/**
 * Every step of the draft with a place: the ones it has, and `placeFor` for the rest, in the draft's order (a step
 * whose box is not placed yet is placed after the one it hangs from).
 */
export function withPlaces(draft: Automation, places: Places): Places {
  const out: Record<string, { x: number; y: number }> = {};
  for (const s of draft.steps) {
    const p = places[s.id];
    if (p) out[s.id] = p;
  }
  if (Object.keys(out).length === draft.steps.length) return out;
  const into = new Map<string, string[]>();
  for (const a of draft.arrows) into.set(a.to.step, [...(into.get(a.to.step) ?? []), a.from.step]);
  const visiting = new Set<string>();
  const place = (id: string) => {
    if (out[id] || visiting.has(id)) return;
    visiting.add(id);
    for (const from of into.get(id) ?? []) place(from);
    out[id] = placeFor(draft, out, id);
  };
  for (const s of draft.steps) place(s.id);
  return out;
}

/**
 * «Ordenar» (AU-64): every box placed again, left to right from each trigger, one column per step of distance, the
 * outputs of a step downwards in the catalogue's order, no two boxes on each other and no arrow backwards.
 *
 * A step's column is its longest way from a step with no arrow in, so every arrow goes to a column on its right
 * (an arrow of a cycle, which validation refuses, is left out). Rows follow a walk from each trigger in the draft's
 * order, a step's outputs in the catalogue's order: a step takes the row of the one that reached it, or the next
 * free one of its column; each trigger's steps start below everything placed before them.
 */
export function tidy(draft: Automation): Places {
  const ids = draft.steps.map((s) => s.id);
  const known = new Set(ids);
  const arrows = draft.arrows.filter((a) => known.has(a.from.step) && known.has(a.to.step));
  const outOf = new Map<string, typeof arrows>();
  const inCount = new Map<string, number>(ids.map((id) => [id, 0]));
  for (const a of arrows) {
    outOf.set(a.from.step, [...(outOf.get(a.from.step) ?? []), a]);
    inCount.set(a.to.step, (inCount.get(a.to.step) ?? 0) + 1);
  }
  // Columns: the longest way, in a topological order (Kahn's); what a cycle leaves keeps column 0 plus its own.
  const column = new Map<string, number>(ids.map((id) => [id, 0]));
  const left = new Map(inCount);
  const queue = ids.filter((id) => left.get(id) === 0);
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i] as string;
    for (const a of outOf.get(id) ?? []) {
      column.set(a.to.step, Math.max(column.get(a.to.step) ?? 0, (column.get(id) ?? 0) + 1));
      const n = (left.get(a.to.step) ?? 1) - 1;
      left.set(a.to.step, n);
      if (n === 0) queue.push(a.to.step);
    }
  }
  // The order a step's arrows are walked: its outputs in the catalogue's order, then the arrows' own.
  const steps = new Map(draft.steps.map((s) => [s.id, s]));
  const ordered = (id: string) => {
    const step = steps.get(id);
    const outputs = step ? outputsOf(step) : [];
    const rank = (o: string) => {
      const i = outputs.indexOf(o);
      return i < 0 ? outputs.length : i;
    };
    return [...(outOf.get(id) ?? [])].sort((a, b) => rank(a.from.output) - rank(b.from.output));
  };
  const out: Record<string, { x: number; y: number }> = {};
  const nextFree = new Map<number, number>();
  let floor = 0;
  const walk = (id: string, y: number) => {
    if (out[id]) return;
    const c = column.get(id) ?? 0;
    const row = Math.max(y, nextFree.get(c) ?? floor);
    out[id] = { x: c * STEP_X, y: row };
    nextFree.set(c, row + STEP_Y);
    for (const a of ordered(id)) walk(a.to.step, row);
  };
  const roots = [
    ...draft.steps.filter((s) => isTrigger(s)).map((s) => s.id),
    ...ids.filter((id) => inCount.get(id) === 0),
    ...ids,
  ];
  for (const id of roots) {
    if (out[id]) continue;
    walk(id, floor);
    floor = Math.max(floor, ...nextFree.values());
  }
  return out;
}

/**
 * Where pasted steps go (AU-68): each at `anchor` plus its offset in the clip, or the next free place below it, so
 * a paste never lands on a box. `ids`: each copied step's new id. «Duplicar» pastes one box below the original.
 */
export function pastedPlaces(
  places: Places,
  offsets: Readonly<Record<string, { x: number; y: number }>>,
  ids: Readonly<Record<string, string>>,
  anchor: { x: number; y: number },
): Record<string, { x: number; y: number }> {
  const boxes = Object.values(places);
  const out: Record<string, { x: number; y: number }> = {};
  for (const [old, made] of Object.entries(ids)) {
    const o = offsets[old] ?? { x: 0, y: 0 };
    const at = free(boxes, { x: anchor.x + o.x, y: anchor.y + o.y });
    out[made] = at;
    boxes.push(at);
  }
  return out;
}

/** One box below `p`: where «Duplicar» puts the copy before looking for a free place. */
export const below = (p: { x: number; y: number }) => ({ x: p.x, y: p.y + STEP_Y });
