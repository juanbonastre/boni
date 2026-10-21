import { describe, expect, it } from "vitest";
import { pageErrors } from "./page.ts";

const ok = {
  version: 1,
  blocks: [
    { id: "h1", type: "heading", text: "Gastos" },
    { id: "t1", type: "text", text: "Lo que llevo gastado este mes." },
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
      "blocks[5]: id used twice",
    );
    expect(pageErrors({ version: 2, blocks: [] })).toHaveLength(1);
    expect(pageErrors({ version: 1, blocks: [], script: "x" })).toHaveLength(1);
    expect(
      pageErrors({
        version: 1,
        blocks: Array.from({ length: 201 }, (_, i) => ({ id: `t${i}`, type: "text", text: "x" })),
      }),
    ).toHaveLength(1);
  });
});
