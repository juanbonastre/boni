import { describe, expect, it } from "vitest";
import { catalogueData, computeBlock } from "./blockData.ts";
import {
  applies,
  CATALOGUE,
  type CatalogueData,
  catalogueErrors,
  catalogueForAI,
  fitAfter,
  newBlock,
  optionsOf,
  PLACE_SETTINGS,
} from "./catalogue.ts";
import { type DataBlock, pageErrors } from "./page.ts";
import { randomBlock, randomPage, randomUser, rng } from "./randomPage.test-util.ts";

const DATA: CatalogueData = {
  collections: [
    {
      id: "t_mov",
      name: "Movimientos",
      fields: [
        { id: "f_importe", name: "Importe", type: "money" },
        {
          id: "f_cat",
          name: "Categoría",
          type: "select",
          options: [
            { id: "o_cafe", name: "Café" },
            { id: "o_fuera", name: "Comer fuera" },
          ],
        },
        { id: "f_fecha", name: "Fecha", type: "date" },
      ],
    },
    { id: "t_ideas", name: "Ideas", fields: [{ id: "f_titulo", name: "Título", type: "text" }] },
  ],
};
const graph = (extra: Record<string, unknown> = {}) => ({
  id: "g",
  type: "graph",
  title: "Café por mes",
  shape: "bar",
  collection: "t_mov",
  groupBy: "@month",
  measure: "sum",
  field: "f_importe",
  period: "12m",
  ...extra,
});

describe("the block catalogue (one list for the panel, the checks and the AI)", () => {
  it("has a kind per type and every choice has something to choose", () => {
    expect(new Set(CATALOGUE.map((k) => k.type)).size).toBe(CATALOGUE.length);
    for (const k of CATALOGUE)
      for (const s of k.settings)
        if (s.type === "choice") expect(s.options, `${k.type}.${s.key}`).toBeDefined();
  });

  it("accepts a block whose settings are among what the data offers", () => {
    expect(catalogueErrors(graph(), DATA)).toEqual([]);
    expect(catalogueErrors(graph({ filterField: "f_cat", filterValue: "o_cafe" }), DATA)).toEqual(
      [],
    );
  });

  it("refuses values that are not in the data instead of putting another (session 0)", () => {
    // «Agrupar por fecha»: there is no field "fecha"; the time is @day|@week|@month.
    expect(catalogueErrors(graph({ groupBy: "fecha" }), DATA)).toEqual([
      { block: "g", key: "groupBy", code: "not-in-data", value: "fecha" },
    ]);
    // A filter written by hand ("bebida/cafe") is not one of the field's options.
    expect(
      catalogueErrors(graph({ filterField: "f_cat", filterValue: "bebida/cafe" }), DATA)[0],
    ).toMatchObject({ key: "filterValue", code: "bad" });
    expect(
      catalogueErrors(graph({ filterField: "f_cat", filterValue: "o_te" }), DATA)[0],
    ).toMatchObject({ key: "filterValue", code: "not-in-data" });
    expect(catalogueErrors(graph({ color: "#3b82f6" }), DATA)[0]).toMatchObject({
      key: "color",
      code: "bad",
    });
    expect(catalogueErrors(graph({ color: "blue" }), DATA)).toEqual([]);
  });

  it("is closed: unknown keys, settings that do not apply, wrong types, missing ones", () => {
    expect(catalogueErrors(graph({ sql: "select 1" }), DATA)[0]).toMatchObject({
      key: "sql",
      code: "not-allowed",
    });
    expect(catalogueErrors(graph({ measure: "count" }), DATA)[0]).toMatchObject({
      key: "field",
      code: "not-allowed",
    });
    expect(catalogueErrors(graph({ filterValue: "o_cafe" }), DATA)[0]).toMatchObject({
      key: "filterValue",
      code: "not-allowed",
    });
    expect(catalogueErrors(graph({ bg: "sí" }), DATA)[0]).toMatchObject({ key: "bg", code: "bad" });
    expect(catalogueErrors(graph({ title: " " }), DATA)[0]).toMatchObject({
      key: "title",
      code: "missing",
    });
    const { period: _p, ...noPeriod } = graph();
    expect(catalogueErrors(noPeriod, DATA)[0]).toMatchObject({ key: "period", code: "missing" });
    expect(catalogueErrors(graph({ period: "forever" }))[0]).toMatchObject({
      key: "period",
      code: "bad",
    });
  });

  it("offers time and periods only for a collection with a date field", () => {
    const { field: _f, ...b } = graph({ collection: "t_ideas", measure: "count", period: "month" });
    const codes = catalogueErrors(b, DATA).map((p) => `${p.key}:${p.code}`);
    expect(codes).toEqual(["groupBy:not-in-data", "period:not-in-data"]);
    const s = CATALOGUE.find((k) => k.type === "graph")?.settings.find((x) => x.key === "period");
    expect(optionsOf(s!, b, DATA).map((o) => o.value)).toEqual(["all"]);
  });

  it("tells the AI every setting the panel has, sizes too, and the data's real values", () => {
    const text = catalogueForAI(DATA);
    for (const k of CATALOGUE) {
      expect(text).toContain(`${k.type}: `);
      for (const s of k.settings) expect(text).toContain(`${s.key}: `);
    }
    for (const s of PLACE_SETTINGS) expect(text).toContain(`${s.key}: `);
    expect(text).toContain("o_cafe=Café");
    expect(text).toContain("@day|@week|@month");
  });

  it("fits the settings after the one the user changed (another collection, other fields)", () => {
    const b = graph({ filterField: "f_cat", filterValue: "o_cafe" });
    const moved = fitAfter({ ...b, collection: "t_ideas" }, "collection", DATA);
    expect(moved).toMatchObject({ collection: "t_ideas", measure: "count", period: "all" });
    expect(moved).not.toHaveProperty("groupBy");
    expect(moved).not.toHaveProperty("field");
    expect(moved).not.toHaveProperty("filterField");
    expect(catalogueErrors(moved, DATA).map((p) => p.key)).toEqual(["groupBy"]);
    // Only what comes after: the title before it is never touched.
    const counted = fitAfter({ ...b, measure: "count" }, "measure", DATA);
    expect(counted).not.toHaveProperty("field");
    expect(counted.title).toBe(b.title);
    expect(fitAfter({ ...b, measure: "avg" }, "measure", DATA).field).toBe("f_importe");
  });

  it("adds a new block that is already valid", () => {
    for (const k of CATALOGUE) {
      const b = newBlock(k.type, "n", DATA);
      expect(catalogueErrors(b, DATA), k.type).toEqual([]);
    }
  });
});

describe("a page on a grid of 12 columns", () => {
  const at = (row: string, col: number, w: number) => ({ row, col, w });
  it("places blocks in rows of columns", () => {
    const spec = {
      version: 1,
      blocks: [
        { id: "a", type: "heading", text: "Gastos", at: at("r1", 0, 4) },
        { id: "b", type: "text", text: "", at: at("r1", 0, 4) },
        { ...graph(), at: { ...at("r1", 1, 8), h: "l" } },
        { id: "c", type: "divider" },
      ],
    };
    expect(pageErrors(spec)).toEqual([]);
  });
  it("refuses rows wider than 12, a column with two widths and places out of range", () => {
    const wide = {
      version: 1,
      blocks: [graph({ id: "a", at: at("r", 0, 8) }), graph({ id: "b", at: at("r", 1, 6) })],
    };
    expect(pageErrors(wide)).toEqual(["row r: its columns are 14 twelfths wide (at most 12)"]);
    const two = {
      version: 1,
      blocks: [graph({ id: "a", at: at("r", 0, 4) }), graph({ id: "b", at: at("r", 0, 6) })],
    };
    expect(pageErrors(two)[0]).toMatch(/one width/);
    const bad = { version: 1, blocks: [graph({ at: { row: "r", col: 0, w: 13 } })] };
    expect(pageErrors(bad)[0]).toMatch(/at \{/);
    const extra = { version: 1, blocks: [graph({ at: { row: "r", col: 0, w: 6, x: 1 } })] };
    expect(pageErrors(extra)[0]).toMatch(/at \{/);
  });
});

describe("whatever the catalogue lets anyone build (random users, random pages)", () => {
  it("is a valid page whose every block is valid with the user's data", () => {
    for (let seed = 1; seed <= 300; seed++) {
      const { r, data } = randomUser(seed);
      const page = randomPage(r, data);
      expect(pageErrors(page), `seed ${seed}`).toEqual([]);
      for (const b of page.blocks)
        expect(catalogueErrors(b, data), `seed ${seed} ${b.id}`).toEqual([]);
    }
  });

  it("computes every data block, from no rows to many, and never anything else in its place", () => {
    let computed = 0;
    let refused = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const { r, types, data, rows } = randomUser(seed);
      const byId = Object.fromEntries(types.map((t) => [t.id, t]));
      const b = randomBlock(r, "x", data);
      // Boni's own numbers (from: boni) are computed by the app, not from a collection.
      if (!["number", "bars", "graph"].includes(String(b.type)) || b.from === "boni") continue;
      const out = computeBlock(b as unknown as DataBlock, byId, (t) => rows.get(t) ?? [], {
        today: "2026-06-15",
      });
      expect("data" in out ? null : out.problems, `seed ${seed}`).toBeNull();
      if (!("data" in out)) continue;
      computed++;
      for (const s of out.data.series)
        for (const p of s.points) expect(Number.isFinite(p.value)).toBe(true);
      // One setting changed to what is not in the data: the block says so, it is never computed.
      const key = String(rng(seed).pick(["collection", "groupBy", "field", "filterValue"]));
      if (
        !(key in b) ||
        !applies(CATALOGUE.find((k) => k.type === b.type)!.settings.find((s) => s.key === key)!, b)
      )
        continue;
      const broken = computeBlock(
        { ...b, [key]: "f_no_existe" } as unknown as DataBlock,
        byId,
        () => [],
        {
          today: "2026-06-15",
        },
      );
      expect("problems" in broken, `seed ${seed} ${key}`).toBe(true);
      refused++;
    }
    expect(computed).toBeGreaterThan(50);
    expect(refused).toBeGreaterThan(15);
  });

  it("knows the collections of the store's schema (system and archived types left out)", () => {
    const { types } = randomUser(3);
    const data = catalogueData([...types, { ...types[0]!, id: "t_sys", system: true }]);
    expect(data.collections.map((c) => c.id)).toEqual(types.map((t) => t.id));
  });
});
