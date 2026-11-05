/**
 * «Mis datos» as a diagram (task 59a; Juan, 2026-11-04: the collections as a database diagram, how they relate and
 * what the AI sees): computed from the schema the server gives (`DataType`), never drawn by hand (D-40). A collection
 * is a card with its own fields; a mother is a frame that holds her own card and her daughters' (docs/clases.md
 * §2); a relation field is an arrow from the card that has it to the collection it points to (to a mother's own
 * card: her whole branch answers, D-18). Boni's own records stay out: they are not the user's data. Dagre lays it
 * out, left to right, mothers as clusters; the frames are drawn around what they hold.
 */
import dagre from "@dagrejs/dagre";
import type { AiLevel, DataType } from "./agent.ts";

export interface DiagramField {
  id: string;
  name: string;
  type: string;
  relation: { target: string; many: boolean } | null;
}
/** A collection's card: its own fields, inside its mother's frame when it has one. */
export interface DiagramCard {
  id: string;
  type: string;
  name: string;
  icon: string;
  count: number;
  level: AiLevel;
  readOnly: boolean;
  frame: string | null;
  fields: DiagramField[];
  /**
   * A collection outside the one whose diagram this is, drawn because a relation joins them (F6): its card without
   * its fields, outside any frame.
   */
  related: boolean;
  /** Lines under its fields (who writes it, who reads it), for its height. */
  lines: number;
}
/** A mother's frame: around her own card and her daughters' cards and frames. */
export interface DiagramFrame {
  id: string;
  type: string;
  name: string;
  icon: string;
  level: AiLevel;
  frame: string | null;
}
/** A relation: from the card whose field it is to the card of the collection it points to. */
export interface DiagramEdge {
  id: string;
  from: string;
  to: string;
  name: string;
  many: boolean;
}
export interface Diagram {
  /** Outer frames first, so whoever draws them meets a frame before what it holds. */
  frames: DiagramFrame[];
  cards: DiagramCard[];
  edges: DiagramEdge[];
}

export const cardOf = (type: string): string => `card:${type}`;
export const frameOf = (type: string): string => `frame:${type}`;

/**
 * The diagram of all the user's collections («Mis datos»), or of one (`root`, its «Diagrama» view, F6): her branch,
 * her daughters inside her frame, and, as plain cards, the collections a relation joins to it either way.
 */
export function diagramOf(
  types: readonly DataType[],
  root: string | null = null,
  lines: (type: string) => number = () => 0,
): Diagram {
  const all = types.filter((t) => !t.system);
  const inBranch = new Set<string>();
  if (root) {
    const add = (id: string) => {
      inBranch.add(id);
      for (const d of all) if (d.parent === id && !inBranch.has(d.id)) add(d.id);
    };
    add(root);
  }
  const related = new Set<string>();
  if (root)
    for (const t of all)
      for (const f of t.fields) {
        const target = f.relation?.target;
        if (!target || f.inherited) continue;
        if (inBranch.has(t.id) && !inBranch.has(target)) related.add(target);
        if (!inBranch.has(t.id) && inBranch.has(target)) related.add(t.id);
      }
  const own = root ? all.filter((t) => inBranch.has(t.id) || related.has(t.id)) : all;
  const byId = new Map(own.map((t) => [t.id, t]));
  // The root's mother and a related collection's are not drawn: they stand alone.
  const motherOf = (t: DataType) =>
    t.parent && byId.has(t.parent) && !related.has(t.id) && t.id !== root ? t.parent : null;
  const mothers = new Set(own.map(motherOf).filter((m): m is string => m !== null));
  const depth = (t: DataType): number => {
    const m = motherOf(t);
    return m ? 1 + depth(byId.get(m) as DataType) : 0;
  };
  const frames: DiagramFrame[] = own
    .filter((t) => mothers.has(t.id))
    .sort((a, b) => depth(a) - depth(b))
    .map((t) => {
      const m = motherOf(t);
      return {
        id: frameOf(t.id),
        type: t.id,
        name: t.name,
        icon: t.icon,
        level: t.level,
        frame: m ? frameOf(m) : null,
      };
    });
  const cards: DiagramCard[] = own.map((t) => {
    const m = motherOf(t);
    return {
      id: cardOf(t.id),
      type: t.id,
      name: t.name,
      icon: t.icon,
      count: t.count,
      level: t.level,
      readOnly: !!t.readOnly,
      frame: mothers.has(t.id) ? frameOf(t.id) : m ? frameOf(m) : null,
      fields: related.has(t.id)
        ? []
        : t.fields
            .filter((f) => !f.inherited)
            .map((f) => ({
              id: f.id,
              name: f.name,
              type: f.type,
              relation: f.relation ? { target: f.relation.target, many: f.relation.many } : null,
            })),
      related: related.has(t.id),
      lines: lines(t.id),
    };
  });
  const edges: DiagramEdge[] = [];
  // A related card shows no fields: its relations into the branch are drawn from the types themselves.
  const fieldsOf = (c: DiagramCard): DiagramField[] =>
    c.related
      ? (byId.get(c.type)?.fields ?? [])
          .filter((f) => !f.inherited && f.relation && inBranch.has(f.relation.target))
          .map((f) => ({
            id: f.id,
            name: f.name,
            type: f.type,
            relation: f.relation ? { target: f.relation.target, many: f.relation.many } : null,
          }))
      : c.fields;
  for (const c of cards)
    for (const f of fieldsOf(c))
      if (f.relation && byId.has(f.relation.target))
        edges.push({
          id: `${c.type}:${f.id}`,
          from: c.id,
          to: cardOf(f.relation.target),
          name: f.name,
          many: f.relation.many,
        });
  return { frames, cards, edges };
}

/** A card is this wide; its height follows its fields. */
export const CARD_WIDTH = 220;
const CARD_HEAD = 38;
const FIELD_ROW = 20;
const LINE_ROW = 18;
export const cardHeight = (fields: number, lines = 0): number =>
  CARD_HEAD + Math.max(1, fields) * FIELD_ROW + 8 + (lines ? lines * LINE_ROW + 6 : 0);

/** Room a frame leaves around what it holds, and above it for its name. */
const FRAME_PAD = 16;
const FRAME_HEAD = 34;

export interface Placed {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface Layout {
  frames: Placed[];
  cards: Placed[];
}

/** Where everything goes (absolute, top-left corners): dagre places the cards, the frames wrap theirs. */
export function layoutOf(d: Diagram): Layout {
  const sizes = new Map(
    d.cards.map((c) => [
      c.id,
      { width: CARD_WIDTH, height: cardHeight(c.related ? 0 : c.fields.length, c.lines) },
    ]),
  );
  const placed = placeCards(d, sizes);
  const cards: Placed[] = d.cards.map((c) => {
    const p = placed.get(c.id) ?? { x: 0, y: 0 };
    const s = sizes.get(c.id) as { width: number; height: number };
    return { id: c.id, x: p.x, y: p.y, width: s.width, height: s.height };
  });
  // Frames from the inside out: the innermost first, so an outer one wraps the inner ones already sized.
  const frames: Placed[] = [];
  const byFrame = new Map<string, Placed>();
  for (const f of [...d.frames].reverse()) {
    const inside: Placed[] = [
      ...cards.filter((c) => d.cards.find((x) => x.id === c.id)?.frame === f.id),
      ...frames.filter((x) => d.frames.find((y) => y.id === x.id)?.frame === f.id),
    ];
    const x0 = Math.min(...inside.map((p) => p.x)) - FRAME_PAD;
    const y0 = Math.min(...inside.map((p) => p.y)) - FRAME_HEAD;
    const x1 = Math.max(...inside.map((p) => p.x + p.width)) + FRAME_PAD;
    const y1 = Math.max(...inside.map((p) => p.y + p.height)) + FRAME_PAD;
    const box = { id: f.id, x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
    frames.push(box);
    byFrame.set(f.id, box);
  }
  frames.reverse();
  return { frames, cards };
}

/** Components that share nothing are set side by side (rows at most this wide), not one under another. */
const ROW_WIDTH = 1500;
const COMPONENT_GAP = 60;

/**
 * Each card's top-left corner: dagre places each connected part (relations, and a mother with her daughters as a
 * cluster), and the parts go side by side, left to right, in rows; a grid if dagre fails.
 */
function placeCards(
  d: Diagram,
  sizes: Map<string, { width: number; height: number }>,
): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>();
  let x = 0;
  let y = 0;
  let rowHeight = 0;
  for (const part of partsOf(d)) {
    const placed = placePart(part, sizes);
    let width = 0;
    let height = 0;
    for (const [id, p] of placed) {
      const s = sizes.get(id) as { width: number; height: number };
      width = Math.max(width, p.x + s.width + FRAME_PAD);
      height = Math.max(height, p.y + s.height + FRAME_PAD);
    }
    if (x > 0 && x + width > ROW_WIDTH) {
      x = 0;
      y += rowHeight + COMPONENT_GAP;
      rowHeight = 0;
    }
    for (const [id, p] of placed) out.set(id, { x: p.x + x, y: p.y + y });
    x += width + COMPONENT_GAP;
    rowHeight = Math.max(rowHeight, height);
  }
  return out;
}

/** The diagram split into its connected parts: joined by an arrow, or by being in one mother's frame. */
function partsOf(d: Diagram): Diagram[] {
  const parent = new Map(d.cards.map((c) => [c.id, c.id]));
  const find = (id: string): string => {
    const p = parent.get(id) ?? id;
    if (p === id) return id;
    const root = find(p);
    parent.set(id, root);
    return root;
  };
  const union = (a: string, b: string) => {
    if (parent.has(a) && parent.has(b)) parent.set(find(a), find(b));
  };
  for (const e of d.edges) union(e.from, e.to);
  const ownCard = new Map(d.frames.map((f) => [f.id, cardOf(f.type)]));
  for (const c of d.cards) if (c.frame) union(c.id, ownCard.get(c.frame) as string);
  for (const f of d.frames)
    if (f.frame) union(ownCard.get(f.id) as string, ownCard.get(f.frame) as string);
  const parts = new Map<string, Diagram>();
  for (const c of d.cards) {
    const root = find(c.id);
    const part = parts.get(root) ?? { frames: [], cards: [], edges: [] };
    part.cards.push(c);
    parts.set(root, part);
  }
  for (const part of parts.values()) {
    const ids = new Set(part.cards.map((c) => c.id));
    part.frames = d.frames.filter((f) => ids.has(ownCard.get(f.id) as string));
    part.edges = d.edges.filter((e) => ids.has(e.from) && ids.has(e.to));
  }
  return [...parts.values()];
}

/** One part by dagre (its mothers as clusters), from the origin; a row if dagre fails. */
function placePart(
  d: Diagram,
  sizes: Map<string, { width: number; height: number }>,
): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>();
  try {
    const g = new dagre.graphlib.Graph({ compound: true });
    g.setGraph({ rankdir: "LR", nodesep: 28, ranksep: 70, marginx: 0, marginy: 0 });
    g.setDefaultEdgeLabel(() => ({}));
    for (const f of d.frames) g.setNode(f.id, { label: f.name });
    for (const f of d.frames) if (f.frame) g.setParent(f.id, f.frame);
    for (const c of d.cards) {
      const s = sizes.get(c.id) as { width: number; height: number };
      // A card wants room around it for its frame, and above it for the frame's name.
      g.setNode(c.id, { width: s.width + 2 * FRAME_PAD, height: s.height + FRAME_HEAD });
      if (c.frame) g.setParent(c.id, c.frame);
    }
    for (const e of d.edges) if (e.from !== e.to) g.setEdge(e.from, e.to);
    dagre.layout(g);
    let minX = Infinity;
    let minY = Infinity;
    for (const c of d.cards) {
      const n = g.node(c.id);
      const s = sizes.get(c.id) as { width: number; height: number };
      if (!n || !Number.isFinite(n.x) || !Number.isFinite(n.y)) throw new Error("no position");
      const p = { x: n.x - s.width / 2, y: n.y - s.height / 2 + FRAME_HEAD / 2 };
      out.set(c.id, p);
      minX = Math.min(minX, p.x - FRAME_PAD);
      minY = Math.min(minY, p.y - FRAME_HEAD);
    }
    for (const [id, p] of out) out.set(id, { x: p.x - minX, y: p.y - minY });
    return out;
  } catch {
    let x = FRAME_PAD;
    for (const c of d.cards) {
      out.set(c.id, { x, y: FRAME_HEAD });
      x += CARD_WIDTH + 2 * FRAME_PAD + 40;
    }
    return out;
  }
}
