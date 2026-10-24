/**
 * Who wrote each line of a note's text (Juan, 2026-10-24: «qué texto ha sido generado por quién»), as `git blame`
 * does, over the versions the operation log already keeps: each version is compared with the one before, line by
 * line; a line kept keeps its author, a new or changed line is the new version's. A line is a paragraph of a
 * Markdown note. Pure: the caller gives the versions (oldest first).
 */
export interface BlameVersion {
  text: string | null;
  by: string;
  at: number;
  /** The operation that wrote it. */
  seq: number;
}
export interface BlameLine {
  text: string;
  by: string;
  at: number;
  seq: number;
}

/** Beyond this many cells the middle of a change is not compared line by line: all of it goes to the new version. */
const MAX_CELLS = 4_000_000;

export function blame(versions: BlameVersion[]): BlameLine[] {
  let lines: BlameLine[] = [];
  for (const v of versions) {
    const next = v.text ? v.text.split("\n") : [];
    lines = step(lines, next, v);
  }
  return lines;
}

function step(prev: BlameLine[], next: string[], v: BlameVersion): BlameLine[] {
  const fresh = (text: string): BlameLine => ({ text, by: v.by, at: v.at, seq: v.seq });
  // Most edits touch a few lines: the common start and end are kept as they are, only the middle is compared.
  let start = 0;
  while (start < prev.length && start < next.length && prev[start]?.text === next[start]) start++;
  let end = 0;
  while (
    end < prev.length - start &&
    end < next.length - start &&
    prev[prev.length - 1 - end]?.text === next[next.length - 1 - end]
  )
    end++;
  const a = prev.slice(start, prev.length - end);
  const b = next.slice(start, next.length - end);
  const middle: BlameLine[] = [];
  if (a.length && b.length && a.length * b.length <= MAX_CELLS) {
    // Longest common subsequence of the middle: its lines keep their author.
    const n = a.length;
    const m = b.length;
    const w = m + 1;
    const dp = new Uint32Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--)
      for (let k = m - 1; k >= 0; k--)
        dp[i * w + k] =
          a[i]?.text === b[k]
            ? (dp[(i + 1) * w + k + 1] as number) + 1
            : Math.max(dp[(i + 1) * w + k] as number, dp[i * w + k + 1] as number);
    let i = 0;
    let k = 0;
    while (k < m) {
      if (i < n && a[i]?.text === b[k]) {
        middle.push(a[i] as BlameLine);
        i++;
        k++;
      } else if (i < n && (dp[(i + 1) * w + k] as number) >= (dp[i * w + k + 1] as number)) i++;
      else {
        middle.push(fresh(b[k] as string));
        k++;
      }
    }
  } else for (const t of b) middle.push(fresh(t));
  return [...prev.slice(0, start), ...middle, ...prev.slice(prev.length - end)];
}
