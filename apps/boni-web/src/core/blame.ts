import { blocksToMarkdown } from "@boni/views";
import type { Page } from "./agent.ts";
import type { RowHistory } from "./audit.ts";

/**
 * Who wrote what of a record, for its page while its History is open (Juan, 2026-10-30): each block of its text by
 * who wrote it last (the log's `git blame` of its lines, matched to the editor's blocks by their words) and each
 * property by who changed it last.
 */

/** Who last wrote a block or a property, and the others who wrote part of it. */
export interface HistoryMark {
  by: string;
  at: number;
  others: string[];
}

type Block = Page["spec"]["blocks"][number];

/** Each property by who changed it last (the changes come oldest first). */
export function fieldMarks(d: RowHistory): Record<string, HistoryMark> {
  const out: Record<string, HistoryMark> = {};
  for (const c of d.changes) for (const f of c.fields) out[f] = { by: c.by, at: c.at, others: [] };
  return out;
}

/** A line's text without what makes it a list, a to-do, a heading or a quote. */
const MARKER = /^\s*(?:[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+|#{1,6}\s+|>\s?)/;
const bare = (s: string) => s.replace(MARKER, "").trim();

/**
 * Each block of the text with who wrote it last: its lines found in order among the blamed lines of the text (by
 * their words, whatever marks them), and the newest of them decides; the others who wrote some of it are kept.
 */
export function alignBlame(
  blocks: readonly Block[],
  blame: RowHistory["blame"],
): Record<string, HistoryMark> {
  const out: Record<string, HistoryMark> = {};
  let p = 0;
  for (const b of blocks) {
    const own = (b as { text?: unknown }).text;
    const lines = (typeof own === "string" ? own : blocksToMarkdown([b])).split("\n");
    const first = bare(lines[0] ?? "");
    if (!first) continue;
    let j = p;
    while (j < blame.length && bare(blame[j]?.text ?? "") !== first) j++;
    if (j >= blame.length) continue;
    const mine = blame.slice(j, j + lines.length);
    p = j + lines.length;
    const last = mine.reduce((a, x) => (x.at > a.at ? x : a));
    out[b.id] = {
      by: last.by,
      at: last.at,
      others: [...new Set(mine.map((x) => x.by))].filter((x) => x !== last.by),
    };
  }
  return out;
}
