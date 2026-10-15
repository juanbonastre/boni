import type { CollectionSnapshot, Row } from "./collections.ts";

export type RowChange =
  | { op: "upsert"; row: Row }
  | { op: "remove"; collectionId: string; id: string };

/**
 * Where rows live. The app edits optimistically in memory and hands each change set to the
 * provider; a provider may be the in-memory sample, the vault's files, or a database later.
 */
export interface CollectionProvider {
  load(): Promise<CollectionSnapshot>;
  apply(changes: readonly RowChange[]): Promise<void>;
}

/** The changes that turn `prev` into `next` (rows are compared by object identity). */
export function diffRows(prev: readonly Row[], next: readonly Row[]): RowChange[] {
  const before = new Map(prev.map((r) => [r.id, r]));
  const out: RowChange[] = [];
  const kept = new Set<string>();
  for (const row of next) {
    kept.add(row.id);
    const was = before.get(row.id);
    if (was === row) continue;
    // A row that moved to another collection leaves the old one first.
    if (was && was.collectionId !== row.collectionId) {
      out.push({ op: "remove", collectionId: was.collectionId, id: was.id });
    }
    out.push({ op: "upsert", row });
  }
  for (const row of prev) {
    if (!kept.has(row.id)) out.push({ op: "remove", collectionId: row.collectionId, id: row.id });
  }
  return out;
}

/** Provider that keeps everything in memory (sample data and tests). */
export function memoryProvider(snapshot: CollectionSnapshot): CollectionProvider & {
  rows: () => Row[];
} {
  let rows = [...snapshot.rows];
  return {
    load: async () => ({ ...snapshot, rows: [...rows] }),
    apply: async (changes) => {
      for (const c of changes) {
        if (c.op === "remove") rows = rows.filter((r) => r.id !== c.id);
        else if (rows.some((r) => r.id === c.row.id)) {
          rows = rows.map((r) => (r.id === c.row.id ? c.row : r));
        } else rows.push(c.row);
      }
    },
    rows: () => rows,
  };
}
