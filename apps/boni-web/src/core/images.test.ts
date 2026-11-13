// What the gestures on a note's images do to its blocks (task 2h), and how they read back as Markdown.
import { blocksToMarkdown, markdownToBlocks } from "@boni/views";
import { describe, expect, it } from "vitest";
import type { Page } from "./agent.ts";
import {
  cropped,
  imagesOf,
  moveImage,
  reshaped,
  sized,
  splitRow,
  tidyCrop,
  withImage,
} from "./images.ts";

type Block = Page["spec"]["blocks"][number];

const md = [
  "Antes.",
  "![a.png|480](boni:f_a)",
  "![b.png](boni:f_b) ![c.png|200](boni:f_c)",
  "Después.",
  "",
].join("\n\n");
const read = () => markdownToBlocks(md) as Block[];
let n = 0;
const makeId = () => `n${++n}`;
const text = (blocks: Block[] | null) => blocksToMarkdown(blocks ?? []);

describe("an image's width and crop", () => {
  it("a width set, and taken off; the same width is no change", () => {
    const blocks = read();
    const a = blocks[1] as Block;
    expect(text(withImage(blocks, { block: a.id, index: 0 }, sized(320.4)))).toContain(
      "![a.png|320](boni:f_a)",
    );
    expect(text(withImage(blocks, { block: a.id, index: 0 }, sized(undefined)))).toContain(
      "\n![a.png](boni:f_a)\n",
    );
    expect(withImage(blocks, { block: a.id, index: 0 }, sized(480))).toBeNull();
  });

  it("an image of a row cropped: only its own link changes; the whole image again takes the crop off", () => {
    const blocks = read();
    const row = blocks[2] as Block;
    const out = withImage(
      blocks,
      { block: row.id, index: 1 },
      cropped({ x: 10.04, y: 0, w: 50, h: 80 }),
    );
    expect(text(out)).toContain("![b.png](boni:f_b) ![c.png|200|crop=10,0,50,80](boni:f_c)");
    const back = withImage(
      out as Block[],
      { block: row.id, index: 1 },
      cropped({ x: 0, y: 0, w: 100, h: 100 }),
    );
    expect(text(back)).toBe(text(blocks));
  });

  it("a crop kept inside the image, one decimal, at least 1 % of it", () => {
    expect(tidyCrop({ x: 95, y: -3, w: 20, h: 0.01 })).toEqual({ x: 80, y: 0, w: 20, h: 1 });
    expect(tidyCrop({ x: 12.345, y: 0, w: 50.06, h: 100 })).toEqual({
      x: 12.3,
      y: 0,
      w: 50.1,
      h: 100,
    });
    expect(tidyCrop({ x: 0, y: 0, w: 100, h: 100 })).toBeNull();
  });
});

describe("an image moved", () => {
  it("beside another alone: the two make a row, their sizes even; its old place is gone", () => {
    const blocks = read();
    const [, a, row, after] = blocks as [Block, Block, Block, Block];
    const out = moveImage(
      blocks,
      { block: a.id, index: 0 },
      { block: after.id, side: "below" },
      makeId,
    );
    expect(text(out)).toBe(
      "Antes.\n\n![b.png](boni:f_b) ![c.png|200](boni:f_c)\n\nDespués.\n\n![a.png|480](boni:f_a)\n",
    );
    // Its block moved whole: the same id, so a pointer at it (task 85) still finds it.
    expect(out?.at(-1)?.id).toBe(a.id);
    const joined = moveImage(
      blocks,
      { block: row.id, index: 0 },
      { block: a.id, index: 0, side: "left" },
      makeId,
    );
    expect(text(joined)).toBe(
      "Antes.\n\n![b.png](boni:f_b) ![a.png](boni:f_a)\n\n![c.png](boni:f_c)\n\nDespués.\n",
    );
  });

  it("into a row and out of it: a row left with one is a file block again", () => {
    const blocks = read();
    const [before, a, row] = blocks as [Block, Block, Block];
    const three = moveImage(
      blocks,
      { block: a.id, index: 0 },
      { block: row.id, index: 1, side: "right" },
      makeId,
    );
    expect(text(three)).toBe(
      "Antes.\n\n![b.png](boni:f_b) ![c.png|200](boni:f_c) ![a.png](boni:f_a)\n\nDespués.\n",
    );
    const out = moveImage(
      three as Block[],
      { block: row.id, index: 2 },
      { block: before.id, side: "above" },
      makeId,
    );
    expect(text(out)).toBe(
      "![a.png](boni:f_a)\n\nAntes.\n\n![b.png](boni:f_b) ![c.png|200](boni:f_c)\n\nDespués.\n",
    );
    const twoOut = moveImage(
      blocks,
      { block: row.id, index: 0 },
      { block: before.id, side: "below" },
      makeId,
    );
    expect(twoOut?.map((b) => b.type)).toEqual(["text", "file", "file", "file", "text"]);
    expect(text(twoOut)).toContain("![c.png](boni:f_c)");
  });

  it("within its row only its place changes, the sizes kept; dropped where it is, nothing", () => {
    const blocks = read();
    const row = blocks[2] as Block;
    const out = moveImage(
      blocks,
      { block: row.id, index: 0 },
      { block: row.id, index: 1, side: "right" },
      makeId,
    );
    expect(text(out)).toContain("![c.png|200](boni:f_c) ![b.png](boni:f_b)");
    expect(
      moveImage(
        blocks,
        { block: row.id, index: 0 },
        { block: row.id, index: 1, side: "left" },
        makeId,
      ),
    ).toBeNull();
    expect(
      moveImage(
        blocks,
        { block: row.id, index: 0 },
        { block: row.id, index: 0, side: "right" },
        makeId,
      ),
    ).toBeNull();
    const a = blocks[1] as Block;
    expect(
      moveImage(blocks, { block: a.id, index: 0 }, { block: a.id, side: "below" }, makeId),
    ).toBeNull();
    expect(
      moveImage(blocks, { block: a.id, index: 0 }, { block: row.id, side: "above" }, makeId),
    ).toBeNull();
  });

  it("a full row takes no ninth image", () => {
    const eight = Array.from({ length: 8 }, (_, i) => `![${i}.png](boni:f_${i})`).join(" ");
    const blocks = markdownToBlocks(`${eight}\n\n![x.png](boni:f_x)\n`) as Block[];
    const [row, x] = blocks as [Block, Block];
    expect(
      moveImage(
        blocks,
        { block: x.id, index: 0 },
        { block: row.id, index: 7, side: "right" },
        makeId,
      ),
    ).toBeNull();
  });
});

describe("a row split, and every image in order", () => {
  it("each image a block of its own, the first keeping the row's id; the viewer's order is the text's", () => {
    const blocks = read();
    const row = blocks[2] as Block;
    expect(imagesOf(blocks).map((i) => i.shown.name)).toEqual(["a.png", "b.png", "c.png"]);
    const out = splitRow(blocks, row.id, makeId);
    expect(text(out)).toBe(
      "Antes.\n\n![a.png|480](boni:f_a)\n\n![b.png](boni:f_b)\n\n![c.png](boni:f_c)\n\nDespués.\n",
    );
    expect(out?.[2]?.id).toBe(row.id);
  });
});

describe("the crop's box dragged", () => {
  it("by a corner it grows or shrinks, never past the image or under 5 %; whole it moves inside the image", () => {
    const b = { x: 10, y: 10, w: 50, h: 50 };
    expect(reshaped(b, "se", 20, 10)).toEqual({ x: 10, y: 10, w: 70, h: 60 });
    expect(reshaped(b, "se", 80, 80)).toEqual({ x: 10, y: 10, w: 90, h: 90 });
    expect(reshaped(b, "nw", -30, 60)).toEqual({ x: 0, y: 55, w: 60, h: 5 });
    expect(reshaped(b, "ne", -60, 0)).toEqual({ x: 10, y: 10, w: 5, h: 50 });
    expect(reshaped(b, "move", 70, -20)).toEqual({ x: 50, y: 0, w: 50, h: 50 });
  });
});
