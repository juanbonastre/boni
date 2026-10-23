import { parseNote } from "@boni/calendar";
import { CORE_MARK } from "@boni/mirror";
import type { UserStore } from "@boni/store";
import { storeBook } from "./book.ts";
import {
  type CloseResult,
  closeMonth,
  type ImportResult,
  importStatements,
  parseRules,
} from "./reconcile.ts";

/**
 * The reconciliation for an account (Boni's MCP: `finanzas_import`, `finanzas_close`): its statements, rules and
 * categories read from the vault (never written; `extractos/` stays as the bank gave it), its movements and debts
 * in Boni. Only once the movements live in Boni (core mode): before that the vault's own tools did it.
 */
const FIN = "registros/finanzas";
export interface MoneyVault {
  files(dir: string, exts: string[]): string[];
  readBytes(rel: string): Buffer;
  read(rel: string): { text: string };
}

function ensureCore(store: UserStore) {
  if (store.setting(`${CORE_MARK}t_movimiento`) === null)
    throw new Error(
      "los movimientos aun viven en el vault, no en Boni: la conciliacion se hace alli (vault-mcp)",
    );
}
const rulesOf = (vault: MoneyVault) => {
  try {
    return parseRules(vault.readBytes(`${FIN}/reglas.csv`).toString("utf8"));
  } catch {
    return [];
  }
};
const categoriesOf = (vault: MoneyVault): string[] => {
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
    rules: rulesOf(vault),
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
  const r = closeMonth(storeBook(store, { ...(o.run ? { run: o.run } : {}) }), o.month, {
    cats: categoriesOf(vault),
    rules: rulesOf(vault),
    apply: o.apply,
  });
  if (o.apply)
    r.report.push(
      "(export/ ya no se regenera: los movimientos estan en Boni, que los exporta desde Ajustes > Tus datos)",
    );
  return r;
}
