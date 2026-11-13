// What the keys of a page's text do to its blocks (task 2g): the same as the textarea editor did, as data.
import { describe, expect, it } from "vitest";
import type { Page } from "./agent.ts";
import { backspaceAtStart, enterIn, shortcutTyped, tabIn } from "./textKeys.ts";

type Block = Page["spec"]["blocks"][number];
let n = 0;
const newId = () => `n${++n}`;

describe("Enter", () => {
  it("splits a block where the caret is; a list goes on, a to-do starts undone", () => {
    const blocks: Block[] = [{ id: "a", type: "todo", text: "compra pan", done: true }];
    const e = enterIn(blocks, 0, 6, newId);
    expect(e?.blocks).toEqual([
      { id: "a", type: "todo", text: "compra", done: true },
      { id: e?.focus?.block, type: "todo", text: " pan", done: false },
    ]);
    expect(e?.focus?.at).toBe("start");
  });
  it("on an empty item comes out of its nesting first, then ends the list", () => {
    const nested: Block[] = [{ id: "a", type: "bullet", text: "", indent: 1 }];
    expect(enterIn(nested, 0, 0, newId)?.blocks).toEqual([{ id: "a", type: "bullet", text: "" }]);
    const top: Block[] = [{ id: "a", type: "bullet", text: "" }];
    expect(enterIn(top, 0, 0, newId)?.blocks).toEqual([{ id: "a", type: "text", text: "" }]);
  });
  it("in a closed toggle opens it and writes inside it", () => {
    const blocks: Block[] = [{ id: "t", type: "toggle", text: "más", open: false }];
    const e = enterIn(blocks, 0, 3, newId);
    expect(e?.blocks[0]).toEqual({ id: "t", type: "toggle", text: "más", open: true });
    expect(e?.blocks[1]).toMatchObject({ type: "text", text: "", indent: 1 });
  });
  it("in code keeps the code whole and adds text after it", () => {
    const blocks: Block[] = [{ id: "c", type: "code", text: "a()\nb()" }];
    const e = enterIn(blocks, 0, 2, newId);
    expect(e?.blocks[0]?.id).toBe("c");
    expect(e?.blocks.map((b) => ("text" in b ? b.text : ""))).toEqual(["a()\nb()", ""]);
  });
});

describe("Backspace at a block's start", () => {
  it("turns it to text, then takes out its nesting, then joins it to the text above", () => {
    const h: Block[] = [{ id: "h", type: "heading", level: 2, text: "Título" }];
    expect(backspaceAtStart(h, 0, undefined)?.blocks).toEqual([
      { id: "h", type: "text", text: "Título" },
    ]);
    const ind: Block[] = [{ id: "a", type: "text", text: "x", indent: 2 }];
    expect(backspaceAtStart(ind, 0, undefined)?.blocks).toEqual([
      { id: "a", type: "text", text: "x", indent: 1 },
    ]);
    const two: Block[] = [
      { id: "a", type: "bullet", text: "uno" },
      { id: "b", type: "text", text: "dos" },
    ];
    expect(backspaceAtStart(two, 1, two[0])).toEqual({
      blocks: [{ id: "a", type: "bullet", text: "unodos" }],
      focus: { block: "a", at: 3 },
    });
  });
  it("takes away an empty line after a block that is not text, and does nothing at the page's start", () => {
    const blocks: Block[] = [
      { id: "d", type: "divider" },
      { id: "b", type: "text", text: "" },
    ];
    expect(backspaceAtStart(blocks, 1, blocks[0])?.blocks).toEqual([{ id: "d", type: "divider" }]);
    expect(backspaceAtStart([{ id: "a", type: "text", text: "x" }], 0, undefined)).toBeNull();
  });
});

describe("Tab", () => {
  it("nests at most one level under the block above; Shift+Tab takes it out", () => {
    const blocks: Block[] = [
      { id: "a", type: "bullet", text: "uno" },
      { id: "b", type: "bullet", text: "dos" },
    ];
    const once = tabIn(blocks, 1, blocks[0], false) as Block[];
    expect(once[1]).toEqual({ id: "b", type: "bullet", text: "dos", indent: 1 });
    expect(tabIn(once, 1, once[0], false)).toBeNull();
    expect((tabIn(once, 1, once[0], true) as Block[])[1]).toEqual(blocks[1]);
  });
});

describe("Markdown typed at a line's start", () => {
  it("turns a text block into its kind only when just typed", () => {
    const blocks: Block[] = [{ id: "a", type: "text", text: "# Hola" }];
    expect(shortcutTyped(blocks, 0, "#Hola", newId)?.blocks).toEqual([
      { id: "a", type: "heading", level: 1, text: "Hola" },
    ]);
    // A paragraph that already started with it (a note as it was written) stays as it is.
    expect(shortcutTyped(blocks, 0, "# Hol", newId)).toBeNull();
  });
  it("«---» makes a line and a new block after it, with the caret", () => {
    const e = shortcutTyped([{ id: "a", type: "text", text: "---" }], 0, "--", newId);
    expect(e?.blocks[0]).toEqual({ id: "a", type: "divider" });
    expect(e?.focus).toEqual({ block: e?.blocks[1]?.id, at: "start" });
  });
});
