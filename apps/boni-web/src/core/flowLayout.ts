/**
 * Where the nodes of a flow go (task 59b, the «Modelos» canvas): dagre, top to bottom (a flow of ten steps read
 * downwards fits a window; left to right it did not), from the arrows; a row if dagre fails. Pure, so the picture of a given flow is always the same.
 */
import dagre from "@dagrejs/dagre";

export interface FlowBox {
  id: string;
  width: number;
  height: number;
}

export function flowLayout(
  boxes: readonly FlowBox[],
  edges: readonly { from: string; to: string }[],
): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>();
  try {
    const g = new dagre.graphlib.Graph();
    g.setGraph({ rankdir: "TB", nodesep: 36, ranksep: 56, marginx: 8, marginy: 8 });
    g.setDefaultEdgeLabel(() => ({}));
    const ids = new Set(boxes.map((b) => b.id));
    for (const b of boxes) g.setNode(b.id, { width: b.width, height: b.height });
    for (const e of edges)
      if (e.from !== e.to && ids.has(e.from) && ids.has(e.to)) g.setEdge(e.from, e.to);
    dagre.layout(g);
    for (const b of boxes) {
      const n = g.node(b.id);
      if (!n || !Number.isFinite(n.x) || !Number.isFinite(n.y)) throw new Error("no position");
      out.set(b.id, { x: n.x - b.width / 2, y: n.y - b.height / 2 });
    }
    return out;
  } catch {
    let x = 0;
    for (const b of boxes) {
      out.set(b.id, { x, y: 0 });
      x += b.width + 40;
    }
    return out;
  }
}
