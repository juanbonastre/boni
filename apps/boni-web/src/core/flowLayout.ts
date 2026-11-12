/**
 * Where the boxes of Boni's flow pictures go, computed and never dragged (docs/sistema.md §4.4; Juan, 2026-11-05: the
 * canvas of «Leer correo» opened in a heap, with positions left over from an older version): a flow's steps read
 * downwards in the order they run, with the steps that run only for one choice side by side, one lane per choice
 * (`stepLayout`, for the editor, a run's path and the map's unfolded flows); Boni's map, left to right from where
 * things come in to where they end, with its frames around a group (`mapLayout`, dagre). Pure: the same flow and the
 * same map give the same picture every time.
 */
import dagre from "@dagrejs/dagre";

type Step = { id: string; op: string } & Record<string, unknown>;

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * The choice a step runs for: its condition says «this value equals that literal» (alone, or as one of an «and»), so
 * a step with the same value and another literal never runs with it. Null for any other condition.
 */
export function choiceOf(step: Step): { on: string; value: string } | null {
  const when = step.when;
  if (!isObj(when)) return null;
  const terms =
    when.fn === "and" && Array.isArray(when.args) ? (when.args as unknown[]) : [when as unknown];
  for (const t of terms) {
    if (!isObj(t) || t.fn !== "eq" || !Array.isArray(t.args) || t.args.length !== 2) continue;
    const [a, b] = t.args as unknown[];
    const lit = (x: unknown) => (isObj(x) && typeof x.lit === "string" ? x.lit : null);
    if (lit(b) !== null && lit(a) === null)
      return { on: JSON.stringify(a), value: lit(b) as string };
    if (lit(a) !== null && lit(b) === null)
      return { on: JSON.stringify(b), value: lit(a) as string };
  }
  return null;
}

/** A part of a flow in order: one step, or steps that run for one choice each, side by side. */
export type Segment =
  | { kind: "step"; id: string }
  | { kind: "lanes"; lanes: { value: string; steps: string[] }[] };

/**
 * A plan's steps in the order they run, the runs of steps that each run for one value of the same choice gathered
 * into lanes (two values at least: a choice with one value is a step like any other).
 */
export function segmentsOf(steps: readonly Step[]): Segment[] {
  const out: Segment[] = [];
  let i = 0;
  while (i < steps.length) {
    const s = steps[i] as Step;
    const c = choiceOf(s);
    if (c) {
      let k = i;
      const lanes: { value: string; steps: string[] }[] = [];
      while (k < steps.length) {
        const x = choiceOf(steps[k] as Step);
        if (!x || x.on !== c.on) break;
        const lane = lanes.find((l) => l.value === x.value);
        if (lane) lane.steps.push((steps[k] as Step).id);
        else lanes.push({ value: x.value, steps: [(steps[k] as Step).id] });
        k++;
      }
      if (lanes.length > 1) {
        out.push({ kind: "lanes", lanes });
        i = k;
        continue;
      }
    }
    out.push({ kind: "step", id: s.id });
    i++;
  }
  return out;
}

export interface StepLayout {
  /** Each step's top left corner; the trigger's at (x, 0). */
  at: Map<string, { x: number; y: number }>;
  /** The order of the run: an arrow from each step to the next one, forks into lanes and joins out of them. `lane`:
   * the choice an arrow goes into a lane for. */
  links: { from: string; to: string; lane?: string }[];
  width: number;
  height: number;
}

/**
 * A flow downwards in its run's order: the trigger (`trigger`, when given) on top, each step under the one before,
 * lanes side by side. `size` says each box's height (all are `width` wide).
 */
export function stepLayout(
  steps: readonly Step[],
  o: {
    trigger?: { id: string; height: number } | null;
    width: number;
    height: (id: string) => number;
    gapY?: number;
    gapX?: number;
    /** Room above a lane's first step for its choice's label. */
    laneHead?: number;
  },
): StepLayout {
  const gapY = o.gapY ?? 40;
  const gapX = o.gapX ?? 32;
  const head = o.laneHead ?? 26;
  const at = new Map<string, { x: number; y: number }>();
  const links: StepLayout["links"] = [];
  let y = 0;
  let width = o.width;
  // The ends the next part joins from: the step before, or every lane's last.
  let ends: string[] = [];
  if (o.trigger) {
    at.set(o.trigger.id, { x: -o.width / 2, y: 0 });
    y = o.trigger.height + gapY;
    ends = [o.trigger.id];
  }
  for (const seg of segmentsOf(steps)) {
    if (seg.kind === "step") {
      at.set(seg.id, { x: -o.width / 2, y });
      for (const e of ends) links.push({ from: e, to: seg.id });
      ends = [seg.id];
      y += o.height(seg.id) + gapY;
      continue;
    }
    const n = seg.lanes.length;
    const total = n * o.width + (n - 1) * gapX;
    width = Math.max(width, total);
    let bottom = y;
    const next: string[] = [];
    seg.lanes.forEach((lane, i) => {
      const x = -total / 2 + i * (o.width + gapX);
      let ly = y + head;
      let prev: string | null = null;
      for (const id of lane.steps) {
        at.set(id, { x, y: ly });
        if (prev) links.push({ from: prev, to: id });
        else for (const e of ends) links.push({ from: e, to: id, lane: lane.value });
        prev = id;
        ly += o.height(id) + gapY;
      }
      bottom = Math.max(bottom, ly);
      if (prev) next.push(prev);
    });
    ends = next;
    y = bottom;
  }
  return { at, links, width, height: Math.max(0, y - gapY) };
}

// ------------------------------------------------------------------ the map

export type MapKind = "connector" | "collection" | "flow" | "boni" | "actor" | "page" | "device";
export type MapEdgeKind =
  | "brings"
  | "starts"
  | "reads"
  | "writes"
  | "proposes"
  | "accepts"
  | "decides"
  | "learns"
  | "improves"
  | "shows"
  /** Out to the account's devices: what a flow's «Avisar» or a turn of the conversation told them. */
  | "tells";
/** A node of the map as the server computes it (apps/server flowMap.ts), with what the lenses look at. */
export interface MapNodeLike {
  id: string;
  kind: MapKind;
  on?: boolean;
  roles?: string[];
  parent?: string | null;
  pack?: string | null;
  trigger?: unknown;
  boni?: boolean;
  /** The Bandeja: what goes through it is followed to where it goes, as if it were not a step of its own. */
  through?: boolean;
}
export interface MapEdgeLike {
  from: string;
  to: string;
  kind: MapEdgeKind;
  n: number | null;
  steps?: string[];
  outside: boolean;
  /** An arrow into the Bandeja: the collections what it carries goes to, and how many to each. */
  into?: string[];
  per?: Record<string, number>;
  /** «tus decisiones»: what proposes, through the Bandeja, the decisions that teach (the reviewer learns from the
   * mail's alone). */
  via?: string[];
}

/** What the map shows of everything (docs/sistema.md §4.4): its centre, how far before and after, its filters. */
export interface Lens {
  /** The node in the centre, or null for all of it. */
  center: string | null;
  /** How many arrows back and forth from the centre (Infinity: all). */
  before: number;
  after: number;
  /** Only flows and Boni's work with a model, only what changes data, only flows that are on, only what happened in
   * the period (an arrow with a number), pages too. */
  ai: boolean;
  writes: boolean;
  on: boolean;
  happened: boolean;
  pages: boolean;
  /** What stays on the map whatever the depth: a run's way, from the connector to where it ended (task 90). */
  keep?: ReadonlySet<string>;
}
export const LENS: Lens = {
  center: null,
  before: 1,
  after: 1,
  ai: false,
  writes: false,
  on: false,
  happened: false,
  pages: false,
};
/** The arrows that change data or start what does. */
const CHANGES: ReadonlySet<MapEdgeKind> = new Set([
  "brings",
  "starts",
  "writes",
  "proposes",
  "accepts",
  "decides",
  "learns",
  "improves",
]);

/**
 * What the lens leaves of the map: the nodes its filters keep, then, with a centre, those within `before` arrows
 * upstream and `after` downstream of it; without one, every node joined to another (a node alone says nothing). The
 * centre always stays, even alone. The Bandeja is crossed, not counted (docs/sistema.md §4.4: «Antes: 1» of Evento
 * is «Leer correo (propone)», through the Bandeja): what reaches it goes on, in the same step, to the collections its
 * arrow carries proposals to, and back from a collection only to those that propose into it.
 */
export function lensOf<N extends MapNodeLike, E extends MapEdgeLike>(
  map: { nodes: readonly N[]; edges: readonly E[] },
  lens: Lens,
): { nodes: N[]; edges: E[] } {
  const keep = (n: N) =>
    n.id === lens.center ||
    ((n.kind !== "page" || lens.pages) &&
      (!lens.on || n.kind !== "flow" || n.on !== false) &&
      (!lens.ai ||
        n.through ||
        (n.kind !== "flow" && n.kind !== "boni") ||
        (n.roles?.length ?? 0) > 0));
  let nodes = map.nodes.filter(keep);
  const ids = new Set(nodes.map((n) => n.id));
  let edges = map.edges.filter(
    (e) =>
      ids.has(e.from) &&
      ids.has(e.to) &&
      (!lens.writes || CHANGES.has(e.kind)) &&
      (!lens.happened || (e.n ?? 0) > 0),
  );
  if (lens.center && ids.has(lens.center)) {
    const reach = new Set<string>([lens.center]);
    const through = new Set(nodes.filter((n) => n.through).map((n) => n.id));
    const walk = (dir: "up" | "down", hops: number) => {
      let front = [lens.center as string];
      // Who the Bandeja was reached from, going down: what proposes into it (by name), or anything else («any»).
      const entered = new Map<string, Set<string> | "any">();
      const enter = (box: string, from: string | "any") => {
        const was = entered.get(box);
        if (was === "any") return;
        if (from === "any") entered.set(box, "any");
        else entered.set(box, new Set([...(was ?? []), from]));
      };
      for (let h = 0; h < hops && front.length; h++) {
        const next: string[] = [];
        const reached = (id: string) => {
          if (reach.has(id)) return;
          reach.add(id);
          next.push(id);
        };
        for (const id of front)
          for (const e of edges) {
            // The Bandeja's own arrows to its collections are followed only through it, from what proposes; what
            // its decisions teach («tus decisiones»), only from what those decisions are about (`via`).
            if (through.has(id) && id !== lens.center) {
              if (dir === "down" && e.from === id && e.kind === "accepts") continue;
              if (dir === "up" && e.to === id && e.kind === "proposes") continue;
              if (dir === "down" && e.from === id && e.kind === "learns" && e.via) {
                const from = entered.get(id);
                if (from !== "any" && ![...(from ?? [])].some((x) => e.via?.includes(x))) continue;
              }
            }
            const other =
              dir === "up" ? (e.to === id ? e.from : null) : e.from === id ? e.to : null;
            if (!other) continue;
            reached(other);
            if (!through.has(other)) continue;
            // Through the Bandeja, in the same step: on to where these proposals go, back to who proposes here (or
            // to what the reviewer's lessons come from).
            if (dir === "down") {
              enter(other, e.kind === "proposes" ? id : "any");
              for (const x of edges)
                if (x.from === other && x.kind === "accepts" && e.into?.includes(x.to))
                  reached(x.to);
            }
            if (dir === "up")
              for (const x of edges)
                if (
                  x.to === other &&
                  x.kind === "proposes" &&
                  (x.into?.includes(id) || (e.kind === "learns" && e.via?.includes(x.from)))
                )
                  reached(x.from);
          }
        front = next;
      }
    };
    walk("up", lens.before);
    walk("down", lens.after);
    for (const id of lens.keep ?? []) if (ids.has(id)) reach.add(id);
    nodes = nodes.filter((n) => reach.has(n.id));
    // Through the Bandeja, only the arrows of what goes where the lens reached (the conversation's proposals in
    // Libros are not on the way of Tarea's).
    const centre = lens.center;
    const kept = edges.filter((e) => reach.has(e.from) && reach.has(e.to));
    edges = kept.filter((e) => {
      if (e.from === centre || e.to === centre) return true;
      if (e.kind === "proposes" && through.has(e.to))
        return (
          (e.into ?? []).some((c) => reach.has(c)) ||
          kept.some((x) => x.kind === "learns" && x.from === e.to && !!x.via?.includes(e.from))
        );
      if (e.kind === "accepts" && through.has(e.from))
        return kept.some(
          (x) => x.kind === "proposes" && x.to === e.from && (x.into ?? []).includes(e.to),
        );
      return true;
    });
  } else {
    const joined = new Set(edges.flatMap((e) => [e.from, e.to]));
    nodes = nodes.filter((n) => joined.has(n.id));
  }
  return { nodes, edges };
}

/**
 * A map with what a run told drawn on it (docs/sistema.md §4.4: «Una ejecución que avisó la recorre»): the arrow
 * «avisa» from whose run it was to the devices, leaving from the steps that told in it. The map of a period may have
 * neither the arrow nor the devices (the run is from before it, or its flow tells no more): they are added, the arrow
 * with no number (the period's notices are not this run's). A run of something the map does not have is drawn nowhere.
 */
export function withTold<N extends MapNodeLike, E extends MapEdgeLike>(
  map: { nodes: readonly N[]; edges: readonly E[] },
  o: {
    /** Whose run it was (the map's node) and the steps of it that told. */
    owner: string;
    steps: readonly string[];
    /** The devices' node and the arrow to them, for a map that lacks them. */
    devices: N;
    arrow: E;
  },
): { nodes: N[]; edges: E[] } {
  if (!o.steps.length || !map.nodes.some((n) => n.id === o.owner))
    return { nodes: [...map.nodes], edges: [...map.edges] };
  const its = (e: MapEdgeLike) => e.from === o.owner && e.to === o.devices.id && e.kind === "tells";
  return {
    nodes: map.nodes.some((n) => n.id === o.devices.id)
      ? [...map.nodes]
      : [...map.nodes, o.devices],
    edges: map.edges.some(its)
      ? map.edges.map((e) =>
          its(e) ? { ...e, steps: [...new Set([...(e.steps ?? []), ...o.steps])] } : e,
        )
      : [...map.edges, o.arrow],
  };
}

/** How the map gathers its nodes into frames (docs/sistema.md §4.4): none, by what starts the flows, by flow (each
 * unfolded into its steps, its own frame), by the collection they are inside, by what came together (the package). */
export type Grouping = "none" | "trigger" | "flow" | "collection" | "pack";

/** The frame a node goes in under a grouping, or null. Triggers by their kind; Boni's own work, Boni's. */
export function groupOf(n: MapNodeLike, by: Grouping): string | null {
  if (by === "pack") return n.pack ? `pack:${n.pack}` : null;
  if (by === "collection")
    return n.kind === "collection" ? (n.parent ? `in:${n.parent}` : null) : null;
  if (by === "trigger") {
    // The Bandeja is started by nothing: it is where proposals wait.
    if (n.kind === "boni") return n.through ? null : "on:boni";
    if (n.kind !== "flow") return null;
    const t = (n.trigger ?? {}) as Record<string, unknown>;
    if (typeof t.created === "string") return `on:created:${t.created}`;
    // Boni's «Traer correo»: the mail connector starts it (never «by the user»).
    if (t.connector === "mail") return "on:connector:mail";
    if (t.learning === "mail") return "on:learning:mail";
    // Boni's «Aviso del presupuesto»: the month's spending starts it.
    if (t.spending === "warn") return "on:spending:warn";
    // A page's chat (D-61): what Juan writes in it.
    if (t.chat) return "on:chat";
    if (t.schedule) return "on:schedule";
    return "on:manual";
  }
  return null;
}

export interface MapBox {
  id: string;
  width: number;
  height: number;
}
export interface MapLayout {
  /** Each box's top left corner. */
  at: Map<string, { x: number; y: number }>;
  /** The frames around a group, with room above for their name. */
  frames: { id: string; x: number; y: number; width: number; height: number }[];
}

/**
 * The map left to right (dagre): sources first, what they end in last; with a grouping, each group's boxes kept
 * together inside a frame. A row of boxes if dagre fails.
 */
export function mapLayout(
  boxes: readonly MapBox[],
  edges: readonly { from: string; to: string }[],
  groups: ReadonlyMap<string, string> = new Map(),
  /** Who acts (the user, an assistant, the conversation): on the left with what they write, what they read coming
   * back to them, not pushing them to the right of everything they look at. */
  left: ReadonlySet<string> = new Set(),
): MapLayout {
  const at = new Map<string, { x: number; y: number }>();
  const frames: MapLayout["frames"] = [];
  try {
    const g = new dagre.graphlib.Graph({ compound: true, multigraph: false });
    // Room between columns for an arrow's words («pone en marcha · 212») between the boxes, not under them.
    g.setGraph({ rankdir: "LR", nodesep: 26, ranksep: 150, marginx: 12, marginy: 12 });
    g.setDefaultEdgeLabel(() => ({}));
    const ids = new Set(boxes.map((b) => b.id));
    for (const b of boxes) g.setNode(b.id, { width: b.width, height: b.height });
    const frameIds = new Set<string>();
    for (const [id, frame] of groups) {
      if (!ids.has(id)) continue;
      const f = `frame:${frame}`;
      if (!frameIds.has(f)) {
        frameIds.add(f);
        g.setNode(f, {
          label: f,
          paddingTop: 34,
          paddingLeft: 14,
          paddingRight: 14,
          paddingBottom: 14,
        });
      }
      g.setParent(id, f);
    }
    for (const e of edges)
      if (e.from !== e.to && ids.has(e.from) && ids.has(e.to)) {
        if (left.has(e.to) && !left.has(e.from)) g.setEdge(e.to, e.from);
        else g.setEdge(e.from, e.to);
      }
    dagre.layout(g);
    for (const b of boxes) {
      const n = g.node(b.id);
      if (!n || !Number.isFinite(n.x) || !Number.isFinite(n.y)) throw new Error("no position");
      at.set(b.id, { x: n.x - b.width / 2, y: n.y - b.height / 2 });
    }
    for (const f of frameIds) {
      // A frame is where its boxes are, with room for its name above them.
      const inside = boxes.filter((b) => g.parent(b.id) === f);
      if (!inside.length) continue;
      const xs = inside.map((b) => at.get(b.id) as { x: number; y: number });
      const x0 = Math.min(...xs.map((p) => p.x)) - 14;
      const y0 = Math.min(...xs.map((p) => p.y)) - 34;
      const x1 = Math.max(...inside.map((b, i) => (xs[i] as { x: number }).x + b.width)) + 14;
      const y1 = Math.max(...inside.map((b, i) => (xs[i] as { y: number }).y + b.height)) + 14;
      frames.push({ id: f.slice("frame:".length), x: x0, y: y0, width: x1 - x0, height: y1 - y0 });
    }
    return { at, frames };
  } catch {
    let x = 0;
    for (const b of boxes) {
      at.set(b.id, { x, y: 0 });
      x += b.width + 40;
    }
    return { at, frames: [] };
  }
}
