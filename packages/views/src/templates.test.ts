import { describe, expect, it } from "vitest";
import { PAGE_TEMPLATES, pageErrors, withoutRetired } from "./page.ts";
import { templateChanges, templatePage } from "./templates.ts";

describe("Boni's template pages", () => {
  it("come valid and unchanged (their blocks against Boni's collections: apps/server data.test.ts)", () => {
    for (const name of PAGE_TEMPLATES) {
      const { spec, title } = templatePage(name);
      expect(title).not.toBe("");
      expect(pageErrors(spec)).toEqual([]);
      expect(spec.template).toBe(name);
      expect(templateChanges(name, spec)).toEqual([]);
    }
  });

  it("say what the user changed: added, removed, changed, resized, moved", () => {
    const { spec } = templatePage("uso-ia");
    const blocks = spec.blocks
      .filter((b) => b.id !== "u8")
      .map((b) => (b.id === "u2" ? { ...b, title: "Llamadas del mes" } : b))
      .map((b) => (b.id === "u5" && b.at ? { ...b, at: { ...b.at, h: "l" as const } } : b));
    blocks.push({ id: "nota", type: "text", text: "Mi nota" });
    const signs = templateChanges("uso-ia", { ...spec, blocks }).map(
      (c) => `${c.sign}${c.block?.id ?? ""}`,
    );
    expect(signs).toEqual(["+nota", "−u8", "✎u2", "⤢u5"]);
    // The list's order of two blocks in different columns draws the same; in one column, it moves them.
    const swap = (i: number, j: number) => {
      const list = [...spec.blocks];
      [list[i], list[j]] = [list[j]!, list[i]!];
      return templateChanges("uso-ia", { ...spec, blocks: list }).map((c) => c.sign);
    };
    expect(swap(0, 1)).toEqual([]);
    expect(swap(5, 6)).toEqual(["↕"]);
  });

  it("is a fresh copy every time (changing one never changes Boni's)", () => {
    const a = templatePage("actividad");
    a.spec.blocks.pop();
    expect(templatePage("actividad").spec.blocks.length).toBe(a.spec.blocks.length + 1);
  });
});

describe("pages stored before the design audit", () => {
  it("lose only the retired blocks (Boni's models, its own numbers), never the rest", () => {
    const old = {
      version: 1,
      blocks: [
        { id: "t", type: "text", text: "Hola" },
        { id: "m", type: "models" },
        { id: "k", type: "model-keys" },
        { id: "s", type: "number", from: "boni", source: "spend" },
        {
          id: "n",
          type: "number",
          from: "collection",
          collection: "t_x",
          measure: "count",
          period: "all",
        },
      ],
    };
    expect(pageErrors(old)).not.toEqual([]);
    const now = withoutRetired(old) as { blocks: { id: string }[] };
    expect(now.blocks.map((b) => b.id)).toEqual(["t", "n"]);
    expect(now.blocks[1]).not.toHaveProperty("from");
    expect(pageErrors(now)).toEqual([]);
    // A page with nothing retired is the very same object.
    const fine = { version: 1, blocks: [{ id: "t", type: "text", text: "Hola" }] };
    expect(withoutRetired(fine)).toBe(fine);
  });
});
