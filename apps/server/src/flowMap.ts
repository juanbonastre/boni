/**
 * Boni's map (docs/sistema.md §4.4, F8): everything that brings, starts, reads and writes the account's data, as one
 * graph computed from what is saved and what happened, never declared by hand (it replaces the «Modelos» canvas of
 * task 59b and its hand-made `pipeline.ts`). The nodes: the mail connector, the collections, the flows (each with its
 * steps, for the app to unfold), the Bandeja (what is proposed waits there until it is accepted), Boni's own work
 * that is not a flow yet (the conversation, the guide's reviewer), the user, the assistants by the MCP, the pages and
 * the account's devices (where what Boni tells arrives).
 * The arrows: what the flows' saved plans name (a step's collection is a literal: D-48; an «Avisar» tells the
 * devices), what the journal says the runs proposed, told, what was accepted and what they changed, and what the
 * audit says each one wrote in the period. Each
 * node and arrow carries its numbers of the last days; the app words Boni's own nodes and the arrows (i18n), a
 * collection, a flow and a page by their own names.
 */
import type { RunRow, UserStore } from "@boni/store";
import { AUTO_AREA } from "./autoAccept.ts";
import { userTypes } from "./data.ts";
import {
  FETCH_FLOW,
  type FlowNode,
  MAIL_FLOW,
  nodesOf,
  REVIEW_FLOW,
  stepsOf,
  typeKeysOf,
} from "./flows.ts";
import { getPage, listPages } from "./pages.ts";
import { timed } from "./perf.ts";
import { whatOf } from "./runInfo.ts";
import { recentActivity } from "./systemCollections.ts";

export type MapKind = "connector" | "collection" | "flow" | "boni" | "actor" | "page" | "device";
/** What an arrow says: data flows along it, from → to. */
export type MapEdgeKind =
  | "brings"
  | "starts"
  | "reads"
  | "writes"
  /** Into the Bandeja: what a flow in the background or the conversation proposes waits there. */
  | "proposes"
  /** Out of the Bandeja: what was accepted into a collection. */
  | "accepts"
  /** The user's decisions in the Bandeja. */
  | "decides"
  /** What the guide's reviewer learns from: the decisions taken in the Bandeja. */
  | "learns"
  | "improves"
  | "shows"
  /** Out to the account's devices: what a flow's «Avisar» or a turn of the conversation told them. */
  | "tells";

export interface MapNode {
  id: string;
  kind: MapKind;
  /** A collection's, a flow's, a page's or an assistant's own name; null for Boni's own nodes (the app names them by
   * `code`). */
  name: string | null;
  /** Boni's own nodes by what they are: `mail` (connector), `chat`, `review` and `inbox` (Boni's), `user`, `import`,
   * `assistant` (actors), `devices` (the account's devices). */
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
  /** Proposals made in the period and how many were accepted (and, the Bandeja, rejected). */
  proposals?: number;
  accepted?: number;
  rejected?: number;
  /** The Bandeja: how many proposals wait in it now. */
  pending?: number;
  /** The Bandeja: what goes through it is followed to where it goes (the lens crosses it with the arrow's `into`). */
  through?: boolean;
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
  /** The devices: how many notices they were told in the period. */
  notices?: number;
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
  /** An arrow into the Bandeja: the collections what it proposes goes to (only those are after it, through it), and
   * how many went to each in the period (with a collection in the centre, its number is that one's). */
  into?: string[];
  per?: Record<string, number>;
  /** «tus decisiones»: the flows whose proposals' decisions teach the reviewer (the lens crosses the Bandeja to it
   * only from them). */
  via?: string[];
}

export interface MapView {
  days: number;
  from: number;
  to: number;
  nodes: MapNode[];
  edges: MapEdge[];
}

const DAY = 24 * 60 * 60_000;
/** The Bandeja's node. */
const INBOX = "boni:inbox";
/** The account's devices: where what Boni tells arrives (its phone and its computers, A-17). */
const DEVICES = "dev:all";
/** A step that tells the devices: the tool «Avisar». */
const tellsStep = (s: Record<string, unknown>) => s.op === "call" && s.tool === "notify";
const READS = new Set(["entities.query", "entities.search", "entities.aggregate", "entities.get"]);
const WRITES = new Set(["entities.create", "entities.update", "entities.delete"]);
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

/**
 * The node of the map a run belongs to: its flow, the conversation, the guide's reviewer, the Bandeja (an
 * «Aceptar»), «Leer correo» for a reading from before flows; null for what the map does not draw (a dry run).
 */
export function mapOwnerOf(
  store: UserStore,
  r: RunRow,
  mailAccount: string | null,
  /** Whether the account has «Revisar la guía» (asked once by a caller that asks for many runs). */
  hasReview: boolean = !!store.journal.flow(REVIEW_FLOW),
): string | null {
  // A dry run («Probar») is no run of anything: it wrote nothing and counts nowhere.
  if (r.origin === "test") return null;
  if (r.flow) return `flow:${r.flow}`;
  if (r.turn) return "boni:chat";
  const kind = whatOf(store, r, mailAccount).kind;
  if (kind === "accepted") return INBOX;
  // The reviewer's work: Boni's «Revisar la guía» when the account has it (D-51), its own box before.
  if (kind === "review" || kind === "measure")
    return hasReview ? `flow:${REVIEW_FLOW}` : "boni:review";
  if (kind === "mail") return `flow:${MAIL_FLOW}`;
  return null;
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
    if (!was) edges.set(k, { ...e, ...(e.steps ? { steps: [...new Set(e.steps)] } : {}) });
    else {
      was.n = was.n === null && e.n === null ? null : (was.n ?? 0) + (e.n ?? 0);
      was.outside ||= e.outside;
      if (e.steps) was.steps = [...new Set([...(was.steps ?? []), ...e.steps])];
    }
  };

  /** Something told the devices: its arrow, with how many notices in the period; the devices' node with their sum. */
  let notices = 0;
  const tells = (who: string, n: number, steps: string[] | null, outside: boolean) => {
    notices += n;
    node({ id: DEVICES, kind: "device", name: null, code: "devices", notices });
    edge({ from: who, to: DEVICES, kind: "tells", n, ...(steps ? { steps } : {}), outside });
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
  /** The node a run counts at: its flow, the conversation, the reviewer; an «Aceptar» counts nowhere (the Bandeja
   * says what it accepted). */
  const hasReview = !!j.flow(REVIEW_FLOW);
  const ownerOf = (r: RunRow): string | null => {
    const at = mapOwnerOf(store, r, o.mailAccount, hasReview);
    return at === INBOX ? null : at;
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
    // A reading «Medir releyendo» starts is part of its review: its calls count there, never as a run of its own.
    if (id === `flow:${REVIEW_FLOW}` && r.flow !== REVIEW_FLOW) continue;
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

  // The proposals of the period, by who made them and the collection; and, through the Bandeja, by collection.
  const proposed = new Map<string, { made: number; accepted: number; rejected: number }>();
  const add = (k: string, status: string, n: number) => {
    const x = proposed.get(k) ?? { made: 0, accepted: 0, rejected: 0 };
    x.made += n;
    if (status === "accepted") x.accepted += n;
    if (status === "rejected") x.rejected += n;
    proposed.set(k, x);
  };
  for (const p of j.proposalsByRun(from, to)) {
    // Whose: the owner of its run, as the runs are counted (a reading before F1, with no flow, is «Leer correo»'s).
    const who = owner.get(p.run) ?? null;
    const type = p.type ? byKey.get(p.type) : undefined;
    if (!who) continue;
    add(`${who}|`, p.status, p.n);
    add("|", p.status, p.n);
    if (type) {
      add(`${who}|${type}`, p.status, p.n);
      add(`|${type}`, p.status, p.n);
    }
  }
  /** The collections each one's proposals went to (or its plan says they would), and those a mail's words reach. */
  const into = new Map<string, Set<string>>();
  const intoOf = (who: string) => {
    let x = into.get(who);
    if (!x) {
      x = new Set();
      into.set(who, x);
    }
    return x;
  };
  for (const k of proposed.keys()) {
    const [who, type] = k.split("|") as [string, string];
    if (who && type && known(type)) intoOf(who).add(type);
  }
  const outsideInto = new Set<string>();
  /** How many of one's proposals went to each collection in the period. */
  const perOf = (who: string, types: Set<string>) =>
    Object.fromEntries([...types].map((t) => [colId(t), proposed.get(`${who}|${t}`)?.made ?? 0]));

  // The mail connector: it brings each mail into its collection, through Boni's «Traer correo» when the account has
  // it (docs/sistema.md §4.2, D-50: connector → «Traer correo» → Correos), straight in when it has not.
  const activity = recentActivity(store, { now: o.now, tz: o.tz, days: o.days });
  const brought = mailCol
    ? activity
        .filter((a) => a.by.startsWith("connector") && a.type === mailCol)
        .reduce((n, a) => n + a.writes, 0)
    : 0;
  const fetchFlow = mailCol ? j.flow(FETCH_FLOW) : null;
  if (mailCol) {
    node({ id: "conn:mail", kind: "connector", name: null, code: "mail", pack: "correo" });
    if (!fetchFlow)
      edge({ from: "conn:mail", to: colId(mailCol), kind: "brings", n: brought, outside: true });
  }

  // The flows: what starts each, what its steps read and write, and how it ran.
  const flows = j.flows();
  for (const f of flows) {
    const id = `flow:${f.id}`;
    const on = (f.trigger ?? {}) as Record<string, unknown>;
    const background =
      typeof on.created === "string" ||
      !!on.schedule ||
      !!on.connector ||
      !!on.learning ||
      !!on.spending;
    const counts = j.stepCountsOf(f.id, from, to);
    const versions = j.flowVersions(f.id);
    const steps = nodesOf(
      f.plan,
      f.trigger,
      (tool) => o.titleOf?.(tool) ?? null,
      (key) => {
        const t = byKey.get(key);
        return t ? (nodes.get(colId(t))?.name ?? null) : null;
      },
      counts,
      j.callsByStep(f.id, from, to),
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
      boni: versions.some((v) => v.by === "preset"),
      plan: f.plan,
      steps,
      pack:
        f.id === MAIL_FLOW ||
        f.id === FETCH_FLOW ||
        f.id === REVIEW_FLOW ||
        (!!starts && starts === mailCol)
          ? "correo"
          : null,
    });
    // «Traer correo»: the connector brings to it what it found, and its «Guardar en Correos» keeps it in Correos.
    if (f.id === FETCH_FLOW && on.connector === "mail" && mailCol) {
      edge({ from: "conn:mail", to: id, kind: "brings", n: brought, outside: true });
      edge({
        from: id,
        to: colId(mailCol),
        kind: "writes",
        n: brought,
        steps: stepsOf(f.plan)
          .filter((s) => s.op === "call" && s.tool === "mail.save")
          .map((s) => s.id),
        outside: true,
      });
    }
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
      const kind: MapEdgeKind | null = READS.has(s.tool)
        ? "reads"
        : WRITES.has(s.tool)
          ? background
            ? "proposes"
            : "writes"
          : null;
      if (!kind) continue;
      // Its collection, or each of those it chooses among («Crear en la elegida»: one of a literal list, D-48).
      for (const key of typeKeysOf((s.args as Record<string, unknown> | undefined)?.type)) {
        const type = byKey.get(key);
        if (!known(type)) continue;
        const k = `${type}|${kind}`;
        const was = named.get(k);
        if (was) was.steps.push(s.id);
        else named.set(k, { type, kind, steps: [s.id] });
      }
    }
    // What a flow a mail starts writes carries the mail's words.
    const outside = !!starts && starts === mailCol;
    // What its «Avisar» steps tell goes to the devices: the arrow from its plan, its number from how often those
    // steps ran in the period (the counts above: nothing more is read). An earlier version may have named its
    // «Avisar» otherwise: what that told in the period counts too, and draws the arrow when this version tells no
    // more. A name this version gives to another kind of step is never counted (those runs told nothing).
    const telling = stepsOf(f.plan)
      .filter(tellsStep)
      .map((s) => s.id);
    const others = new Set(
      stepsOf(f.plan)
        .filter((s) => !tellsStep(s))
        .map((s) => s.id),
    );
    const everTold = new Set(
      versions.flatMap((v) =>
        stepsOf(v.plan)
          .filter((s) => tellsStep(s) && !others.has(s.id))
          .map((s) => s.id),
      ),
    );
    const toldN = counts
      .filter((c) => c.decision === "allow" && everTold.has(c.step))
      .reduce((n, c) => n + c.n, 0);
    if (telling.length || toldN > 0) tells(id, toldN, telling.length ? telling : null, outside);
    // Each proposing step once: one that chooses among collections is named once for each («Crear en la elegida»).
    const proposing = new Set<string>();
    for (const { type, kind, steps } of named.values()) {
      if (kind === "reads")
        edge({ from: colId(type), to: id, kind, n: null, steps, outside: false });
      else if (kind === "proposes") {
        // Into the Bandeja: one arrow with every step that proposes, and where each proposal goes.
        intoOf(id).add(type);
        for (const x of steps) proposing.add(x);
      } else edge({ from: id, to: colId(type), kind, n: null, steps, outside });
    }
    // The steps in the order they run.
    const at = new Map(stepsOf(f.plan).map((x, i) => [x.id, i]));
    const ordered = [...proposing].sort((a, b) => (at.get(a) ?? 0) - (at.get(b) ?? 0));
    const goes = into.get(id);
    if (goes?.size) {
      edge({
        from: id,
        to: INBOX,
        kind: "proposes",
        n: p?.made ?? 0,
        ...(ordered.length ? { steps: ordered } : {}),
        outside,
        into: [...goes].map(colId).sort(),
        per: perOf(id, goes),
      });
      if (outside) for (const t of goes) outsideInto.add(t);
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
  const chatInto = into.get("boni:chat") ?? new Set<string>();
  if (chat?.made)
    edge({
      from: "boni:chat",
      to: INBOX,
      kind: "proposes",
      n: chat.made,
      outside: false,
      into: [...chatInto].map(colId).sort(),
      per: perOf("boni:chat", chatInto),
    });
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
  // What the conversation's turns told the devices (the planner's «Avisar»): the steps of a turn are read only when
  // its plan has one.
  let chatTold = 0;
  for (const r of runs) {
    if (!r.turn || owner.get(r.id) !== "boni:chat") continue;
    const telling = new Set(
      stepsOf(r.plan)
        .filter(tellsStep)
        .map((s) => s.id),
    );
    if (!telling.size) continue;
    chatTold += j.steps(r.id).filter((s) => s.decision === "allow" && telling.has(s.step)).length;
  }
  if (chatTold) tells("boni:chat", chatTold, null, false);
  // The Bandeja (docs/sistema.md §4.4: «Leer correo → Bandeja → Juan acepta → Tarea y Evento»): what is proposed
  // waits in it; out of it, what was accepted into each collection; the user's decisions in it teach the reviewer.
  const all = proposed.get("|");
  const pending = j.proposals("pending").length;
  const goesSomewhere = [...into.values()].some((x) => x.size > 0);
  // The user's decisions of the period: what was accepted or rejected, but not what Boni accepted alone («Solo»,
  // docs/fiabilidad.md); those on «Leer correo»'s proposals are the ones the reviewer learns from.
  const alone = store.journal
    .decisions(AUTO_AREA, 1000)
    .filter((d) => d.outcome === "do" && d.at >= from && d.at < to).length;
  const ranBefore = new Map<string, string | null>();
  const whose = (run: string) => {
    if (owner.has(run)) return owner.get(run) ?? null;
    if (!ranBefore.has(run)) {
      const r = j.run(run);
      ranBefore.set(run, r ? ownerOf(r) : null);
    }
    return ranBefore.get(run) ?? null;
  };
  let decisions = 0;
  let mailDecisions = 0;
  for (const d of j.proposalsDecidedByRun(from, to)) {
    if (d.status !== "accepted" && d.status !== "rejected") continue;
    decisions += d.n;
    if (whose(d.run) === `flow:${MAIL_FLOW}`) mailDecisions += d.n;
  }
  decisions = Math.max(0, decisions - alone);
  mailDecisions = Math.max(0, mailDecisions - alone);
  if (goesSomewhere || pending > 0) {
    node({
      id: INBOX,
      kind: "boni",
      name: null,
      code: "inbox",
      ...numbers(INBOX),
      roles: [],
      proposals: all?.made ?? 0,
      accepted: all?.accepted ?? 0,
      rejected: all?.rejected ?? 0,
      pending,
      through: true,
    });
    const reached = new Set([...into.values()].flatMap((x) => [...x]));
    for (const t of [...reached].sort())
      edge({
        from: INBOX,
        to: colId(t),
        kind: "accepts",
        n: proposed.get(`|${t}`)?.accepted ?? 0,
        outside: outsideInto.has(t),
      });
    edge({ from: "actor:user", to: INBOX, kind: "decides", n: decisions, outside: false });
  }
  // The guide's reviewer: Boni's flow «Revisar la guía» when the account has it (D-51; drawn with the flows), else
  // its own box.
  const reviewer = j.flow(REVIEW_FLOW) ? `flow:${REVIEW_FLOW}` : "boni:review";
  if (mailCol || (stats.get(reviewer)?.runs ?? 0) > 0) {
    if (reviewer === "boni:review")
      node({
        id: "boni:review",
        kind: "boni",
        name: null,
        code: "review",
        ...numbers("boni:review"),
        roles: ["reviewer"],
        pack: "correo",
      });
    if (nodes.has(reviewer)) {
      edge({
        from: INBOX,
        to: reviewer,
        kind: "learns",
        n: mailDecisions,
        outside: false,
        via: [`flow:${MAIL_FLOW}`],
      });
      if (nodes.has(`flow:${MAIL_FLOW}`))
        edge({
          from: reviewer,
          to: `flow:${MAIL_FLOW}`,
          kind: "improves",
          n: numbers(reviewer).runs,
          outside: false,
        });
    }
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
