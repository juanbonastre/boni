/**
 * The reconciliation as an extension's functions (docs/extensiones.md, E4): the code of `finanzas_import` and
 * `finanzas_close` (reconcile.ts) over the rows Boni gives a function instead of the store, so that it runs in the
 * box. `importar` reads the statements its flow gives it (`data.files`: each its name and its bytes in base64) and
 * gives back the new movements, what the joined notes gain and a question for each doubtful line; `cerrar_mes` gives
 * back the movements of a month (`data.month`, or of every month) to mark `conciliado`. Neither writes anything: Boni
 * checks and applies the change set (functions.ts). Built into one file for the box with what it imports
 * (conciliacion.gen.js, build.ts), so nothing of Node's may be in it.
 */
import type { Change, ChangeSet, FunctionInput } from "@boni/extensions";
import type { CategoryKind } from "@boni/views";
import { fromBase64 } from "./bytes.ts";
import {
  type Book,
  byName,
  type MoneyNote,
  type NewMovement,
  type PropValue,
  planClose,
  planImport,
  type Rule,
  rulePattern,
  type StatementFile,
  sortRules,
} from "./reconcile.ts";
import { asciiLow } from "./statements.ts";

/** The reconciliation's properties of a movement and of a debt, by name; each field's key is its name's. */
export const MOVEMENT = [
  "date",
  "time",
  "amount",
  "currency",
  "account",
  "category",
  "merchant",
  "status",
  "source",
  "bank_ref",
  "bank_text",
  "created",
  "people",
  "invited",
  "my_share",
  "settles",
] as const;
export const DEBT = ["movement", "person", "amount", "direction", "status"] as const;
/** A field's key from its name, as Boni makes it (`bank_ref` → `bank-ref`). */
export const keyOf = (name: string) => name.replace(/_/g, "-");

type Row = { id: string; version: number; values: Record<string, unknown> };
const one = (v: unknown) => (Array.isArray(v) ? v[0] : v);
const LINK = /^\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]$/;
/** A category's kind by its option's name; one it does not know, by the category's name (collections.ts). */
const KIND: Record<string, CategoryKind> = {
  gasto: "gasto",
  ingreso: "ingreso",
  otro: "otro",
  "ni gasto ni ingreso": "otro",
};

/** The account as the reconciliation reads it, from the rows: its book, its categories and kinds, its rules. */
function accountOf(input: FunctionInput) {
  const list = (k: string): Row[] => input.rows?.[k] ?? [];
  const titles = new Map<string, string>();
  for (const rows of Object.values(input.rows ?? {}))
    for (const r of rows) titles.set(r.id, String(r.values.$title ?? ""));
  const categories = list("categoria");
  const nombre = new Map(categories.map((c) => [c.id, String(c.values.nombre ?? "")]));
  // A relation to Categorías by the row's id or by its title (the first of each), as Boni's byName.ts finds it.
  const byTitle = new Map<string, string>();
  for (const c of categories) {
    const t = String(c.values.$title ?? "")
      .trim()
      .toLowerCase();
    if (t && !byTitle.has(t)) byTitle.set(t, c.id);
  }
  const categoryId = (v: string): string | null => {
    const s = v.trim();
    if (!s) return null;
    if (nombre.has(s)) return s;
    return byTitle.get((LINK.exec(s)?.[1]?.trim() ?? s).toLowerCase()) ?? null;
  };
  const fm = (r: Row, names: readonly string[]) => {
    const out: Record<string, unknown> = {};
    for (const n of names) out[n] = r.values[keyOf(n)] ?? null;
    return out;
  };
  const movements: MoneyNote[] = list("movimiento").map((r) => {
    const f = fm(r, MOVEMENT);
    // A movement's category is read as the row's name (book.ts).
    const c = one(f.category);
    f.category = typeof c === "string" && nombre.has(c) ? nombre.get(c) || null : null;
    return { id: r.id, title: String(r.values.$title ?? ""), fm: f };
  });
  const debts: MoneyNote[] = list("deuda").map((r) => ({
    id: r.id,
    title: String(r.values.$title ?? ""),
    fm: fm(r, DEBT),
  }));
  const kinds = categories
    .map((c) => {
      const name = String(c.values.nombre ?? "").trim();
      return { name, kind: KIND[asciiLow(c.values.tipo).trim()] ?? byName(name) };
    })
    .filter((c) => c.name)
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const kindOf = new Map(kinds.map((c) => [c.name, c.kind]));
  const rules = sortRules(
    list("regla").map(
      (r): Rule => [
        rulePattern(String(r.values.texto ?? "")),
        String(r.values.comercio ?? "").trim(),
        typeof r.values.categoria === "string" ? (titles.get(r.values.categoria) ?? "") : "",
      ],
    ),
  ).filter((r) => r[0]);
  const never = () => {
    throw new Error("una función no escribe: devuelve sus cambios");
  };
  const book: Book = {
    movements: () => movements,
    debts: () => debts,
    title: (id) => titles.get(id) ?? "",
    create: never,
    update: never,
  };
  const versions = new Map(list("movimiento").map((r) => [r.id, r.version]));
  /** Properties by name as a change's values by key, skipping what Boni's byName.ts skips. */
  const valuesOf = (props: Record<string, PropValue>) => {
    const out: Record<string, unknown> = {};
    for (const [n, v] of Object.entries(props)) {
      if (v === null || v === "" || (Array.isArray(v) && !v.length)) continue;
      out[keyOf(n)] = n === "category" ? categoryId(String(v)) : v;
    }
    return out;
  };
  return {
    book,
    cats: kinds.map((c) => c.name),
    rules,
    kindOf: (category: string) => kindOf.get(category) ?? byName(category),
    create: (m: NewMovement): Change => ({
      op: "create",
      collection: "movimiento",
      values: { $title: m.title, ...valuesOf(m.values), ...(m.body ? { $text: m.body } : {}) },
    }),
    update: (id: string, props: Record<string, PropValue>): Change => ({
      op: "update",
      id,
      version: versions.get(id) ?? 0,
      values: valuesOf(props),
    }),
  };
}

/**
 * Text as Boni shows a function's: one plain line, never a link or markup (what would read as one is broken up), its
 * spaces as they are (the report lines up its columns with them).
 */
export function plain(s: string, max = 300): string {
  const t = s
    .replace(/(https?):\/\//gi, "$1 ")
    .replace(/www\./gi, "www ")
    .replace(/<(?=\s*\/?\s*[a-z!])/gi, "‹")
    .replace(/\]\(/g, "] (")
    .replace(/(javascript|data):/gi, "$1 ")
    .replace(/[\t\n\v\f\r]+/g, " ")
    .trimEnd();
  const cut = t.length > max ? `${t.slice(0, max - 1)}…` : t;
  return cut.trim() ? cut : "?";
}

/** The report as a function's: one line each, plain, at most as many as a change set takes. */
export function reportOf(lines: string[], max = 200): string[] {
  const out = lines
    .flatMap((l) => l.split("\n"))
    .filter((l) => l.trim())
    .map((l) => plain(l));
  return out.length > max
    ? [...out.slice(0, max - 1), `… y ${out.length - max + 1} líneas más`]
    : out;
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function filesOf(data: unknown): StatementFile[] {
  const files = (data as { files?: unknown } | null | undefined)?.files;
  if (files === undefined || files === null) return [];
  if (!Array.isArray(files)) throw new Error("data.files: una lista de extractos { name, base64 }");
  return files.map((f: { name?: unknown; base64?: unknown } | null, i) => {
    if (typeof f?.name !== "string" || typeof f.base64 !== "string")
      throw new Error(`data.files[${i}]: { name, base64 }`);
    return { name: f.name, bytes: fromBase64(f.base64) };
  });
}

/** The statements' new lines as movements, joined with the app's notes; the doubtful ones as questions. */
export function importar(input: FunctionInput, ctx: { day: string }): ChangeSet {
  const a = accountOf(input);
  const files = filesOf(input.data);
  const plan = planImport(a.book, files, { rules: a.rules, today: ctx.day });
  const asks = plan.unclear.map(
    (u): Change => ({
      op: "ask",
      question: plain(
        `Línea del banco dudosa: ${u.line.date} ${u.line.amount.toFixed(2)} ${u.line.text}. ¿Cuál de estas notas es?`,
      ),
      options: [
        ...u.candidates.slice(0, 5).map((id) => plain(a.book.title(id) || id, 80)),
        "Ninguna: es otro movimiento",
      ],
    }),
  );
  return {
    summary: files.length
      ? [
          count(plan.creates.length, "nueva", "nuevas"),
          count(plan.edits.length, "unida", "unidas"),
          count(plan.unclear.length, "dudosa", "dudosas"),
        ].join(", ")
      : "No hay extractos",
    report: reportOf(plan.result.report),
    changes: [
      ...plan.edits.map((e) => a.update(e.id, e.props)),
      ...plan.creates.map((c) => a.create(c.movement)),
      ...asks,
    ],
  };
}

/** A month's pending movements (`data.month`, `AAAA-MM`; every month without it) checked: the complete ones, `conciliado`. */
export function cerrar_mes(input: FunctionInput): ChangeSet {
  const m = (input.data as { month?: unknown } | null | undefined)?.month;
  if (m !== undefined && m !== null && (typeof m !== "string" || !/^\d{4}-\d{2}$/.test(m)))
    throw new Error("data.month: un mes como 2026-09");
  const month = typeof m === "string" ? m : null;
  const a = accountOf(input);
  const plan = planClose(a.book, month, { cats: a.cats, rules: a.rules, kindOf: a.kindOf });
  return {
    summary: `${month ?? "Todos los meses"}: ${plan.ready.length} para conciliar, ${count(plan.result.blocked.length, "sigue pendiente", "siguen pendientes")}`,
    report: reportOf(plan.result.report),
    changes: plan.ready.map((id) => a.update(id, { status: "conciliado" })),
  };
}
