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

export function diagramOf(types: readonly DataType[]): Diagram {
  const own = types.filter((t) => !t.system);
  const byId = new Map(own.map((t) => [t.id, t]));
  const motherOf = (t: DataType) => (t.parent && byId.has(t.parent) ? t.parent : null);
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
      fields: t.fields
        .filter((f) => !f.inherited)
        .map((f) => ({
          id: f.id,
          name: f.name,
          type: f.type,
          relation: f.relation ? { target: f.relation.target, many: f.relation.many } : null,
        })),
    };
  });
  const edges: DiagramEdge[] = [];
  for (const c of cards)
    for (const f of c.fields)
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
export const cardHeight = (fields: number): number =>
  CARD_HEAD + Math.max(1, fields) * FIELD_ROW + 8;

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
    d.cards.map((c) => [c.id, { width: CARD_WIDTH, height: cardHeight(c.fields.length) }]),
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

/** Each card's top-left corner by dagre (the mothers as clusters keep their branch together), or a grid if it fails. */
function placeCards(
  d: Diagram,
  sizes: Map<string, { width: number; height: number }>,
): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>();
  try {
    const g = new dagre.graphlib.Graph({ compound: true });
    g.setGraph({ rankdir: "LR", nodesep: 28, ranksep: 70, marginx: 8, marginy: 8 });
    g.setDefaultEdgeLabel(() => ({}));
    for (const f of d.frames) g.setNode(f.id, { label: f.name });
    for (const f of d.frames) if (f.frame) g.setParent(f.id, f.frame);
    for (const c of d.cards) {
      const s = sizes.get(c.id) as { width: number; height: number };
      // A frame's own card wants room above it for the frame's name.
      g.setNode(c.id, { width: s.width + 2 * FRAME_PAD, height: s.height + FRAME_HEAD });
      if (c.frame) g.setParent(c.id, c.frame);
    }
    for (const e of d.edges) if (e.from !== e.to) g.setEdge(e.from, e.to);
    dagre.layout(g);
    for (const c of d.cards) {
      const n = g.node(c.id);
      const s = sizes.get(c.id) as { width: number; height: number };
      if (!n || !Number.isFinite(n.x) || !Number.isFinite(n.y)) throw new Error("no position");
      out.set(c.id, { x: n.x - s.width / 2, y: n.y - s.height / 2 + FRAME_HEAD / 2 });
    }
    return out;
  } catch {
    let x = 0;
    for (const c of d.cards) {
      out.set(c.id, { x, y: FRAME_HEAD });
      x += CARD_WIDTH + 2 * FRAME_PAD + 40;
    }
    return out;
  }
}
