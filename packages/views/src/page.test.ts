import { describe, expect, it } from "vitest";
import { pageErrors } from "./page.ts";

const ok = {
  version: 1,
  blocks: [
    { id: "h1", type: "heading", text: "Gastos" },
    { id: "h2", type: "heading", text: "Este mes", level: 2 },
    { id: "t1", type: "text", text: "Lo que llevo gastado este mes." },
    { id: "l1", type: "bullet", text: "Comida" },
    { id: "d1", type: "todo", text: "Revisar el banco", done: true },
    { id: "s1", type: "divider" },
    { id: "n1", type: "numbered", text: "Primero", indent: 1 },
    { id: "g1", type: "toggle", text: "Detalles", open: false },
    { id: "q1", type: "quote", text: "Una cita", indent: 1 },
    { id: "k1", type: "callout", text: "Ojo", icon: "💡" },
    { id: "c2", type: "code", text: "a = 1\nb = 2" },
    { id: "p1", type: "page", page: "e_01abc" },
    {
      id: "db1",
      type: "database",
      source: "t_libro",
      view: { layout: "board", group: "f_estado", sort: { field: "f_titulo" }, hide: ["f_x"] },
    },
    { id: "c1", type: "chart", chart: "gasto-del-mes" },
    { id: "a1", type: "action", screen: "gasto", label: "Apuntar gasto" },
    { id: "a2", type: "action", screen: "gasto", label: "Café", shortcut: "cafe" },
  ],
};

describe("a page (docs/extensiones.md 6)", () => {
  it("is blocks of the catalogue", () => {
    expect(pageErrors(ok)).toEqual([]);
    expect(pageErrors({ version: 1, blocks: [] })).toEqual([]);
  });

  it("is closed: unknown blocks or keys, HTML-ish or code-ish extras, repeated ids, no ids", () => {
    const with_ = (b: Record<string, unknown>) => pageErrors({ version: 1, blocks: [b] });
    expect(with_({ id: "x", type: "html", html: "<script>" })[0]).toMatch(/unknown block/);
    expect(with_({ id: "x", type: "text", text: "hola", onclick: "x" })[0]).toMatch(/text block/);
    expect(with_({ id: "x", type: "chart", chart: "https://evil.example" })[0]).toMatch(/chart/);
    expect(with_({ id: "x", type: "action", screen: "gasto", label: " " })[0]).toMatch(/action/);
    expect(with_({ type: "heading", text: "x" })[0]).toMatch(/needs an id/);
    expect(pageErrors({ ...ok, blocks: [...ok.blocks, ok.blocks[0]] })).toContain(
      "blocks[16]: id used twice",
    );
    expect(pageErrors({ version: 2, blocks: [] })).toHaveLength(1);
    expect(pageErrors({ version: 1, blocks: [], script: "x" })).toHaveLength(1);
    expect(pageErrors({ version: 1, full: "yes", blocks: [] })).toHaveLength(1);
    expect(with_({ id: "x", type: "heading", text: "x", level: 4 })[0]).toMatch(/level/);
    expect(with_({ id: "x", type: "todo", text: "x", done: "sí" })[0]).toMatch(/to-do/);
    expect(with_({ id: "x", type: "divider", text: "x" })[0]).toMatch(/divider/);
    expect(with_({ id: "x", type: "text", text: "x", indent: 7 })[0]).toMatch(/text block/);
    expect(with_({ id: "x", type: "page", page: "https://x" })[0]).toMatch(/page link/);
    expect(
      with_({ id: "x", type: "database", source: "t", view: { layout: "kanban" } })[0],
    ).toMatch(/database/);
    expect(
      with_({ id: "x", type: "database", source: "t", view: { layout: "table", sql: "x" } })[0],
    ).toMatch(/database/);
    expect(with_({ id: "x", type: "callout", text: "x", icon: "<img>" })[0]).toMatch(/callout/);
    expect(
      pageErrors({
        version: 1,
        blocks: Array.from({ length: 1001 }, (_, i) => ({ id: `t${i}`, type: "text", text: "x" })),
      }),
    ).toHaveLength(1);
  });
});
