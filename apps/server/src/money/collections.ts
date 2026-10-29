import type { UserStore } from "@boni/store";
import { type CategoryKind, kindByName } from "@boni/views";
import { CATEGORIES, titleOf } from "./book.ts";
import { type Rule, rulePattern, sortRules } from "./reconcile.ts";

/**
 * The money's own collections (Juan, 2026-10-23: in Boni everything is a collection): "Categorías" (a row per
 * category: its name, its kind, what goes in it) and "Reglas" (a bank text, the merchant and category it means).
 * A movement's `category` points to a row of Categorías.
 */
export { CATEGORIES };
export const RULES = "t_regla";
const MOVEMENTS = "t_movimiento";

const KINDS: CategoryKind[] = ["gasto", "ingreso", "otro"];
const kindOption = (k: CategoryKind) => `o_${k}`;

const has = (store: UserStore, type: string) => {
  const t = store.schema().types[type];
  return !!t && !t.archived;
};

/** Whether the money uses its collections: a movement's category points to Categorías. */
export function moneyCollectionsOn(store: UserStore): boolean {
  const f = store
    .schema()
    .types[MOVEMENTS]?.fields.find((x) => !x.archived && x.name === "category");
  return f?.type === "relation" && f.relation?.target === CATEGORIES && has(store, CATEGORIES);
}

/** The account's categories (name and kind), by name; null before they are a collection. */
export function categoryRows(store: UserStore): { name: string; kind: CategoryKind }[] | null {
  if (!moneyCollectionsOn(store)) return null;
  const byOption = new Map(KINDS.map((k) => [kindOption(k), k]));
  return store
    .entities(CATEGORIES)
    .map((e) => ({
      name: String(e.values.f_nombre ?? "").trim(),
      kind: byOption.get(String(e.values.f_tipo)) ?? kindByName(String(e.values.f_nombre ?? "")),
    }))
    .filter((c) => c.name)
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** The account's rules, longest bank text first; null before they are a collection. */
export function ruleRows(store: UserStore): Rule[] | null {
  if (!moneyCollectionsOn(store) || !has(store, RULES)) return null;
  return sortRules(
    store
      .entities(RULES)
      .map(
        (e): Rule => [
          rulePattern(String(e.values.f_texto ?? "")),
          String(e.values.f_comercio ?? "").trim(),
          titleOf(store, e.values.f_categoria),
        ],
      ),
  ).filter((r) => r[0]);
}
