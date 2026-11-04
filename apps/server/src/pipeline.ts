/**
 * The numbers of the «Modelos» canvas (task 59b): for each node of the declared flow (packages/agent, pipeline.ts)
 * what the journal says of the last days (the model calls and their cost, by the reader each call names; the runs
 * that start there; the accuracy of the decisions judged there) and, for each arrow, how many went through.
 * Computed on each request from the journal's aggregates by time (one query each), never stored; the canvas names
 * the nodes and what flows, this only counts.
 */
import {
  nodeOfArea,
  nodeOfReader,
  nodeOfRole,
  nodeOfRun,
  PIPELINE,
  type PipelineKind,
} from "@boni/agent";
import type { UserStore } from "@boni/store";
import { accuracy } from "./accuracy.ts";
import { aloneRuns } from "./autoAccept.ts";
import { whatOf } from "./runInfo.ts";

export interface NodeStats {
  /** Model calls counted here, and what they cost (US dollars, of the calls whose cost is known). */
  calls: number;
  cost: number;
  /** When the last of them was. */
  last: number | null;
  /** Runs that started here. */
  runs: number;
  /** The decisions judged here: how many Juan judged and how many were right (the last 200 of each area). */
  accuracy: { judged: number; right: number } | null;
}
export interface PipelineStats {
  days: number;
  from: number;
  to: number;
  nodes: Record<string, NodeStats>;
  /** How many went through each arrow, by `from>to`; an arrow absent here has no number to show. */
  edges: Record<string, number>;
}

const DAY = 24 * 60 * 60_000;

export function pipelineStats(
  store: UserStore,
  now: number,
  days: number,
  mailAccount: string | null,
): PipelineStats {
  const to = now;
  const from = now - days * DAY;
  const j = store.journal;
  const nodes: Record<string, NodeStats> = {};
  for (const n of PIPELINE.nodes)
    nodes[n.id] = { calls: 0, cost: 0, last: null, runs: 0, accuracy: null };
  const at = (id: string | null): NodeStats | null => (id ? (nodes[id] ?? null) : null);
  // Model calls: at the reader the request names; those naming none (before 0.8.103, the decider's, the
  // planner's), at their role's node for them.
  for (const c of j.callsByKind(from, to)) {
    const s = at((c.kind && nodeOfReader(c.kind)) || nodeOfRole(c.role));
    if (!s) continue;
    s.calls += c.calls;
    s.cost += c.cost;
    s.last = Math.max(s.last ?? 0, c.last);
  }
  // Runs: where each kind starts; and those Boni accepted alone («Solo»).
  const runs = j.runsIn(from, to);
  const kinds: Record<string, number> = {};
  const alone = aloneRuns(store);
  let aloneN = 0;
  for (const r of runs) {
    const kind = whatOf(store, r, mailAccount).kind;
    kinds[kind] = (kinds[kind] ?? 0) + 1;
    const s = at(nodeOfRun(kind));
    if (s) s.runs++;
    if (alone.has(r.id)) aloneN++;
  }
  // Decisions: each area's accuracy at the node that judges it.
  for (const a of accuracy(store)) {
    const s = at(nodeOfArea(a.area));
    if (!s) continue;
    s.accuracy = {
      judged: (s.accuracy?.judged ?? 0) + a.judged,
      right: (s.accuracy?.right ?? 0) + a.right,
    };
  }
  // Arrows.
  const made = j.proposalsMade(from, to);
  const decided = j.proposalsDecided(from, to);
  const steps = j.stepCounts(from, to, { turns: true });
  const step = (kind: string, decision?: string) =>
    steps
      .filter((s) => s.kind === kind && (decision === undefined || s.decision === decision))
      .reduce((n, s) => n + s.n, 0);
  const calls = (id: string) => nodes[id]?.calls ?? 0;
  const judged = (decided.accepted ?? 0) + (decided.rejected ?? 0);
  const edges: Record<string, number> = {
    "mail>read_message": kinds.mail ?? 0,
    "read_message>classify": calls("classify"),
    "classify>fill": calls("fill"),
    "fill>calendar": made,
    "calendar>relations": made,
    "relations>inbox": made,
    "inbox>user": judged,
    "user>store": decided.accepted ?? 0,
    "user>reviewer": judged,
    "reviewer>guide": kinds.review ?? 0,
    "user>learners": judged,
    "learners>inbox": aloneN,
    "conversation>planner": kinds.request ?? 0,
    "planner>readers": step("read", "allow"),
    "planner>tools": step("call"),
    "tools>policy": step("call"),
    "policy>store": step("call", "allow") + step("call", "confirmed"),
    "policy>inbox": step("call", "propose"),
    "planner>conversation": kinds.request ?? 0,
  };
  return { days, from, to, nodes, edges };
}

/** What the canvas draws: the declared flow with its numbers (the app names nodes and arrows by their ids). */
export interface PipelineView {
  days: number;
  from: number;
  to: number;
  nodes: ({ id: string; kind: PipelineKind; role: string | null } & NodeStats)[];
  edges: { from: string; to: string; what: string; n: number | null }[];
}

export function pipelineView(
  store: UserStore,
  now: number,
  days: number,
  mailAccount: string | null,
): PipelineView {
  const s = pipelineStats(store, now, days, mailAccount);
  return {
    days: s.days,
    from: s.from,
    to: s.to,
    nodes: PIPELINE.nodes.map((n) => ({
      id: n.id,
      kind: n.kind,
      role: n.role ?? null,
      ...(s.nodes[n.id] ?? { calls: 0, cost: 0, last: null, runs: 0, accuracy: null }),
    })),
    edges: PIPELINE.edges.map((e) => ({ ...e, n: s.edges[`${e.from}>${e.to}`] ?? null })),
  };
}
