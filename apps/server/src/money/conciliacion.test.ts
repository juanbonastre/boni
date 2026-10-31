import { type ChildProcess, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { label } from "@boni/entities";
import type { ChangeSet, FunctionInput } from "@boni/extensions";
import { manifestErrors } from "@boni/extensions";
import { openUserStore, type UserStore } from "@boni/store";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CATALOGUE } from "../extensions.ts";
import { applyChangeSet, callFunction, inputFor, type Runner, runTests } from "../functions.ts";
import { runInSandbox } from "../sandbox.ts";
import { seed, type TypeSpec } from "../seed.test-util.ts";
import { storeNotes } from "./book.ts";
import { buildConciliacion, GENERATED } from "./build.ts";
import { CONCILIACION } from "./conciliacion.ts";
import { cerrar_mes, importar, reportOf } from "./preset.ts";
import type { StatementFile } from "./reconcile.ts";
import { reconcileClose, reconcileImport } from "./service.ts";

/**
 * The reconciliation as an extension's functions (E4) gives exactly what `finanzas_import` and `finanzas_close` give:
 * on an invented account (the repo is public), today's code is run and undone, then the functions are run through
 * Boni (functions.ts) and their change sets applied, and the movements must end the same; the box gives what Node
 * gives. The equality on a copy of Juan's data comes before the functions replace the tools (docs/extensiones.md).
 */
const DAY = "2026-10-12";
const FIXTURES = join(import.meta.dirname, "testdata");
const CSV = `Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance
CARD_PAYMENT,Current,2026-09-02 10:11:12,2026-09-03 08:00:00,Spotify,-10.99,0.00,EUR,COMPLETED,100.00
CARD_PAYMENT,Current,2026-09-05 21:43:09,2026-09-06 09:00:00,La Tasca Ejemplo,-60.00,0.00,EUR,COMPLETED,40.00
CARD_PAYMENT,Current,2026-09-06 12:00:00,2026-09-07 09:00:00,Kiosko Pepe,-3.50,0.00,EUR,COMPLETED,36.50
CARD_PAYMENT,Current,2026-09-07 12:00:00,,Tienda X,-5.00,0.00,EUR,REVERTED,36.50
TRANSFER,Savings,2026-09-08 12:00:00,2026-09-08 12:00:00,To pocket,-10.00,0.00,EUR,COMPLETED,26.50
ATM,Current,2026-09-09 18:00:00,2026-09-09 18:00:00,Cash at Cajero,-20.00,1.50,EUR,COMPLETED,5.00
CARD_PAYMENT,Current,2026-09-10 09:00:00,2026-09-10 10:00:00,WWW.EJEMPLO-TIENDA.INVALID,-7.25,0.00,EUR,COMPLETED,-2.25
TOPUP,Current,2026-09-11 09:00:00,,Recarga Ejemplo,15.00,0.00,EUR,PENDING,12.75
`;
const MOV = "registros/finanzas/movimientos";
const movement = (props: string) => `---\n${props}\nstatus: pendiente\nsource: manual\n---\n\n`;
const NOTES: Record<string, string> = {
  "registros/personas/ana.md": "---\ntype: person\n---\n\n# Ana\n",
  "registros/personas/luis.md": "---\ntype: person\n---\n\n# Luis\n",
  ...Object.fromEntries(
    [
      ["comida/restaurante", "gasto"],
      ["comida/supermercado", "gasto"],
      ["suscripciones", "gasto"],
      ["otros/desconocido", "gasto"],
      ["ingreso/nomina", "ingreso"],
      ["transferencia/interna", "otro"],
    ].map(([name, tipo]) => [
      `registros/finanzas/categorias/${name?.replace("/", "-")}.md`,
      `---\nnombre: ${name}\ntipo: ${tipo}\n---\n\n# ${name}\n`,
    ]),
  ),
  "registros/finanzas/reglas/spotify.md":
    '---\ntexto: spotify\ncomercio: Spotify\ncategoria: "[[suscripciones]]"\n---\n\n# spotify\n',
  "registros/finanzas/reglas/mercadona.md":
    '---\ntexto: mercadona\ncomercio: Mercadona\ncategoria: "[[comida/supermercado]]"\n---\n\n# mercadona\n',
  [`${MOV}/cena.md`]: `${movement('date: 2026-09-05\ntime: "21:40"\namount: -60\ncurrency: EUR\nmy_share: 20\naccount: revolut\ncategory: comida/restaurante\npeople: ["[[ana]]", "[[luis]]"]\ninvited: ["[[luis]]"]\ncreated: 2026-09-05')}# Cena cumple 60,00 EUR\n`,
  [`${MOV}/prensa.md`]: `${movement('date: 2026-09-06\ntime: "11:58"\namount: -3.5\naccount: revolut\ncategory: comida/restaurante')}# Prensa 3,50 EUR\n`,
  [`${MOV}/tienda-a.md`]: `${movement("date: 2026-09-10\namount: -7.25\naccount: revolut")}# Tienda A 7,25 EUR\n`,
  [`${MOV}/tienda-b.md`]: `${movement("date: 2026-09-10\namount: -7.25\naccount: revolut")}# Tienda B 7,25 EUR\n`,
  [`${MOV}/efectivo.md`]: `${movement("date: 2026-09-12\namount: -5\naccount: efectivo\ncategory: comida/restaurante")}# Churros 5,00 EUR\n`,
  [`${MOV}/reembolso.md`]: `${movement("date: 2026-09-14\namount: 15\naccount: efectivo\ncategory: comida/restaurante")}# Reembolso 15,00 EUR\n`,
  [`${MOV}/bizum.md`]: `${movement('date: 2026-09-15\namount: 20\naccount: efectivo\ncategory: comida/restaurante\nsettles: "[[cena]]"')}# Bizum de Ana 20,00 EUR\n`,
  [`${MOV}/agosto.md`]:
    "---\ndate: 2026-08-30\namount: -9\naccount: efectivo\ncategory: comida/restaurante\nstatus: conciliado\nsource: manual\n---\n\n# Agosto 9,00 EUR\n",
  "registros/finanzas/deudas/ana-cena.md":
    '---\nperson: "[[ana]]"\nmovement: "[[cena]]"\namount: 20\ndirection: me-deben\nstatus: pendiente\ndate: 2026-09-05\n---\n\n# Ana cena\n',
};
const TYPES: TypeSpec[] = [
  { key: "persona", name: "Persona", folder: "registros/personas/", thirdParty: true },
  {
    key: "categoria",
    name: "Categorías",
    folder: "registros/finanzas/categorias/",
    fields: { nombre: "text", tipo: { type: "select", options: ["gasto", "ingreso", "otro"] } },
  },
  {
    key: "regla",
    name: "Reglas",
    folder: "registros/finanzas/reglas/",
    fields: { texto: "text", comercio: "text", categoria: { type: "relation", to: "categoria" } },
  },
  {
    key: "movimiento",
    name: "Movimiento",
    folder: `${MOV}/`,
    sensitivity: "sensitive",
    fields: {
      date: "date",
      time: "time",
      amount: "number",
      currency: "text",
      // Options, as an account may have them: the functions give and take them by name.
      account: { type: "select", options: ["revolut", "ing", "efectivo"] },
      category: { type: "relation", to: "categoria" },
      merchant: "text",
      status: { type: "select", options: ["pendiente", "conciliado"] },
      source: "text",
      bank_ref: "text",
      bank_text: "text",
      created: "date",
      people: { type: "relation", to: "persona", many: true },
      invited: { type: "relation", to: "persona", many: true },
      my_share: "number",
      settles: { type: "relation", to: "movimiento" },
    },
  },
  {
    key: "deuda",
    name: "Deuda",
    folder: "registros/finanzas/deudas/",
    sensitivity: "sensitive",
    thirdParty: true,
    fields: {
      date: "date",
      amount: "number",
      direction: "text",
      status: "text",
      person: { type: "relation", to: "persona" },
      movement: { type: "relation", to: "movimiento" },
    },
  },
];

const dir = mkdtempSync(join(tmpdir(), "boni-conciliacion-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
let n = 0;
const account = (): UserStore => {
  const store = openUserStore(join(dir, `u${++n}.db`));
  seed(store, TYPES, NOTES);
  return store;
};
const statements = (more: string[] = []): StatementFile[] => [
  { name: "2026-09-revolut.csv", bytes: Buffer.from(CSV) },
  // The same statement again (they overlap): its lines are not made twice.
  { name: "2026-09-revolut-otra-vez.csv", bytes: Buffer.from(CSV) },
  ...["ing.xls", "ing.xlsx", ...more].map((f) => ({
    name: f,
    bytes: readFileSync(join(FIXTURES, f)),
  })),
];
const asData = (files: StatementFile[]) => ({
  value: {
    files: files.map((f) => ({ name: f.name, base64: Buffer.from(f.bytes).toString("base64") })),
  },
  label: label("imported", "sensitive", [{ kind: "file", id: "extractos" }]),
});
/** The movements as the reconciliation reads them, and their texts: what both ways must leave the same. */
const movements = (store: UserStore) =>
  storeNotes(store)("t_movimiento")
    .map((m) =>
      JSON.stringify({ title: m.title, fm: m.fm, text: store.get(m.id)?.entity.body ?? null }),
    )
    .sort();
/** The stand-in box: the functions run here as the box runs them, their output as JSON. */
const inNode: Runner = async (req) => {
  const f = req.fn === "importar" ? importar : cerrar_mes;
  const out = f(req.input as FunctionInput, { day: req.day });
  return { id: req.id, ok: true, output: JSON.parse(JSON.stringify(out)), steps: 0, ms: 0 };
};
const undo = (store: UserStore, run: string) =>
  store.undoRun(run, { actor: "user", device: "portatil" });

describe("the reconciliation as an extension's functions", () => {
  it("is the code in the repo: the file the box runs is what preset.ts builds", async () => {
    expect(readFileSync(GENERATED, "utf8")).toBe(await buildConciliacion());
  });

  it("is a valid extension whose tests pass", async () => {
    expect(manifestErrors(CONCILIACION, CATALOGUE)).toEqual([]);
    expect(await runTests(CONCILIACION, inNode)).toEqual(
      (CONCILIACION.tests ?? []).map((t) => ({ function: t.function, name: t.name, ok: true })),
    );
  });

  it("imports exactly what finanzas_import imports, and asks what it leaves out", async () => {
    const store = account();
    const files = statements();
    const files$ = {
      files: () => files.map((f) => f.name),
      readBytes: (rel: string) =>
        files.find((f) => rel.endsWith(`/${f.name}`))?.bytes ?? new Uint8Array(),
    };
    const today = reconcileImport(store, files$, { apply: true, today: DAY, run: "hoy" });
    expect(today.created.length).toBeGreaterThan(4);
    expect(today.joined).toEqual(["Cena cumple 60,00 EUR", "Prensa 3,50 EUR"]);
    expect(today.unclear).toHaveLength(1);
    const want = movements(store);
    undo(store, "hoy");
    expect(movements(store)).not.toEqual(want);

    const r = await callFunction(store, CONCILIACION, "importar", {
      run: inNode,
      day: DAY,
      data: asData(files),
    });
    if (!r.ok) throw new Error(r.message);
    expect(r.changeSet.summary).toBe(`${today.created.length} nuevas, 2 unidas, 1 dudosa`);
    // Its report is today's but the line that says what was written (nothing is, until Boni applies it).
    expect(r.changeSet.report).toEqual(reportOf(today.report.slice(0, -1)));
    expect(r.changeSet.report?.join("\n")).toContain("www EJEMPLO-TIENDA.INVALID");
    const asks = r.changeSet.changes.filter((c) => c.op === "ask");
    expect(asks).toEqual([
      {
        op: "ask",
        question:
          "Línea del banco dudosa: 2026-09-10 -7.25 www EJEMPLO-TIENDA.INVALID. ¿Cuál de estas notas es?",
        options: expect.arrayContaining([
          "Tienda A 7,25 EUR",
          "Tienda B 7,25 EUR",
          "Ninguna: es otro movimiento",
        ]),
      },
    ]);
    const done = applyChangeSet(store, CONCILIACION, "importar", r.changeSet, r.label, r.read);
    if (!done.ok) throw new Error(done.message);
    expect(movements(store)).toEqual(want);
  });

  it("closes a month exactly as finanzas_close closes it", async () => {
    const store = account();
    const files = statements();
    const files$ = {
      files: () => files.map((f) => f.name),
      readBytes: (rel: string) =>
        files.find((f) => rel.endsWith(`/${f.name}`))?.bytes ?? new Uint8Array(),
    };
    reconcileImport(store, files$, { apply: true, today: DAY });
    const today = reconcileClose(store, { month: "2026-09", apply: true, run: "cierre" });
    expect(today.ready.length).toBeGreaterThan(3);
    expect(today.blocked.length).toBeGreaterThan(2);
    const want = movements(store);
    undo(store, "cierre");

    const r = await callFunction(store, CONCILIACION, "cerrar_mes", {
      run: inNode,
      day: DAY,
      data: {
        value: { month: "2026-09" },
        label: label("user", "personal", [{ kind: "user-edit", id: "portatil" }]),
      },
    });
    if (!r.ok) throw new Error(r.message);
    expect(r.changeSet.summary).toBe(
      `2026-09: ${today.ready.length} para conciliar, ${today.blocked.length} siguen pendientes`,
    );
    // Its report is today's but the two lines on what was written.
    expect(r.changeSet.report).toEqual(reportOf(today.report.slice(0, -2)));
    const done = applyChangeSet(store, CONCILIACION, "cerrar_mes", r.changeSet, r.label, r.read);
    if (!done.ok) throw new Error(done.message);
    expect(movements(store)).toEqual(want);
  });
});

describe("in the real box", () => {
  let box: ChildProcess;
  const socket = join(dir, "caja.sock");
  beforeAll(async () => {
    box = spawn(
      process.execPath,
      [
        "--disable-warning=ExperimentalWarning",
        join(import.meta.dirname, "../../../sandbox/src/main.ts"),
      ],
      {
        env: { ...process.env, BONI_SANDBOX_SOCKET: socket },
        stdio: ["ignore", "pipe", "inherit"],
      },
    );
    await new Promise<void>((resolve) => box.stdout?.once("data", () => resolve()));
    process.env.BONI_SANDBOX_SOCKET = socket;
  });
  afterAll(() => {
    box.kill();
    delete process.env.BONI_SANDBOX_SOCKET;
  });

  it("its tests pass there, and it gives there what it gives in Node, a big sheet included, well within its limits", async () => {
    expect((await runTests(CONCILIACION)).every((t) => t.ok)).toBe(true);
    const store = account();
    const fn = CONCILIACION.functions?.[0];
    if (!fn) throw new Error("no importar");
    const got = inputFor(store, fn, asData(statements(["grande.xls"])));
    if (!got.ok) throw new Error(got.message);
    const req = {
      id: "conciliacion.prueba",
      code: fn.code,
      hash: fn.hash,
      fn: "importar",
      input: got.input,
      day: DAY,
      seed: 1,
      ...(fn.limits ? { limits: fn.limits } : {}),
    };
    const [there, here] = await Promise.all([runInSandbox(req), inNode(req)]);
    if (!there.ok || !here.ok) throw new Error(there.ok ? "" : there.message);
    expect(there.output as ChangeSet).toEqual(here.output);
    expect((there.output as ChangeSet).report?.join("\n")).toContain("ERROR grande.xls");
    expect(there.steps).toBeLessThan((fn.limits?.steps ?? 0) / 4);
  }, 60_000);
});
