import { describe, expect, it } from "vitest";
import { catalogueErrors } from "./catalogue.ts";
import { pageErrors } from "./page.ts";
import { SYSTEM_PAGES, systemChanges, systemPage } from "./systemPages.ts";

describe("Boni's screens as pages of blocks", () => {
  it("come valid, every block from the catalogue", () => {
    for (const name of SYSTEM_PAGES) {
      const spec = systemPage(name);
      expect(pageErrors(spec)).toEqual([]);
      for (const b of spec.blocks)
        if (b.type !== "heading") expect(catalogueErrors(b, { collections: [] }), b.id).toEqual([]);
      expect(systemChanges(name, spec)).toEqual([]);
    }
  });

  it("say what the user changed: added, removed, changed, resized, moved", () => {
    const spec = systemPage("models");
    const blocks = spec.blocks
      .filter((b) => b.id !== "keys")
      .map((b) => (b.id === "calls" ? { ...b, title: "Llamadas del mes" } : b))
      .map((b) => (b.id === "byday" && b.at ? { ...b, at: { ...b.at, h: "l" as const } } : b));
    blocks.push({ id: "nota", type: "text", text: "Mi nota" });
    const signs = systemChanges("models", { ...spec, blocks }).map(
      (c) => `${c.sign}${c.block?.id ?? ""}`,
    );
    expect(signs).toEqual(["+nota", "−keys", "✎calls", "⤢byday"]);
    // The list's order of two blocks in different columns draws the same; in one column, it moves them.
    const swap = (i: number, j: number) => {
      const list = [...spec.blocks];
      [list[i], list[j]] = [list[j]!, list[i]!];
      return systemChanges("models", { ...spec, blocks: list }).map((c) => c.sign);
    };
    expect(swap(0, 1)).toEqual([]);
    expect(swap(4, 5)).toEqual(["↕"]);
  });

  it("is a fresh copy every time (changing one never changes Boni's)", () => {
    const a = systemPage("models");
    a.blocks.pop();
    expect(systemPage("models").blocks.length).toBe(a.blocks.length + 1);
  });
});
