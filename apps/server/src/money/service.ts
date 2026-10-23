import { parseNote } from "@boni/calendar";
import { CORE_MARK } from "@boni/mirror";
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
 * in Boni. Only once the movements live in Boni (core mode): before that the vault's own tools did it.
 */
const FIN = "registros/finanzas";
export interface MoneyVault {
  files(dir: string, exts: string[]): string[];
  readBytes(rel: string): Buffer;
  read(rel: string): { text: string };
  /** The categories, when they are not a note's text to parse (Boni's own: storeFiles). */
  categories?(): string[];
}

function ensureCore(store: UserStore) {
  if (store.setting(`${CORE_MARK}t_movimiento`) === null)
    throw new Error(
      "los movimientos aun viven en el vault, no en Boni: la conciliacion se hace alli (vault-mcp)",
    );
}
const rulesOf = (store: UserStore, vault: MoneyVault) => {
  const own = ruleRows(store);
  if (own) return own;
  try {
    return parseRules(vault.readBytes(`${FIN}/reglas.csv`).toString("utf8"));
  } catch {
    return [];
  }
};
const categoriesOf = (store: UserStore, vault: MoneyVault): string[] => {
  const own = categoryRows(store);
  if (own) return own.map((c) => c.name);
  if (vault.categories) return vault.categories();
  try {
    const v = parseNote(vault.read(`${FIN}/categorias.md`).text).values.categories;
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
};

export function reconcileImport(
  store: UserStore,
  vault: MoneyVault,
  o: { apply: boolean; today: string; run?: string },
): ImportResult {
  ensureCore(store);
  const names = vault
    .files(`${FIN}/extractos`, [".csv", ".xlsx", ".xls"])
    .filter((n) => !n.includes(".sync-conflict-"));
  const files = names.map((name) => ({
    name,
    bytes: vault.readBytes(`${FIN}/extractos/${name}`),
  }));
  return importStatements(storeBook(store, { ...(o.run ? { run: o.run } : {}) }), files, {
    rules: rulesOf(store, vault),
    apply: o.apply,
    today: o.today,
  });
}

export function reconcileClose(
  store: UserStore,
  vault: MoneyVault,
  o: { month: string | null; apply: boolean; run?: string },
): CloseResult {
  ensureCore(store);
  const kinds = categoryRows(store);
  const r = closeMonth(storeBook(store, { ...(o.run ? { run: o.run } : {}) }), o.month, {
    cats: categoriesOf(store, vault),
    rules: rulesOf(store, vault),
    apply: o.apply,
    ...(kinds ? { kindOf: kindFrom(new Map(kinds.map((c) => [c.name, c.kind]))) } : {}),
  });
  if (o.apply)
    r.report.push(
      "(export/ ya no se regenera: los movimientos estan en Boni, que los exporta desde Ajustes > Tus datos)",
    );
  return r;
}
