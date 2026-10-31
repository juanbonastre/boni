import { sha1Hex } from "./bytes.ts";
import { type Cell, parseDt, parseNum, type Row } from "./sheets.ts";

/**
 * Bank statements as lines (ported from `finanzas.py`, 2026-10-23): the bank is told by the headers, never by the
 * file name; Revolut (English or Spanish headers) and ING España. Every line gets a reference made from what the
 * bank says of it, so the same line in two overlapping statements is the same line.
 */
export interface BankLine {
  account: "revolut" | "ing";
  date: string;
  time: string;
  amount: number;
  currency: string;
  text: string;
  ref: string;
  body: string[];
  kind: string;
}
export interface Statement {
  bank: "revolut" | "ing";
  lines: BankLine[];
  skipped: Map<string, number>;
  products: Map<string, number>;
}

/** Lower case ASCII without accents (how texts are compared). */
export const asciiLow = (s: unknown) =>
  String(s ?? "")
    .normalize("NFKD")
    .replace(/[^\p{ASCII}]/gu, "")
    .toLowerCase();
/** Python's "%.2f" (both round the exact binary value; bank amounts have cents, so no ties). */
const fixed2 = (x: number) => x.toFixed(2);

/** Field → column, comparing headers without case, accents or symbols ("importe*" matches a prefix). */
function headerMap(row: Row, aliases: Record<string, string[]>): Map<string, number> {
  const norm = row.map((h) =>
    asciiLow(h)
      .replace(/[^a-z0-9. ]/g, "")
      .trim(),
  );
  const out = new Map<string, number>();
  for (const [field, names] of Object.entries(aliases))
    norm.forEach((h, i) => {
      if (out.has(field)) return;
      if (names.some((n) => h === n || (n.endsWith("*") && h.startsWith(n.slice(0, -1)))))
        out.set(field, i);
    });
  return out;
}

function makeRef(prefix: string, parts: string[], seen: Map<string, number>): string {
  let key = parts.join("|");
  const n = (seen.get(key) ?? 0) + 1;
  seen.set(key, n);
  if (n > 1) key += `#${n}`;
  return prefix + sha1Hex(key).slice(0, 12);
}

const REVOLUT: Record<string, string[]> = {
  type: ["type", "tipo"],
  product: ["product", "producto"],
  started: ["started date", "fecha de inicio"],
  completed: ["completed date", "fecha de finalizacion", "fecha de fin"],
  description: ["description", "descripcion"],
  amount: ["amount", "importe", "cantidad"],
  fee: ["fee", "comision", "tarifa"],
  currency: ["currency", "divisa", "moneda"],
  state: ["state", "estado"],
  balance: ["balance", "saldo"],
};
const REVOLUT_WAIT = new Set(["pending", "pendiente"]);
const REVOLUT_SKIP = new Set(
  "reverted declined failed cancelled canceled revertida revertido rechazada rechazado fallida fallido cancelada cancelado".split(
    " ",
  ),
);
const REVOLUT_SKIP_PRODUCTS = ["saving", "ahorro", "deposit", "deposito", "hucha", "vault"];
const ING: Record<string, string[]> = {
  date: ["f. valor", "f.valor", "fecha valor", "fecha", "fecha operacion", "f. operacion"],
  description: ["descripcion", "concepto", "descripcion de la operacion"],
  amount: ["importe*"],
  balance: ["saldo*"],
  category: ["categoria"],
  subcategory: ["subcategoria"],
  comment: ["comentario"],
};

const inc = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
const getter =
  (r: Row, hdr: Map<string, number>) =>
  (k: string): Cell => {
    const i = hdr.get(k);
    return i !== undefined && i < r.length ? (r[i] as Cell) : "";
  };
const blank = (r: Row) => !r.some((x) => String(x).trim());
const euro = (x: number) => fixed2(Math.abs(x)).replace(".", ",");

function parseRevolut(rows: Row[], hdr: Map<string, number>): Omit<Statement, "bank"> {
  const lines: BankLine[] = [];
  const skipped = new Map<string, number>();
  const products = new Map<string, number>();
  const seen = new Map<string, number>();
  for (const r of rows) {
    if (blank(r)) continue;
    const g = getter(r, hdr);
    const state = asciiLow(g("state")).trim();
    const product = String(g("product")).trim();
    inc(products, product || "?");
    if (REVOLUT_SKIP.has(state)) {
      inc(skipped, `estado ${state}`);
      continue;
    }
    if (REVOLUT_WAIT.has(state)) {
      // The amount may still change (pre-authorisations): it comes in once completed.
      inc(skipped, "sin completar (entrara en el proximo extracto)");
      continue;
    }
    if (REVOLUT_SKIP_PRODUCTS.some((w) => asciiLow(product).includes(w))) {
      inc(skipped, `producto ${product}`);
      continue;
    }
    const [date, hhmm, hhmmss] = parseDt(g("started") || g("completed"));
    const fee = Math.abs(parseNum(g("fee")));
    const amount = parseNum(g("amount")) - fee;
    const text = String(g("description")).split(/\s+/).filter(Boolean).join(" ");
    const currency = String(g("currency")).trim().toUpperCase() || "EUR";
    const ref = makeRef(
      "rev-",
      [date, hhmmss, asciiLow(text), fixed2(parseNum(g("amount"))), currency],
      seen,
    );
    lines.push({
      account: "revolut",
      date,
      time: hhmm,
      amount: Math.round(amount * 100) / 100,
      currency,
      text,
      ref,
      body: fee > 0 ? [`Incluye comision de ${euro(fee)} ${currency}.`] : [],
      kind: String(g("type")).trim(),
    });
  }
  return { lines, skipped, products };
}

function parseIng(rows: Row[], hdr: Map<string, number>): Omit<Statement, "bank"> {
  const lines: BankLine[] = [];
  const skipped = new Map<string, number>();
  const seen = new Map<string, number>();
  for (const r of rows) {
    const g = getter(r, hdr);
    if (blank(r) || String(g("amount")).trim() === "") continue;
    let date: string;
    try {
      [date] = parseDt(g("date"));
    } catch {
      inc(skipped, "fila sin fecha");
      continue;
    }
    const amount = parseNum(g("amount"));
    const text = String(g("description")).split(/\s+/).filter(Boolean).join(" ");
    const balance = String(g("balance")).trim() ? fixed2(parseNum(g("balance"))) : "";
    const ref = makeRef("ing-", [date, asciiLow(text), fixed2(amount), balance], seen);
    const body: string[] = [];
    const cat = [String(g("category")).trim(), String(g("subcategory")).trim()]
      .filter(Boolean)
      .join(" > ");
    if (cat) body.push(`Categoria segun ING: ${cat}.`);
    if (String(g("comment")).trim()) body.push(`Comentario en ING: ${String(g("comment")).trim()}`);
    lines.push({
      account: "ing",
      date,
      time: "",
      amount: Math.round(amount * 100) / 100,
      currency: "EUR",
      text,
      ref,
      body,
      kind: "",
    });
  }
  return { lines, skipped, products: new Map() };
}

/** A statement's lines; throws, with its first rows, when neither bank's columns are there. */
export function parseStatement(rows: Row[]): Statement {
  for (const [i, row] of rows.slice(0, 30).entries()) {
    let hdr = headerMap(row, REVOLUT);
    if (hdr.has("started") && hdr.has("amount") && hdr.has("description"))
      return { bank: "revolut", ...parseRevolut(rows.slice(i + 1), hdr) };
    hdr = headerMap(row, ING);
    if (hdr.has("date") && hdr.has("amount") && hdr.has("description"))
      return { bank: "ing", ...parseIng(rows.slice(i + 1), hdr) };
  }
  const preview = rows
    .slice(0, 12)
    .map((row, i) =>
      row.length ? `    fila ${i + 1}: ${row.map((x) => String(x).slice(0, 30)).join(" | ")}` : "",
    )
    .filter(Boolean);
  throw new Error(
    `no reconozco las columnas (ni Revolut ni ING). Primeras filas:\n${preview.join("\n")}`,
  );
}
