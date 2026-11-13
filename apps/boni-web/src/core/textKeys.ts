/**
 * What the keys of a page's text do to its blocks (Notion's): Enter makes the next block (a list goes on, an empty
 * item ends it), Backspace at a block's start turns it to text, takes its nesting out or joins it to the one above,
 * Tab nests it, Markdown typed at a line's start turns it into a heading, a list or a to-do. Pure: the editor
 * (components/TextRun.tsx) says where the caret is and applies what comes back.
 */
import type { Page } from "./agent.ts";
import { isText, type TextBlock } from "./docModel.ts";

type Block = Page["spec"]["blocks"][number];
export type TextKind =
  | "text"
  | "h1"
  | "h2"
  | "h3"
  | "bullet"
  | "numbered"
  | "todo"
  | "toggle"
  | "quote"
  | "callout"
  | "code";

/** Where the caret goes after a change: a block's start, its end or a place in its text. */
export type Focus = { block: string; at: "start" | "end" | number };
/** Blocks changed by a key, and where the caret goes. */
export interface KeyEdit {
  blocks: Block[];
  focus?: Focus;
}

export const kindOf = (b: TextBlock): TextKind =>
  b.type === "heading" ? (`h${b.level ?? 1}` as TextKind) : (b.type as TextKind);
export const indentOf = (b: Block | undefined): number => (b && "indent" in b && b.indent) || 0;
export const withIndent = (n: number) => (n > 0 ? { indent: Math.min(n, 4) as 1 | 2 | 3 | 4 } : {});

/** The same block (id, text and indent kept) as another kind of text. */
export function asKind(b: TextBlock, kind: TextKind, text = b.text): TextBlock {
  // Its indent and its place on the grid stay.
  const ind = { ...withIndent(indentOf(b)), ...(b.at ? { at: b.at } : {}) };
  if (kind === "h1" || kind === "h2" || kind === "h3")
    return { id: b.id, type: "heading", text, level: Number(kind[1]) as 1 | 2 | 3, ...ind };
  if (kind === "toggle") return { id: b.id, type: "toggle", text, open: true, ...ind };
  if (kind === "callout")
    return {
      id: b.id,
      type: "callout",
      text,
      icon: b.type === "callout" && b.icon ? b.icon : "💡",
      ...ind,
    };
  return { id: b.id, type: kind, text, ...ind } as TextBlock;
}

export const emptyText = (id: string, indent = 0): TextBlock => ({
  id,
  type: "text",
  text: "",
  ...withIndent(indent),
});

/** The block with another nesting. */
function nested(b: TextBlock, to: number): TextBlock {
  const { indent: _, ...rest } = b as TextBlock & { indent?: number };
  return { ...rest, ...withIndent(to) } as TextBlock;
}

/** A block with the ones nested under it (moved, duplicated and deleted together, as in Notion). */
export function withChildren(blocks: readonly Block[], i: number): Block[] {
  const base = indentOf(blocks[i]);
  let j = i + 1;
  while (j < blocks.length && indentOf(blocks[j]) > base) j++;
  return blocks.slice(i, j);
}

/** Markdown at the start of a line turns the block into another kind, as Notion does. */
export const SHORTCUTS: [string, TextKind | "divider"][] = [
  ["### ", "h3"],
  ["## ", "h2"],
  ["# ", "h1"],
  ["- ", "bullet"],
  ["* ", "bullet"],
  ["1. ", "numbered"],
  ["[] ", "todo"],
  ["[ ] ", "todo"],
  ["> ", "toggle"],
  ['" ', "quote"],
  ["```", "code"],
  ["---", "divider"],
];
/** Kinds whose Enter makes another of the same kind (a list goes on). */
const CONTINUES = new Set(["bullet", "numbered", "todo"]);
/** Kinds whose empty line ends with Enter (it becomes text), as Notion's lists. */
const ENDS = new Set(["bullet", "numbered", "todo", "toggle", "quote", "callout"]);

/**
 * A text block whose text was `was` and now starts with one of the shortcuts it did not start with before: what it
 * turns into (the shortcut taken from its text). Only a text block, only a shortcut just typed: a paragraph kept as
 * it was written that starts with «> » does not change kind because a word was typed at its end.
 */
export function shortcutTyped(
  blocks: readonly Block[],
  index: number,
  was: string,
  newId: () => string,
): KeyEdit | null {
  const block = blocks[index];
  if (!block || block.type !== "text") return null;
  for (const [prefix, to] of SHORTCUTS) {
    if (!block.text.startsWith(prefix) || was.startsWith(prefix)) continue;
    const out = [...blocks];
    if (to === "divider") {
      const after = emptyText(newId(), indentOf(block));
      out.splice(index, 1, { id: block.id, type: "divider" }, after);
      return { blocks: out, focus: { block: after.id, at: "start" } };
    }
    out[index] = asKind(block, to, block.text.slice(prefix.length));
    return { blocks: out, focus: { block: block.id, at: 0 } };
  }
  return null;
}

/** Enter in a text block with the caret at `at` (Ctrl+Enter in code): the block goes on in the next one. */
export function enterIn(
  blocks: readonly Block[],
  index: number,
  at: number,
  newId: () => string,
): KeyEdit | null {
  const block = blocks[index];
  if (!block || !isText(block)) return null;
  const indent = indentOf(block);
  const out = [...blocks];
  // Enter on an empty list item first comes out of its nesting, then ends the list, as in Notion.
  if (!block.text && ENDS.has(block.type)) {
    out[index] = indent > 0 ? nested(block, indent - 1) : asKind(block, "text");
    return { blocks: out, focus: { block: block.id, at: "start" } };
  }
  const tail = block.type === "code" ? "" : block.text.slice(at);
  const head = block.type === "code" ? block.text : block.text.slice(0, at);
  // A toggle's next line goes inside it; a list goes on; anything else is followed by text.
  const made: TextBlock =
    block.type === "toggle"
      ? emptyText(newId(), Math.min(4, indent + 1))
      : CONTINUES.has(block.type)
        ? {
            ...asKind({ ...block, id: newId() }, kindOf(block), tail),
            ...(block.type === "todo" ? { done: false } : {}),
          }
        : { ...emptyText(newId(), indent), text: tail };
  // A closed toggle opens to take the new line.
  const kept = {
    ...block,
    text: head,
    ...(block.type === "toggle" && !block.open ? { open: true } : {}),
  } as TextBlock;
  out.splice(index, 1, kept, made);
  return { blocks: out, focus: { block: made.id, at: "start" } };
}

/**
 * Backspace with the caret at a text block's start: it turns to text, then comes out of its nesting, then joins the
 * text block above (the caret where the two meet); an empty one after a block that is not text goes away.
 */
export function backspaceAtStart(
  blocks: readonly Block[],
  index: number,
  prev: Block | undefined,
): KeyEdit | null {
  const block = blocks[index];
  if (!block || !isText(block)) return null;
  const out = [...blocks];
  if (block.type !== "text") {
    out[index] = asKind(block, "text");
    return { blocks: out, focus: { block: block.id, at: "start" } };
  }
  const indent = indentOf(block);
  if (indent > 0) {
    out[index] = nested(block, indent - 1);
    return { blocks: out, focus: { block: block.id, at: "start" } };
  }
  if (prev && isText(prev)) {
    const joined = { ...prev, text: prev.text + block.text } as TextBlock;
    return {
      blocks: blocks.flatMap((b) => (b.id === block.id ? [] : b.id === prev.id ? [joined] : [b])),
      focus: { block: prev.id, at: prev.text.length },
    };
  }
  if (prev && !block.text) return { blocks: blocks.filter((b) => b.id !== block.id) };
  return null;
}

/** Tab nests a block under the one above (at most one level deeper), Shift+Tab takes it back out. */
export function tabIn(
  blocks: readonly Block[],
  index: number,
  prev: Block | undefined,
  out: boolean,
): Block[] | null {
  const block = blocks[index];
  if (!block || !isText(block)) return null;
  const indent = indentOf(block);
  const deeper = Math.min(4, indentOf(prev) + 1, indent + 1);
  const to = out ? Math.max(0, indent - 1) : prev ? deeper : indent;
  if (to === indent) return null;
  const next = [...blocks];
  next[index] = nested(block, to);
  return next;
}
