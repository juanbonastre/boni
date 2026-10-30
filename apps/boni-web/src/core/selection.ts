/**
 * Blocks selected as a whole, as Notion's (Juan, 2026-10-30): a selection that leaves a block takes whole blocks, and
 * what is done to them (copy, cut, delete, duplicate, move, indent, paste) made here on the page's list of blocks, by
 * code with no screen, so it is tested alone. The editor (PageView.tsx) draws it and turns keys into these.
 */
import { TEXT_BLOCKS } from "@boni/views";
import type { Page } from "./agent.ts";

type Block = Page["spec"]["blocks"][number];
type TextBlock = Extract<Block, { text: string }>;
const TEXT = new Set<string>(TEXT_BLOCKS);
export const isTextBlock = (b: Block | undefined): b is TextBlock => !!b && TEXT.has(b.type);
const indentOf = (b: Block): number => ("indent" in b && b.indent) || 0;

/** The ids from one block to another, both included, in the page's order (either may come first). */
export function rangeIds(blocks: readonly Block[], anchor: string, focus: string): string[] {
  const a = blocks.findIndex((b) => b.id === anchor);
  const f = blocks.findIndex((b) => b.id === focus);
  if (a < 0 || f < 0) return [];
  const [from, to] = a <= f ? [a, f] : [f, a];
  return blocks.slice(from, to + 1).map((b) => b.id);
}

/** The page without these blocks; a page is never left with none (one empty text). */
export function withoutBlocks(
  blocks: readonly Block[],
  ids: readonly string[],
  newId: () => string,
): Block[] {
  const gone = new Set(ids);
  const rest = blocks.filter((b) => !gone.has(b.id));
  return rest.length ? rest : [{ id: newId(), type: "text", text: "" }];
}

/** Copies of these blocks right after the last of them, each with an id of its own. */
export function duplicated(
  blocks: readonly Block[],
  ids: readonly string[],
  newId: () => string,
): { blocks: Block[]; ids: string[] } {
  const chosen = new Set(ids);
  const copies = blocks
    .filter((b) => chosen.has(b.id))
    .map((b) => ({ ...b, id: newId() }) as Block);
  const last = Math.max(...blocks.map((b, i) => (chosen.has(b.id) ? i : -1)));
  if (last < 0) return { blocks: [...blocks], ids: [] };
  const out = [...blocks];
  out.splice(last + 1, 0, ...copies);
  return { blocks: out, ids: copies.map((b) => b.id) };
}

/** These blocks (one run of them) one place up or down, past the block next to them; null when they cannot go. */
export function moved(
  blocks: readonly Block[],
  ids: readonly string[],
  dir: -1 | 1,
): Block[] | null {
  const chosen = new Set(ids);
  const at = blocks.map((b, i) => (chosen.has(b.id) ? i : -1)).filter((i) => i >= 0);
  if (!at.length) return null;
  const first = at[0] as number;
  const last = at[at.length - 1] as number;
  // Blocks placed on a page's grid keep their place there: only the page's flow moves by keys.
  if (blocks.slice(first, last + 1).some((b) => b.at)) return null;
  const other = dir < 0 ? first - 1 : last + 1;
  const passed = blocks[other];
  if (!passed || passed.at) return null;
  const run = blocks.slice(first, last + 1);
  const out = blocks.filter((_, i) => i < first || i > last);
  out.splice(dir < 0 ? first - 1 : first + 1, 0, ...run);
  return out;
}

/** Each of these text blocks one level deeper (at most one under the block above it) or shallower. */
export function indented(blocks: readonly Block[], ids: readonly string[], by: 1 | -1): Block[] {
  const chosen = new Set(ids);
  const out: Block[] = [];
  for (const b of blocks) {
    if (!chosen.has(b.id) || !isTextBlock(b)) {
      out.push(b);
      continue;
    }
    const above = out[out.length - 1];
    const deepest = above ? Math.min(4, indentOf(above) + 1) : 0;
    const to = by > 0 ? Math.min(indentOf(b) + 1, deepest) : Math.max(0, indentOf(b) - 1);
    const { indent: _, ...rest } = b as TextBlock & { indent?: number };
    out.push((to ? { ...rest, indent: to } : rest) as Block);
  }
  return out;
}

/** Blocks come in with ids of their own, one level deeper as the block they land on (at most four). */
function fresh(incoming: readonly Block[], newId: () => string, base: number): Block[] {
  return incoming.map((b) => {
    const copy = { ...b, id: newId() } as Block;
    if (!isTextBlock(copy) || !base) return copy;
    return { ...copy, indent: Math.min(4, indentOf(copy) + base) } as Block;
  });
}

/**
 * Blocks pasted into a text block where its text is selected (`start`..`end`): the text before joins the first one
 * when that is plain text, the text after joins the last; an empty plain block becomes the first one. Where the
 * caret ends: at the end of what was pasted.
 */
export function pastedInto(
  blocks: readonly Block[],
  at: { id: string; start: number; end: number },
  incoming: readonly Block[],
  newId: () => string,
): { blocks: Block[]; focus: { block: string; at: number } } | null {
  const i = blocks.findIndex((b) => b.id === at.id);
  const here = blocks[i];
  if (!isTextBlock(here) || !incoming.length) return null;
  const head = here.text.slice(0, at.start);
  const tail = here.text.slice(at.end);
  const made = fresh(incoming, newId, indentOf(here));
  const out: Block[] = [];
  const first = made[0] as Block;
  if (!head && here.type === "text") out.push({ ...first, id: here.id } as Block);
  else if (first.type === "text" && isTextBlock(first))
    out.push({ ...here, text: head + first.text });
  else out.push({ ...here, text: head }, first);
  out.push(...made.slice(1));
  const last = out[out.length - 1] as Block;
  let focus: { block: string; at: number };
  if (isTextBlock(last) && last.type !== "code") {
    focus = { block: last.id, at: last.text.length };
    out[out.length - 1] = { ...last, text: last.text + tail } as Block;
  } else {
    const after: Block = { id: newId(), type: "text", text: tail };
    out.push(after);
    focus = { block: after.id, at: 0 };
  }
  return { blocks: [...blocks.slice(0, i), ...out, ...blocks.slice(i + 1)], focus };
}

/** Blocks pasted in place of selected ones (a cut and paste, or a paste over a selection). */
export function replacedBy(
  blocks: readonly Block[],
  ids: readonly string[],
  incoming: readonly Block[],
  newId: () => string,
): Block[] {
  const chosen = new Set(ids);
  const first = blocks.findIndex((b) => chosen.has(b.id));
  if (first < 0) return [...blocks];
  const made = fresh(incoming, newId, 0);
  const rest = blocks.filter((b) => !chosen.has(b.id));
  rest.splice(first, 0, ...made);
  return rest.length ? rest : [{ id: newId(), type: "text", text: "" }];
}
