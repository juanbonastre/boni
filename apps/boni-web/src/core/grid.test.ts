import { type PageBlock, pageErrors } from "@boni/views";
import { describe, expect, it } from "vitest";
import { compact, moveTo, segmentsOf, setHeight, setWidth } from "./grid.ts";

const text = (id: string, at?: PageBlock["at"]): PageBlock =>
  ({ id, type: "text", text: id, ...(at ? { at } : {}) }) as PageBlock;
const at = (row: string, col: number, w: number) => ({ row, col, w });
const valid = (blocks: PageBlock[]) => expect(pageErrors({ version: 1, blocks })).toEqual([]);
const shape = (blocks: PageBlock[]) =>
  segmentsOf(blocks).map((s) =>
    s.kind === "flow"
      ? s.block.id
      : s.cols.map((c) => `${c.w}:${c.blocks.map((b) => b.id).join("")}`).join(" | "),
  );

describe("a page's grid", () => {
  const page = [
    text("a"),
    text("b", at("r", 0, 4)),
    text("c", at("r", 1, 8)),
    text("d", at("r", 0, 4)),
    text("e"),
  ];

  it("draws rows of columns where their first block is, the column's blocks one under another", () => {
    expect(shape(page)).toEqual(["a", "4:bd | 8:c", "e"]);
  });

  it("drops beside a block on its own: a row of two halves", () => {
    const next = moveTo(page, "e", "a", "right");
    expect(shape(next)).toEqual(["6:a | 6:e", "4:bd | 8:c"]);
    valid(next);
  });

  it("drops beside a block in a row: a new column with half of its width", () => {
    const next = moveTo(page, "a", "c", "left");
    expect(shape(next)).toEqual(["4:bd | 4:a | 4:c", "e"]);
    valid(next);
  });

  it("beside a block in a row with room: the block keeps its own width", () => {
    const narrow = [text("n", at("q", 0, 3)), text("m", at("p", 0, 6))];
    const next = moveTo(narrow, "m", "n", "right");
    expect(shape(next)).toEqual(["3:n | 6:m"]);
    valid(next);
  });

  it("drops above or below a block, into its column", () => {
    const next = moveTo(page, "e", "b", "below");
    expect(shape(next)).toEqual(["a", "4:bed | 8:c"]);
    valid(next);
  });

  it("a row left with one column becomes the whole width again", () => {
    const next = moveTo(page, "c", "e", "below");
    expect(shape(next)).toEqual(["a", "b", "d", "e", "c"]);
    valid(next);
  });

  it("numbers columns again when one empties", () => {
    const three = [text("x", at("q", 0, 4)), text("y", at("q", 1, 4)), text("z", at("q", 2, 4))];
    const next = compact(three.filter((b) => b.id !== "y"));
    expect(next.map((b) => b.at?.col)).toEqual([0, 1]);
  });

  it("widens a column and the next one gives way, never past 12", () => {
    const next = setWidth(page, "b", 9);
    expect(shape(next)).toEqual(["a", "9:bd | 3:c", "e"]);
    valid(next);
    expect(shape(setWidth(page, "c", 12))).toEqual(["a", "1:bd | 11:c", "e"]);
    // A block on its own gets a row of its own with that width.
    expect(shape(setWidth(page, "a", 4))).toEqual(["4:a", "4:bd | 8:c", "e"]);
  });

  it("sets a chart's height and keeps it when it moves", () => {
    const next = setHeight(page, "c", "l");
    expect(next.find((b) => b.id === "c")?.at).toEqual({ row: "r", col: 1, w: 8, h: "l" });
    const moved = moveTo(next, "c", "a", "below");
    expect(moved.find((b) => b.id === "c")?.at).toBeUndefined();
    const into = moveTo(next, "c", "b", "above");
    expect(into.find((b) => b.id === "c")?.at).toEqual({ row: "r", col: 0, w: 4, h: "l" });
  });
});
