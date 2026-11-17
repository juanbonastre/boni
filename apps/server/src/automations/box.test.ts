// JavaScript in an automation over the real store and the real box (box.ts, collections.ts, policy.ts;
// docs/automatizaciones.md §5.4, §5.5, §6, §7). The box is apps/sandbox's own door (`startBox`), on a socket of the
// test: a dev dependency of the server for its tests alone. The store has collections shaped like the user's, with
// invented names other than the design's (generated ids, a relation, 3,000 rows), and no test calls a model.
import { appendFileSync, mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AUTOMATION_LIMITS,
  type Automation,
  type Box,
  type BoxJob,
  bornParams,
  type Change,
  type ChangeWith,
  CODE_LIMITS,
  CODE_TYPE,
  CodeFault,
  type Connection,
  type Decision,
  FORMAT,
  guard,
  type Labelled,
  newConnection,
  type Policy,
  type PolicyCall,
  type RunLimits,
  run as runAutomation,
} from "@boni/automations";
import { monthNames, tzOffsetMs, weekdayNames } from "@boni/calendar";
import { label, newId } from "@boni/entities";
import { clock, under } from "@boni/pace";
import {
  EVAL_DEFAULT_LIMITS,
  EVAL_MAX_LIMITS,
  type EvalLimits,
  type EvalResponse,
  evalRequestErrors,
  MAX_LIMITS,
  MAX_REQUEST_BYTES,
  ZONE_YEARS,
} from "@boni/sandbox";
import { startBox } from "@boni/sandbox-runner/src/server.ts";
import { openUserStore, type UserStore } from "@boni/store";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { handLabel } from "../actions.ts";
import { seed, typeId } from "../seed.test-util.ts";
import { answerOf, BOX_LIMITS, dateNames, requestOf, sandboxBox, zoneTable } from "./box.ts";
import { AUTOMATION, runPolicy } from "./policy.ts";
import { publish } from "./publish.ts";
import {
  automationView,
  createAutomation,
  keepDraft,
  previewExpression,
  publishedOf,
  runDeps,
  type ServiceError,
  type TestAnswer,
  testAutomation,
  testRows,
  WOULD_ROWS,
} from "./service.ts";

// ---------------------------------------------------------------- the limits and the request

describe("the limits of JavaScript and the box's", () => {
  it("every limit an evaluation is sent with is one the box allows, and a job fits a request's line", () => {
    expect(CODE_LIMITS.ms).toBeLessThanOrEqual(MAX_LIMITS.ms);
    expect(CODE_LIMITS.steps).toBeLessThanOrEqual(MAX_LIMITS.steps);
    expect(CODE_LIMITS.memoryBytes).toBeLessThanOrEqual(MAX_LIMITS.memoryBytes);
    expect(CODE_LIMITS.stackBytes).toBeLessThanOrEqual(MAX_LIMITS.stackBytes);
    expect(CODE_LIMITS.outputBytes).toBeLessThanOrEqual(MAX_LIMITS.outputBytes);
    expect(CODE_LIMITS.inputBytes + CODE_LIMITS.sourceChars * 4).toBeLessThan(MAX_REQUEST_BYTES);
  });

  it("AU-35 · every limit of an evaluation is sent, as the engine has it, and none passes what the box allows for one (`EVAL_MAX_LIMITS`): the box never cuts one down", () => {
    for (const k of Object.keys(EVAL_DEFAULT_LIMITS) as (keyof EvalLimits)[]) {
      expect(BOX_LIMITS[k], k).toBe(CODE_LIMITS[k]);
      expect(CODE_LIMITS[k], k).toBeLessThanOrEqual(EVAL_MAX_LIMITS[k]);
    }
    const req = requestOf(job({ sources: ["return []"] }));
    expect(evalRequestErrors(req)).toEqual([]);
    expect(req.limits).toEqual(BOX_LIMITS);
    // The box's defaults are not the engine's: without them a call would have 1 s and 1 MB of answer.
    expect(BOX_LIMITS.ms).toBeGreaterThan(EVAL_DEFAULT_LIMITS.ms);
    expect(BOX_LIMITS.outputBytes).toBeGreaterThan(EVAL_DEFAULT_LIMITS.outputBytes);
  });

  it("AU-160 · a request carries only data: what the job had, the zone as its table and the names, never a label, an origin or a path", () => {
    const req = requestOf(
      job({
        sources: ["return $input.all()"],
        input: [{ importe: 3 }],
        writes: { Pedido: ["create"] },
      }),
    );
    expect(Object.keys(req).sort()).toEqual(
      [
        "from",
        "hash",
        "id",
        "input",
        "kind",
        "limits",
        "mode",
        "names",
        "now",
        "reads",
        "run",
        "seed",
        "sources",
        "steps",
        "v",
        "writes",
        "zone",
      ].sort(),
    );
    expect(req.zone.zone).toBe("Europe/Madrid");
    expect(req.writes).toEqual({ Pedido: ["create"] });
    // An evaluation of expressions never gets a method to save (AU-184).
    expect(
      requestOf(job({ kind: "expressions", sources: ["1"], writes: { Pedido: ["create"] } }))
        .writes,
    ).toBeUndefined();
  });
});

describe("the box's faults as the engine's failures (AU-35, AU-175)", () => {
  const fails = (r: EvalResponse) => {
    try {
      answerOf(r);
    } catch (e) {
      expect(e).toBeInstanceOf(CodeFault);
      return (e as CodeFault).why;
    }
    throw new Error("it did not fail");
  };
  const call = (error: string, message = "dice la caja") =>
    ({ id: "x", ok: false, error, message }) as EvalResponse;

  it("a call that passes a limit is `code.limit` with which and the limit; one the box cannot run, or with its door full, `code.unavailable`", () => {
    expect(fails(call("timeout"))).toEqual({
      code: "code.limit",
      detail: { limit: "ms", max: CODE_LIMITS.ms },
    });
    expect(fails(call("steps"))).toEqual({
      code: "code.limit",
      detail: { limit: "steps", max: CODE_LIMITS.steps },
    });
    expect(fails(call("memory"))).toEqual({
      code: "code.limit",
      detail: { limit: "memoryBytes", max: CODE_LIMITS.memoryBytes },
    });
    expect(fails(call("output"))).toEqual({
      code: "code.limit",
      detail: { limit: "outputBytes", max: CODE_LIMITS.outputBytes },
    });
    expect(fails(call("busy"))).toEqual({ code: "code.unavailable", detail: { why: "busy" } });
    for (const e of ["invalid", "exception", "unavailable", "nada"])
      expect(fails(call(e)), e).toEqual({
        code: "code.unavailable",
        detail: { why: "unavailable" },
      });
  });

  it("an evaluation's fault is its row's: what it threw (cut to 500 characters), what it gave, what it tried to change, and too many reads or requests to save as `code.limit`", () => {
    const answer = answerOf({
      id: "x",
      ok: true,
      evaluations: [
        {
          state: "failed",
          fault: "threw",
          message: "x".repeat(900),
          source: 0,
          line: 3,
          column: 7,
        },
        { state: "failed", fault: "result", message: "promise", source: 0 },
        { state: "failed", fault: "frozen", message: "no", source: 1, line: 2 },
        { state: "failed", fault: "reads", message: "muchas", source: 0 },
        { state: "failed", fault: "writes", message: "muchas", source: 0 },
      ],
      console: [],
      dropped: 0,
      steps: 1,
      ms: 1,
    });
    expect(answer.evaluations).toEqual([
      {
        state: "failed",
        failure: { code: "code.threw", detail: { message: "x".repeat(500), line: 3, column: 7 } },
        source: 0,
      },
      { state: "failed", failure: { code: "code.result", detail: { why: "promise" } }, source: 0 },
      { state: "failed", failure: { code: "code.frozen", detail: { line: 2 } }, source: 1 },
      {
        state: "failed",
        failure: { code: "code.limit", detail: { limit: "reads", max: CODE_LIMITS.reads } },
        source: 0,
      },
      {
        state: "failed",
        failure: { code: "code.limit", detail: { limit: "writes", max: CODE_LIMITS.writes } },
        source: 0,
      },
    ]);
  });

  it("an answer that is not the protocol's is the box being unavailable, never something the engine acts on", () => {
    const ok = (more: Record<string, unknown>) =>
      ({
        id: "x",
        ok: true,
        console: [],
        dropped: 0,
        steps: 1,
        ms: 1,
        ...more,
      }) as unknown as EvalResponse;
    for (const bad of [
      ok({ evaluations: "no" }),
      ok({ evaluations: [null] }),
      ok({ evaluations: [{ state: "done" }] }),
      ok({ evaluations: [{ state: "needs", key: 3 }] }),
      ok({ evaluations: [{ state: "failed", fault: "otra" }] }),
      ok({ evaluations: [{ state: "hecho" }] }),
    ])
      expect(fails(bad)).toEqual({ code: "code.unavailable", detail: { why: "unavailable" } });
  });
});

// ---------------------------------------------------------------- the zone and the names (AU-28)

describe("the zone's table and the names the server sends", () => {
  /** The offset the table gives an instant: the last change at or before it, or the first. */
  const fromTable = (t: ReturnType<typeof zoneTable>, ms: number) => {
    let off = t.offsets[0]?.[1] ?? 0;
    for (const [from, minutes] of t.offsets) {
      if (from > ms) break;
      off = minutes;
    }
    return off;
  };

  it("AU-28 · the zone table the server sends is the zone's as `packages/calendar/src/time.ts` says it for every day of `ZONE_YEARS`, for zones with and without changes of hour, and the names of months and days are `time.ts`'s", () => {
    const start = Date.UTC(ZONE_YEARS[0], 0, 1);
    const end = Date.UTC(ZONE_YEARS[1], 11, 31);
    for (const zone of [
      "Europe/Madrid",
      "America/New_York",
      "Australia/Lord_Howe",
      "Asia/Kolkata",
      "UTC",
    ]) {
      const t = zoneTable(zone);
      expect(t.zone).toBe(zone);
      let wrong = 0;
      for (let ms = start; ms <= end; ms += 86_400_000)
        for (const hour of [0, 6, 12, 18]) {
          const at = ms + hour * 3_600_000;
          if (fromTable(t, at) !== Math.round(tzOffsetMs(at, zone) / 60_000)) wrong++;
        }
      expect(wrong, zone).toBe(0);
      // Each change is at its minute: a minute before it, the offset before it.
      for (const [from, minutes] of t.offsets.slice(1)) {
        expect(Math.round(tzOffsetMs(from, zone) / 60_000), `${zone} ${from}`).toBe(minutes);
        expect(Math.round(tzOffsetMs(from - 60_000, zone) / 60_000)).not.toBe(minutes);
      }
      // Kept: the same table, not computed again.
      expect(zoneTable(zone)).toBe(t);
    }
    expect(zoneTable("UTC").offsets).toEqual([[start, 0]]);

    const es = dateNames("es");
    expect(es.months).toEqual(monthNames("es", "long"));
    expect(es.monthsShort).toEqual(monthNames("es", "short"));
    // From Monday, as the box counts them; `time.ts` counts them from Sunday.
    expect(es.days).toEqual([
      ...weekdayNames("es", "long").slice(1),
      weekdayNames("es", "long")[0],
    ]);
    expect(es.daysShort[6]).toBe(weekdayNames("es", "short")[0]);
    expect([es.months, es.monthsShort, es.days, es.daysShort].map((a) => a.length)).toEqual([
      12, 12, 7, 7,
    ]);
    expect(dateNames("en").days[0]).toBe("Monday");
    // A language Boni does not have is Spanish, as the rest of the server writes.
    expect(dateNames("fr")).toEqual(es);
  });
});

// ---------------------------------------------------------------- the real box and the real store

const NOW = Date.UTC(2026, 10, 16, 9, 0);
const JUAN = { device: "d_portatil", now: NOW, trust: "personal" as const, zone: "Europe/Madrid" };
const SEED = label("imported", "public", [{ kind: "vault", id: "seed" }]);
const OUTSIDE = label("external", "personal", [{ kind: "mail", id: "m_ejemplo" }]);
const PEDIDO = typeId("pedido");
const TIENDA = typeId("tienda");

const dir = mkdtempSync(join(tmpdir(), "boni-caja-"));
const socket = join(dir, "caja.sock");
let closeBox: () => Promise<void>;
beforeAll(async () => {
  const b = await startBox(socket, { workers: 2 });
  closeBox = () => b.close();
});
afterAll(async () => {
  await closeBox();
  rmSync(dir, { recursive: true, force: true });
});
const box = () => sandboxBox({ socket });

let store: UserStore;
let n = 0;
/** The ids of the shops, in order. */
let tiendas: string[] = [];
beforeEach(() => {
  store = openUserStore(join(dir, `u${++n}.db`), { now: () => NOW });
  seed(
    store,
    [
      {
        key: "tienda",
        name: "Tienda",
        folder: "tiendas/",
        fields: { nombre: "text", presupuesto: "number" },
      },
      {
        key: "pedido",
        name: "Pedido",
        folder: "pedidos/",
        fields: {
          fecha: "date",
          importe: "number",
          tienda: { type: "relation", to: "tienda" },
          nota: "text",
        },
      },
    ],
    {},
  );
  tiendas = [];
  store.batch(() => {
    for (let i = 0; i < 37; i++)
      tiendas.push(
        store.create(
          TIENDA,
          {
            f_nombre: { value: `Tienda ${i}`, label: SEED },
            f_presupuesto: { value: 100 + i, label: SEED },
          },
          { actor: "import", device: "seed" },
        ).entity.id,
      );
  });
});

/** `count` orders, made in one batch as an import would; each `outsideEvery`-th has a note from outside. */
function orders(count: number, outsideEvery = 0): string[] {
  const ids: string[] = [];
  store.batch(() => {
    for (let i = 0; i < count; i++)
      ids.push(
        store.create(
          PEDIDO,
          {
            f_fecha: {
              value: `2026-${String((i % 12) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`,
              label: SEED,
            },
            f_importe: { value: (i * 37) % 900, label: SEED },
            f_tienda: { value: tiendas[i % tiendas.length] as string, label: SEED },
            f_nota: {
              value: `pedido de ejemplo ${i}`,
              label: outsideEvery && i % outsideEvery === 0 ? OUTSIDE : SEED,
            },
          },
          { actor: "import", device: "seed" },
        ).entity.id,
      );
  });
  return ids;
}

const stepId = () => newId("o").replace(/^o_/, "s_");

type StepSpec = [
  name: string,
  type: string,
  params?: Record<string, unknown>,
  more?: { connections?: Connection[]; settings?: Record<string, unknown> },
];

/** A step's params as the editor writes them: the «Permiso» a «Colección» write step is born with comes first (AU-187). */
function born(type: string, params: Record<string, unknown> | undefined) {
  const p = params ?? {};
  return { ...bornParams(type, typeof p.action === "string" ? p.action : undefined), ...p };
}

/**
 * A draft from steps by name, each after the one before it, the way the canvas would send it; with `limits`, the run's
 * own (AU-17) where a test writes more than their defaults.
 */
function chain(steps: readonly StepSpec[], limits?: Partial<RunLimits>) {
  const ids = new Map(steps.map(([name]) => [name, stepId()]));
  const id = (name: string) => ids.get(name) as string;
  const doc: Automation = {
    format: FORMAT,
    id: "",
    version: 0,
    name: "Revisar pedidos",
    steps: steps.map(([name, type, params, more]) => ({
      id: id(name),
      name,
      type,
      params: born(type, params) as Automation["steps"][number]["params"],
      ...(more?.settings ? { settings: more.settings } : {}),
      ...(more?.connections ? { connections: more.connections } : {}),
    })),
    arrows: steps.slice(1).map(([name], i) => ({
      from: { step: id(steps[i]?.[0] as string), output: "main" },
      to: { step: id(name), input: "main" },
    })),
    settings: limits ? { limits } : {},
  };
  const view = createAutomation(store, doc, JUAN);
  if ("error" in view) throw new Error(`service error: ${view.error}`);
  return { id: view.id, step: id };
}

/** The run's «rows written» at its ceiling, for a test of 3,000 rows that is about something else (AU-17). */
const MANY_ROWS = { rowsWritten: AUTOMATION_LIMITS.rowsWritten.ceiling };

function ok<T>(x: T | ServiceError): T {
  if (x && typeof x === "object" && "error" in x && Object.keys(x).length === 1)
    throw new Error(`service error: ${(x as ServiceError).error}`);
  return x as T;
}

const tested = async (
  id: string,
  request: Parameters<typeof testAutomation>[2],
  b = box(),
): Promise<TestAnswer> => ok(await testAutomation(store, id, request, JUAN, b));

/** Every row a step gave by `output` in its last test, page by page. */
function rowsOf(id: string, step: string, output = "main") {
  const out = [];
  for (let offset = 0; ; offset += 500) {
    const page = ok(testRows(store, id, { step, side: "out", name: output, offset, limit: 500 }));
    out.push(...page.rows);
    if (offset + 500 >= page.total) return out;
  }
}

const find = (limit = 5000) =>
  [
    "Buscar",
    "collection",
    { collection: "pedido", action: "find", where: [], sort: [], limit },
  ] as StepSpec;
const code = (source: string, mode: "all" | "perRow", connections: Connection[] = []) =>
  ["Código", CODE_TYPE, { mode, source }, { connections }] as StepSpec;
const reads = (collection: string, more: Partial<Connection> = {}): Connection => ({
  ...newConnection(collection),
  ...more,
});

/** The code of the design's §5.4, with the names of this store's collections. */
const BY_SHOP = `
const tiendas = $col('Tienda').find();
const gastado = {};
for (const pedido of $input.all()) {
  gastado[pedido.tienda] = (gastado[pedido.tienda] ?? 0) + pedido.importe;
}
console.log('tiendas con pedidos:', Object.keys(gastado).length);
return tiendas.map((t) => ({
  tienda: t.nombre,
  gastado: gastado[t.id] ?? 0,
  presupuesto: t.presupuesto,
  pasada: (gastado[t.id] ?? 0) > t.presupuesto,
}));`;

describe("«Código» over the real store and the real box", () => {
  it("AU-31 · the code of the design's §5.4, with collections of other names, runs in a test over a store with 3,000 rows: it reads the collection it is connected to with `find`, adds up its input and gives one row per row read, twice the same", async () => {
    orders(3000);
    const a = chain([["Inicio", "manual"], find(), code(BY_SHOP, "all", [reads("tienda")])]);
    const first = await tested(a.id, { trigger: a.step("Inicio"), fields: {} });
    expect(first.state).toBe("done");
    expect(first.tests[a.step("Código")]?.out.main).toBe(37);
    const rows = rowsOf(a.id, a.step("Código")).map((r) => r.json);
    // The sums by shop, as the store has them: 3,000 orders over 37 shops.
    const want = new Map<string, number>();
    for (let i = 0; i < 3000; i++)
      want.set(`Tienda ${i % 37}`, (want.get(`Tienda ${i % 37}`) ?? 0) + ((i * 37) % 900));
    expect(rows).toHaveLength(37);
    for (const r of rows) expect(r.gastado, String(r.tienda)).toBe(want.get(r.tienda as string));
    expect(rows.find((r) => r.tienda === "Tienda 0")).toEqual({
      tienda: "Tienda 0",
      gastado: want.get("Tienda 0"),
      presupuesto: 100,
      pasada: true,
    });
    const again = await tested(a.id, { trigger: a.step("Inicio"), fields: {} });
    expect(again.state).toBe("done");
    expect(rowsOf(a.id, a.step("Código")).map((r) => r.json)).toEqual(rows);
  }, 60_000);

  /** A test of the §5.4 code over 30 orders, and how to run it with a box. */
  const shopTest = () => {
    orders(30);
    const a = chain([["Inicio", "manual"], find(), code(BY_SHOP, "all", [reads("tienda")])]);
    const run = (b: ReturnType<typeof box>) =>
      tested(a.id, { trigger: a.step("Inicio"), fields: {} }, b);
    const why = () =>
      JSON.parse(
        store.journal.automationTests(a.id).find((t) => t.step === a.step("Código"))?.record ??
          "{}",
      );
    return { a, run, why };
  };

  it("AU-35 · with no box listening, the step fails with `code.unavailable`, nothing was read, and the server goes on: the same test with the box there is done", async () => {
    const { a, run, why } = shopTest();
    const none = await run(sandboxBox({ socket: join(dir, "no-hay.sock") }));
    expect(none.state).toBe("failed");
    expect(none.failedAt).toBe(a.step("Código"));
    expect(why().error?.why).toEqual({ code: "code.unavailable", detail: { why: "unavailable" } });
    expect(why().reads ?? []).toEqual([]);
    expect((await run(box())).state).toBe("done");
  }, 30_000);

  it("AU-35 · with the box's door full, the step fails with `code.unavailable` and says the box is busy, and nothing was read", async () => {
    const { run, why } = shopTest();
    // A door with no room at all: every call is told «busy», as one is when its workers and its queue are taken.
    const fullAt = join(dir, "llena.sock");
    const full = await startBox(fullAt, { workers: 0, queue: 0 });
    try {
      const busy = await run(sandboxBox({ socket: fullAt }));
      expect(busy.state).toBe("failed");
      expect(why().error?.why).toEqual({ code: "code.unavailable", detail: { why: "busy" } });
      expect(why().reads ?? []).toEqual([]);
    } finally {
      await full.close();
    }
  }, 30_000);

  it("AU-35 · a box that takes the call and never answers is not waited for past the call's time and the margin", async () => {
    const silentAt = join(dir, "muda.sock");
    // It reads what it is sent and says nothing.
    const silent: Server = createServer((c) => c.resume());
    await new Promise<void>((r) => silent.listen(silentAt, () => r()));
    try {
      const start = clock();
      const late = sandboxBox({ socket: silentAt, marginMs: 100 }).run(
        job({ sources: ["return []"] }),
      );
      await expect(late).rejects.toMatchObject({
        why: { code: "code.unavailable", detail: { why: "unavailable" } },
      });
      const waited = clock() - start;
      expect(waited).toBeGreaterThanOrEqual(CODE_LIMITS.ms);
      under(waited, CODE_LIMITS.ms + 2_000, "clock", "giving up on a box that does not answer");
    } finally {
      await new Promise<void>((r) => silent.close(() => r()));
    }
  }, 30_000);

  it("AU-35 · a box that answers a line that is not JSON, an answer to another call or a line longer than any is unavailable, never an answer the engine acts on", async () => {
    const answers: Record<string, (line: string) => string> = {
      "nojson.sock": () => "esto no es JSON\n",
      "otra.sock": () =>
        `${JSON.stringify({ id: "otra", ok: true, evaluations: [], console: [] })}\n`,
      "larga.sock": () => "x".repeat(MAX_REQUEST_BYTES + 10),
    };
    for (const [name, answer] of Object.entries(answers)) {
      const at = join(dir, name);
      const liar: Server = createServer((c) => {
        c.setEncoding("utf8");
        c.once("data", (d: string) => c.write(answer(d)));
        c.resume();
      });
      await new Promise<void>((r) => liar.listen(at, () => r()));
      try {
        await expect(
          sandboxBox({ socket: at, marginMs: 100 }).run(job({ sources: ["return []"] })),
          name,
        ).rejects.toMatchObject({
          why: { code: "code.unavailable", detail: { why: "unavailable" } },
        });
      } finally {
        await new Promise<void>((r) => liar.close(() => r()));
      }
    }
  }, 30_000);
});

/** What a step's last test kept, as the store has it: its record without its rows. */
const keptOf = (id: string, step: string) =>
  JSON.parse(
    store.journal.automationTests(id).find((t) => t.step === step)?.record ?? "{}",
  ) as Record<string, unknown> & {
    error?: { message: string; why?: unknown };
    console?: { lines: { text: string }[]; dropped: number };
    reads?: unknown[];
    clock?: { now: number; seed: number };
    asked?: number;
  };

const START = (fields: { key: string; name: string; type: string }[] = []) =>
  ["Inicio", "manual", { fields }] as StepSpec;

describe("what «Código» reads, over the real store and the real box", () => {
  it("AU-43 · with «Solo estas filas» on the connection, no `find`, `get`, `count` or `sum` from code gives or counts a row outside it, over the real store with 3,000 rows, and a `get` of a row outside it gives null, as for a row that does not exist", async () => {
    const ids = orders(3000);
    const importe = (i: number) => (i * 37) % 900;
    const inside = [...ids.keys()].filter((i) => importe(i) < 100);
    const outside = ids.findIndex((_, i) => importe(i) >= 100);
    const a = chain([
      START([
        { key: "dentro", name: "Dentro", type: "text" },
        { key: "fuera", name: "Fuera", type: "text" },
      ]),
      code(
        `const pedido = $input.first();
const filas = $col('Pedido').find();
return [{
  filas: filas.length,
  mayor: Math.max(...filas.map((f) => f.importe)),
  cuenta: $col('Pedido').count(),
  suma: $col('Pedido').sum('importe'),
  porEncima: $col('Pedido').count({ where: [{ field: 'importe', op: 'gt', value: 99 }] }),
  buscadas: $col('Pedido').find({ where: [{ field: 'importe', op: 'gt', value: 99 }] }).length,
  dentro: $col('Pedido').get(pedido.dentro)?.importe ?? 'nada',
  fuera: $col('Pedido').get(pedido.fuera),
  noExiste: $col('Pedido').get('e_01m7ejemplonoexiste0000000'),
  primero: filas[0].id,
  tienda: filas[0].tienda,
}];`,
        "all",
        [reads("pedido", { read: { where: [{ field: "importe", op: "lt", value: 100 }] } })],
      ),
    ]);
    const first = inside[1] as number;
    const t = await tested(a.id, {
      trigger: a.step("Inicio"),
      fields: { dentro: ids[first] as string, fuera: ids[outside] as string },
    });
    expect(t.state, JSON.stringify([t.problems, keptOf(a.id, a.step("Código")).error])).toBe(
      "done",
    );
    const [row] = rowsOf(a.id, a.step("Código")).map((r) => r.json);
    expect(row).toEqual({
      filas: inside.length,
      mayor: Math.max(...inside.map(importe)),
      cuenta: inside.length,
      suma: inside.reduce((s, i) => s + importe(i), 0),
      porEncima: 0,
      buscadas: 0,
      dentro: importe(first),
      fuera: null,
      noExiste: null,
      primero: expect.any(String),
      // A relation arrives as the id of the row it points to.
      tienda: tiendas[ids.indexOf(row?.primero as string) % tiendas.length],
    });
    expect(inside).toContain(ids.indexOf(row?.primero as string));
  }, 60_000);

  it("AU-161 · the connection is read from the automation as it is saved in the store, never from what the box or the request says: a job answered by a box that asks for a collection that is not connected reads nothing", async () => {
    orders(10);
    const a = chain([START(), code("return $col('Pedido').find()", "all", [reads("pedido")])]);
    // A box that, whatever it is sent, asks for «Tienda», which the step is not connected to.
    const asked: BoxJob[] = [];
    const lying = {
      async run(j: BoxJob) {
        asked.push(j);
        return {
          evaluations: [
            {
              state: "needs" as const,
              key: "k1",
              read: { collection: "Tienda", op: "find" as const },
            },
          ],
          console: [],
          dropped: 0,
          ms: 1,
        };
      },
    };
    const t = await tested(a.id, { trigger: a.step("Inicio"), fields: {} }, lying);
    expect(t.state).toBe("failed");
    const k = keptOf(a.id, a.step("Código"));
    expect(k.error?.why).toMatchObject({ code: "code.read.notConnected" });
    // Asked once and given nothing: the read never reached the store.
    expect(asked).toHaveLength(1);
    expect(asked[0]?.reads).toEqual({});
    expect(k.reads ?? []).toEqual([]);
  }, 30_000);

  it("AU-169 · what «Código» gives carries the worst label of everything that evaluation got, never finer: with «Todas a la vez» every row it gives is from outside when one row it read had a field from outside, and so is the field a «Colección» step after it would write; a test writes nothing", async () => {
    orders(20, 2);
    const log = store.logPage(0, 1_000_000).length;
    const a = chain([
      START(),
      code(
        "return $col('Pedido').find({ sort: [{ field: 'importe', direction: 'asc' }] }).map((p) => ({ nota: p.nota }))",
        "all",
        [reads("pedido")],
      ),
      [
        "Crear",
        "collection",
        {
          collection: "tienda",
          action: "create",
          fields: [{ field: "nombre", value: { expr: "{{ $json.nota }}" } }],
        },
      ],
    ]);
    const t = await tested(a.id, { trigger: a.step("Inicio"), fields: {} });
    expect(t.state).toBe("done");
    const made = rowsOf(a.id, a.step("Código"));
    expect(made).toHaveLength(20);
    // Half the notes it read were from outside; one evaluation read them all, so every row it gave is.
    for (const r of made) {
      expect(r.label.integrity).toBe("external");
      expect(r.fields?.nota?.integrity).toBe("external");
    }
    const would = rowsOf(a.id, a.step("Crear"));
    expect(would).toHaveLength(20);
    for (const r of would) expect(r.fields?.nombre?.integrity).toBe("external");
    expect(keptOf(a.id, a.step("Crear")).wouldWrite).toBe(20);
    expect(store.logPage(0, 1_000_000).length).toBe(log);
  }, 30_000);
});

describe("what «Código» did, kept with the test", () => {
  it("AU-34 · the run's instant and seed are kept with the test: «Probar paso» on a later step reuses what the «Código» before it gave, and running the «Código» again takes the new test's", async () => {
    const a = chain([
      START(),
      code("return [{ azar: Math.random(), ahora: Date.now() }]", "all"),
      ["Después", CODE_TYPE, { mode: "perRow", source: "return { ...$json, visto: true }" }],
    ]);
    const whole = await tested(a.id, { trigger: a.step("Inicio"), fields: {} });
    expect(whole.state).toBe("done");
    const k = keptOf(a.id, a.step("Código"));
    expect(k.clock).toEqual({ now: expect.any(Number), seed: expect.any(Number) });
    const [gave] = rowsOf(a.id, a.step("Código")).map((r) => r.json);
    expect(gave?.ahora).toBe(k.clock?.now);

    await new Promise((r) => setTimeout(r, 5));
    const later = await tested(a.id, {
      trigger: a.step("Inicio"),
      fields: {},
      step: a.step("Después"),
    });
    expect(later.reused).toContain(a.step("Código"));
    expect(rowsOf(a.id, a.step("Después")).map((r) => r.json)).toEqual([{ ...gave, visto: true }]);
    expect(keptOf(a.id, a.step("Código")).clock).toEqual(k.clock);

    await new Promise((r) => setTimeout(r, 5));
    const again = await tested(a.id, {
      trigger: a.step("Inicio"),
      fields: {},
      step: a.step("Código"),
    });
    expect(again.ran).toContain(a.step("Código"));
    const now = keptOf(a.id, a.step("Código")).clock;
    expect(now?.now).toBeGreaterThan(k.clock?.now as number);
    const [fresh] = rowsOf(a.id, a.step("Código")).map((r) => r.json);
    expect(fresh?.ahora).toBe(now?.now);
    expect(fresh?.azar).not.toBe(gave?.azar);
  }, 30_000);

  it("AU-33 · the console and the message of an error are kept with the step's test in the user's store and given with it, and neither is written to the server's log", async () => {
    const said: string[] = [];
    const spies = [
      vi.spyOn(process.stdout, "write").mockImplementation((c: string | Uint8Array) => {
        said.push(String(c));
        return true;
      }),
      vi.spyOn(process.stderr, "write").mockImplementation((c: string | Uint8Array) => {
        said.push(String(c));
        return true;
      }),
      ...(["log", "info", "warn", "error", "debug"] as const).map((m) =>
        vi.spyOn(console, m).mockImplementation((...x: unknown[]) => {
          said.push(x.map(String).join(" "));
        }),
      ),
    ];
    try {
      const a = chain([
        START(),
        code(
          "console.log('contando filas de ejemplo');\nthrow new Error('falla de ejemplo')",
          "all",
        ),
      ]);
      const t = await tested(a.id, { trigger: a.step("Inicio"), fields: {} });
      expect(t.state).toBe("failed");
      const k = keptOf(a.id, a.step("Código"));
      expect(k.console?.lines.map((l) => l.text)).toEqual(["contando filas de ejemplo"]);
      // Given with the step's test, for «Consola» under its output.
      expect(t.tests[a.step("Código")]?.console).toEqual(k.console);
      expect(k.error?.why).toMatchObject({
        code: "code.threw",
        detail: { message: expect.stringContaining("falla de ejemplo"), line: 2 },
      });
      // The code's message is only in `why`: never in the message the server writes itself.
      expect(k.error?.message).not.toContain("falla de ejemplo");
    } finally {
      for (const s of spies) s.mockRestore();
    }
    expect(said.join("\n")).not.toMatch(/contando filas de ejemplo|falla de ejemplo/);
  }, 30_000);

  it("AU-27 · the value under an expression and the value the test gave its row are the same over the real box, for a table of expressions with dates in the user's zone on the days it changes its hour", async () => {
    // The days Madrid changes its hour in 2026, and the ones around them, at the hours that move.
    const days = [
      "2026-03-28",
      "2026-03-29",
      "2026-03-30",
      "2026-10-24",
      "2026-10-25",
      "2026-10-26",
    ];
    const a = chain([
      START(),
      code(
        `return ${JSON.stringify(days)}.flatMap((d) => [0, 1, 2, 3, 23].map((h) => ({ dia: d, hora: h })))`,
        "all",
      ),
      [
        "Tabla",
        "edit",
        {
          keep: "none",
          fields: [
            {
              field: "cuando",
              value: {
                expr: "{{ new Date($json.dia + 'T' + String($json.hora).padStart(2, '0') + ':30:00').getTime() }}",
              },
            },
            {
              field: "texto",
              value: { expr: "{{ new Date(Date.UTC(2026, 2, 29, $json.hora)).toLocaleString() }}" },
            },
            {
              field: "hora",
              value: { expr: "{{ new Date(Date.UTC(2026, 9, 25, $json.hora)).getHours() }}" },
            },
            { field: "azar", value: { expr: "{{ Math.random() }}" } },
          ],
        },
      ],
    ]);
    const t = await tested(a.id, { trigger: a.step("Inicio"), fields: {} });
    expect(t.state, JSON.stringify(keptOf(a.id, a.step("Tabla")).error)).toBe("done");
    const gave = rowsOf(a.id, a.step("Tabla")).map((r) => r.json);
    expect(gave).toHaveLength(30);
    // Each day's first and last row, and every row of the two days that change their hour: 02:30 on 29 March does not
    // exist in Madrid (row 7) and 02:30 on 25 October is there twice (row 22).
    for (const n of [0, 4, 5, 9, 10, 11, 12, 13, 14, 15, 19, 20, 21, 22, 23, 24, 25, 29])
      for (const [i, field] of ["cuando", "texto", "hora", "azar"].entries()) {
        const p = ok(
          await previewExpression(
            store,
            a.id,
            { step: a.step("Tabla"), param: `fields.${i}.value`, row: n },
            JUAN,
            box(),
          ),
        );
        expect(p, `${field} ${n}`).toEqual({
          state: "value",
          value: gave[n]?.[field],
          row: n,
          of: 30,
        });
      }
    // AU-23 · a stale test is never read: with the «Código» before it changed, the value is to test again, not the old one.
    const draft = JSON.parse(store.journal.automationDraft(a.id)?.doc as string) as Automation;
    const changed = {
      ...draft,
      steps: draft.steps.map((s) =>
        s.id === a.step("Código")
          ? { ...s, params: { ...s.params, source: `${String(s.params.source)}\n// otra` } }
          : s,
      ),
    };
    expect(ok(keepDraft(store, a.id, changed, JUAN)).stale).toContain(a.step("Código"));
    expect(
      await previewExpression(
        store,
        a.id,
        { step: a.step("Tabla"), param: "fields.3.value", row: 0 },
        JUAN,
        box(),
      ),
    ).toEqual({ state: "untested", steps: [a.step("Código")] });
    // A parameter the step does not have is a bad request; a step of another automation too.
    expect(
      await previewExpression(
        store,
        a.id,
        { step: a.step("Tabla"), param: "nada", row: 0 },
        JUAN,
        box(),
      ),
    ).toEqual({
      error: "bad-request",
    });
    expect(
      await previewExpression(
        store,
        a.id,
        { step: "s_otro", param: "fields.0.value", row: 0 },
        JUAN,
        box(),
      ),
    ).toEqual({
      error: "bad-request",
    });
  }, 60_000);
});

describe("the box's limits over the real box (AU-35, AU-175)", () => {
  const one = async (source: string, connections: Connection[] = []) => {
    const a = chain([START(), code(source, "all", connections)]);
    const t = await tested(a.id, { trigger: a.step("Inicio"), fields: {} });
    return { t, k: keptOf(a.id, a.step("Código")), a };
  };

  it("what the code threw, what it gave that is not rows and what it tried to change are its own failures, each by its code", async () => {
    const threw = await one("const x = 1;\nnull.y");
    expect(threw.k.error?.why).toMatchObject({ code: "code.threw", detail: { line: 2 } });
    const nothing = await one("const x = 1;");
    expect(nothing.k.error?.why).toMatchObject({ code: "code.result" });
    orders(1);
    // What was read is looked at, never changed: the message says to change a copy.
    const frozen = await one("const p = $col('Pedido').find();\np[0].importe = 9;\nreturn []", [
      reads("pedido"),
    ]);
    expect(frozen.k.error?.why).toMatchObject({ code: "code.frozen", detail: { line: 2 } });
  }, 30_000);

  it("an answer over the box's own default of a mega and under the engine's limit is given whole; one over the engine's is `code.limit` of `outputBytes`", async () => {
    const big = await one("return [{ texto: 'x'.repeat(2000000) }]");
    expect(big.t.state, JSON.stringify(big.k.error)).toBe("done");
    expect(String(rowsOf(big.a.id, big.a.step("Código"))[0]?.json.texto)).toHaveLength(2_000_000);
    const over = await one("return [{ texto: 'x'.repeat(5000000) }]");
    expect(over.k.error?.why).toEqual({
      code: "code.limit",
      detail: { limit: "outputBytes", max: CODE_LIMITS.outputBytes },
    });
  }, 60_000);

  it("code that takes more memory than it may is `code.limit` of `memoryBytes`, and the next call runs", async () => {
    const over = await one("const a = 'x'.repeat(100000000); return [{ n: a.length }]");
    expect(over.k.error?.why).toEqual({
      code: "code.limit",
      detail: { limit: "memoryBytes", max: CODE_LIMITS.memoryBytes },
    });
    expect((await one("return [{ n: 1 }]")).t.state).toBe("done");
  }, 60_000);

  it("code that never ends is stopped by the interpreter's count of steps, `code.limit` of `steps`, and the next call runs", async () => {
    const start = clock();
    const over = await one("let i = 0;\nwhile (true) i++;\nreturn []");
    expect(over.k.error?.why).toEqual({
      code: "code.limit",
      detail: { limit: "steps", max: CODE_LIMITS.steps },
    });
    timing("a loop stopped by the box's count of steps", clock() - start);
    expect((await one("return [{ n: 1 }]")).t.state).toBe("done");
  }, 60_000);

  it("AU-175 · a «Código» that asks to save more rows than it may is `code.limit` of `writes` (a test never writes; that a run saves nothing is S1-c's)", async () => {
    const log = store.logPage(0, 1_000_000).length;
    const over = await one(
      `for (let i = 0; i < ${CODE_LIMITS.writes + 1}; i++) $col('Pedido').create({ importe: i });\nreturn []`,
      [reads("pedido", { create: { mode: "ask" } })],
    );
    expect(over.k.error?.why).toMatchObject({
      code: "code.limit",
      detail: { limit: "writes", max: CODE_LIMITS.writes },
    });
    expect(store.logPage(0, 1_000_000).length).toBe(log);
  }, 60_000);
});

/** Timings for the PR (A-15), when BONI_TIMINGS names a file. */
const timing = (what: string, value: number, unit = "ms") => {
  if (process.env.BONI_TIMINGS)
    appendFileSync(process.env.BONI_TIMINGS, `${what}: ${value.toFixed(1)} ${unit}\n`);
};

/** A box that counts its calls and how long each took, there and back and inside the box. */
function counted(b: Box) {
  const calls: { ms: number; inside: number }[] = [];
  return {
    calls,
    box: {
      async run(j: BoxJob) {
        const start = clock();
        const r = await b.run(j);
        calls.push({ ms: clock() - start, inside: r.ms });
        return r;
      },
    } satisfies Box,
  };
}

/** The most this thread's heap grew over what it was, sampled while `f` runs. */
async function heapPeak<T>(f: () => Promise<T>): Promise<{ value: T; grew: number }> {
  const before = process.memoryUsage().heapUsed;
  let peak = before;
  const sample = setInterval(() => {
    peak = Math.max(peak, process.memoryUsage().heapUsed);
  }, 20);
  try {
    const value = await f();
    peak = Math.max(peak, process.memoryUsage().heapUsed);
    return { value, grew: peak - before };
  } finally {
    clearInterval(sample);
  }
}

describe("JavaScript over the user's volume (AU-38, A-15)", () => {
  it("AU-38 · a test of an automation with three steps of `{{ }}` of JavaScript over 3,000 rows, a «Código» once per row of 3,000 and a «Código» that reads 3,000 rows with all of them at once ends within the time written here and holds the server's heap under the memory written here", async () => {
    orders(3000, 7);
    const edit = (name: string, field: string, expr: string) =>
      [name, "edit", { keep: "all", fields: [{ field, value: { expr } }] }] as StepSpec;
    const a = chain([
      START(),
      find(),
      edit("Doble", "doble", "{{ $json.importe * 2 }}"),
      edit("Mayúsculas", "mayus", "{{ $json.nota.toUpperCase() }}"),
      edit("Mes", "mes", "{{ $json.fecha.slice(0, 7) }}"),
      [
        "Por fila",
        CODE_TYPE,
        { mode: "perRow", source: "return { ...$json, total: $json.doble + 1 }" },
      ],
      code(
        `const gastado = {};
for (const p of $col('Pedido').find()) gastado[p.tienda] = (gastado[p.tienda] ?? 0) + p.importe;
const filas = $input.all();
return $col('Tienda').find().map((t) => ({ tienda: t.nombre, gastado: gastado[t.id] ?? 0, filas: filas.length }));`,
        "all",
        [reads("pedido"), reads("tienda")],
      ),
    ]);
    const c = counted(box());
    const start = clock();
    const { value: t, grew } = await heapPeak(() =>
      tested(a.id, { trigger: a.step("Inicio"), fields: {} }, c.box),
    );
    const took = clock() - start;
    expect(t.state, JSON.stringify(keptOf(a.id, t.failedAt ?? "").error)).toBe("done");
    expect(t.tests[a.step("Por fila")]?.out.main).toBe(3000);
    expect(t.tests[a.step("Código")]?.out.main).toBe(37);
    const [shop] = rowsOf(a.id, a.step("Código")).map((r) => r.json);
    expect(shop?.filas).toBe(3000);

    // What one call costs with nothing to do: starting its interpreter, and the way there and back.
    const empty = counted(box());
    for (let i = 0; i < 10; i++) await empty.box.run(job({ sources: ["return []"] }));
    const avg = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
    const call = avg(c.calls.map((x) => x.ms));
    const bare = avg(empty.calls.map((x) => x.ms));
    timing("AU-38 · the five steps of JavaScript over 3,000 rows, whole test", took);
    timing("AU-38 · calls to the box", c.calls.length, "calls");
    timing("AU-38 · a call, there and back, on average", call);
    timing("AU-38 · a call, inside the box, on average", avg(c.calls.map((x) => x.inside)));
    timing("AU-38 · the longest call", Math.max(...c.calls.map((x) => x.ms)));
    timing("AU-38 · an empty call, there and back, on average", bare);
    timing(
      "AU-38 · an empty call, inside the box, on average",
      avg(empty.calls.map((x) => x.inside)),
    );
    timing("AU-38 · an empty call's share of an average call", (100 * bare) / call, "%");
    timing("AU-38 · the server's heap grew at most", grew / 2 ** 20, "MB");

    under(took, 10_000, "clock", "a test of five steps of JavaScript over 3,000 rows");
    expect(grew).toBeLessThan(160 * 2 ** 20);
  }, 120_000);
});

describe("the line under an expression over the user's volume (AU-23, A-15)", () => {
  it("AU-23 · while Juan types an expression of JavaScript in a step after 3,000 rows, each line under it is worked out within the time written here, the one that sends every row too, and each is what the box gives that text", async () => {
    orders(3000);
    const a = chain([
      START(),
      find(),
      [
        "Doble",
        "edit",
        { keep: "all", fields: [{ field: "doble", value: { expr: "{{ $json.importe * 2 }}" } }] },
      ],
    ]);
    const t = await tested(a.id, { trigger: a.step("Inicio"), fields: {} });
    expect(t.state).toBe("done");
    const at = { step: a.step("Doble"), param: "fields.0.value", row: 41 };
    const importe = rowsOf(a.id, a.step("Buscar"))[41]?.json.importe as number;
    // What he types, a pause at a time: each pause is one request (the app asks when he stops typing).
    const typed = [
      ["{{ $json.importe * 3 }}", importe * 3],
      ["{{ $json.importe * 3 + }}", null],
      ["{{ $json.importe * 3 + 1 }}", importe * 3 + 1],
      ["{{ Math.round($json.importe / 7) }}", Math.round(importe / 7)],
      ["{{ $input.all().length }} pedidos", "3000 pedidos"],
    ] as const;
    const took: number[] = [];
    for (const [expr, value] of typed) {
      const start = clock();
      const p = ok(await previewExpression(store, a.id, { ...at, expr }, JUAN, box()));
      took.push(clock() - start);
      if (value === null) expect(p, expr).toMatchObject({ state: "failed", row: 41, of: 3000 });
      else expect(p, expr).toEqual({ state: "value", value, row: 41, of: 3000 });
    }
    for (const [i, ms] of took.entries()) timing(`AU-23 · the line under «${typed[i]?.[0]}»`, ms);
    for (const ms of took) under(ms, 600, "clock", "the line under an expression after 3,000 rows");

    // `$input.all()` row by row needs every row in each call, in the run too (box.ts): there, one that goes through
    // all the rows for each of 3,000 is cut at the call's time, and the line says the same, no later than the run.
    const slow = "{{ $input.all().filter((p) => p.importe > $json.importe).length }}";
    const start = clock();
    const p = ok(await previewExpression(store, a.id, { ...at, expr: slow }, JUAN, box()));
    const cut = clock() - start;
    timing("AU-23 · the line under an expression cut at the call's time", cut);
    expect(p).toMatchObject({ state: "failed", failure: { code: "code.limit" } });
    under(cut, CODE_LIMITS.ms + 2_000, "clock", "a line cut at the call's time");
  }, 60_000);
});

/** A job as the engine makes them, with what a test does not care about filled in. */
function job(more: Partial<BoxJob> & Pick<BoxJob, "sources">): BoxJob {
  return {
    kind: "code",
    mode: "all",
    input: [],
    from: 0,
    steps: {},
    now: NOW,
    zone: "Europe/Madrid",
    locale: "es",
    seed: 7,
    run: { test: true, startedBy: "user" },
    reads: {},
    ...more,
  };
}

// ---------------------------------------------------------------- a run over the real store (S1-c)

/** A «Código» that reads every order and asks to modify each one's note: a step's change of 3,000 rows. */
const NOTE_ALL = `
const pedidos = $col('Pedido').find({ limit: 5000 });
for (const p of pedidos) $col('Pedido').update(p.id, { nota: 'revisado ' + p.importe });
return [];`;

/** A run's id, as whoever starts one makes it (F14d: the server, when a run is published and saved). */
const runId = () => newId("o").replace(/^o_/, "r_");

/**
 * The automation as it is published from its saved draft: what a run for real reads, never the canvas's copy nor the
 * draft (AU-95). Publishing is Juan's hand on his laptop.
 */
const savedOf = (id: string): Automation => {
  const v = automationView(store, id);
  if ("error" in v) throw new Error(`service error: ${v.error}`);
  const p = publish(store, id, { rev: v.rev }, JUAN);
  if (!("version" in p)) throw new Error(`not published: ${JSON.stringify(p)}`);
  const published = publishedOf(store, id);
  if (!published) throw new Error("no published version");
  return published.automation;
};

/** A run for real of the published version, by Juan's hand on his laptop, from the automation's manual trigger. */
const ranFor = (id: string, trigger: string, run: string) => {
  const automation = savedOf(id);
  return runAutomation(
    { automation, trigger, fields: { json: {}, label: handLabel(JUAN.device) }, test: false },
    runDeps(store, id, JUAN, box(), run),
  );
};

/** Every order's note, by id: what a change of the step would touch. */
const notes = () =>
  new Map(store.list(PEDIDO).map((e) => [e.entity.id, e.entity.values.f_nota ?? null]));

describe("a run over the real store (S1-c)", () => {
  it("AU-181 · «Probar paso» of a «Código» that asks to modify 3,000 rows saves none and leaves no operation in the log: its kept test says how many it would change in which collection, whether a run would ask, and the first rows with their note before and after", async () => {
    orders(3000);
    const before = notes();
    const a = chain(
      [["Inicio", "manual"], code(NOTE_ALL, "all", [reads("pedido", { update: { mode: "ask" } })])],
      MANY_ROWS,
    );
    const log = store.version();
    const t = await tested(a.id, { trigger: a.step("Inicio"), fields: {}, step: a.step("Código") });
    expect(t.state, JSON.stringify(t.problems)).toBe("done");
    expect(store.version()).toBe(log);
    expect(notes()).toEqual(before);
    const view = t.tests[a.step("Código")];
    expect(view?.wouldWrite).toBe(3000);
    expect(view?.would?.asks).toBe(true);
    expect(view?.would?.counts).toEqual([{ collection: "pedido", action: "update", n: 3000 }]);
    expect(view?.would?.records).toHaveLength(WOULD_ROWS);
    const [first] = view?.would?.records ?? [];
    expect(first).toMatchObject({ collection: "pedido", action: "update" });
    expect(String(first?.after?.f_nota ?? first?.after?.nota)).toMatch(/^revisado \d+$/);
    // Opened again, the editor reads the same.
    const opened = automationView(store, a.id);
    if ("error" in opened) throw new Error(opened.error);
    expect(opened.tests[a.step("Código")]?.would).toEqual(view?.would);
  }, 60_000);

  it("AU-175 · AU-186 · in a run for real a «Código» whose cell says «Preguntar» saves nothing: its change of 3,000 rows waits for Juan as one proposal; one that asks for more than an evaluation or a step may fails with `code.limit`; none leaves an operation in the log", async () => {
    orders(3000);
    const before = notes();
    const ask = [reads("pedido", { update: { mode: "ask" } })];
    const a = chain([["Inicio", "manual"], code(NOTE_ALL, "all", ask)], MANY_ROWS);
    const log = store.version();

    const r = runId();
    const e = await ranFor(a.id, a.step("Inicio"), r);
    expect(e.state, JSON.stringify(e.error)).toBe("done");
    expect(e.test).toBe(false);
    expect(e.steps[a.step("Código")]?.writes?.kind).toBe("asked");
    expect(e.asked).toHaveLength(3000);
    expect(new Set(e.asked.map((x) => `${x.step} ${x.kind} ${x.rule}`))).toEqual(
      // With no «Sí» the policy proposes first (P28), before the cell would.
      new Set([`${a.step("Código")} propose P28`]),
    );
    expect(e.asked.every((x) => x.change.kind === "update")).toBe(true);

    // Over the limit of one evaluation, and over the step's with one request per row of 3,000 rows twice.
    const creates = [reads("pedido", { create: { mode: "yes" } })];
    const many = chain(
      [
        ["Inicio", "manual"],
        code(
          `for (let i = 0; i < ${CODE_LIMITS.writes + 1}; i++) $col('Pedido').create({ importe: i });\nreturn []`,
          "all",
          creates,
        ),
      ],
      MANY_ROWS,
    );
    const perRow = chain(
      [
        ["Inicio", "manual"],
        find(),
        code(
          "$col('Pedido').create({ importe: 1 });\n$col('Pedido').create({ importe: 2 });\nreturn [$json]",
          "perRow",
          creates,
        ),
      ],
      MANY_ROWS,
    );
    const over = await ranFor(many.id, many.step("Inicio"), runId());
    const overStep = await ranFor(perRow.id, perRow.step("Inicio"), runId());
    expect(over.state).toBe("failed");
    expect(over.error?.why).toMatchObject({
      code: "code.limit",
      detail: { limit: "writes", max: CODE_LIMITS.writes },
    });
    expect(overStep.state).toBe("failed");
    expect(overStep.error?.why).toMatchObject({
      code: "code.limit",
      detail: { limit: "stepWrites", max: CODE_LIMITS.stepWrites },
    });
    expect(over.asked).toEqual([]);
    expect(overStep.asked).toEqual([]);

    expect(store.version()).toBe(log);
    expect(store.runOps(r)).toEqual([]);
    expect(notes()).toEqual(before);
    expect(store.list(PEDIDO)).toHaveLength(3000);
  }, 120_000);

  it("AU-174 · AU-185 · a step's change of 3,000 rows is written in one transaction of the user's store, every operation with the run in the log: with the 3,000th changed since it was read none is saved; read again, all are, each value keeping its label, from outside or Juan's (AU-170); and `undoRun` takes back the whole step", async () => {
    orders(3000, 10);
    const ask = [reads("pedido", { update: { mode: "ask" } })];
    const a = chain([["Inicio", "manual"], code(NOTE_ALL, "all", ask)], MANY_ROWS);
    const r = runId();
    const automation = savedOf(a.id);
    const real = runDeps(store, a.id, JUAN, box(), r);
    // The server's own policy, each of its decisions written down: which rule let each read and each write.
    const decided: { effect: string; d: Decision }[] = [];
    const recorded = (policy: Policy): Policy => ({
      decide(call: PolicyCall): Decision {
        const d = policy.decide(call);
        decided.push({ effect: call.effect, d });
        return d;
      },
    });
    const deps = { ...real, policy: recorded(real.policy) };
    const e = await runAutomation(
      {
        automation,
        trigger: a.step("Inicio"),
        fields: { json: {}, label: handLabel(JUAN.device) },
        test: false,
      },
      deps,
    );
    expect(e.asked).toHaveLength(3000);
    // Every read of the run is allowed (P1: AU-161), and with «Preguntar» every write is proposed by the one origin of
    // a run (P28: AU-167), whoever started it.
    const ruled = (effect: string) =>
      new Set(decided.filter((x) => x.effect === effect).map((x) => `${x.d.kind} ${x.d.rule}`));
    expect(decided.filter((x) => x.effect === "read").length).toBeGreaterThan(0);
    expect(ruled("read")).toEqual(new Set(["allow P1"]));
    expect(decided.filter((x) => x.effect === "write")).toHaveLength(3000);
    expect(ruled("write")).toEqual(new Set(["propose P28"]));
    decided.length = 0;

    // The change as F14d writes it once Juan accepts it, through the step's gate, each value with the label the gate
    // gets it with. This step's one evaluation read notes from outside, so all of its values are from outside
    // (AU-169); every other one is given Juan's own label here, to see that the store keeps each value's label and
    // makes none worse.
    // Once allowed: the server's policy as it is with the «Sí» it reads from the stored version (AU-188).
    const allowing = recorded(runPolicy(AUTOMATION, deps.own, () => true));
    const gate = guard(allowing, deps.collections, {
      automation: { id: a.id, version: automation.version },
      step: a.step("Código"),
      type: CODE_TYPE,
      action: "update",
      effect: "write",
      destroys: false,
      control: null,
      test: false,
      own: deps.own,
    });
    const mine = handLabel(JUAN.device);
    const want = new Map<string, string>();
    const changes = e.asked.map(({ change }, i): ChangeWith => {
      const values: Labelled = {};
      const from = i % 2 ? mine : OUTSIDE;
      if (change.kind === "update") {
        values.nota = { value: change.fields.nota ?? null, label: from, derived: true };
        want.set(change.row.id, from.integrity);
      }
      return { change, values };
    });
    expect(new Set(want.values())).toEqual(new Set(["external", "user"]));
    expect(await gate.decideAll(changes)).toBe("allow");
    // Each value from outside is let through by its «Sí» (P28): saved with its label, not proposed (AU-170); only an
    // ambient turn's would be (a model's saves with the «Sí» too since F15, AU-204).
    expect(decided).toHaveLength(3000);
    expect(ruled("write")).toEqual(new Set(["allow P28"]));

    // Juan changes the last one on his phone while the change waits: the whole change is refused, nothing saved.
    const last = changes[2999]?.change as Extract<Change, { kind: "update" }>;
    store.update(
      last.row.id,
      { f_nota: { value: "cambiada a mano", label: handLabel("d_telefono") } },
      { actor: "user", device: "d_telefono" },
    );
    const before = notes();
    const log = store.version();
    await expect(gate.writeAll(changes)).rejects.toMatchObject({
      failure: { code: "row.changed" },
    });
    expect(store.version()).toBe(log);
    expect(store.runOps(r)).toEqual([]);
    expect(notes()).toEqual(before);

    // Read again, as trying the step again does (AU-16): all 3,000 are saved, once each.
    const again = await deps.collections.get("pedido", last.row.id);
    if (!again) throw new Error("no row");
    changes[2999] = { ...(changes[2999] as ChangeWith), change: { ...last, row: again.origin } };
    const start = clock();
    const written = await gate.writeAll(changes);
    const took = clock() - start;
    expect(written).toHaveLength(3000);
    expect(written.every((w) => w.kind === "applied")).toBe(true);
    const ops = store.logPage(log, 10_000);
    expect(ops).toHaveLength(3000);
    expect(new Set(ops.map((o) => `${o.run} ${o.actor} ${o.device} ${o.kind}`))).toEqual(
      new Set([`${r} user ${JUAN.device} update`]),
    );
    expect(store.runOps(r)).toHaveLength(3000);
    expect(store.runUndoable(r)).toBe(true);

    // In the store each note keeps the label it was written with, from outside or Juan's, and so does it when read
    // again (AU-170).
    const saved = store.list(PEDIDO);
    expect(
      saved.filter((x) => String(x.entity.values.f_nota).startsWith("revisado ")),
    ).toHaveLength(3000);
    expect(saved.every((x) => x.labels.f_nota?.integrity === want.get(x.entity.id))).toBe(true);
    const read = await deps.collections.find({
      collection: "pedido",
      where: [],
      sort: [],
      limit: 5000,
      related: false,
    });
    expect(read).toHaveLength(3000);
    expect(read.every((row) => row.fields?.nota?.label.integrity === want.get(row.origin.id))).toBe(
      true,
    );

    // «Deshacer lo que hizo» takes back the whole step: every note as it was, the one from Juan's phone too.
    const undoStart = clock();
    const undone = store.undoRun(r, { actor: "user", device: JUAN.device });
    const undoTook = clock() - undoStart;
    expect(undone).toHaveLength(3000);
    expect(notes()).toEqual(before);
    expect(store.runUndoable(r)).toBe(false);

    timing("S1-c · a step's change of 3,000 rows, written", took);
    timing("S1-c · the run's 3,000 operations, undone", undoTook);
    // Since task 137 a write finds its row's entry in the search index by its rowid instead of reading the whole
    // index: measured on the laptop with the queue held, 1.8 s to write and 1.6 s to undo (2.9 s and 3.4 s before,
    // and 7.4 s and 7.6 s for these 3,000 among 12,000). The bounds are about twice that.
    under(took, 4000, "clock", "a step's change of 3,000 rows in one transaction");
    under(undoTook, 4000, "clock", "undoing a run of 3,000 operations");
  }, 120_000);
});
