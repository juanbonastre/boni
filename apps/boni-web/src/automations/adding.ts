/**
 * What the panel «Añadir un paso» lists (docs/automatizaciones.md AU-69), as data: the component paints it and
 * decides nothing. It is made from the catalogue alone: a category is there when the catalogue has a step of it, so
 * a later phase's category appears with its first step and nothing here changes.
 */
import type { Category } from "@boni/automations";
import { notBuilt } from "./pending.ts";

/**
 * The panel's categories in its order, by the catalogue's: said by what one wants to do through `KEY.category`
 * (words.ts). F14b's three: «Leer o escribir en una colección» (`data`), «Transformar filas» (`transform`) and
 * «Decidir el camino» (`logic`). The triggers (`trigger`) are no category of the list: they are what an empty
 * canvas asks («¿Cómo empieza?») and what «Añadir otro disparador» opens.
 */
export const PANEL_CATEGORIES = [
  "data",
  "transform",
  "logic",
] as const satisfies readonly Category[];

/**
 * The step types listed as one entry per action, each said as a phrase («Buscar filas», «Crear una fila»): the
 * design names «Colección» and no other. Any other type is one entry, and its action is chosen in the step's view.
 */
export const ACTIONS_AS_ENTRIES: readonly string[] = ["collection"];

/** One thing to choose: a step type, or one action of a type of `ACTIONS_AS_ENTRIES`. */
export interface PanelEntry {
  type: string;
  action?: string;
}

/** What the panel shows with no search: the triggers alone, or the categories and then «Añadir otro disparador». */
export type PanelList =
  | { kind: "triggers"; entries: PanelEntry[] }
  | {
      kind: "steps";
      sections: { category: (typeof PANEL_CATEGORIES)[number]; entries: PanelEntry[] }[];
      /** Always last (AU-69). */
      anotherTrigger: true;
    };

/**
 * `empty`: the canvas has no step, so the panel asks how it starts and lists the triggers. `triggers`: Juan chose
 * «Añadir otro disparador». Otherwise the categories, each with its entries in the catalogue's order; every step
 * type is in exactly one.
 */
export function panelList(_showing: "empty" | "triggers" | "steps"): PanelList {
  return notBuilt("panelList (AU-69)");
}

/**
 * The search (AU-69): over every category at once, and over the triggers when the panel lists them, by a step's
 * name and its actions' names as `say` words them, ignoring case and accents. An entry is found once: a type whose
 * name matches gives its entries; an action whose name matches gives that entry. Empty: «Nada con «…»».
 */
export function searchPanel(
  _query: string,
  _showing: "empty" | "triggers" | "steps",
  _say: (entry: PanelEntry) => string[],
): PanelEntry[] {
  return notBuilt("searchPanel (AU-69)");
}
