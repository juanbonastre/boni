// What the panel «Añadir un paso» lists (docs/automatizaciones.md AU-69). Pending but the first: see edit.test.ts.
import { CATALOGUE, CATEGORIES } from "@boni/automations";
import { describe, expect, it } from "vitest";
import { PANEL_CATEGORIES } from "./adding.ts";

describe("the panel «Añadir un paso»", () => {
  it("AU-69 · every category of the catalogue is a category of the panel or the triggers', and the catalogue has a step of each", () => {
    expect([...PANEL_CATEGORIES, "trigger"].sort()).toEqual([...CATEGORIES].sort());
    for (const category of CATEGORIES)
      expect(
        CATALOGUE.some((t) => t.category === category),
        category,
      ).toBe(true);
  });
  it.todo(
    "AU-69 · an empty canvas lists the triggers alone; then the panel lists the categories in their order and «Añadir otro disparador» last; every step type of the catalogue is in exactly one category, «Colección» is an entry per action and every other type one entry",
  );
  it.todo(
    "AU-69 · the search looks in every category at once by a step's name and its actions' names, ignoring case and accents, finds an entry once, and finds nothing for a word no name has",
  );
});
