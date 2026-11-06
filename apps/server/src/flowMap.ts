/**
 * Boni's map (docs/sistema.md §4.4, F8): everything that brings, starts, reads and writes the account's data, as one
 * graph computed from what is saved and what happened, never declared by hand (it replaces the «Modelos» canvas of
 * task 59b and its hand-made `pipeline.ts`). The nodes: the mail connector, the collections, the flows (each with its
 * steps, for the app to unfold), Boni's own work that is not a flow yet (the conversation, the guide's reviewer), the
 * user, the assistants by the MCP and the pages. The arrows: what the flows' saved plans name (a step's collection is
 * a literal: D-48), what the journal says the runs proposed and changed, and what the audit says each one wrote in
 * the period. Each node and arrow carries its numbers of the last days; the app words Boni's own nodes and the
 * arrows (i18n), a collection, a flow and a page by their own names.
 */
import type { RunRow, UserStore } from "@boni/store";
import { userTypes } from "./data.ts";
import { type FlowNode, MAIL_FLOW, nodesOf, stepsOf } from "./flows.ts";
import { getPage, listPages } from "./pages.ts";
import { timed } from "./perf.ts";
import { whatOf } from "./runInfo.ts";
import { recentActivity } from "./systemCollections.ts";

export type MapKind = "connector" | "collection" | "flow" | "boni" | "actor" | "page";
/** What an arrow says: data flows along it, from → to. */
export type MapEdgeKind =
  | "brings"
  | "starts"
  | "reads"
  | "writes"
  | "proposes"
  | "decides"
  | "improves"
  | "shows";

export interface MapNode {
  id: string;
  kind: MapKind;
  /** A collection's, a flow's, a page's or an assistant's own name; null for Boni's own nodes (the app names them by
   * `code`). */
  name: string | null;
  /** Boni's own nodes by what they are: `mail` (connector), `chat` and `review` (Boni's work), `user`, `import`,
   * `assistant` (actors). */
  code: string | null;
  icon?: string;
  /** In the period: runs (a flow, Boni's work), when the last was, model calls and their cost (US dollars). */
  runs?: number;
  last?: number | null;
  calls?: number;
  cost?: number;
  /** The models that answered in the period, and the roles its steps ask for (the app names the role's model). */
  models?: string[];
  roles?: string[];
  /** Proposals made in the period and how many were accepted. */
  proposals?: number;
  accepted?: number;
  /** A collection: its key (what a trigger names), its rows, and the collection it is inside (for grouping). */
  key?: string;
  rows?: number;
  parent?: string | null;
  /** A flow: what starts it, whether it is on, whose version runs, Boni's own; its plan and its steps as the editor
   * names them, with how each ran in the period. */
  trigger?: unknown;
  on?: boolean;
  by?: string;
  boni?: boolean;
  plan?: unknown;
  steps?: FlowNode[];
  /** What it came with (the package, docs/sistema.md §4.5): `correo` for the mail's connector, collection and flows. */
  pack?: string | null;
}

export interface MapEdge {
  from: string;
  to: string;
  kind: MapEdgeKind;
  /** How many went along it in the period; null where nothing counts it (a plan's read, a page's block). */
  n: number | null;
  /** The steps of the flow at either end that make this arrow (when the flow is drawn with its steps). */
  steps?: string[];
  /** It carries what came from outside (a mail's text): docs/nucleo.md §4.2. */
  outside: boolean;
}

export interface MapView {
  days: number;
  from: number;
  to: number;
  nodes: MapNode[];
  edges: MapEdge[];
}

const DAY = 24 * 60 * 60_000;
const READS = new Set(["entities.query", "entities.search", "entities.aggregate", "entities.get"]);
const WRITES = new Set(["entities.create", "entities.update", "entities.delete"]);
const litOf = (v: unknown): string | null =>
  v && typeof v === "object" && typeof (v as { lit?: unknown }).lit === "string"
    ? (v as { lit: string }).lit
    : null;
/** The role a reader's model plays (packages/agent models.ts). */
const roleOf = (reader: string) =>
  reader === "classify" ? "decider" : reader === "review_reading" ? "reviewer" : "reader";

/** The keys a page's blocks read: a data block's `collection`, a table's `source` (anywhere in its spec). */
function collectionsOfSpec(spec: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(spec)) for (const x of spec) collectionsOfSpec(x, out);
  else if (spec && typeof spec === "object")
    for (const [k, v] of Object.entries(spec)) {
      if ((k === "collection" || k === "source") && typeof v === "string") out.add(v);
      else collectionsOfSpec(v, out);
    }
  return out;
}

export function flowMap(
  store: UserStore,
  o: {
    now: number;
    days: number;
    tz: string;
    /** The mail's collection (its id), when a mailbox is configured. */
    mailType: string | null;
    mailAccount: string | null;
    /** A tool's title from the registry («Crear»), for a step's name. */
    titleOf?: (tool: string) => string | null;
  },
): MapView {
  return timed("the map", 400, () => makeMap(store, o));
}

function makeMap(
  store: UserStore,
  o: {
    now: number;
    days: number;
    tz: string;
    mailType: string | null;
    mailAccount: string | null;
    titleOf?: (tool: string) => string | null;
  },
): MapView {
  const to = o.now;
  const from = o.now - o.days * DAY;
  const j = store.journal;
  const nodes = new Map<string, MapNode>();
  const edges = new Map<string, MapEdge>();
  const node = (n: MapNode) => {
    nodes.set(n.id, { ...(nodes.get(n.id) ?? {}), ...n });
    return nodes.get(n.id) as MapNode;
  };
  /** An arrow, summed with one of the same ends and kind. */
  const edge = (e: MapEdge) => {
    const k = `${e.from}>${e.to}>${e.kind}`;
    const was = edges.get(k);
    if (!was) edges.set(k, { ...e, ...(e.steps ? { steps: [...e.steps] } : {}) });
    else {
      was.n = was.n === null && e.n === null ? null : (was.n ?? 0) + (e.n ?? 0);
      was.outside ||= e.outside;
      if (e.steps) was.steps = [...new Set([...(was.steps ?? []), ...e.steps])];
    }
  };

  // The collections: every one of the user's, each with its rows and where it is.
  const mine = userTypes(store);
  const byKey = new Map(mine.map((t) => [t.key, t.id]));
  const colId = (typeId: string) => `col:${typeId}`;
  for (const t of mine)
    node({
      id: colId(t.id),
      kind: "collection",
      name: t.name,
      code: null,
      icon: t.icon ?? "",
      key: t.key,
      rows: store.count(t.id),
      parent: t.parent && mine.some((x) => x.id === t.parent) ? colId(t.parent) : null,
      pack: t.id === o.mailType ? "correo" : null,
    });
  const known = (typeId: string | null | undefined): typeId is string =>
    !!typeId && nodes.has(colId(typeId));
  const mailCol = known(o.mailType) ? o.mailType : null;

  // The runs of the period: by flow, the conversation's turns, Boni's own work.
  const runs = j.runsIn(from, to);
  const runOf = new Map<string, RunRow>(runs.map((r) => [r.id, r]));
  /** The node a run counts at: its flow, the conversation, the reviewer; null for what the map does not draw. */
  const ownerOf = (r: RunRow): string | null => {
    // A dry run («Probar») is no run of anything: it wrote nothing and counts nowhere.
    if (r.origin === "test") return null;
    if (r.flow) return `flow:${r.flow}`;
    if (r.turn) return "boni:chat";
    const kind = whatOf(store, r, o.mailAccount).kind;
    if (kind === "review" || kind === "measure") return "boni:review";
    if (kind === "mail") return `flow:${MAIL_FLOW}`;
    return null;
  };
  const owner = new Map<string, string | null>();
  for (const r of runs) owner.set(r.id, ownerOf(r));
  const stats = new Map<
    string,
    { runs: number; last: number | null; calls: number; cost: number; models: Set<string> }
  >();
  const statOf = (id: string) => {
    let s = stats.get(id);
    if (!s) {
      s = { runs: 0, last: null, calls: 0, cost: 0, models: new Set() };
      stats.set(id, s);
    }
    return s;
  };
  for (const r of runs) {
    const id = owner.get(r.id);
    if (!id) continue;
    const s = statOf(id);
    s.runs++;
    s.last = Math.max(s.last ?? 0, r.started);
  }
  for (const c of j.modelCallsIn(from, to)) {
    const r = runOf.get(c.run);
    const id = r ? owner.get(r.id) : null;
    if (!id) continue;
    const s = statOf(id);
    s.calls++;
    s.cost += c.cost ?? 0;
    s.models.add(c.model);
  }
  const numbers = (id: string) => {
    const s = stats.get(id);
    return {
      runs: s?.runs ?? 0,
      last: s?.last ?? null,
      calls: s?.calls ?? 0,
      cost: s?.cost ?? 0,
      models: [...(s?.models ?? [])].sort(),
    };
  };

  // The proposals of the period, by who made them and the collection.
  const proposed = new Map<string, { made: number; accepted: number }>();
  for (const p of j.proposalsByRun(from, to)) {
    // Whose: the owner of its run, as the runs are counted (a reading before F1, with no flow, is «Leer correo»'s).
    const who = owner.get(p.run) ?? null;
    const type = p.type ? byKey.get(p.type) : undefined;
    if (!who) continue;
    for (const k of [`${who}|`, ...(type ? [`${who}|${type}`] : [])]) {
      const x = proposed.get(k) ?? { made: 0, accepted: 0 };
      x.made += p.n;
      if (p.status === "accepted") x.accepted += p.n;
      proposed.set(k, x);
    }
  }

  // The mail connector: it brings each mail into its collection.
  const activity = recentActivity(store, { now: o.now, tz: o.tz, days: o.days });
  if (mailCol) {
    node({ id: "conn:mail", kind: "connector", name: null, code: "mail", pack: "correo" });
    const brought = activity
      .filter((a) => a.by.startsWith("connector") && a.type === mailCol)
      .reduce((n, a) => n + a.writes, 0);
    edge({ from: "conn:mail", to: colId(mailCol), kind: "brings", n: brought, outside: true });
  }

  // The flows: what starts each, what its steps read and write, and how it ran.
  const flows = j.flows();
  for (const f of flows) {
    const id = `flow:${f.id}`;
    const on = (f.trigger ?? {}) as Record<string, unknown>;
    const background = typeof on.created === "string" || !!on.schedule;
    const counts = j.stepCountsOf(f.id, from, to);
    const steps = nodesOf(
      f.plan,
      f.trigger,
      (tool) => o.titleOf?.(tool) ?? null,
      (key) => {
        const t = byKey.get(key);
        return t ? (nodes.get(colId(t))?.name ?? null) : null;
      },
      counts,
    );
    const p = proposed.get(`${id}|`);
    const starts =
      typeof on.created === "string"
        ? (byKey.get(on.created) ?? (on.created === "correo" ? mailCol : null))
        : null;
    node({
      id,
      kind: "flow",
      name: f.name,
      code: null,
      ...numbers(id),
      roles: [
        ...new Set(
          stepsOf(f.plan)
            .filter((s) => s.op === "read")
            .map((s) => roleOf(String(s.reader ?? ""))),
        ),
      ],
      proposals: p?.made ?? 0,
      accepted: p?.accepted ?? 0,
      trigger: f.trigger,
      on: f.enabled,
      by: f.by,
      boni: j.flowVersions(f.id).some((v) => v.by === "preset"),
      plan: f.plan,
      steps,
      pack: f.id === MAIL_FLOW || (!!starts && starts === mailCol) ? "correo" : null,
    });
    if (known(starts)) {
      // The steps that read the record that started it take it from the trigger.
      edge({
        from: colId(starts),
        to: id,
        kind: "starts",
        n: numbers(id).runs,
        outside: starts === mailCol,
      });
    }
    // One arrow per collection and verb, with the steps that make it: several steps creating in Tarea (a task, an
    // event, an invitation) are one «propone» whose number is the flow's proposals in Tarea, counted once.
    const named = new Map<string, { type: string; kind: MapEdgeKind; steps: string[] }>();
    for (const s of stepsOf(f.plan)) {
      if (s.op !== "call" || typeof s.tool !== "string") continue;
      const key = litOf((s.args as Record<string, unknown> | undefined)?.type);
      const type = key ? byKey.get(key) : undefined;
      if (!known(type)) continue;
      const kind: MapEdgeKind | null = READS.has(s.tool)
        ? "reads"
        : WRITES.has(s.tool)
          ? background
            ? "proposes"
            : "writes"
          : null;
      if (!kind) continue;
      const k = `${type}|${kind}`;
      const was = named.get(k);
      if (was) was.steps.push(s.id);
      else named.set(k, { type, kind, steps: [s.id] });
    }
    for (const { type, kind, steps } of named.values()) {
      if (kind === "reads")
        edge({ from: colId(type), to: id, kind, n: null, steps, outside: false });
      else
        edge({
          from: id,
          to: colId(type),
          kind,
          n: kind === "proposes" ? (proposed.get(`${id}|${type}`)?.made ?? 0) : null,
          steps,
          // What a flow a mail starts writes carries the mail's words.
          outside: !!starts && starts === mailCol,
        });
    }
  }

  // Boni's own work that is not a flow yet (docs/sistema.md §4.2): the conversation and the guide's reviewer.
  const chat = proposed.get("boni:chat|");
  node({
    id: "boni:chat",
    kind: "boni",
    name: null,
    code: "chat",
    ...numbers("boni:chat"),
    roles: ["planner", "reader"],
    proposals: chat?.made ?? 0,
    accepted: chat?.accepted ?? 0,
  });
  for (const t of mine) {
    const made = proposed.get(`boni:chat|${t.id}`);
    if (made?.made)
      edge({
        from: "boni:chat",
        to: colId(t.id),
        kind: "proposes",
        n: made.made,
        outside: false,
      });
  }
  // What the conversation's turns changed (confirmed by the user, or his own collections' writes): from their runs.
  const turnWrites = new Map<string, number>();
  for (const r of runs) {
    if (!r.turn) continue;
    const who = owner.get(r.id);
    if (!who) continue;
    for (const op of store.runOps(r.id)) {
      const e = store.get(op.target);
      const type = e?.entity.type;
      if (!known(type)) continue;
      const k = `${who}|${type}`;
      turnWrites.set(k, (turnWrites.get(k) ?? 0) + 1);
    }
  }
  for (const [k, n] of turnWrites) {
    const [who, type] = k.split("|") as [string, string];
    edge({ from: who, to: colId(type), kind: "writes", n, outside: false });
  }
  if (mailCol || (stats.get("boni:review")?.runs ?? 0) > 0) {
    node({
      id: "boni:review",
      kind: "boni",
      name: null,
      code: "review",
      ...numbers("boni:review"),
      roles: ["reviewer"],
      pack: "correo",
    });
    const decided = j.proposalsDecided(from, to);
    edge({
      from: "actor:user",
      to: "boni:review",
      kind: "decides",
      n: (decided.accepted ?? 0) + (decided.rejected ?? 0),
      outside: false,
    });
    if (nodes.has(`flow:${MAIL_FLOW}`))
      edge({
        from: "boni:review",
        to: `flow:${MAIL_FLOW}`,
        kind: "improves",
        n: numbers("boni:review").runs,
        outside: false,
      });
  }

  // Who wrote and read in the period, by the audit: the user, the assistants by the MCP, an import; what a turn of
  // the conversation's model saw.
  node({ id: "actor:user", kind: "actor", name: null, code: "user" });
  for (const a of activity) {
    if (!known(a.type)) continue;
    if (a.by.startsWith("user:")) {
      if (a.writes)
        edge({
          from: "actor:user",
          to: colId(a.type),
          kind: "writes",
          n: a.writes,
          outside: false,
        });
    } else if (a.by.startsWith("mcp:")) {
      const id = `actor:${a.by}`;
      node({ id, kind: "actor", name: a.by.slice(4, 44), code: "assistant" });
      if (a.writes)
        edge({ from: id, to: colId(a.type), kind: "writes", n: a.writes, outside: false });
      if (a.reads) edge({ from: colId(a.type), to: id, kind: "reads", n: a.reads, outside: false });
    } else if (a.by === "import") {
      node({ id: "actor:import", kind: "actor", name: null, code: "import" });
      if (a.writes)
        edge({
          from: "actor:import",
          to: colId(a.type),
          kind: "writes",
          n: a.writes,
          outside: false,
        });
    } else if (a.by.startsWith("model:planner")) {
      if (a.reads)
        edge({ from: colId(a.type), to: "boni:chat", kind: "reads", n: a.reads, outside: false });
    }
  }

  // The pages: what each of their blocks shows.
  for (const p of listPages(store)) {
    const page = getPage(store, p.id);
    if (!page) continue;
    const cols = [...collectionsOfSpec(page.spec)].filter((x) => known(x));
    if (!cols.length) continue;
    node({ id: `page:${p.id}`, kind: "page", name: p.title, code: null, icon: p.icon });
    for (const c of cols)
      edge({ from: colId(c), to: `page:${p.id}`, kind: "shows", n: null, outside: false });
  }

  // Arrows only between nodes the map has.
  const out = [...edges.values()].filter((e) => nodes.has(e.from) && nodes.has(e.to));
  return { days: o.days, from, to, nodes: [...nodes.values()], edges: out };
}
