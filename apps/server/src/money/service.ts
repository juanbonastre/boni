import type { UserStore } from "@boni/store";
import { kindFrom } from "@boni/views";
import { storeBook } from "./book.ts";
import { categoryRows, ruleRows } from "./collections.ts";
import { type CloseResult, closeMonth, type ImportResult, importStatements } from "./reconcile.ts";

/**
 * The reconciliation for an account (Boni's MCP: `finanzas_import`, `finanzas_close`): its statements read as
 * files of "Archivos" (never written; the bank's bytes as they came), its rules and categories from the collections
 * Reglas and Categorías (`collections.ts`), its movements and debts in Boni (the collection Movimiento).
 */
/** The folder the bank statements are kept in, among the account's files (MCP `upload_file`). */
export const STATEMENTS = "registros/finanzas/extractos";
export interface MoneyFiles {
  files(dir: string, exts: string[]): string[];
  readBytes(rel: string): Buffer;
}

function ensureMovements(store: UserStore) {
  if (!store.schema().types.t_movimiento)
    throw new Error("esta cuenta no tiene movimientos en Boni (la coleccion Movimiento)");
}
const rulesOf = (store: UserStore) => ruleRows(store) ?? [];
const categoriesOf = (store: UserStore): string[] => (categoryRows(store) ?? []).map((c) => c.name);

export function reconcileImport(
  store: UserStore,
  files: MoneyFiles,
  o: { apply: boolean; today: string; run?: string },
): ImportResult {
  ensureMovements(store);
  const names = files
    .files(STATEMENTS, [".csv", ".xlsx", ".xls"])
    .filter((n) => !n.includes(".sync-conflict-"));
  const statements = names.map((name) => ({
    name,
    bytes: files.readBytes(`${STATEMENTS}/${name}`),
  }));
  return importStatements(storeBook(store, { ...(o.run ? { run: o.run } : {}) }), statements, {
    rules: rulesOf(store),
    apply: o.apply,
    today: o.today,
  });
}

export function reconcileClose(
  store: UserStore,
  o: { month: string | null; apply: boolean; run?: string },
): CloseResult {
  ensureMovements(store);
  const kinds = categoryRows(store);
  const r = closeMonth(storeBook(store, { ...(o.run ? { run: o.run } : {}) }), o.month, {
    cats: categoriesOf(store),
    rules: rulesOf(store),
    apply: o.apply,
    ...(kinds ? { kindOf: kindFrom(new Map(kinds.map((c) => [c.name, c.kind]))) } : {}),
  });
  if (o.apply)
    r.report.push(
      "(export/ ya no se regenera: los movimientos estan en Boni, que los exporta desde Ajustes > Tus datos)",
    );
  return r;
}
