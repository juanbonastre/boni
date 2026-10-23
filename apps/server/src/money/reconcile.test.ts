import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseNote, patchNote } from "@boni/calendar";
import { describe, expect, it } from "vitest";
import {
  type Book,
  closeMonth,
  importStatements,
  linkName,
  MOV,
  type MoneyNote,
  matchRule,
  parseRules,
  prettyMerchant,
  type Rule,
  UNKNOWN,
} from "./reconcile.ts";
import { parseDt, parseNum, readRows } from "./sheets.ts";

/**
 * The reconciliation ported from finanzas.py, checked with the script's own tests (invented statements and
 * notes, never real ones: the repo is public). The book here is plain note texts by path.
 */
const TODAY = "2026-10-12";
const CATS = [
  "comida/restaurante",
  "comida/supermercado",
  "suscripciones",
  "otros/desconocido",
  "ingreso/nomina",
  "transferencia/interna",
];
const RULES = parseRules(
  "pattern,merchant,category,notes\nspotify,Spotify,suscripciones,\nmercadona,Mercadona,comida/supermercado,\n",
);
const APP_NOTE = `---
type: movement
date: 2026-09-05
time: "21:40"
amount: -60.00
currency: EUR
my_share: 20.00
account: revolut
category: comida/restaurante
merchant:
concept: "Cena cumple"
people: ["[[ana]]", "[[luis]]"]
invited: ["[[luis]]"]
related: []
status: pendiente
source: manual
bank_ref:
created: 2026-09-05
---

# Cena cumple 60,00 EUR
`;
const REVOLUT_EN = `Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance
CARD_PAYMENT,Current,2026-09-02 10:11:12,2026-09-03 08:00:00,Spotify,-10.99,0.00,EUR,COMPLETED,100.00
CARD_PAYMENT,Current,2026-09-05 21:43:09,2026-09-06 09:00:00,La Tasca Ejemplo,-60.00,0.00,EUR,COMPLETED,40.00
CARD_PAYMENT,Current,2026-09-06 12:00:00,2026-09-07 09:00:00,Kiosko Pepe,-3.50,0.00,EUR,COMPLETED,36.50
CARD_PAYMENT,Current,2026-09-07 12:00:00,,Tienda X,-5.00,0.00,EUR,REVERTED,36.50
TRANSFER,Savings,2026-09-08 12:00:00,2026-09-08 12:00:00,To pocket,-10.00,0.00,EUR,COMPLETED,26.50
ATM,Current,2026-09-09 18:00:00,2026-09-09 18:00:00,Cash at Cajero,-20.00,1.50,EUR,COMPLETED,5.00
Card Payment,Current,2026-09-10 18:35:01,,VPN Ejemplo,-60.00,0.00,EUR,PENDING,
`;
const REVOLUT_ES = `Tipo;Producto;Fecha de inicio;Fecha de finalización;Descripción;Importe;Comisión;Divisa;State;Saldo
Pago con tarjeta;Actual;2026-09-10 09:30:00;2026-09-11 09:00:00;MERCADONA AV EJEMPLO;-23,45;0,00;EUR;COMPLETADO;10,00
`;
const FIXTURES = join(import.meta.dirname, "testdata");

/** Movement and debt notes by path, as the vault had them. */
class NotesBook implements Book {
  notes = new Map<string, string>([[`${MOV}/2026/09/2026-09-05-2140-cena-cumple.md`, APP_NOTE]]);
  private of(prefix: string, type: string): MoneyNote[] {
    return [...this.notes.entries()]
      .filter(([p]) => p.startsWith(prefix))
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([p, t]) => ({ id: p, path: p, fm: parseNote(t).values as Record<string, unknown> }))
      .filter((n) => n.fm.type === type);
  }
  movements = () => this.of(MOV, "movement");
  debts = () => this.of("registros/finanzas/deudas", "debt");
  taken = (p: string) => this.notes.has(p);
  create(path: string, text: string) {
    this.notes.set(path, text);
  }
  update(id: string, props: Record<string, string | number | boolean | null>) {
    this.notes.set(id, patchNote(this.notes.get(id) as string, props));
  }
  fm = (p: string) => parseNote(this.notes.get(p) as string).values as Record<string, unknown>;
}
const csv = (name: string, text: string) => ({ name, bytes: Buffer.from(text, "utf8") });
const run = (book: Book, files: { name: string; bytes: Buffer }[], apply = true) =>
  importStatements(book, files, { rules: RULES, apply, today: TODAY });
const base = (p: string) => p.split("/").pop();

describe("helpers (finanzas.py's)", () => {
  it("reads numbers and dates as banks write them", () => {
    expect(parseNum("-12,50")).toBe(-12.5);
    expect(parseNum("1.234,56")).toBe(1234.56);
    expect(parseNum("1,234.56")).toBe(1234.56);
    expect(parseNum("-3.5")).toBe(-3.5);
    expect(parseNum("12,00 EUR")).toBe(12);
    expect(parseNum(-7)).toBe(-7);
    expect(parseDt("2026-09-05 21:43:09")).toEqual(["2026-09-05", "21:43", "21:43:09"]);
    expect(parseDt("05/09/2026")).toEqual(["2026-09-05", "", ""]);
    expect(parseDt(46270)[0]).toBe("2026-09-05");
  });

  it("rules: an exact one with =, the longest that fits", () => {
    const rules: Rule[] = [
      ["ucam universidad", "Cafeteria UCAM", "comida/cafeteria-ucam"],
      ["=dia", "Dia", "comida/supermercado"],
      ["ucam", "UCAM", "comida/cafeteria-ucam"],
    ];
    expect(matchRule(rules, "Dia")?.[1]).toBe("Dia");
    expect(matchRule(rules, "Media Markt Dia")).toBeNull();
    expect(matchRule(rules, "UCAM Universidad Católica de Murcia")?.[1]).toBe("Cafeteria UCAM");
  });

  it("merchant names in ASCII, links by their note", () => {
    expect(prettyMerchant("Pastelería La Mallorquina")).toBe("Pasteleria La Mallorquina");
    expect(prettyMerchant("ZARA MURCIA*123")).toBe("Zara Murcia 123");
    expect(linkName("[[registros/personas/ana|Ana]]")).toBe("ana");
    expect(linkName("ana")).toBe("ana");
  });

  it("an old .xls with a large shared-string table (strings across records, UTF-16 and compressed)", () => {
    const rows = readRows(readFileSync(join(FIXTURES, "grande.xls")), "grande.xls");
    expect(rows).toHaveLength(402);
    for (const r of [0, 7, 199, 399]) {
      expect(rows[r]?.[0]).toBe(`fila ${r} ${"x".repeat(r % 50)}`);
      expect(rows[r]?.[1]).toBe(`ñandú ${r} €${"é".repeat(r % 37)}`);
      expect(rows[r]?.[2]).toBe(r * 1.25 - 100);
      expect(rows[r]?.[3]).toBe(r);
    }
    expect(rows[400]?.[0]).toBe("A".repeat(9000));
    expect(rows[401]?.[0]).toBe("Ü".repeat(5000));
  });
});

describe("importing statements", () => {
  it("Revolut: joins the app's note, applies the rules, leaves out reverted, savings and pending", () => {
    const book = new NotesBook();
    const res = run(book, [csv("2026-09-revolut.csv", REVOLUT_EN)]);
    expect(res.joined).toHaveLength(1);
    expect(res.created).toHaveLength(3);
    const app = book.fm(`${MOV}/2026/09/2026-09-05-2140-cena-cumple.md`);
    expect(String(app.bank_ref)).toMatch(/^rev-/);
    expect(app).toMatchObject({
      bank_text: "La Tasca Ejemplo",
      merchant: "La Tasca Ejemplo",
      status: "pendiente",
      concept: "Cena cumple",
    });
    const spotify = book.fm(`${MOV}/2026/09/2026-09-02-1011-spotify.md`);
    expect([spotify.category, spotify.merchant, spotify.amount, spotify.source]).toEqual([
      "suscripciones",
      "Spotify",
      -10.99,
      "revolut",
    ]);
    expect(book.fm(`${MOV}/2026/09/2026-09-06-1200-kiosko-pepe.md`).category).toBe(UNKNOWN);
    const atm = `${MOV}/2026/09/2026-09-09-1800-cash-at-cajero.md`;
    expect(book.fm(atm).amount).toBe(-21.5); // the fee included
    expect(book.notes.get(atm)).toContain("comision");
    expect(
      res.report.some((l) => l.includes("sin completar (entrara en el proximo extracto) 1")),
    ).toBe(true);
    expect(res.created.some((p) => p.includes("vpn"))).toBe(false);
  });

  it("is idempotent: the same lines in an overlapping statement change nothing", () => {
    const book = new NotesBook();
    run(book, [csv("2026-09-revolut.csv", REVOLUT_EN)]);
    const before = new Map(book.notes);
    const res = run(book, [
      csv("2026-09-revolut.csv", REVOLUT_EN),
      csv("2026-09b-revolut.csv", REVOLUT_EN),
    ]);
    expect([res.created, res.joined, res.unclear]).toEqual([[], [], []]);
    expect(book.notes).toEqual(before);
  });

  it("a dry run writes nothing", () => {
    const book = new NotesBook();
    const before = new Map(book.notes);
    expect(run(book, [csv("2026-09-revolut.csv", REVOLUT_EN)], false).created).toHaveLength(3);
    expect(book.notes).toEqual(before);
  });

  it("Spanish Revolut headers", () => {
    const book = new NotesBook();
    expect(run(book, [csv("2026-09-revolut.csv", REVOLUT_ES)]).created).toHaveLength(1);
    const n = book.fm(`${MOV}/2026/09/2026-09-10-0930-mercadona.md`);
    expect([n.amount, n.category, n.bank_text]).toEqual([
      -23.45,
      "comida/supermercado",
      "MERCADONA AV EJEMPLO",
    ]);
  });

  it("an unclear join is not imported; the closest note wins", () => {
    const book = new NotesBook();
    book.notes.set(
      `${MOV}/2026/09/2026-09-05-2140-otra-cena.md`,
      APP_NOTE.replace('concept: "Cena cumple"', 'concept: "Otra cena"'),
    );
    const res = run(book, [csv("2026-09-revolut.csv", REVOLUT_EN)]);
    expect(res.unclear).toHaveLength(1);
    expect(res.joined).toHaveLength(0);
    expect(res.created.some((p) => p.includes("tasca"))).toBe(false);
    expect(res.report.some((l) => l.includes("DUDOSA"))).toBe(true);

    const near = new NotesBook();
    near.notes.set(
      `${MOV}/2026/09/2026-09-07-2140-lejos.md`,
      APP_NOTE.replace("date: 2026-09-05", "date: 2026-09-07").replace(
        'concept: "Cena cumple"',
        'concept: "Lejos"',
      ),
    );
    const r2 = run(near, [csv("2026-09-revolut.csv", REVOLUT_EN)]);
    expect(r2.joined.map(base)).toEqual(["2026-09-05-2140-cena-cumple.md"]);
    expect(r2.unclear).toEqual([]);
  });

  it("ING: the old .xls and the .xlsx, same text and amount kept apart by the balance", () => {
    for (const f of ["ing.xls", "ing.xlsx"]) {
      const book = new NotesBook();
      const res = run(book, [{ name: f, bytes: readFileSync(join(FIXTURES, f)) }]);
      expect(res.created, f).toHaveLength(4);
      const merc = res.created.filter((p) => p.includes("mercadona")).map((p) => book.fm(p));
      expect(merc).toHaveLength(2);
      expect(new Set(merc.map((m) => m.bank_ref)).size).toBe(2);
      expect(merc.every((m) => m.account === "ing" && m.category === "comida/supermercado")).toBe(
        true,
      );
      expect(merc.map((m) => m.amount).sort()).toEqual([-30.55, -30.55]);
      const nomina = res.created.find((p) => p.includes("nomina")) as string;
      expect(book.fm(nomina)).toMatchObject({ date: "2026-09-30", amount: 1500 });
      expect(book.notes.get(nomina)).toContain(
        "Categoria segun ING: Nómina y otras prestaciones > Nómina.",
      );
    }
  });

  it("a file it does not understand is reported, never guessed", () => {
    const book = new NotesBook();
    const res = run(book, [csv("otra-cosa.csv", "a,b,c\n1,2,3\n")]);
    expect(res.created).toEqual([]);
    expect(res.report.some((l) => l.startsWith("ERROR otra-cosa.csv"))).toBe(true);
  });
});

describe("closing a month", () => {
  const prepared = () => {
    const book = new NotesBook();
    run(book, [csv("2026-09-revolut.csv", REVOLUT_EN)]);
    return book;
  };
  const close = (book: Book, apply = true) =>
    closeMonth(book, "2026-09", { cats: CATS, rules: RULES, apply });

  it("marks the complete ones conciliado and says what the rest need", () => {
    const book = prepared();
    const res = close(book);
    expect(res.ready.map(base)).toEqual(["2026-09-02-1011-spotify.md"]);
    const why = Object.fromEntries(res.blocked.map(([p, r]) => [base(p), r]));
    expect(why["2026-09-05-2140-cena-cumple.md"]).toEqual(["faltan deudas de: ana"]);
    expect(why["2026-09-06-1200-kiosko-pepe.md"]).toEqual(["sin categoria"]);
    expect(book.fm(`${MOV}/2026/09/2026-09-02-1011-spotify.md`).status).toBe("conciliado");
  });

  it("a debt and a category unblock them; it says who owes and suggests rules", () => {
    const book = prepared();
    book.notes.set(
      "registros/finanzas/deudas/2026-09-05-ana-cena-cumple.md",
      '---\ntype: debt\nperson: "[[ana]]"\nmovement: "[[2026-09-05-2140-cena-cumple]]"\namount: 20.00\ndirection: me-deben\nstatus: pendiente\nsettled_by: \ndate: 2026-09-05\n---\n\n# Ana cena\n',
    );
    book.update(`${MOV}/2026/09/2026-09-06-1200-kiosko-pepe.md`, {
      category: "comida/restaurante",
      merchant: "Kiosko Pepe",
    });
    const res = close(book);
    expect(res.ready.map(base)).toEqual(
      expect.arrayContaining(["2026-09-05-2140-cena-cumple.md", "2026-09-06-1200-kiosko-pepe.md"]),
    );
    expect(res.report.some((l) => l.startsWith("Te deben: ana 20,00 EUR"))).toBe(true);
    expect(
      res.report.some((l) => l.includes("Kiosko Pepe  ->  Kiosko Pepe, comida/restaurante")),
    ).toBe(true);
  });

  it("money in of a spending category needs what it settles", () => {
    const book = prepared();
    book.notes.set(
      `${MOV}/2026/09/2026-09-08-bizum-ana.md`,
      '---\ntype: movement\ndate: 2026-09-08\namount: 20.00\naccount: revolut\ncategory: comida/restaurante\npeople: ["[[ana]]"]\nstatus: pendiente\nsource: revolut\nbank_ref: rev-x\ncreated: 2026-10-12\n---\n',
    );
    const why = Object.fromEntries(close(book, false).blocked.map(([p, r]) => [base(p), r]));
    expect(why["2026-09-08-bizum-ana.md"]?.[0]).toContain("sin settles");
  });
});
