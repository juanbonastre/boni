import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type Book,
  closeMonth,
  importStatements,
  type MoneyNote,
  matchRule,
  type NewMovement,
  type PropValue,
  parseRules,
  prettyMerchant,
  type Rule,
  UNKNOWN,
} from "./reconcile.ts";
import { parseDt, parseNum, readRows } from "./sheets.ts";

/**
 * The reconciliation ported from finanzas.py, checked with the script's own tests (invented statements and
 * records, never real ones: the repo is public). The book here is plain records by id, as Boni keeps them: a
 * relation (people, a debt's movement and person, what a movement settles) holds ids.
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
/** What Juan noted in the app: a dinner with Ana and Luis, Luis invited. */
const CENA: Record<string, unknown> = {
  date: "2026-09-05",
  time: "21:40",
  amount: -60,
  currency: "EUR",
  my_share: 20,
  account: "revolut",
  category: "comida/restaurante",
  merchant: null,
  concept: "Cena cumple",
  people: ["p_ana", "p_luis"],
  invited: ["p_luis"],
  status: "pendiente",
  source: "manual",
  bank_ref: null,
  created: "2026-09-05",
};
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

interface Rec {
  kind: "movement" | "debt";
  title: string;
  fm: Record<string, unknown>;
  body: string;
}
/** Movements and debts by id, and the people they name. */
class RecordsBook implements Book {
  records = new Map<string, Rec>([
    ["m_cena", { kind: "movement", title: "Cena cumple 60,00 EUR", fm: { ...CENA }, body: "" }],
  ]);
  people = new Map([
    ["p_ana", "Ana"],
    ["p_luis", "Luis"],
  ]);
  made: string[] = [];
  private of(kind: Rec["kind"]): MoneyNote[] {
    return [...this.records.entries()]
      .filter(([, r]) => r.kind === kind)
      .map(([id, r]) => ({ id, title: r.title, fm: { ...r.fm } }));
  }
  movements = () => this.of("movement");
  debts = () => this.of("debt");
  title = (id: string) => this.records.get(id)?.title ?? this.people.get(id) ?? "";
  create(m: NewMovement) {
    const id = `m_new${this.made.length + 1}`;
    this.records.set(id, { kind: "movement", title: m.title, fm: { ...m.values }, body: m.body });
    this.made.push(id);
    return id;
  }
  update(id: string, props: Record<string, PropValue>) {
    const r = this.records.get(id);
    if (r) Object.assign(r.fm, props);
  }
  fm = (id: string) => this.records.get(id)?.fm as Record<string, unknown>;
  /** The movement made from the bank line with that text. */
  byBank = (text: string) =>
    [...this.records.entries()].find(([, r]) => r.fm.bank_text === text)?.[0] as string;
}
const csv = (name: string, text: string) => ({ name, bytes: Buffer.from(text, "utf8") });
const run = (book: Book, files: { name: string; bytes: Buffer }[], apply = true) =>
  importStatements(book, files, { rules: RULES, apply, today: TODAY });

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

  it("merchant names in ASCII", () => {
    expect(prettyMerchant("Pastelería La Mallorquina")).toBe("Pasteleria La Mallorquina");
    expect(prettyMerchant("ZARA MURCIA*123")).toBe("Zara Murcia 123");
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
    const book = new RecordsBook();
    const res = run(book, [csv("2026-09-revolut.csv", REVOLUT_EN)]);
    expect(res.joined).toEqual(["Cena cumple 60,00 EUR"]);
    expect(res.created).toHaveLength(3);
    const app = book.fm("m_cena");
    expect(String(app.bank_ref)).toMatch(/^rev-/);
    expect(app).toMatchObject({
      bank_text: "La Tasca Ejemplo",
      merchant: "La Tasca Ejemplo",
      status: "pendiente",
      concept: "Cena cumple",
    });
    const spotify = book.fm(book.byBank("Spotify"));
    expect([spotify.category, spotify.merchant, spotify.amount, spotify.source]).toEqual([
      "suscripciones",
      "Spotify",
      -10.99,
      "revolut",
    ]);
    expect(book.records.get(book.byBank("Spotify"))?.title).toBe("Spotify 10,99 EUR");
    expect(book.fm(book.byBank("Kiosko Pepe")).category).toBe(UNKNOWN);
    const atm = book.byBank("Cash at Cajero");
    expect(book.fm(atm).amount).toBe(-21.5); // the fee included
    expect(book.records.get(atm)?.body).toContain("comision");
    expect(
      res.report.some((l) => l.includes("sin completar (entrara en el proximo extracto) 1")),
    ).toBe(true);
    expect(res.created.some((t) => /vpn/i.test(t))).toBe(false);
  });

  it("is idempotent: the same lines in an overlapping statement change nothing", () => {
    const book = new RecordsBook();
    run(book, [csv("2026-09-revolut.csv", REVOLUT_EN)]);
    const before = JSON.stringify([...book.records]);
    const res = run(book, [
      csv("2026-09-revolut.csv", REVOLUT_EN),
      csv("2026-09b-revolut.csv", REVOLUT_EN),
    ]);
    expect([res.created, res.joined, res.unclear]).toEqual([[], [], []]);
    expect(JSON.stringify([...book.records])).toBe(before);
  });

  it("a dry run writes nothing", () => {
    const book = new RecordsBook();
    const before = JSON.stringify([...book.records]);
    expect(run(book, [csv("2026-09-revolut.csv", REVOLUT_EN)], false).created).toHaveLength(3);
    expect(JSON.stringify([...book.records])).toBe(before);
  });

  it("Spanish Revolut headers", () => {
    const book = new RecordsBook();
    expect(run(book, [csv("2026-09-revolut.csv", REVOLUT_ES)]).created).toHaveLength(1);
    const n = book.fm(book.byBank("MERCADONA AV EJEMPLO"));
    expect([n.amount, n.category, n.bank_text]).toEqual([
      -23.45,
      "comida/supermercado",
      "MERCADONA AV EJEMPLO",
    ]);
  });

  it("an unclear join is not imported; the closest note wins", () => {
    const book = new RecordsBook();
    book.records.set("m_otra", {
      kind: "movement",
      title: "Otra cena 60,00 EUR",
      fm: { ...CENA, concept: "Otra cena" },
      body: "",
    });
    const res = run(book, [csv("2026-09-revolut.csv", REVOLUT_EN)]);
    expect(res.unclear).toHaveLength(1);
    expect(res.joined).toHaveLength(0);
    expect(res.created.some((t) => /tasca/i.test(t))).toBe(false);
    expect(res.report.some((l) => l.includes("DUDOSA") && l.includes("Otra cena 60,00 EUR"))).toBe(
      true,
    );

    const near = new RecordsBook();
    near.records.set("m_lejos", {
      kind: "movement",
      title: "Lejos 60,00 EUR",
      fm: { ...CENA, date: "2026-09-07", concept: "Lejos" },
      body: "",
    });
    const r2 = run(near, [csv("2026-09-revolut.csv", REVOLUT_EN)]);
    expect(r2.joined).toEqual(["Cena cumple 60,00 EUR"]);
    expect(r2.unclear).toEqual([]);
  });

  it("ING: the old .xls and the .xlsx, same text and amount kept apart by the balance", () => {
    for (const f of ["ing.xls", "ing.xlsx"]) {
      const book = new RecordsBook();
      const res = run(book, [{ name: f, bytes: readFileSync(join(FIXTURES, f)) }]);
      expect(res.created, f).toHaveLength(4);
      const made = book.made.map((id) => book.fm(id));
      const merc = made.filter((m) => m.merchant === "Mercadona");
      expect(merc).toHaveLength(2);
      expect(new Set(merc.map((m) => m.bank_ref)).size).toBe(2);
      expect(merc.every((m) => m.account === "ing" && m.category === "comida/supermercado")).toBe(
        true,
      );
      expect(merc.map((m) => m.amount).sort()).toEqual([-30.55, -30.55]);
      const nomina = book.made.find((id) => /nomina/i.test(book.records.get(id)?.title ?? ""));
      expect(book.fm(nomina as string)).toMatchObject({ date: "2026-09-30", amount: 1500 });
      expect(book.records.get(nomina as string)?.body).toContain(
        "Categoria segun ING: Nómina y otras prestaciones > Nómina.",
      );
    }
  });

  it("a file it does not understand is reported, never guessed", () => {
    const book = new RecordsBook();
    const res = run(book, [csv("otra-cosa.csv", "a,b,c\n1,2,3\n")]);
    expect(res.created).toEqual([]);
    expect(res.report.some((l) => l.startsWith("ERROR otra-cosa.csv"))).toBe(true);
  });
});

describe("closing a month", () => {
  const prepared = () => {
    const book = new RecordsBook();
    run(book, [csv("2026-09-revolut.csv", REVOLUT_EN)]);
    return book;
  };
  const close = (book: Book, apply = true) =>
    closeMonth(book, "2026-09", { cats: CATS, rules: RULES, apply });

  it("marks the complete ones conciliado and says what the rest need, naming people", () => {
    const book = prepared();
    const res = close(book);
    expect(res.ready).toEqual(["Spotify 10,99 EUR"]);
    const why = Object.fromEntries(res.blocked);
    expect(why["Cena cumple 60,00 EUR"]).toEqual(["faltan deudas de: Ana"]);
    expect(why["Kiosko Pepe 3,50 EUR"]).toEqual(["sin categoria"]);
    expect(book.fm(book.byBank("Spotify")).status).toBe("conciliado");
  });

  it("a debt and a category unblock them; it says who owes and suggests rules", () => {
    const book = prepared();
    book.records.set("d_ana", {
      kind: "debt",
      title: "Ana: cena 20,00 EUR",
      fm: {
        person: "p_ana",
        movement: "m_cena",
        amount: 20,
        direction: "me-deben",
        status: "pendiente",
        date: "2026-09-05",
      },
      body: "",
    });
    book.update(book.byBank("Kiosko Pepe"), {
      category: "comida/restaurante",
      merchant: "Kiosko Pepe",
    });
    const res = close(book);
    expect(res.ready).toEqual(
      expect.arrayContaining(["Cena cumple 60,00 EUR", "Kiosko Pepe 3,50 EUR"]),
    );
    expect(res.report.some((l) => l.startsWith("Te deben: Ana 20,00 EUR"))).toBe(true);
    expect(
      res.report.some((l) => l.includes("Kiosko Pepe  ->  Kiosko Pepe, comida/restaurante")),
    ).toBe(true);
  });

  it("money in of a spending category needs what it settles, and that record must exist", () => {
    const book = prepared();
    const bizum = {
      date: "2026-09-08",
      amount: 20,
      account: "revolut",
      category: "comida/restaurante",
      people: ["p_ana"],
      status: "pendiente",
      source: "revolut",
      bank_ref: "rev-x",
      created: "2026-10-12",
    };
    book.records.set("m_bizum", { kind: "movement", title: "Bizum Ana", fm: bizum, body: "" });
    book.records.set("m_bizum2", {
      kind: "movement",
      title: "Bizum Ana otra vez",
      fm: { ...bizum, bank_ref: "rev-y", settles: "d_no_esta" },
      body: "",
    });
    const why = Object.fromEntries(close(book, false).blocked);
    expect(why["Bizum Ana"]?.[0]).toContain("sin settles");
    expect(why["Bizum Ana otra vez"]).toEqual([
      "settles apunta a un registro que no existe: d_no_esta",
    ]);
  });
});
