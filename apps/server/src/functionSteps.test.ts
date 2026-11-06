/**
 * (test) The steps «Función» and «Aplicar cambios» (task 93; Juan, 2026-11-06: «A: a la Bandeja»): an active
 * extension's function run in the box as a step of a flow; in the background its changes wait in the Bandeja as one
 * proposal, applied when Juan accepts it, in that run; «Probar» changes nothing; the checklist wants the function
 * named literally and «Aplicar cambios» over a «Función» step's result.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { codeLabel, fakePlanner, leaf, type Val } from "@boni/agent";
import { label } from "@boni/entities";
import type { ExtensionManifest, FunctionInput } from "@boni/extensions";
import { afterEach, describe, expect, it } from "vitest";
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
        values: { concepto: l },
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
  host?.close();
  host = null;
  if (dir) rmSync(dir, { recursive: true, force: true });
});

async function setUp() {
  dir = mkdtempSync(join(tmpdir(), "boni-funcion-"));
  host = new AgentHost({
    dataDir: dir,
    providers: { planner: fakePlanner([]), reader: fakePlanner([]) },
  });
  host.sandboxRun = box;
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
  await propose(store, manifest, "mcp:c", { run: box });
  expect(activate(store, "banco", "portatil")).toBe(true);
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
    const rows = (p.view as { rows: { arg: string; value: string }[] }).rows;
    expect(rows.find((x) => x.arg === "cambios.resumen")?.value).toBe("2 nuevos");
    expect(rows.find((x) => x.arg === "cambios.nuevas")?.value).toBe("2");
    expect(rows.some((x) => x.arg === "cambios.conjunto")).toBe(false);
    expect(inboxCard(store, p).title).toBe("2 nuevos");
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
  });
});
