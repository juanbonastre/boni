import { describe, expect, it } from "vitest";
import type { Page } from "./agent.ts";
import {
  duplicated,
  indented,
  moved,
  pastedInto,
  rangeIds,
  replacedBy,
  withoutBlocks,
} from "./selection.ts";

type Block = Page["spec"]["blocks"][number];
const text = (id: string, t: string, extra: Record<string, unknown> = {}) =>
  ({ id, type: "text", text: t, ...extra }) as Block;
const page: Block[] = [
  text("a", "Uno"),
  { id: "b", type: "bullet", text: "Dos" } as Block,
  { id: "c", type: "divider" } as Block,
  text("d", "Cuatro"),
];
let n = 0;
const newId = () => `n${++n}`;

describe("blocks selected as a whole (Notion's)", () => {
  it("a range is every block between two, in the page's order, whichever comes first", () => {
    expect(rangeIds(page, "d", "b")).toEqual(["b", "c", "d"]);
    expect(rangeIds(page, "a", "a")).toEqual(["a"]);
    expect(rangeIds(page, "a", "zz")).toEqual([]);
  });

  it("delete, duplicate, move and indent act on the selected blocks only", () => {
    expect(withoutBlocks(page, ["b", "c"], newId).map((b) => b.id)).toEqual(["a", "d"]);
    expect(withoutBlocks(page, ["a", "b", "c", "d"], newId)).toEqual([
      { id: expect.any(String), type: "text", text: "" },
    ]);
    const dup = duplicated(page, ["a", "b"], newId);
    expect(dup.blocks.map((b) => b.id)).toEqual(["a", "b", ...dup.ids, "c", "d"]);
    expect(dup.blocks[2]).toMatchObject({ type: "text", text: "Uno" });
    expect(moved(page, ["b", "c"], -1)?.map((b) => b.id)).toEqual(["b", "c", "a", "d"]);
    expect(moved(page, ["a"], -1)).toBeNull();
    expect(moved(page, ["c"], 1)?.map((b) => b.id)).toEqual(["a", "b", "d", "c"]);
    const deeper = indented(page, ["b", "c", "d"], 1);
    expect(deeper[1]).toMatchObject({ id: "b", indent: 1 });
    expect(deeper[2]).toEqual(page[2]);
    expect(deeper[3]).toMatchObject({ id: "d", indent: 1 });
    expect(indented(deeper, ["b"], -1)[1]).not.toHaveProperty("indent");
  });

  it("pasting several blocks into a text: the text before joins the first, the text after the last", () => {
    const incoming = [
      text("x", "pegado uno"),
      { id: "y", type: "bullet", text: "pegado dos" } as Block,
    ];
    const r = pastedInto(page, { id: "a", start: 1, end: 2 }, incoming, newId);
    expect(r?.blocks.map((b) => [b.type, "text" in b ? b.text : ""])).toEqual([
      ["text", "Upegado uno"],
      ["bullet", "pegado doso"],
      ["bullet", "Dos"],
      ["divider", ""],
      ["text", "Cuatro"],
    ]);
    expect(r?.focus).toEqual({ block: r?.blocks[1]?.id, at: "pegado dos".length });
    // An empty plain block becomes the first pasted block (a heading stays a heading).
    const empty = [text("e", "")];
    const h = pastedInto(
      empty,
      { id: "e", start: 0, end: 0 },
      [{ id: "h", type: "heading", text: "Título", level: 2 } as Block, text("p", "Párrafo")],
      newId,
    );
    expect(h?.blocks).toEqual([
      { id: "e", type: "heading", text: "Título", level: 2 },
      { id: expect.any(String), type: "text", text: "Párrafo" },
    ]);
  });

  it("pasting over selected blocks puts the new ones in their place", () => {
    const r = replacedBy(page, ["b", "c"], [text("x", "nuevo")], newId);
    expect(r.map((b) => ("text" in b ? b.text : b.type))).toEqual(["Uno", "nuevo", "Cuatro"]);
    expect(r[1]?.id).not.toBe("x");
  });
});
