import type { PageBlock, Place } from "@boni/views";

/**
 * A page's blocks on its grid of 12 columns (packages/views catalogue.ts `Place`): a block without a place is a
 * row of its own, the whole width, as a Notion page's text; blocks with one share their row's columns, one under
 * another in each column. Rows are where their first block is in the list; a column's blocks keep the list's order.
 * Pure: every change returns the new list of blocks, as the page keeps it.
 */

type Block = PageBlock;
export type Where = "above" | "below" | "left" | "right";
export interface GridCol {
  col: number;
  w: number;
  blocks: Block[];
}
export type Segment =
  | { kind: "flow"; block: Block }
  | { kind: "row"; row: string; cols: GridCol[] };

/** The page as it is drawn: blocks on their own and rows of columns, in the list's order. */
export function segmentsOf(blocks: readonly Block[]): Segment[] {
  const out: Segment[] = [];
  const rows = new Map<string, Extract<Segment, { kind: "row" }>>();
  for (const b of blocks) {
    if (!b.at) {
      out.push({ kind: "flow", block: b });
      continue;
    }
    let r = rows.get(b.at.row);
    if (!r) {
      r = { kind: "row", row: b.at.row, cols: [] };
      rows.set(b.at.row, r);
      out.push(r);
    }
    let c = r.cols.find((x) => x.col === b.at?.col);
    if (!c) {
      c = { col: b.at.col, w: b.at.w, blocks: [] };
      r.cols.push(c);
    }
    c.blocks.push(b);
  }
  for (const s of out) if (s.kind === "row") s.cols.sort((a, b) => a.col - b.col);
  return out;
}

const placed = (b: Block, at: Place | undefined): Block => {
  const { at: _old, ...rest } = b;
  return (at ? { ...rest, at } : rest) as Block;
};

/** A row id the page does not use yet. */
export function newRowId(blocks: readonly Block[]): string {
  const used = new Set(blocks.map((b) => b.at?.row));
  let n = blocks.length + 1;
  while (used.has(`r${n}`)) n++;
  return `r${n}`;
}

/** Each row's columns numbered 0, 1… again (after one is emptied). */
export function compact(blocks: readonly Block[]): Block[] {
  const renumber = new Map<string, Map<number, number>>();
  for (const s of segmentsOf(blocks))
    if (s.kind === "row") renumber.set(s.row, new Map(s.cols.map((c, i) => [c.col, i])));
  return blocks.map((b) => {
    if (!b.at) return b;
    const col = renumber.get(b.at.row)?.get(b.at.col) ?? 0;
    return col === b.at.col ? b : placed(b, { ...b.at, col });
  });
}

/** A row left with one column after a block went elsewhere becomes the whole width again (as in Notion). */
function dissolveIfAlone(blocks: Block[], row: string, hadCols: number): Block[] {
  if (hadCols < 2 || colsOf(blocks, row).length !== 1) return blocks;
  return blocks.map((b) => (b.at?.row === row ? placed(b, undefined) : b));
}

export const colsOf = (blocks: readonly Block[], row: string | undefined) => {
  const s = segmentsOf(blocks).find((x) => x.kind === "row" && x.row === row);
  return s && s.kind === "row" ? s.cols : [];
};

/**
 * Drops a block above or below another (in that one's column, or in the page's flow) or beside it: a new column,
 * with the block's own width when the row has room for it, else half of the other's (a block on its own becomes a
 * row of two halves). Nothing changes when there is no room and the other column cannot be split.
 */
export function moveTo(
  blocks: readonly Block[],
  id: string,
  target: string,
  where: Where,
): Block[] {
  if (id === target) return [...blocks];
  const moving = blocks.find((b) => b.id === id);
  const t0 = blocks.find((b) => b.id === target);
  if (!moving || !t0) return [...blocks];
  const fromRow = moving.at?.row;
  const fromCols = colsOf(blocks, fromRow).length;
  let list = blocks.filter((b) => b.id !== id);
  if (where === "above" || where === "below") {
    const h = moving.at?.h;
    const it = placed(
      moving,
      t0.at ? { row: t0.at.row, col: t0.at.col, w: t0.at.w, ...(h ? { h } : {}) } : undefined,
    );
    const j = list.findIndex((b) => b.id === target);
    list.splice(where === "above" ? j : j + 1, 0, it);
  } else if (!t0.at) {
    const row = newRowId(blocks);
    const j = list.findIndex((b) => b.id === target);
    const first = { row, w: 6 };
    const left = where === "left";
    list[j] = placed(t0, { ...first, col: left ? 1 : 0 });
    list.splice(left ? j : j + 1, 0, placed(moving, { ...first, col: left ? 0 : 1 }));
  } else {
    const tw = t0.at.w;
    const row = t0.at.row;
    // The row's free room first (a number beside a number keeps its width); else half of the other's.
    const free = 12 - colsOf(list, row).reduce((n, c) => n + c.w, 0);
    const own = moving.at && moving.at.row !== row ? moving.at.w : 6;
    const fits = Math.min(own, free) >= 2 || (free >= 1 && own <= free);
    if (!fits && tw < 2) return [...blocks];
    const nw = fits ? Math.min(own, free) : Math.floor(tw / 2);
    const at = where === "left" ? t0.at.col : t0.at.col + 1;
    list = list.map((b) => {
      if (b.at?.row !== row) return b;
      const shifted = b.at.col >= at ? b.at.col + 1 : b.at.col;
      const w = !fits && b.at.col === t0.at?.col ? tw - nw : b.at.w;
      return placed(b, { ...b.at, col: shifted, w });
    });
    const j = list.findIndex((b) => b.id === target);
    list.splice(j + 1, 0, placed(moving, { row, col: at, w: nw }));
  }
  list = compact(list);
  return fromRow && fromRow !== t0.at?.row ? dissolveIfAlone(list, fromRow, fromCols) : list;
}

/**
 * A block's column width. A block on its own gets a row of its own with that width; in a row, the next column (or
 * the one before) gives way so the row stays within 12.
 */
export function setWidth(blocks: readonly Block[], id: string, w: number): Block[] {
  const x = blocks.find((b) => b.id === id);
  if (!x || w < 1 || w > 12) return [...blocks];
  if (!x.at)
    return blocks.map((b) => (b.id === id ? placed(b, { row: newRowId(blocks), col: 0, w }) : b));
  const { row, col } = x.at;
  const cols = colsOf(blocks, row);
  const others = cols.filter((c) => c.col !== col).reduce((n, c) => n + c.w, 0);
  const widths = new Map(cols.map((c) => [c.col, c.w]));
  let width = w;
  let over = others + width - 12;
  for (const n of [col + 1, col - 1, ...cols.map((c) => c.col)]) {
    if (over <= 0) break;
    const nw = widths.get(n);
    if (n === col || nw === undefined) continue;
    const give = Math.min(over, nw - 1);
    widths.set(n, nw - give);
    over -= give;
  }
  if (over > 0) width -= over;
  widths.set(col, width);
  return blocks.map((b) =>
    b.at?.row === row ? placed(b, { ...b.at, w: widths.get(b.at.col) ?? b.at.w }) : b,
  );
}

/** A block's height (charts): low, medium or high. */
export function setHeight(blocks: readonly Block[], id: string, h: Place["h"]): Block[] {
  return blocks.map((b) => {
    if (b.id !== id) return b;
    const at = b.at ?? { row: newRowId(blocks), col: 0, w: 12 };
    return placed(b, h ? { ...at, h } : { row: at.row, col: at.col, w: at.w });
  });
}
