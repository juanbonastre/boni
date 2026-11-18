/**
 * What the panel «Añadir un paso» lists (docs/automatizaciones.md AU-69), as data: the component paints it and
 * decides nothing. It is made from the catalogue alone: a category is there when the catalogue has a step of it, so
 * a later phase's category appears with its first step and nothing here changes.
 */
import {
  AGENT_TYPE,
  AI_CATEGORY,
  CATALOGUE,
  type Category,
  CODE_TYPE,
  type StepTypeSpec,
  specOf,
} from "@boni/automations";

/**
 * The panel's categories in its order, by the catalogue's: said by what one wants to do through `KEY.category`
 * (words.ts). F14b's three: «Leer o escribir en una colección» (`data`), «Transformar filas» (`transform`) and
 * «Decidir el camino» (`logic`); and F15's «Usar IA» (`ai`, the «Agente», AU-50). The triggers (`trigger`) are no
 * category of the list: they are what an empty canvas asks («¿Cómo empieza?») and what «Añadir otro disparador» opens.
 */
export const PANEL_CATEGORIES = [
  "data",
  "transform",
  "logic",
  AI_CATEGORY,
] as const satisfies readonly (Category | typeof AI_CATEGORY)[];

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
export function panelList(showing: "empty" | "triggers" | "steps"): PanelList {
  if (showing !== "steps") return { kind: "triggers", entries: entriesOf("trigger") };
  return {
    kind: "steps",
    sections: PANEL_CATEGORIES.map((category) => ({ category, entries: entriesOf(category) })),
    anotherTrigger: true,
  };
}

/**
 * The types the engine runs that are not in `CATALOGUE` yet (code.ts says why), each at the end of its category:
 * «Código» under «Transformar» (AU-30), and the «Agente» under «Usar IA» (AU-50).
 */
const BESIDE_CATALOGUE: readonly StepTypeSpec[] = [CODE_TYPE, AGENT_TYPE].map(
  (type) => specOf(type) as StepTypeSpec,
);

const entriesOf = (category: Category | typeof AI_CATEGORY): PanelEntry[] =>
  [...CATALOGUE, ...BESIDE_CATALOGUE].filter((t) => t.category === category).flatMap(entriesOfType);
const entriesOfType = (spec: StepTypeSpec): PanelEntry[] =>
  ACTIONS_AS_ENTRIES.includes(spec.type)
    ? spec.actions.map((a) => ({ type: spec.type, action: a.key }))
    : [{ type: spec.type }];

/** A word as the search compares it: lower case, with no accents. */
export const folded = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();

/**
 * The search (AU-69): over every category at once, and over the triggers when the panel lists them, by a step's
 * name and its actions' names as `say` words them, ignoring case and accents. An entry is found once: a type whose
 * name matches gives its entries; an action whose name matches gives that entry. Empty: «Nada con «…»».
 */
export function searchPanel(
  query: string,
  showing: "empty" | "triggers" | "steps",
  say: (entry: PanelEntry) => string[],
): PanelEntry[] {
  const q = folded(query);
  const list = panelList(showing);
  const all = list.kind === "triggers" ? list.entries : list.sections.flatMap((s) => s.entries);
  if (!q) return all;
  return all.filter((e) => say(e).some((name) => folded(name).includes(q)));
}
