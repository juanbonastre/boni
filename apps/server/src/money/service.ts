import { parseNote } from "@boni/calendar";
import type { UserStore } from "@boni/store";
import { kindFrom } from "@boni/views";
import { storeBook } from "./book.ts";
import { categoryRows, ruleRows } from "./collections.ts";
import {
  type CloseResult,
  closeMonth,
  type ImportResult,
  importStatements,
  parseRules,
} from "./reconcile.ts";

/**
 * The reconciliation for an account (Boni's MCP: `finanzas_import`, `finanzas_close`): its statements read as
 * files (never written; the bank's bytes as they came), its rules and categories from the collections Reglas and
 * Categorías (`collections.ts`; before they exist, `reglas.csv` and the categories note), its movements and debts
 * in Boni (the collection Movimiento).
 */
const FIN = "registros/finanzas";
export interface MoneyFiles {
  files(dir: string, exts: string[]): string[];
  readBytes(rel: string): Buffer;
  read(rel: string): { text: string };
  /** The categories, when they are not a note's text to parse (Boni's own: storeFiles). */
  categories?(): string[];
}

function ensureMovements(store: UserStore) {
  if (!store.schema().types.t_movimiento)
    throw new Error("esta cuenta no tiene movimientos en Boni (la coleccion Movimiento)");
}
const rulesOf = (store: UserStore, files: MoneyFiles) => {
  const own = ruleRows(store);
  if (own) return own;
  try {
    return parseRules(files.readBytes(`${FIN}/reglas.csv`).toString("utf8"));
  } catch {
    return [];
  }
};
const categoriesOf = (store: UserStore, files: MoneyFiles): string[] => {
  const own = categoryRows(store);
  if (own) return own.map((c) => c.name);
  if (files.categories) return files.categories();
  try {
    const v = parseNote(files.read(`${FIN}/categorias.md`).text).values.categories;
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
};

export function reconcileImport(
  store: UserStore,
  files: MoneyFiles,
  o: { apply: boolean; today: string; run?: string },
): ImportResult {
  ensureMovements(store);
  const names = files
    .files(`${FIN}/extractos`, [".csv", ".xlsx", ".xls"])
    .filter((n) => !n.includes(".sync-conflict-"));
  const statements = names.map((name) => ({
    name,
    bytes: files.readBytes(`${FIN}/extractos/${name}`),
  }));
  return importStatements(storeBook(store, { ...(o.run ? { run: o.run } : {}) }), statements, {
    rules: rulesOf(store, files),
    apply: o.apply,
    today: o.today,
  });
}

export function reconcileClose(
  store: UserStore,
  files: MoneyFiles,
  o: { month: string | null; apply: boolean; run?: string },
): CloseResult {
  ensureMovements(store);
  const kinds = categoryRows(store);
  const r = closeMonth(storeBook(store, { ...(o.run ? { run: o.run } : {}) }), o.month, {
    cats: categoriesOf(store, files),
    rules: rulesOf(store, files),
    apply: o.apply,
    ...(kinds ? { kindOf: kindFrom(new Map(kinds.map((c) => [c.name, c.kind]))) } : {}),
  });
  if (o.apply)
    r.report.push(
      "(export/ ya no se regenera: los movimientos estan en Boni, que los exporta desde Ajustes > Tus datos)",
    );
  return r;
}
