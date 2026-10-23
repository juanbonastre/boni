import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { CORE_MARK } from "@boni/mirror";
import { openUserStore } from "@boni/store";
import { importVault } from "@boni/vault-import";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDb } from "../db.ts";
import { captureScreen, validateCapture } from "./capture.ts";
import { CATALOG, DEFAULT_CHARTS, normalizeSpec } from "./contract.ts";
import { money, parseDec, share } from "./decimal.ts";
import { Finanzas, parseCategories, parseDebt, parseMovement } from "./finanzas.ts";
import { baseName, render, slug } from "./note.ts";
import { V1Service } from "./service.ts";
import { V1Store } from "./store.ts";
import { StoreMoney } from "./storeMoney.ts";

/**
 * The port against the ORIGINAL Python server: golden/v1.json is what legacy/boni/server answered for
 * the same cases (golden/make_golden.py). Every value must be the same.
 */
const golden = JSON.parse(readFileSync(new URL("./golden/v1.json", import.meta.url), "utf8"));
const CATS = [
  "comida/restaurante",
  "comida/supermercado",
  "bebida/cafe",
  "ingreso/nomina",
  "transferencia/ahorro",
  "ocio/cine",
];
const PEOPLE = new Set(["lucia-ferri", "tomas", "pablo-soler-gil"]);

describe("the Boni API v1 gives the Python server's answers", () => {
  it("the capture form, the chart catalogue and the default charts", () => {
    expect(captureScreen(null)).toEqual(golden.screen);
    expect(captureScreen("revolut")).toEqual(golden.screen_revolut);
    expect(CATALOG).toEqual(golden.catalog);
    expect(DEFAULT_CHARTS()).toEqual(golden.default_charts);
  });

  it("reads chart definitions as the Pydantic model did, old keys upgraded", () => {
    for (const s of golden.specs) expect(normalizeSpec(s.raw), s.raw.title).toEqual(s.spec);
  });

  it("checks a capture and writes the same note", () => {
    for (const c of golden.captures) {
      const created = c.created_at
        ? { date: c.created_at.slice(0, 10), time: c.created_at.slice(11, 16) }
        : null;
      const { draft, errors } = validateCapture(c.values, {
        categories: c.lists ? CATS : null,
        people: c.lists ? PEOPLE : null,
        createdAt: created,
        today: c.today,
      });
      const what = JSON.stringify(c.values);
      expect(errors, what).toEqual(c.errors);
      if (c.note === undefined) expect(draft, what).toBeNull();
      else {
        expect(draft, what).not.toBeNull();
        if (!draft) continue;
        expect(baseName(draft), what).toBe(c.base_name);
        expect(render(draft, "2026-10-19"), what).toBe(c.note);
      }
    }
  });

  it("shares, names, categories, movements and debts", () => {
    for (const s of golden.shares)
      expect(money(share(parseDec(s.amount) ?? { n: 0n, scale: 0 }, s.people, s.invited))).toBe(
        s.share,
      );
    for (const s of golden.slugs) expect(slug(s.text, s.max), s.text).toBe(s.slug);
    for (const c of golden.categories) expect(parseCategories(c.text)).toEqual(c.categories);
    for (const m of golden.movements) expect(parseMovement(m.row), m.row.path).toEqual(m.movement);
    for (const d of golden.debts) expect(parseDebt(d.row), d.row.path).toEqual(d.debt);
  });

  describe("option lists, over an invented vault", () => {
    let dir: string;
    let svc: V1Service;
    const write = (rel: string, text: string) => {
      mkdirSync(dirname(join(dir, rel)), { recursive: true });
      writeFileSync(join(dir, rel), text);
    };
    beforeAll(() => {
      dir = mkdtempSync(join(tmpdir(), "boni-v1-"));
      write(
        "registros/finanzas/categorias.md",
        `---\ntype: wiki\ncategories:\n${CATS.map((c) => `  - ${c}`).join("\n")}\n---\n`,
      );
      write("registros/personas/lucia-ferri.md", "---\ntype: person\nsummary: Amiga\n---\n");
      write("registros/personas/tomas.md", "---\ntype: person\n---\n");
      for (const m of golden.movements_for_options) {
        const related = m.related.length
          ? `related:\n${m.related.map((r: string) => `  - "[[${r}]]"`).join("\n")}\n`
          : "related: []\n";
        write(
          `registros/finanzas/movimientos/${m.date.slice(0, 4)}/${m.date.slice(5, 7)}/${m.name}.md`,
          `---\ntype: movement\ndate: ${m.date}\namount: ${m.amount}\ncategory: ${m.category}\nmerchant: "${m.merchant}"\n${related}status: ${m.status}\nsource: ${m.source}\n---\n`,
        );
      }
      svc = new V1Service({
        store: new V1Store(openDb(":memory:")),
        tz: "Europe/Madrid",
        writable: false,
        now: () => Date.UTC(2026, 9, 19, 10, 0),
      });
    });
    afterAll(() => rmSync(dir, { recursive: true, force: true }));

    it("are the same lists, in the same order", () => {
      const caller = { account: 1, device: "prueba", vault: dir };
      for (const o of golden.options)
        expect(svc.options(caller, o.source, o.q, o.limit), `${o.source} ${o.q}`).toEqual(
          o.options,
        );
    });

    it("and the same from Boni itself once the vault is imported (no vault: Juan, 2026-10-23)", () => {
      // A debt too, so both lists are compared.
      write(
        "registros/finanzas/deudas/2026-10-01-lucia-ferri-cena.md",
        '---\ntype: debt\ndate: 2026-10-01\nmovement: "[[2026-10-01-cena]]"\namount: 12.5\ndirection: me-deben\nstatus: pendiente\n---\n',
      );
      const store = openUserStore(":memory:");
      importVault(dir, store, { apply: true });
      store.setSetting(`${CORE_MARK}t_movimiento`, "1");
      const own = new StoreMoney(store);
      const vault = new Finanzas(dir);
      // Relations are sets in Boni: their order inside one movement does not count.
      const sets = (l: ReturnType<typeof vault.movements>) =>
        l.map((m) => ({
          ...m,
          people: [...(m.people ?? [])].sort(),
          invited: [...(m.invited ?? [])].sort(),
          related: [...(m.related ?? [])].sort(),
        }));
      expect(sets(own.movements())).toEqual(sets(vault.movements()));
      expect(own.debts()).toEqual(vault.debts());
      expect([...own.categories()].sort()).toEqual([...vault.categories()].sort());
      expect(own.people()).toEqual(vault.people());
      const fromBoni = new V1Service({
        store: new V1Store(openDb(":memory:")),
        tz: "Europe/Madrid",
        writable: false,
        now: () => Date.UTC(2026, 9, 19, 10, 0),
        moneyOf: () => own,
      });
      const caller = { account: 1, device: "prueba", vault: "" };
      // Boni keeps a list as a set: the categories (and their groups) come in alphabetical order, not in
      // categorias.md's (a known, accepted difference); every other list is the Python server's, in its order.
      const byValue = (l: { value: string }[]) =>
        [...l].sort((a, b) => (a.value < b.value ? -1 : a.value > b.value ? 1 : 0));
      for (const o of golden.options) {
        const got = fromBoni.options(caller, o.source, o.q, o.limit) as { value: string }[];
        if (o.source === "categories" || o.source === "groups")
          expect(byValue(got), `${o.source} ${o.q}`).toEqual(byValue(o.options));
        else expect(got, `${o.source} ${o.q}`).toEqual(o.options);
      }
      store.close();
    });
  });
});
