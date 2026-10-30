import { openUserStore, type UserStore } from "@boni/store";
import { afterEach, describe, expect, it } from "vitest";
import { mcpAnswer } from "../mcp.ts";
import { seed, type TypeSpec } from "../seed.test-util.ts";
import { StoreMoney } from "../v1/storeMoney.ts";
import { storeNotes } from "./book.ts";
import { categoryRows, ruleRows } from "./collections.ts";

/**
 * The reconciliation on Boni's own movements, through Boni's MCP as Claude uses it: invented money in a store (the
 * statements rows of "Archivos", the categories and rules rows of their collections), the movements made there.
 */
const CENA = "registros/finanzas/movimientos/2026-09-05-2140-cena-cumple.md";
const FILES: Record<string, string> = {
  "registros/finanzas/categorias/comida-restaurante.md":
    "---\nnombre: comida/restaurante\ntipo: gasto\n---\n\n# comida/restaurante\n",
  "registros/finanzas/categorias/ingreso-nomina.md":
    "---\nnombre: ingreso/nomina\ntipo: ingreso\n---\n\n# ingreso/nomina\n",
  "registros/finanzas/categorias/suscripciones.md":
    "---\nnombre: suscripciones\ntipo: gasto\nque_va: pagos periodicos\n---\n\n# suscripciones\n",
  "registros/finanzas/categorias/otros-desconocido.md":
    "---\nnombre: otros/desconocido\ntipo: gasto\n---\n\n# otros/desconocido\n",
  "registros/finanzas/reglas/spotify.md":
    '---\ntexto: spotify\ncomercio: Spotify\ncategoria: "[[suscripciones]]"\nnotas: la musica\n---\n\n# spotify\n',
  "registros/personas/ana.md": "---\ntype: person\n---\n\n# Ana\n",
  [CENA]:
    '---\ndate: 2026-09-05\ntime: "21:40"\namount: -60.00\ncurrency: EUR\nmy_share: 30.00\naccount: revolut\ncategory: comida/restaurante\nmerchant:\nconcept: "Cena cumple"\npeople: ["[[ana]]"]\nstatus: pendiente\nsource: manual\nbank_ref:\ncreated: 2026-09-05\n---\n\n# Cena cumple 60,00 EUR\n',
  "registros/finanzas/deudas/2026-09-05-ana-cena.md":
    '---\nperson: "[[ana]]"\nmovement: "[[2026-09-05-2140-cena-cumple]]"\namount: 30.00\ndirection: me-deben\nstatus: pendiente\ndate: 2026-09-05\n---\n\n# Ana cena\n',
  "registros/finanzas/extractos/2026-09-revolut.csv": `Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance
CARD_PAYMENT,Current,2026-09-02 10:11:12,2026-09-03 08:00:00,Spotify,-10.99,0.00,EUR,COMPLETED,100.00
CARD_PAYMENT,Current,2026-09-05 21:43:09,2026-09-06 09:00:00,La Tasca Ejemplo,-60.00,0.00,EUR,COMPLETED,40.00
CARD_PAYMENT,Current,2026-09-06 12:00:00,2026-09-07 09:00:00,Kiosko Pepe,-3.50,0.00,EUR,COMPLETED,36.50
`,
};

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
});

const TYPES: TypeSpec[] = [
  { key: "persona", name: "Persona", folder: "registros/personas/", thirdParty: true },
  {
    key: "categoria",
    name: "Categorías",
    folder: "registros/finanzas/categorias/",
    fields: { tipo: { type: "select", options: ["gasto", "ingreso", "otro"] } },
  },
  {
    key: "regla",
    name: "Reglas",
    folder: "registros/finanzas/reglas/",
    fields: { categoria: { type: "relation", to: "categoria" } },
  },
  {
    key: "movimiento",
    name: "Movimiento",
    folder: "registros/finanzas/movimientos/",
    sensitivity: "sensitive",
    fields: {
      date: "date",
      category: { type: "relation", to: "categoria" },
      people: { type: "relation", to: "persona", many: true },
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
      person: { type: "relation", to: "persona" },
      movement: { type: "relation", to: "movimiento" },
    },
  },
  { key: "nota", name: "Nota", folder: "" },
  { key: "archivo", name: "Archivos", folder: "registros/finanzas/", files: true },
];

/** The money in Boni, and each invented note's record; without `movements`, an account that keeps none there. */
function env(movements = true): { store: UserStore; ids: Map<string, string> } {
  const store = openUserStore(":memory:");
  const types = movements
    ? TYPES
    : TYPES.filter((t) => t.key !== "movimiento" && t.key !== "deuda");
  const files = movements
    ? FILES
    : Object.fromEntries(
        Object.entries(FILES).filter(([p]) => !/\/(movimientos|deudas)\//.test(p)),
      );
  const ids = seed(store, types, files);
  cleanups.push(() => store.close());
  return { store, ids };
}
let n = 0;
async function call(e: { store: UserStore }, name: string, args: Record<string, unknown>) {
  const out = (await mcpAnswer(
    e.store,
    "portatil",
    { jsonrpc: "2.0", id: ++n, method: "tools/call", params: { name, arguments: args } },
    () => Date.UTC(2026, 9, 12),
  )) as { result: { content: { text: string }[]; isError: boolean } };
  const text = out.result.content[0]?.text ?? "";
  return { isError: out.result.isError, text, json: out.result.isError ? null : JSON.parse(text) };
}
const movements = (s: UserStore) => {
  const t = s.schema().types.t_movimiento;
  const by = (name: string) => t?.fields.find((f) => f.name === name)?.id as string;
  return s.list("t_movimiento").map((x) => ({
    title: x.entity.values[t?.titleField as string],
    ref: x.entity.values[by("bank_ref")],
    // An option by its name, or the text itself (a field with one value as it came in is text).
    status:
      t?.fields
        .find((f) => f.name === "status")
        ?.options?.find((o) => o.id === x.entity.values[by("status")])?.name ??
      x.entity.values[by("status")],
    label: x.labels[by("bank_ref")]?.integrity,
  }));
};

describe("the reconciliation in Boni (MCP finanzas_import / finanzas_close)", () => {
  it("dry run first, then the movements made in Boni, the app's joined; the month closed; all undone whole", async () => {
    const e = env();
    const dry = await call(e, "finanzas_import", {});
    expect(dry.json.output).toContain("2026-09-revolut.csv: revolut, 3 lineas");
    expect(dry.json.output).toContain("Unidas a notas de la app: 1; notas nuevas: 2");
    expect(movements(e.store)).toHaveLength(1);

    const done = await call(e, "finanzas_import", { dry_run: false });
    expect(done.json).toMatchObject({ created: 2, joined: 1 });
    const ms = movements(e.store);
    expect(ms).toHaveLength(3);
    const spotify = ms.find((m) => m.title === "Spotify 10,99 EUR");
    // Titled by its merchant and amount; the statement's values as imported from it.
    expect(spotify).toMatchObject({
      title: "Spotify 10,99 EUR",
      status: "pendiente",
      label: "imported",
    });
    expect(String(ms.find((m) => m.title === "Cena cumple 60,00 EUR")?.ref)).toMatch(/^rev-/);
    // Again: nothing new (the same lines are known by their reference).
    expect((await call(e, "finanzas_import", { dry_run: false })).json).toMatchObject({
      created: 0,
      joined: 0,
    });

    const close = await call(e, "finanzas_close", { month: "2026-09", dry_run: false });
    expect(close.json.output).toContain("listos para conciliar: 2; siguen pendientes: 1");
    expect(close.json.output).toContain("sin categoria");
    expect(close.json.output).toContain("Te deben: Ana 30,00 EUR");
    const after = movements(e.store);
    expect(
      after
        .filter((m) => m.status === "conciliado")
        .map((m) => m.title)
        .sort(),
    ).toEqual(["Cena cumple 60,00 EUR", "Spotify 10,99 EUR"]);
    // Each applied call is one run: undone whole.
    expect((await call(e, "undo", { run: close.json.run })).json.undone).toBe(2);
    expect(movements(e.store).every((m) => m.status === "pendiente")).toBe(true);
    await call(e, "undo", { run: done.json.run });
    expect(movements(e.store)).toHaveLength(1);
  });

  it("reads a statement uploaded to Boni (upload_file), never over another file or as a note", async () => {
    const e = env();
    const csv = `Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance
CARD_PAYMENT,Current,2026-10-02 10:11:12,2026-10-03 08:00:00,Spotify,-10.99,0.00,EUR,COMPLETED,90.00
`;
    const path = "registros/finanzas/extractos/2026-10-revolut.csv";
    const up = await call(e, "upload_file", {
      path,
      content_base64: Buffer.from(csv).toString("base64"),
    });
    expect(up.json.bytes).toBe(csv.length);
    expect((await call(e, "finanzas_import", {})).json.output).toContain(
      "2026-10-revolut.csv: revolut, 1 lineas",
    );
    const b64 = Buffer.from("x").toString("base64");
    for (const bad of [
      path,
      "registros/finanzas/nota.md",
      "private/a.csv",
      "registros/../a.csv",
      "/abs.csv",
      "sin-extension",
    ])
      expect((await call(e, "upload_file", { path: bad, content_base64: b64 })).isError).toBe(true);
    expect((await call(e, "upload_file", { path: "a/b.csv", content_base64: "" })).isError).toBe(
      true,
    );
    // One run, undone whole: the statement is gone again.
    await call(e, "undo", { run: up.json.run });
    expect((await call(e, "finanzas_import", {})).json.output).not.toContain("2026-10-revolut.csv");
  });

  it("reads the categories and rules from their collections; a category set by its name points to its row", async () => {
    const e = env();
    const category = () =>
      Object.fromEntries(
        storeNotes(e.store)("t_movimiento").map((n) => [n.title, n.fm.category] as const),
      );
    expect(categoryRows(e.store)).toEqual([
      { name: "comida/restaurante", kind: "gasto" },
      { name: "ingreso/nomina", kind: "ingreso" },
      { name: "otros/desconocido", kind: "gasto" },
      { name: "suscripciones", kind: "gasto" },
    ]);
    expect(ruleRows(e.store)).toEqual([["spotify", "Spotify", "suscripciones"]]);
    expect(new StoreMoney(e.store).categoryKinds().get("ingreso/nomina")).toBe("ingreso");
    // The charts name people by their names, and a movement and a debt by their records.
    const [cena] = new StoreMoney(e.store).movements();
    expect(cena).toMatchObject({ name: e.ids.get(CENA), people: ["Ana"] });
    expect(new StoreMoney(e.store).debts()[0]?.movement).toBe(e.ids.get(CENA));
    expect(new StoreMoney(e.store).people().map((p) => p.label)).toEqual(["Ana"]);

    // The reconciliation reads them: Spotify by its rule, into the row of suscripciones.
    const imported = await call(e, "finanzas_import", { dry_run: false });
    expect(imported.json).toMatchObject({ created: 2, joined: 1 });
    expect(category()).toMatchObject({
      "Spotify 10,99 EUR": "suscripciones",
      "Kiosko Pepe 3,50 EUR": "otros/desconocido",
    });
    // A category set by its name through the MCP, as Claude does in the reconciliation.
    await call(e, "set_properties", {
      id: e.ids.get(CENA),
      properties: { category: "ingreso/nomina" },
    });
    expect(category()["Cena cumple 60,00 EUR"]).toBe("ingreso/nomina");
  });

  it("refuses without the movements in Boni, and without a month", async () => {
    const e = env(false);
    expect(await call(e, "finanzas_import", {})).toMatchObject({ isError: true });
    expect((await call(e, "finanzas_import", {})).text).toContain("no tiene movimientos en Boni");
    expect((await call(env(), "finanzas_close", { month: "septiembre" })).isError).toBe(true);
    // Movimientos kept from the models: not read through here either.
    const shut = env();
    shut.store.setAiAccess("t_movimiento", "restricted", "portatil");
    expect((await call(shut, "finanzas_import", {})).text).toContain("kept from the models");
  });
});
