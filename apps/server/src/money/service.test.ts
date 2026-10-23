import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { openUserStore, type UserStore } from "@boni/store";
import { CORE_MARK, importVault } from "@boni/vault-import";
import { afterEach, describe, expect, it } from "vitest";
import { mcpAnswer } from "../mcp.ts";
import { StoreMoney } from "../v1/storeMoney.ts";
import { storeNotes } from "./book.ts";
import { categoryRows, moneyCollections, ruleRows } from "./collections.ts";

/**
 * The reconciliation on Boni's own movements, through Boni's MCP as Claude uses it: an invented vault imported into
 * a store (the movements in core mode), its statements read from the vault, the movements made in the store.
 */
const FILES: Record<string, string> = {
  "registros/finanzas/categorias.md":
    "---\ntype: index\ncategories:\n  - comida/restaurante\n  - ingreso/nomina\n  - suscripciones\n  - otros/desconocido\n---\n\n# Categorias\n\n| Categoria | Que va | Ejemplos |\n|---|---|---|\n| suscripciones | pagos periodicos | Spotify, Ejemplo Cloud |\n\n| Categoria | Que va |\n|---|---|\n| ingreso/nomina | la nomina |\n",
  "registros/finanzas/reglas.csv":
    "pattern,merchant,category,notes\nspotify,Spotify,suscripciones,la musica\n",
  "registros/personas/ana.md": "---\ntype: person\n---\n\n# Ana\n",
  "registros/finanzas/movimientos/2026/09/2026-09-05-2140-cena-cumple.md":
    '---\ntype: movement\ndate: 2026-09-05\ntime: "21:40"\namount: -60.00\ncurrency: EUR\nmy_share: 30.00\naccount: revolut\ncategory: comida/restaurante\nmerchant:\nconcept: "Cena cumple"\npeople: ["[[ana]]"]\nstatus: pendiente\nsource: manual\nbank_ref:\ncreated: 2026-09-05\n---\n\n# Cena cumple 60,00 EUR\n',
  "registros/finanzas/deudas/2026-09-05-ana-cena.md":
    '---\ntype: debt\nperson: "[[ana]]"\nmovement: "[[2026-09-05-2140-cena-cumple]]"\namount: 30.00\ndirection: me-deben\nstatus: pendiente\ndate: 2026-09-05\n---\n\n# Ana cena\n',
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

function env(core = true): { root: string; store: UserStore } {
  const root = mkdtempSync(join(tmpdir(), "boni-money-"));
  for (const [p, t] of Object.entries(FILES)) {
    mkdirSync(dirname(join(root, p)), { recursive: true });
    writeFileSync(join(root, p), t);
  }
  const store = openUserStore(":memory:");
  importVault(root, store, { apply: true });
  if (core) store.setSetting(`${CORE_MARK}t_movimiento`, "vault");
  cleanups.push(() => {
    store.close();
    rmSync(root, { recursive: true, force: true });
  });
  return { root, store };
}
let n = 0;
function call(e: { root: string; store: UserStore }, name: string, args: Record<string, unknown>) {
  const out = mcpAnswer(
    e.store,
    "portatil",
    { jsonrpc: "2.0", id: ++n, method: "tools/call", params: { name, arguments: args } },
    () => Date.UTC(2026, 9, 12),
  ) as { result: { content: { text: string }[]; isError: boolean } };
  const text = out.result.content[0]?.text ?? "";
  return { isError: out.result.isError, text, json: out.result.isError ? null : JSON.parse(text) };
}
const movements = (s: UserStore) => {
  const t = s.schema().types.t_movimiento;
  const by = (name: string) => t?.fields.find((f) => f.name === name)?.id as string;
  return s.list("t_movimiento").map((x) => ({
    title: x.entity.values[t?.titleField as string],
    ref: x.entity.values[by("bank_ref")],
    // An option by its name, or the text itself (a field with one value in the vault is text).
    status:
      t?.fields
        .find((f) => f.name === "status")
        ?.options?.find((o) => o.id === x.entity.values[by("status")])?.name ??
      x.entity.values[by("status")],
    path: x.entity.values.f_vault_path,
    label: x.labels[by("bank_ref")]?.integrity,
  }));
};

describe("the reconciliation in Boni (MCP finanzas_import / finanzas_close)", () => {
  it("dry run first, then the movements made in Boni, the app's joined; the month closed; all undone whole", () => {
    const e = env();
    const dry = call(e, "finanzas_import", {});
    expect(dry.json.output).toContain("2026-09-revolut.csv: revolut, 3 lineas");
    expect(dry.json.output).toContain("Unidas a notas de la app: 1; notas nuevas: 2");
    expect(movements(e.store)).toHaveLength(1);

    const done = call(e, "finanzas_import", { dry_run: false });
    expect(done.json).toMatchObject({ created: 2, joined: 1 });
    const ms = movements(e.store);
    expect(ms).toHaveLength(3);
    const spotify = ms.find(
      (m) => m.path === "registros/finanzas/movimientos/2026/09/2026-09-02-1011-spotify.md",
    );
    // Titled by its heading, as the vault's import would; the statement's values as imported from it.
    expect(spotify).toMatchObject({
      title: "Spotify 10,99 EUR",
      status: "pendiente",
      label: "imported",
    });
    expect(String(ms.find((m) => m.title === "Cena cumple 60,00 EUR")?.ref)).toMatch(/^rev-/);
    // Again: nothing new (the same lines are known by their reference).
    expect(call(e, "finanzas_import", { dry_run: false }).json).toMatchObject({
      created: 0,
      joined: 0,
    });

    const close = call(e, "finanzas_close", { month: "2026-09", dry_run: false });
    expect(close.json.output).toContain("listos para conciliar: 2; siguen pendientes: 1");
    expect(close.json.output).toContain("sin categoria");
    expect(close.json.output).toContain("Te deben: ana 30,00 EUR");
    const after = movements(e.store);
    expect(
      after
        .filter((m) => m.status === "conciliado")
        .map((m) => m.title)
        .sort(),
    ).toEqual(["Cena cumple 60,00 EUR", "Spotify 10,99 EUR"]);
    // Each applied call is one run: undone whole.
    expect(call(e, "undo", { run: close.json.run }).json.undone).toBe(2);
    expect(movements(e.store).every((m) => m.status === "pendiente")).toBe(true);
    call(e, "undo", { run: done.json.run });
    expect(movements(e.store)).toHaveLength(1);
  });

  it("reads a statement uploaded to Boni (upload_file), never over another file or as a note", () => {
    const e = env();
    const csv = `Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance
CARD_PAYMENT,Current,2026-10-02 10:11:12,2026-10-03 08:00:00,Spotify,-10.99,0.00,EUR,COMPLETED,90.00
`;
    const path = "registros/finanzas/extractos/2026-10-revolut.csv";
    const up = call(e, "upload_file", {
      path,
      content_base64: Buffer.from(csv).toString("base64"),
    });
    expect(up.json.bytes).toBe(csv.length);
    expect(call(e, "finanzas_import", {}).json.output).toContain(
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
      expect(call(e, "upload_file", { path: bad, content_base64: b64 }).isError).toBe(true);
    expect(call(e, "upload_file", { path: "a/b.csv", content_base64: "" }).isError).toBe(true);
    // One run, undone whole: the statement is gone again.
    call(e, "undo", { run: up.json.run });
    expect(call(e, "finanzas_import", {}).json.output).not.toContain("2026-10-revolut.csv");
  });

  it("moves the categories and rules into collections; the movements point to their category; undone whole", () => {
    const e = env();
    const CENA = "registros/finanzas/movimientos/2026/09/2026-09-05-2140-cena-cumple.md";
    const category = () =>
      storeNotes(e.store)("t_movimiento", "movement").map((n) => [n.path, n.fm.category]);
    // A category a movement uses that the list does not have: it becomes a row too.
    call(e, "set_properties", { path: CENA, properties: { category: "ocio/salidas" } });

    const dry = moneyCollections(e.store, { apply: false });
    expect(dry.report.join("\n")).toContain(
      "Categorias: 5 (4 de registros/finanzas/categorias.md, 2 con su explicacion)",
    );
    expect(dry.report.join("\n")).toContain(
      "sin estar en la lista (se crean igual): ocio/salidas (1)",
    );
    expect(dry.run).toBeNull();
    expect(categoryRows(e.store)).toBeNull();

    const done = moneyCollections(e.store, { apply: true });
    expect(categoryRows(e.store)).toEqual([
      { name: "comida/restaurante", kind: "gasto" },
      { name: "ingreso/nomina", kind: "ingreso" },
      { name: "ocio/salidas", kind: "gasto" },
      { name: "otros/desconocido", kind: "gasto" },
      { name: "suscripciones", kind: "gasto" },
    ]);
    const subs = e.store.entities("t_categoria").find((x) => x.values.f_nombre === "suscripciones");
    expect(subs?.values).toMatchObject({
      f_que_va: "pagos periodicos",
      f_ejemplos: "Spotify, Ejemplo Cloud",
    });
    expect(ruleRows(e.store)).toEqual([["spotify", "Spotify", "suscripciones"]]);
    expect(e.store.entities("t_regla")[0]?.values.f_notas).toBe("la musica");
    // The file is in the trash: its rules are rows now.
    expect(e.store.findByValue("f_vault_path", "registros/finanzas/reglas.csv")).toEqual([]);
    expect(category()).toEqual([[CENA, "ocio/salidas"]]);
    const mov = e.store.schema().types.t_movimiento;
    expect(mov?.fields.find((f) => f.name === "category")?.type).toBe("relation");
    expect(new StoreMoney(e.store).categories()).toContain("ocio/salidas");
    expect(new StoreMoney(e.store).categoryKinds().get("ingreso/nomina")).toBe("ingreso");
    expect(() => moneyCollections(e.store, { apply: true })).toThrow("already uses");

    // The reconciliation reads them: Spotify by its rule, into the row of suscripciones.
    const imported = call(e, "finanzas_import", { dry_run: false });
    expect(imported.json).toMatchObject({ created: 2, joined: 1 });
    expect(Object.fromEntries(category())).toMatchObject({
      "registros/finanzas/movimientos/2026/09/2026-09-02-1011-spotify.md": "suscripciones",
      "registros/finanzas/movimientos/2026/09/2026-09-06-1200-kiosko-pepe.md": "otros/desconocido",
    });
    expect(call(e, "finanzas_close", { month: "2026-09" }).json.output).toContain(
      "listos para conciliar: 2; siguen pendientes: 1",
    );
    // A category set by its name through the MCP, as Claude does in the reconciliation.
    const set = call(e, "set_properties", {
      path: CENA,
      properties: { category: "comida/restaurante" },
    });
    expect(Object.fromEntries(category())[CENA]).toBe("comida/restaurante");

    // Undone (the later runs first; while they are in effect the move is not undone): the text as it was, no
    // collections, the file back.
    expect(() => e.store.undoRun(done.run as string, { actor: "user" })).toThrow("changed since");
    call(e, "undo", { run: set.json.run });
    call(e, "undo", { run: imported.json.run });
    e.store.undoRun(done.run as string, { actor: "user" });
    expect(categoryRows(e.store)).toBeNull();
    expect(
      e.store.schema().types.t_movimiento?.fields.find((f) => f.name === "category")?.type,
    ).toBe("text");
    expect(e.store.findByValue("f_vault_path", "registros/finanzas/reglas.csv")).toHaveLength(1);
    expect(ruleRows(e.store)).toBeNull();
    expect(category()).toEqual([[CENA, "ocio/salidas"]]);
    // And moved again, into the same (emptied) collections.
    moneyCollections(e.store, { apply: true });
    expect(categoryRows(e.store)).toHaveLength(5);
    expect(ruleRows(e.store)).toEqual([["spotify", "Spotify", "suscripciones"]]);
  });

  it("refuses while the movements still live in the vault, and without a month", () => {
    const e = env(false);
    expect(call(e, "finanzas_import", {})).toMatchObject({ isError: true });
    expect(call(e, "finanzas_import", {}).text).toContain("aun viven en el vault");
    expect(call(env(), "finanzas_close", { month: "septiembre" }).isError).toBe(true);
    // Movimientos kept from the models: not read through here either.
    const shut = env();
    shut.store.setAiAccess("t_movimiento", "restricted", "portatil");
    expect(call(shut, "finanzas_import", {}).text).toContain("kept from the models");
  });
});
