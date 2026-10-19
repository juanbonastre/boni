import type { ParsedNote, Row } from "@boni/calendar";

/**
 * What the app remembers about each note between reads: its stat, the parsed properties and body, and
 * the row built from it. A note whose modification time and size did not change is not read or parsed
 * again, and keeps the very same row object (so nothing downstream recomputes).
 */
export interface IndexEntry {
  mtimeMs: number;
  size: number;
  note: ParsedNote;
  collectionId?: string;
  row?: Row;
}

export type VaultIndex = Map<string, IndexEntry>;

const VERSION = 1;

/** The part worth keeping on disk: parsed notes, without rows (those are rebuilt from the definitions). */
export function serializeIndex(index: VaultIndex): string {
  const notes: Record<string, unknown[]> = {};
  for (const [path, e] of index) {
    notes[path] = [
      e.mtimeMs,
      e.size,
      e.note.values,
      e.note.body,
      e.note.hasFrontmatter,
      e.note.error ?? null,
    ];
  }
  return JSON.stringify({ version: VERSION, notes });
}

/** Reads what `serializeIndex` wrote; anything unexpected gives an empty index (a cold start). */
export function parseIndex(text: string | null | undefined): VaultIndex {
  const index: VaultIndex = new Map();
  if (!text) return index;
  try {
    const data = JSON.parse(text) as { version?: number; notes?: Record<string, unknown[]> };
    if (data.version !== VERSION || !data.notes) return index;
    for (const [path, v] of Object.entries(data.notes)) {
      const [mtimeMs, size, values, body, hasFrontmatter, error] = v as [
        number,
        number,
        ParsedNote["values"],
        string,
        boolean,
        string | null,
      ];
      if (typeof mtimeMs !== "number" || typeof size !== "number" || typeof body !== "string")
        continue;
      index.set(path, {
        mtimeMs,
        size,
        note: { values, body, hasFrontmatter, ...(error ? { error } : {}) },
      });
    }
  } catch {
    return new Map();
  }
  return index;
}
