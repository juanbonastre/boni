/**
 * The text of a page or a note as the editor's engine holds it (task 2g, ProseMirror): a run of blocks one after
 * another (text of every kind, dividers, files, links to pages) is one document, so text is selected from one block to
 * another as in a document; and back to the very blocks it was made of. A block that was not edited comes back as the
 * same object (so a note's text keeps its bytes, `writeMarkdown`), one whose text changed comes back with only its
 * text changed. Nothing here knows the screen.
 */
import { type Node as PMNode, Schema } from "prosemirror-model";
import type { Page } from "./agent.ts";

type Block = Page["spec"]["blocks"][number];
export type TextBlock = Extract<Block, { text: string }>;

/** The kinds of block whose text is typed in the document. */
export const TEXT_TYPES: ReadonlySet<string> = new Set([
  "text",
  "heading",
  "bullet",
  "numbered",
  "todo",
  "toggle",
  "quote",
  "callout",
  "code",
]);
export const isText = (b: Block): b is TextBlock => TEXT_TYPES.has(b.type);
/** Blocks that sit inside the text without text of their own: the caret passes over them, a selection takes them. */
export const IN_TEXT: ReadonlySet<string> = new Set(["divider", "file", "page"]);
/** Whether a block is part of the document of text around it. */
export const inRun = (b: Block): boolean => TEXT_TYPES.has(b.type) || IN_TEXT.has(b.type);

/**
 * One kind of node for every kind of text block (its kind and the rest of it are in `block`, its text is the node's;
 * a line break is "\n" in the text, as a textarea had it) and one for the blocks in the text that have none. No
 * marks: a text's format is its Markdown, painted over it (components/runFormat.ts, task 2f), so the text is the bytes.
 */
export const schema = new Schema({
  nodes: {
    doc: { content: "(blk | atom)+" },
    blk: {
      content: "text*",
      whitespace: "pre",
      attrs: { id: { default: null }, block: { default: null } },
      toDOM: () => ["div", 0],
    },
    atom: {
      atom: true,
      selectable: true,
      draggable: false,
      attrs: { id: { default: null }, block: { default: null } },
      toDOM: () => ["div"],
    },
    text: {},
  },
});

const nodes = new WeakMap<Block, PMNode>();
const blocksOfNodes = new WeakMap<PMNode, Block>();

/** The node of a block; the same block always gives the same node. */
export function nodeOf(b: Block): PMNode {
  const had = nodes.get(b);
  if (had) return had;
  const n = isText(b)
    ? schema.nodes.blk.create({ id: b.id, block: b }, b.text ? schema.text(b.text) : null)
    : schema.nodes.atom.create({ id: b.id, block: b });
  nodes.set(b, n);
  blocksOfNodes.set(n, b);
  return n;
}

/** A run of blocks as a document. */
export const docOf = (blocks: readonly Block[]): PMNode =>
  schema.nodes.doc.create(null, blocks.length ? blocks.map(nodeOf) : [nodeOf(blankText(""))]);

/** A text block for a node that has none yet (made by the engine), its id given later. */
function blankText(id: string): TextBlock {
  return { id, type: "text", text: "" };
}

/**
 * The block a node stands for: the very block it was made from while its text is the same, else that block with the
 * node's text. A node the engine made itself (no block yet) is a text block.
 */
export function blockOfNode(n: PMNode): Block {
  const had = blocksOfNodes.get(n);
  if (had) return had;
  const base = (n.attrs.block as Block | null) ?? blankText(String(n.attrs.id ?? ""));
  const id = String(n.attrs.id ?? base.id);
  let b: Block;
  if (n.type === schema.nodes.atom) b = base.id === id ? base : ({ ...base, id } as Block);
  else {
    const text = n.textContent;
    const was = isText(base) ? base : blankText(id);
    b = was.text === text && was.id === id ? was : ({ ...was, id, text } as Block);
  }
  blocksOfNodes.set(n, b);
  return b;
}

/** The blocks of a document, in order. */
export function blocksOfDoc(doc: PMNode): Block[] {
  const out: Block[] = [];
  doc.forEach((n) => {
    out.push(blockOfNode(n));
  });
  return out;
}

/**
 * The page's blocks with a run's blocks written back: `oldIds` were the run's (in order; they need not be next to
 * each other in the page, a folded toggle's blocks sit between), `next` is what the run holds now. A block still there
 * keeps its place, one gone leaves it, a new one goes after the block before it in the run; everything else of the
 * page stays as it was.
 */
export function spliceRun(
  full: readonly Block[],
  oldIds: readonly string[],
  next: readonly Block[],
): Block[] {
  const old = new Set(oldIds);
  const nextIds = new Set(next.map((b) => b.id));
  const kept = full.filter((b) => old.has(b.id) && nextIds.has(b.id)).map((b) => b.id);
  const keptInNext = next.filter((b) => old.has(b.id)).map((b) => b.id);
  const lastOld = full.reduce((at, b, i) => (old.has(b.id) ? i : at), -1);
  const firstOld = full.findIndex((b) => old.has(b.id));
  if (firstOld < 0) return [...full, ...next];
  const out: Block[] = [];
  if (kept.join("\n") !== keptInNext.join("\n")) {
    // Blocks of the run in another order than the page's: the run goes whole where it began.
    full.forEach((b, i) => {
      if (i === firstOld) out.push(...next);
      if (!old.has(b.id)) out.push(b);
    });
    return out;
  }
  let k = 0;
  full.forEach((b, i) => {
    if (!old.has(b.id)) out.push(b);
    else if (nextIds.has(b.id))
      while (k < next.length) {
        const n = next[k++] as Block;
        out.push(n);
        if (n.id === b.id) break;
      }
    else if (!kept.length && i === firstOld) {
      out.push(...next);
      k = next.length;
    }
    if (i === lastOld && k < next.length) {
      out.push(...next.slice(k));
      k = next.length;
    }
  });
  return out;
}
