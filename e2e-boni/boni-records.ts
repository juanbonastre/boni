import { systemCollections } from "../apps/server/src/systemCollections.ts";
import type { Entity, TypeDef } from "../packages/entities/src/index.ts";
import { blockRows, computeBlock } from "../packages/views/src/index.ts";

/**
 * Boni's own records as the server makes them (apps/server/src/systemCollections.ts, the real code) from invented
 * calls to models and activity around `today`, and the blocks counted over them with the real engine (packages/views),
 * for the fake server of fixtures.ts: «Uso de la IA» and «Actividad» show what the server would. Invented data only.
 */

const DAY = 86_400_000;
const MODELS = [
  ["planner", "anthropic", "claude-opus-5-5", 0.04],
  ["reader", "openrouter", "deepseek/deepseek-v4.1-flash", 0.0006],
  ["decider", "typesafe", "jev-1.14.0", 0.0002],
  ["reviewer", "anthropic", "claude-haiku-4-5", 0.004],
] as const;
const WHO = [
  "user:portatil-ejemplo",
  "model:reader:openrouter/deepseek-v4.1-flash",
  "mcp:claude-ejemplo",
  "agent",
];

/** The same records for the same day, every run. */
function fakeStore(today: string, types: Record<string, TypeDef>) {
  let seed = 7;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  const end = Date.parse(`${today}T12:00:00Z`);
  const calls = Array.from({ length: 160 }, (_, n) => {
    const [role, provider, model, cost] = MODELS[Math.floor(rnd() * MODELS.length)]!;
    return {
      n: n + 1,
      run: `r${n}`,
      role,
      provider,
      model,
      input: 400 + Math.floor(rnd() * 4000),
      output: 50 + Math.floor(rnd() * 600),
      cost: cost * (0.5 + rnd()),
      at: end - Math.floor(rnd() * 60) * DAY,
    };
  }).sort((a, b) => a.at - b.at);
  const activity = Array.from({ length: 40 }, (_, i) => ({
    day: new Date(end - (i % 30) * DAY).toISOString().slice(0, 10),
    by: WHO[i % WHO.length]!,
    type: i % 3 ? "t_libro" : "t_private_documentos",
    reads: Math.floor(rnd() * 20),
    writes: Math.floor(rnd() * 4),
  }));
  const runs = Array.from({ length: 40 }, (_, n) => {
    const started = end - Math.floor(rnd() * 30) * DAY - 4000;
    return {
      id: `r${n}`,
      turn: null,
      origin: "other",
      device: "portatil-ejemplo",
      status: n % 7 === 0 ? "stopped:limit" : "done",
      plan: null,
      started,
      finished: started + 4000,
    };
  }).sort((a, b) => a.started - b.started);
  return {
    journal: {
      lastModelCall: () => calls.length,
      modelCallsIn: (from: number, to: number) => calls.filter((c) => c.at >= from && c.at < to),
      modelCalls: () => [],
      proposals: () => [],
      lastRun: () => runs.length + Math.max(...runs.map((r) => r.finished)),
      runsIn: (from: number, to: number) => runs.filter((r) => r.started >= from && r.started < to),
    },
    runOps: () => [],
    audit: {
      lastAction: () => 0,
      activityByType: () => activity,
    },
    schema: () => ({ types }),
    version: () => 0,
  };
}

const NAMES: Record<string, TypeDef> = {
  t_libro: { id: "t_libro", name: "Libros" } as TypeDef,
  t_private_documentos: { id: "t_private_documentos", name: "Documentos" } as TypeDef,
};

export function boniRecords(today: string) {
  const sys = systemCollections(fakeStore(today, NAMES) as never, {
    now: Date.parse(`${today}T12:00:00Z`),
    usdToEur: 0.9,
  });
  return sys;
}

/** What the fake server answers for Boni's collections: their types as the app lists them, and their rows. */
export function boniTypes(today: string) {
  const sys = boniRecords(today);
  return Object.values(sys.types).map((t) => ({
    id: t.id,
    name: t.name,
    icon: t.icon ?? "",
    titleField: t.titleField,
    fields: t.fields.map((f) => ({
      id: f.id,
      name: f.name,
      type: f.type,
      ...(f.options ? { options: f.options.map((o) => ({ id: o.id, name: o.name })) } : {}),
    })),
    count: sys.rows(t.id).length,
    level: "private",
    rules: [],
    rowUi: { open: false, hidden: [] },
    system: true,
  }));
}

const rowOf = (e: Entity) => ({ id: e.id, values: e.values, updated: e.updated });

/** `POST api/data/blocks` and `POST api/data/blocks/rows` for blocks over Boni's collections. */
export function boniEngine(
  kind: "blocks" | "rows" | "list",
  body: unknown,
  today: string,
): unknown {
  const sys = boniRecords(today);
  if (kind === "list")
    return {
      rows: sys.rows(String(body)).map(rowOf),
      titles: {},
      truncated: false,
      ghosts: [],
      columns: {},
    };
  if (kind === "blocks") {
    const blocks = ((body ?? {}) as { blocks?: Record<string, unknown>[] }).blocks ?? [];
    return {
      results: Object.fromEntries(
        blocks.map((b) => {
          const out = computeBlock(b as never, sys.types, sys.rows, { today });
          return [
            b.id,
            "data" in out ? { data: { ...out.data, computed_at: `${today}T10:00:00.000Z` } } : out,
          ];
        }),
      ),
    };
  }
  const b = (body ?? {}) as { block?: Record<string, unknown>; drill?: string };
  const out = blockRows(b.block as never, sys.types, sys.rows, { today, drill: b.drill ?? null });
  if ("problems" in out) return out;
  const rows = [...out.rows].sort((x, y) => y.updated - x.updated);
  return {
    type: b.block?.collection,
    rows: rows.slice(0, 2000).map(rowOf),
    total: rows.length,
    titles: {},
    columns: {},
  };
}
