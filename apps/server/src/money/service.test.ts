import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { openUserStore, type UserStore } from "@boni/store";
import { CORE_MARK, importVault } from "@boni/vault-import";
import { afterEach, describe, expect, it } from "vitest";
import { mcpAnswer } from "../mcp.ts";

/**
 * The reconciliation on Boni's own movements, through Boni's MCP as Claude uses it: an invented vault imported into
 * a store (the movements in core mode), its statements read from the vault, the movements made in the store.
 */
const FILES: Record<string, string> = {
  "registros/finanzas/categorias.md":
    "---\ntype: index\ncategories:\n  - comida/restaurante\n  - suscripciones\n  - otros/desconocido\n---\n\n# Categorias\n",
  "registros/finanzas/reglas.csv":
    "pattern,merchant,category,notes\nspotify,Spotify,suscripciones,\n",
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
    e.root,
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
