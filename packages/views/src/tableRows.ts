/**
 * The rows a page's table shows, as the server picks them (docs/sistema.md §4.6, point 3; task 102): its view's
 * rules with the page's values in them (`rulesWithValues`), the ones still waiting for a value left out
 * (`liveRules`), over every record of its collection (her daughters' too). The server answers a page's table with
 * them (`POST /api/data/blocks/rows`, a «database» block), so the app never needs the whole collection to filter it;
 * the app reads the same rules over what it holds after a change of its own (a row edited out of the filter leaves).
 */
import type { Entity, TypeDef } from "@boni/entities";
import { liveRules, matchesFilters } from "./filter.ts";
import type { FilterItem } from "./page.ts";
import { type ControlBlock, rulesWithValues } from "./pageValues.ts";

/** A table's rules as they filter now: the page's values in them, the waiting ones out. */
export const tableRules = (
  filter: readonly FilterItem[] | undefined,
  controls: readonly ControlBlock[],
): FilterItem[] => liveRules(rulesWithValues(filter ?? [], controls));

export function tableRows(
  rows: readonly Entity[],
  def: TypeDef,
  filter: readonly FilterItem[] | undefined,
  o: { today: string; controls: readonly ControlBlock[] },
): Entity[] {
  const rules = tableRules(filter, o.controls);
  if (!rules.length) return [...rows];
  const types = new Map(def.fields.map((f) => [f.id, f.type as string]));
  const typeOf = (id: string) => types.get(id);
  return rows.filter((e) => matchesFilters(e.values, typeOf, rules, o.today));
}
