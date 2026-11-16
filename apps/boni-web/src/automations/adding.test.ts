// What the panel «Añadir un paso» lists (docs/automatizaciones.md AU-69).
import { CATALOGUE, CATEGORIES, isTrigger } from "@boni/automations";
import { describe, expect, it } from "vitest";
import { translator } from "../i18n.ts";
import { PANEL_CATEGORIES, type PanelEntry, panelList, searchPanel } from "./adding.ts";
import { entryNames } from "./words.ts";

const t = translator("es");
const say = (e: PanelEntry) => entryNames(t, e);

describe("the panel «Añadir un paso»", () => {
  it("AU-69 · every category of the catalogue is a category of the panel or the triggers', and the catalogue has a step of each", () => {
    expect([...PANEL_CATEGORIES, "trigger"].sort()).toEqual([...CATEGORIES].sort());
    for (const category of CATEGORIES)
      expect(
        CATALOGUE.some((t) => t.category === category),
        category,
      ).toBe(true);
  });
  it("AU-69 · an empty canvas lists the triggers alone; then the panel lists the categories in their order and «Añadir otro disparador» last; every step type of the catalogue is in exactly one category, «Colección» is an entry per action and every other type one entry", () => {
    const triggers = CATALOGUE.filter((s) => s.category === "trigger").map((s) => ({
      type: s.type,
    }));
    expect(panelList("empty")).toEqual({ kind: "triggers", entries: triggers });
    expect(panelList("triggers")).toEqual({ kind: "triggers", entries: triggers });
    const list = panelList("steps");
    if (list.kind !== "steps") throw new Error("steps");
    expect(list.sections.map((s) => s.category)).toEqual([...PANEL_CATEGORIES]);
    expect(list.anotherTrigger).toBe(true);
    const entries = list.sections.flatMap((s) => s.entries);
    // Every type that is not a trigger, in exactly one category; «Colección» once per action.
    for (const spec of CATALOGUE.filter((s) => s.category !== "trigger")) {
      const of = entries.filter((e) => e.type === spec.type);
      if (spec.type === "collection")
        expect(of).toEqual(spec.actions.map((a) => ({ type: spec.type, action: a.key })));
      else expect(of).toEqual([{ type: spec.type }]);
      expect(list.sections.filter((s) => s.entries.some((e) => e.type === spec.type))).toHaveLength(
        1,
      );
    }
    expect(entries.every((e) => !isTrigger({ id: "x", name: "x", type: e.type, params: {} }))).toBe(
      true,
    );
  });
  it("AU-69 · the search looks in every category at once by a step's name and its actions' names, ignoring case and accents, finds an entry once, and finds nothing for a word no name has", () => {
    // «Crear una fila» is an action of «Colección»; «filtrar» is a step of «Transformar filas»; «si» of «Decidir».
    expect(searchPanel("CREAR una", "steps", say)).toEqual([
      { type: "collection", action: "create" },
    ]);
    expect(searchPanel("filtrar", "steps", say)).toContainEqual({ type: "filter" });
    expect(searchPanel("  fécha ", "steps", say)).toEqual([{ type: "date" }]);
    // By the name of an action chosen in the step's view («Diferencia» is «Fecha»'s).
    expect(searchPanel("diferencia", "steps", say)).toEqual([{ type: "date" }]);
    // A word of both the type's name and its actions' («Colección», «… una fila»): each entry once.
    const fila = searchPanel("fila", "steps", say);
    expect(new Set(fila.map((e) => JSON.stringify(e))).size).toBe(fila.length);
    expect(searchPanel("colección", "steps", say)).toHaveLength(
      CATALOGUE.find((s) => s.type === "collection")?.actions.length ?? 0,
    );
    // In every category at once, and nothing for a word no name has.
    const cats = new Set(
      searchPanel("a", "steps", say).map((e) => CATALOGUE.find((s) => s.type === e.type)?.category),
    );
    expect(cats.size).toBe(PANEL_CATEGORIES.length);
    expect(searchPanel("zzzz", "steps", say)).toEqual([]);
    // Empty, it is the whole list, with «Código» beside the catalogue (AU-30); over the triggers when the panel
    // lists them.
    expect(searchPanel("", "steps", say)).toHaveLength(
      CATALOGUE.filter((s) => s.category !== "trigger").reduce(
        (n, s) => n + (s.type === "collection" ? s.actions.length : 1),
        1,
      ),
    );
    expect(searchPanel("código", "steps", say)).toEqual([{ type: "code" }]);
    expect(searchPanel("usuario", "empty", say)).toEqual([{ type: "manual" }]);
  });
});
