/**
 * Who reads and who writes each collection (docs/flujos.md §4.7, F6), for «Mis datos» and a collection's diagram:
 * the flows whose steps name it (their saved plans, nothing run) and who did in the last thirty days (the audit's
 * running activity, `systemCollections.ts`): the user from his devices, an assistant through the MCP, a model's use,
 * Boni's own work. Code only; the names are Boni's words and the user's own flow names.
 */
import type { UserStore } from "@boni/store";
import { stepsOf } from "./flows.ts";
import { actorOf, recentActivity } from "./systemCollections.ts";

export interface Who {
  /** A flow's id, or the actor's (`user`, `mcp:<device>`, `model:<use>`, `boni`). */
  id: string;
  name: string;
  kind: "flow" | "user" | "assistant" | "model" | "boni";
  /** How many: a flow's runs; an actor's records read or changed in the period. */
  n: number;
  /** A flow: whether it is on. */
  on?: boolean;
}
export interface Usage {
  days: number;
  /** By the collection's id. */
  types: Record<string, { reads: Who[]; writes: Who[] }>;
}

const READS = new Set(["entities.query", "entities.search", "entities.aggregate", "entities.get"]);
const WRITES = new Set(["entities.create", "entities.update", "entities.delete"]);
const litOf = (v: unknown): string | null =>
  v && typeof v === "object" && typeof (v as { lit?: unknown }).lit === "string"
    ? (v as { lit: string }).lit
    : null;

export function usageOf(store: UserStore, o: { now: number; tz: string; days?: number }): Usage {
  const days = o.days ?? 30;
  const types = store.schema().types;
  const byKey = new Map(Object.values(types).map((t) => [t.key, t.id]));
  const out: Usage["types"] = {};
  const add = (type: string, side: "reads" | "writes", w: Who) => {
    if (!types[type] || types[type].system) return;
    const u = out[type] ?? { reads: [], writes: [] };
    out[type] = u;
    const was = u[side].find((x) => x.id === w.id);
    if (was) was.n += w.kind === "flow" ? 0 : w.n;
    else u[side].push({ ...w });
  };
  // The flows: what their steps name, read or written.
  for (const f of store.journal.flows()) {
    const runs = store.journal.flowRuns(f.id).runs;
    for (const s of stepsOf(f.plan)) {
      if (s.op !== "call" || typeof s.tool !== "string") continue;
      const side = READS.has(s.tool) ? "reads" : WRITES.has(s.tool) ? "writes" : null;
      const key = litOf((s.args as Record<string, unknown> | undefined)?.type);
      const type = key ? byKey.get(key) : undefined;
      if (side && type)
        add(type, side, { id: f.id, name: f.name, kind: "flow", n: runs, on: f.enabled });
    }
  }
  // Who did, in the period.
  for (const a of recentActivity(store, { now: o.now, tz: o.tz, days })) {
    const who = actorOf(a.by);
    if (a.reads) add(a.type, "reads", { ...who, n: a.reads });
    if (a.writes) add(a.type, "writes", { ...who, n: a.writes });
  }
  // Flows first, then the most active.
  for (const u of Object.values(out))
    for (const side of [u.reads, u.writes])
      side.sort((a, b) => Number(b.kind === "flow") - Number(a.kind === "flow") || b.n - a.n);
  return { days, types: out };
}
