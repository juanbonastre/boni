/**
 * (test) The steps «Función» and «Aplicar cambios» (task 93; Juan, 2026-11-06: «A: a la Bandeja»): an active
 * extension's function run in the box as a step of a flow; in the background its changes wait in the Bandeja as one
 * proposal, applied when Juan accepts it, in that run, and undone whole; «Probar» changes nothing; by hand the policy
 * counts each row; applying runs the function again and makes its set only when it is still the one proposed (else
 * the proposal is stale), so a set a plan writes is never made; what it says carries what it read; the checklist
 * wants the function named literally and «Aplicar cambios» over a «Función» step's result.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { codeLabel, deepLabel, fakePlanner, leaf, readStore, type Val } from "@boni/agent";
import { label } from "@boni/entities";
import type { ExtensionManifest, FunctionInput } from "@boni/extensions";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { AgentHost } from "./agent.ts";
import { checkFlow, flowCatalog } from "./flows.ts";
import type { Runner } from "./functions.ts";
import { inboxCard } from "./inboxCard.ts";
import { activate, propose } from "./proposals.ts";
import { codeHash } from "./sandbox.ts";
import { seed } from "./seed.test-util.ts";

const CODE = `function importar(input) {
  const nuevos = (input.data && input.data.lineas) || [];
  return { summary: nuevos.length + " nuevos", changes: nuevos.map((l) => ({ op: "create", collection: "movimiento", values: { concepto: l } })) };
}`;
const manifest: ExtensionManifest = {
  id: "banco",
  name: "Banco",
  version: 1,
  description: "Lee los extractos que subes y propone los movimientos nuevos.",
  functions: [
    {
      name: "importar",
      code: CODE,
      hash: codeHash(CODE),
      reads: [{ collection: "movimiento", fields: ["fecha", "importe"] }],
      writes: [{ collection: "movimiento", fields: ["concepto"], create: true }],
    },
  ],
  tests: [
    {
      function: "importar",
      name: "dos líneas dan dos movimientos",
      input: { rows: { movimiento: [] }, data: { lineas: ["cena", "taxi"] } },
      expect: {
        summary: "2 nuevos",
        changes: [
          { op: "create", collection: "movimiento", values: { concepto: "cena" } },
          { op: "create", collection: "movimiento", values: { concepto: "taxi" } },
        ],
      },
    },
  ],
  needs: { reads: ["movimiento"], proposes: false },
};
/** What the stand-in adds to each concept: another set from the same data (as rows it reads that changed would). */
let variant = "";
/** The box's stand-in: the function as it would run there. */
const box: Runner = async (req) => {
  const lines =
    ((req.input as FunctionInput).data as { lineas?: string[] } | undefined)?.lineas ?? [];
  return {
    id: req.id,
    ok: true,
    output: {
      summary: `${lines.length} nuevos`,
      changes: lines.map((l) => ({
        op: "create",
        collection: "movimiento",
        values: { concepto: `${l}${variant}` },
      })),
    },
    steps: 1,
    ms: 1,
  };
};

const PLAN = {
  version: 1,
  steps: [
    {
      id: "f",
      op: "call",
      tool: "function.run",
      args: { funcion: { lit: "banco/importar" }, datos: { ref: "$extracto" } },
    },
    { id: "a", op: "call", tool: "function.apply", args: { cambios: { ref: "$f" } } },
  ],
};

let dir = "";
let host: AgentHost | null = null;
afterEach(() => {
  variant = "";
  host?.close();
  host = null;
  if (dir) rmSync(dir, { recursive: true, force: true });
});

/** An account with the function active; `real`: in the box itself (apps/sandbox), not its stand-in. */
async function setUp(o: { real?: boolean; manifest?: ExtensionManifest } = {}) {
  dir = mkdtempSync(join(tmpdir(), "boni-funcion-"));
  host = new AgentHost({
    dataDir: dir,
    providers: { planner: fakePlanner([]), reader: fakePlanner([]) },
  });
  if (!o.real) host.sandboxRun = box;
  const store = host.store(1);
  seed(
    store,
    [
      {
        key: "movimiento",
        name: "Movimiento",
        folder: "finanzas/",
        fields: { fecha: "date", importe: "number", concepto: "text" },
      },
      // What no model may read once it is opaque (the last case).
      { key: "privado", name: "Privado", folder: "privado/", fields: { importe: "number" } },
    ],
    { "privado/uno.md": "---\nimporte: 12\n---\n" },
  );
  const m = o.manifest ?? manifest;
  await propose(store, m, "mcp:c", o.real ? {} : { run: box });
  expect(activate(store, m.id, "portatil")).toBe(true);
  return { host, store };
}

/** A collection by its key. */
const typeOf = (store: ReturnType<AgentHost["store"]>, key: string) => {
  const t = Object.values(store.schema().types).find((x) => x.key === key);
  if (!t) throw new Error(`no ${key}`);
  return t;
};
/** The flow run by hand (as «Ejecutar» runs it: a turn of Juan's, on his device). */
const byHand = (h: AgentHost, lineas: string[], plan: unknown = PLAN) =>
  h.agent(1).turn({
    text: "«Importar extracto»",
    origin: { kind: "turn", trust: "personal", device: "portatil" },
    flow: {
      id: "importar-extracto",
      version: 1,
      by: "user",
      plan,
      bind: {
        extracto: leaf(
          { lineas } as never,
          label("user", "personal", [{ kind: "user-edit", id: "flow:x" }]),
        ),
      },
    },
  });
const lines = (n: number) => Array.from({ length: n }, (_, i) => `línea ${i + 1}`);

/** A function that reads what no model may read (an opaque collection) and would write into an open one. */
const COPY = "function copiar(input) { return { changes: [] }; }";
const caja: ExtensionManifest = {
  id: "caja",
  name: "Caja",
  version: 1,
  description: "Copia en movimientos lo que lee.",
  functions: [
    {
      name: "copiar",
      code: COPY,
      hash: codeHash(COPY),
      reads: [{ collection: "privado", fields: ["importe"] }],
      writes: [{ collection: "movimiento", fields: ["concepto"], create: true }],
    },
  ],
  tests: [
    {
      function: "copiar",
      name: "una línea da un movimiento",
      input: { rows: { privado: [] }, data: { lineas: ["x"] } },
      expect: {
        summary: "1 nuevos",
        changes: [{ op: "create", collection: "movimiento", values: { concepto: "x" } }],
      },
    },
  ],
  needs: { reads: ["privado"], proposes: false },
};

const extracto = { lineas: ["cena", "taxi"] };
const data = (): Record<string, Val> => ({
  extracto: leaf(extracto as never, codeLabel("extracto")),
});

describe("the step «Función» (task 93)", () => {
  it("in the background its changes wait in the Bandeja as one proposal, applied when Juan accepts it", async () => {
    const { host, store } = await setUp();
    const before = store.list(
      store.schema().types[
        Object.keys(store.schema().types).find(
          (k) => store.schema().types[k]?.key === "movimiento",
        ) ?? ""
      ]?.id ?? "",
    ).length;
    const r = await host.agent(1).background(PLAN, data(), [], undefined, {
      id: "importar-extracto",
      version: 1,
    });
    expect(r.status).toBe("done");
    // One proposal for the whole set, nothing written yet; the card says what it would change, never its JSON.
    expect(r.proposals).toHaveLength(1);
    const p = store.journal.proposal(r.proposals[0] as string);
    if (!p) throw new Error("no proposal");
    expect(p.tool).toBe("function.apply");
    // The card: the function by its name, its summary and its numbers; never what it keeps to run it again.
    const rows = (p.view as { rows: { arg: string; value: string }[] }).rows;
    expect(rows.map((x) => [x.arg, x.value])).toEqual([
      ["cambios.nombre", "Banco · importar"],
      ["cambios.resumen", "2 nuevos"],
      ["cambios.nuevas", "2"],
      ["cambios.cambiadas", "0"],
    ]);
    expect(inboxCard(store, p).title).toBe("Banco · importar: 2 nuevos");
    const mov = Object.values(store.schema().types).find((t) => t.key === "movimiento");
    if (!mov) throw new Error("no movimiento");
    expect(store.list(mov.id)).toHaveLength(before);
    // Accepted: made in the accepting run, which Deshacer takes back whole.
    const done = await host.agent(1).acceptProposal(p.id, "personal");
    expect(done.status).toBe("done");
    const titles = store
      .list(mov.id)
      .map((e) => e.entity.values[mov.fields.find((f) => f.key === "concepto")?.id ?? ""]);
    expect(titles).toEqual(expect.arrayContaining(["cena", "taxi"]));
    expect(store.runOps(done.run)).toHaveLength(2);
    expect(store.journal.proposal(p.id)?.status).toBe("accepted");
    // Deshacer takes the whole set back.
    host.agent(1).undoRun(done.run);
    expect(store.list(mov.id)).toHaveLength(before);
  });

  it("«Probar» runs the function and says what it would change, writing nothing and proposing nothing", async () => {
    const { host, store } = await setUp();
    const mov = Object.values(store.schema().types).find((t) => t.key === "movimiento");
    if (!mov) throw new Error("no movimiento");
    const before = store.list(mov.id).length;
    const r = await host.agent(1).dryRun(PLAN, data(), {
      origin: { kind: "background", trust: "personal" },
      flow: { id: "importar-extracto", version: 1, by: "user" },
    });
    expect(r.status).toBe("done");
    expect(r.proposals).toHaveLength(0);
    expect(store.list(mov.id)).toHaveLength(before);
    expect(store.journal.proposals("pending")).toHaveLength(0);
  });

  it("the checklist wants the function named literally, an active one, and «Aplicar cambios» over a «Función»", async () => {
    const { host, store } = await setUp();
    const o = { modules: ["tasks"], mailType: null };
    const check = (steps: unknown[]) =>
      checkFlow(
        store,
        host.tools,
        { trigger: { manual: true, inputs: [{ name: "extracto" }] }, plan: { version: 1, steps } },
        o,
      ).problems;
    expect(check(PLAN.steps)).toEqual([]);
    // The editor's catalogue: the function by its name, its code and its tests' names, to read in its panel.
    expect(flowCatalog(host.tools, store, ["tasks"]).functions).toEqual([
      {
        id: "banco/importar",
        name: "Banco · importar",
        code: CODE,
        tests: ["dos líneas dan dos movimientos"],
      },
    ]);
    expect(
      check([
        { id: "f", op: "call", tool: "function.run", args: { funcion: { lit: "banco/otra" } } },
      ]),
    ).toContainEqual({ step: "f", at: "args.funcion", code: "function-unknown" });
    expect(
      check([
        { id: "n", op: "call", tool: "entities.count", args: {} },
        { id: "a", op: "call", tool: "function.apply", args: { cambios: { ref: "$n" } } },
      ]),
    ).toContainEqual({ step: "a", at: "args.cambios", code: "apply-needs-function" });
  });

  it("by hand the policy decides: a few rows are made at once, many are confirmed first (P11, as `decideApply`)", async () => {
    const { host, store } = await setUp();
    const mov = typeOf(store, "movimiento");
    const few = await byHand(host, ["cena", "taxi"]);
    expect(few.status).toBe("done");
    expect(store.runOps(few.run)).toHaveLength(2);
    const many = await byHand(host, lines(25));
    expect(many.status).toBe("waiting");
    expect(many.pending?.kind).toBe("confirm");
    expect(store.list(mov.id)).toHaveLength(2);
  });

  it("accepted in the Bandeja, a set of many rows is made whole in that run, never asked again", async () => {
    const { host, store } = await setUp();
    const r = await host
      .agent(1)
      .background(
        PLAN,
        { extracto: leaf({ lineas: lines(25) } as never, codeLabel("extracto")) },
        [],
        undefined,
        { id: "importar-extracto", version: 1 },
      );
    expect(r.proposals).toHaveLength(1);
    const done = await host.agent(1).acceptProposal(r.proposals[0] as string, "personal");
    expect(done.status).toBe("done");
    expect(store.runOps(done.run)).toHaveLength(25);
  });

  it("what no model may read never lands where a model could read it, and nothing of the set is made (A-09)", async () => {
    const { host, store } = await setUp();
    store.setAiAccess(typeOf(store, "privado").id, "opaque", "portatil");
    await propose(store, caja, "mcp:c", { run: box });
    expect(activate(store, "caja", "portatil")).toBe(true);
    const plan = {
      version: 1,
      steps: [
        {
          id: "f",
          op: "call",
          tool: "function.run",
          args: { funcion: { lit: "caja/copiar" }, datos: { ref: "$extracto" } },
        },
        { id: "a", op: "call", tool: "function.apply", args: { cambios: { ref: "$f" } } },
      ],
    };
    const r = await byHand(host, ["uno", "dos"], plan);
    expect(r.status).toBe("stopped");
    expect(r.error).toContain("function-more-open");
    expect(store.list(typeOf(store, "movimiento").id)).toHaveLength(0);
    // What it says carries what it read: no count or summary of it reaches a model as Boni's own value.
    const said = (await host.tools.get("function.run")?.run(
      { store: readStore(store), functions: { store: () => store, run: box } } as never,
      {
        funcion: leaf("caja/copiar", codeLabel("plan")),
        datos: leaf({ lineas: ["x"] } as never, codeLabel("plan")),
      },
      codeLabel("plan"),
    )) as Val;
    if (said?.t !== "rec") throw new Error("no record");
    for (const k of ["nombre", "resumen", "nuevas", "cambiadas", "huella"])
      expect(deepLabel(said.fields[k] as Val).noModel).toBe(true);
  });

  it("applying runs it again: a set that is no longer the one proposed is not made, and its proposal is stale", async () => {
    const { host, store } = await setUp();
    const mov = typeOf(store, "movimiento");
    const r = await host.agent(1).background(PLAN, data(), [], undefined, {
      id: "importar-extracto",
      version: 1,
    });
    const id = r.proposals[0] as string;
    // What it reads changed since, and it now gives another set: nothing made, and the Bandeja says it no longer
    // stands (never «accepted» with nothing done).
    variant = " (2)";
    const done = await host.agent(1).acceptProposal(id, "personal");
    expect(done.error).toBe("stale");
    expect(store.journal.proposal(id)?.status).toBe("stale");
    expect(store.list(mov.id)).toHaveLength(0);
  });

  it("when the box does not answer on accepting, nothing is made and the proposal waits again", async () => {
    const { host, store } = await setUp();
    const r = await host.agent(1).background(PLAN, data(), [], undefined, {
      id: "importar-extracto",
      version: 1,
    });
    const id = r.proposals[0] as string;
    host.sandboxRun = async (req) => ({ id: req.id, ok: false, error: "timeout", message: "x" });
    const failed = await host.agent(1).acceptProposal(id, "personal");
    expect(failed.status).toBe("stopped");
    expect(store.journal.proposal(id)?.status).toBe("pending");
    expect(store.list(typeOf(store, "movimiento").id)).toHaveLength(0);
    // The box back: accepted, it is made.
    host.sandboxRun = box;
    expect((await host.agent(1).acceptProposal(id, "personal")).status).toBe("done");
    expect(store.list(typeOf(store, "movimiento").id)).toHaveLength(2);
  });

  it("what Juan reads is what runs: a plan that names it otherwise or says another summary makes nothing", async () => {
    const { host, store } = await setUp();
    // The function's own values, all but its name and summary, which the plan writes («Banco · conciliar»).
    const plan = {
      version: 1,
      steps: [
        PLAN.steps[0],
        {
          id: "a",
          op: "call",
          tool: "function.apply",
          args: {
            cambios: {
              fn: "obj",
              args: [
                ...["funcion", "huella", "datos", "nuevas", "cambiadas"].flatMap((k) => [
                  { lit: k },
                  { ref: `$f.${k}` },
                ]),
                { lit: "nombre" },
                { lit: "Banco · conciliar" },
                { lit: "resumen" },
                { lit: "2 conciliados" },
              ],
            },
          },
        },
      ],
    };
    const r = await byHand(host, ["cena", "taxi"], plan);
    expect(r.error).toBe("tool-stale");
    expect(store.list(typeOf(store, "movimiento").id)).toHaveLength(0);
  });

  it("a set a plan writes itself is never made: only what the function gives when run again (A-09)", async () => {
    const { host, store } = await setUp();
    const forged = {
      version: 1,
      steps: [
        {
          id: "a",
          op: "call",
          tool: "function.apply",
          // Built with the plan's own `obj`, as a model could write it: any set, any fingerprint.
          args: {
            cambios: {
              fn: "obj",
              args: [
                { lit: "funcion" },
                { lit: "banco/importar" },
                { lit: "nombre" },
                { lit: "Banco · importar" },
                { lit: "nuevas" },
                { lit: 1 },
                { lit: "cambiadas" },
                { lit: 0 },
                { lit: "datos" },
                { lit: "lo que diga el plan" },
                { lit: "huella" },
                { lit: "2026-11-06|1|0000" },
              ],
            },
          },
        },
      ],
    };
    const r = await byHand(host, [], forged);
    expect(r.status).toBe("stopped");
    expect(r.error).toBe("tool-stale");
    expect(store.list(typeOf(store, "movimiento").id)).toHaveLength(0);
  });
});

/** A function that, when asked, marks each line with the day and a number drawn at random (`ctx`). */
const AZAR = `function sortear(input, ctx) {
  const d = input.data || {};
  const lineas = d.lineas || [];
  const marca = d.azar ? " · " + ctx.day + " · " + Math.floor(ctx.random() * 1000000) : "";
  return { summary: lineas.length + " nuevos", changes: lineas.map((l) => ({ op: "create", collection: "movimiento", values: { concepto: l + marca } })) };
}`;
const sorteo: ExtensionManifest = {
  id: "sorteo",
  name: "Sorteo",
  version: 1,
  description: "Marca cada línea con el día y un número al azar.",
  functions: [
    {
      name: "sortear",
      code: AZAR,
      hash: codeHash(AZAR),
      reads: [{ collection: "movimiento", fields: ["fecha"] }],
      writes: [{ collection: "movimiento", fields: ["concepto"], create: true }],
    },
  ],
  tests: [
    {
      function: "sortear",
      name: "sin azar, una línea da un movimiento",
      input: { rows: { movimiento: [] }, data: { lineas: ["cena"] } },
      expect: {
        summary: "1 nuevos",
        changes: [{ op: "create", collection: "movimiento", values: { concepto: "cena" } }],
      },
    },
  ],
  needs: { reads: ["movimiento"], proposes: false },
};

describe("the step «Función» in the real box (task 93)", () => {
  const sockets = mkdtempSync(join(tmpdir(), "boni-caja-"));
  const socket = join(sockets, "caja.sock");
  let boxProc: ChildProcess;
  beforeAll(async () => {
    boxProc = spawn(
      process.execPath,
      [
        "--disable-warning=ExperimentalWarning",
        join(import.meta.dirname, "../../sandbox/src/main.ts"),
      ],
      {
        env: { ...process.env, BONI_SANDBOX_SOCKET: socket },
        stdio: ["ignore", "pipe", "inherit"],
      },
    );
    await new Promise<void>((resolve) => boxProc.stdout?.once("data", () => resolve()));
    process.env.BONI_SANDBOX_SOCKET = socket;
  });
  afterAll(() => {
    boxProc.kill();
    delete process.env.BONI_SANDBOX_SOCKET;
    rmSync(sockets, { recursive: true, force: true });
  });

  it("accepted, the box runs it again on its day and with its seed: the set proposed is the one made, even drawn at random", async () => {
    const { host, store } = await setUp({ real: true, manifest: sorteo });
    const plan = {
      version: 1,
      steps: [
        {
          id: "f",
          op: "call",
          tool: "function.run",
          args: { funcion: { lit: "sorteo/sortear" }, datos: { ref: "$extracto" } },
        },
        { id: "a", op: "call", tool: "function.apply", args: { cambios: { ref: "$f" } } },
      ],
    };
    const r = await host.agent(1).background(
      plan,
      {
        extracto: leaf({ lineas: ["cena", "taxi"], azar: true } as never, codeLabel("extracto")),
      },
      [],
      undefined,
      { id: "sortear-extracto", version: 1 },
    );
    expect(r.proposals).toHaveLength(1);
    const done = await host.agent(1).acceptProposal(r.proposals[0] as string, "personal");
    expect(done.status).toBe("done");
    const mov = typeOf(store, "movimiento");
    const concepto = mov.fields.find((f) => f.key === "concepto")?.id ?? "";
    const made = store.list(mov.id).map((e) => String(e.entity.values[concepto]));
    expect(made).toHaveLength(2);
    for (const c of made) expect(c).toMatch(/^(cena|taxi) · \d{4}-\d{2}-\d{2} · \d+$/);
  }, 30_000);
});
