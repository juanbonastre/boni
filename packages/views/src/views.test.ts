import { type Entity, label, type TypeDef } from "@boni/entities";
import { describe, expect, it } from "vitest";
import { computeChart } from "./chart.ts";
import { entityMonths, entityProfile } from "./entities.ts";
import { type ViewSpec, viewErrors, viewRows } from "./views.ts";

/** "Quiero llevar control de los libros que leo" (docs/nucleo.md): an invented type and entities. */
const L = label("user", "public", []);
const LIBRO: TypeDef = {
  id: "t_libro",
  key: "libro",
  name: "Libro",
  fields: [
    { id: "f_titulo", key: "titulo", name: "Título", type: "text", label: L },
    { id: "f_fin", key: "fin", name: "Terminado", type: "date", label: L },
    { id: "f_paginas", key: "paginas", name: "Páginas", type: "number", label: L },
    {
      id: "f_estado",
      key: "estado",
      name: "Estado",
      type: "select",
      options: [
        { id: "o_leido", name: "Leído", label: L },
        { id: "o_dejado", name: "Dejado", label: L },
      ],
      label: L,
    },
    {
      id: "f_autor",
      key: "autor",
      name: "Autor",
      type: "relation",
      relation: { target: "t_persona", many: false },
      label: L,
    },
  ],
  titleField: "f_titulo",
  sensitivity: "personal",
  schemaVersion: 1,
  label: L,
};
const book = (
  id: string,
  fin: string | null,
  paginas: number | null,
  estado: string,
  autor?: string,
): Entity => ({
  id,
  type: "t_libro",
  values: {
    f_titulo: `Libro ${id}`,
    ...(fin ? { f_fin: fin } : {}),
    ...(paginas !== null ? { f_paginas: paginas } : {}),
    f_estado: estado,
    ...(autor ? { f_autor: autor } : {}),
  },
  created: 0,
  updated: 0,
  version: 1,
});
const BOOKS = [
  book("1", "2025-11-03", 320, "o_leido", "e_ana"),
  book("2", "2026-01-15", 180, "o_leido", "e_luis"),
  book("3", "2026-01-28", 500, "o_dejado", "e_ana"),
  book("4", "2026-03-02", null, "o_leido"),
  book("5", null, 90, "o_leido"),
];
const p = entityProfile(LIBRO, {
  dateField: "f_fin",
  titleOf: (id) => ({ e_ana: "Ana Ejemplo", e_luis: "Luis Ejemplo" })[id] ?? "",
});
const opts = { today: "2026-03-20", monthsWithData: entityMonths(BOOKS, "f_fin") };

describe("charts of any type", () => {
  it("¿cuántos libros leí este año frente al pasado?", () => {
    const d = computeChart(
      p,
      {
        title: "Libros",
        kind: "number",
        measure: "count",
        period: { kind: "this_year" },
        compare: "previous_year",
      },
      BOOKS,
      opts,
    );
    expect(d.total).toBe(3); // books 2, 3 and 4 ended in 2026; 5 has no date
    expect(d.previous_total).toBe(0); // by 20 March 2025, none
    expect(d.unit).toBe("");
  });

  it("counts by month, averages a number by a select, labels relations by their titles", () => {
    const byMonth = computeChart(
      p,
      {
        title: "Por mes",
        kind: "bar",
        measure: "count",
        x: { field: "date", granularity: "month" },
        period: { kind: "last_months", months: 6 },
      },
      BOOKS,
      opts,
    );
    expect(byMonth.series[0]?.points.map((x) => [x.label, x.value])).toEqual([
      ["oct 25", 0], // two years in the period: months carry the year
      ["nov 25", 1],
      ["dic 25", 0],
      ["ene 26", 2],
      ["feb 26", 0],
      ["mar 26", 1],
    ]);
    expect(byMonth.series[0]?.points[0]?.no_data).toBe(true); // no book at all in October: a gap
    const pages = computeChart(
      p,
      {
        title: "Páginas",
        kind: "hbar",
        measure: "avg:f_paginas",
        x: { field: "f_estado" },
        period: { kind: "all" },
      },
      BOOKS,
      opts,
    );
    expect(pages.series[0]?.points.map((x) => [x.label, x.value])).toEqual([
      ["Dejado", 500],
      ["Leído", 250],
    ]);
    const authors = computeChart(
      p,
      {
        title: "Autores",
        kind: "table",
        measure: "sum:f_paginas",
        x: { field: "f_autor" },
        period: { kind: "all" },
      },
      BOOKS,
      opts,
    );
    expect(authors.series[0]?.points.map((x) => [x.label, x.value])).toEqual([
      ["Ana Ejemplo", 820],
      ["Luis Ejemplo", 180],
    ]);
  });
});

describe("views", () => {
  const view = (
    component: ViewSpec["component"],
    source: Partial<ViewSpec["source"]> = {},
  ): ViewSpec => ({
    id: "v1",
    name: "Mis libros",
    version: 1,
    source: { type: "t_libro", ...source },
    component,
  });

  it("checks every field a view names against the schema", () => {
    const types = { t_libro: LIBRO };
    expect(viewErrors(view({ kind: "table", columns: ["f_titulo", "f_estado"] }), types)).toEqual(
      [],
    );
    expect(viewErrors(view({ kind: "kanban", groupBy: "f_estado" }), types)).toEqual([]);
    expect(viewErrors(view({ kind: "table", columns: ["f_inventado"] }), types)).toEqual([
      'column: no field "f_inventado" in "t_libro"',
    ]);
    expect(viewErrors(view({ kind: "kanban", groupBy: "f_paginas" }), types)).toEqual([
      "kanban: group by a select or a checkbox",
    ]);
    expect(viewErrors(view({ kind: "html", columns: [] } as never), types)).toEqual([
      'unknown component "html"',
    ]); // a closed catalogue
    expect(
      viewErrors({ ...view({ kind: "list", columns: [] }), source: { type: "t_nada" } }, types),
    ).toEqual(['unknown type "t_nada"']);
  });

  it("filters, sorts (empty last) and limits the rows of a view", () => {
    const v = view(
      { kind: "table", columns: ["f_titulo"] },
      {
        filters: [{ field: "f_estado", op: "in", values: ["o_leido"] }],
        sort: [{ field: "f_paginas", desc: true }],
        limit: 3,
      },
    );
    expect(viewRows(v, LIBRO, BOOKS).map((e) => e.id)).toEqual(["1", "2", "5"]);
    const asc = view({ kind: "list", columns: [] }, { sort: [{ field: "f_paginas" }] });
    expect(viewRows(asc, LIBRO, BOOKS).map((e) => e.id)).toEqual(["5", "2", "1", "3", "4"]);
  });
});
