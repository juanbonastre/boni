import {
  type CollectionDef,
  type CollectionSnapshot,
  defsToModel,
  frontmatterData,
  makeModel,
  noteToRow,
  parseCollectionDef,
  parseNote,
  type Row,
  unplaceableRows,
} from "@boni-calendar/core";
import type { VaultBridge } from "../vaultBridge.ts";

/** Where the collection definitions live in the vault: one note per collection. */
export const DEFINITIONS_DIR = "_system/colecciones";

export interface IgnoredNote {
  path: string;
  /** Why the calendar cannot show it: a message, or a code from `reasonText`. */
  reason: string;
}

export interface VaultLoad {
  snapshot: CollectionSnapshot;
  ignored: IgnoredNote[];
  /** Definitions or folders that could not be read (the rest still loads). */
  problems: string[];
  notes: number;
}

/** Runs `fn` over `items` with at most `limit` calls in flight. */
async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (x: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/**
 * Reads the definitions, then every note of each collection's folder, into rows. Notes whose
 * properties are broken or that have no usable date are not rows of the calendar: they are
 * returned in `ignored` so the user can fix them.
 */
export async function loadVault(
  bridge: VaultBridge,
  opts: { readOnly: boolean },
): Promise<VaultLoad> {
  const problems: string[] = [];
  const ignored: IgnoredNote[] = [];

  const defs: CollectionDef[] = [];
  const found = await bridge.scan(DEFINITIONS_DIR);
  if (!found.ok) {
    problems.push(`${DEFINITIONS_DIR}: ${found.message}`);
  } else {
    const texts = await mapLimit(found.value, 16, async (n) => ({
      n,
      r: await bridge.read(n.path),
    }));
    for (const { n, r } of texts) {
      if (!r.ok) {
        problems.push(`${n.path}: ${r.message}`);
        continue;
      }
      const fm = frontmatterData(r.value.text);
      if ("error" in fm) {
        problems.push(`${n.path}: ${fm.error}`);
      } else if (fm.data.collection !== undefined) {
        const parsed = parseCollectionDef(fm.data.collection);
        if (parsed.ok) defs.push(parsed.def);
        else problems.push(`${n.path}: ${parsed.errors.join("; ")}`);
      }
    }
  }
  const ids = new Set<string>();
  const unique = defs.filter((d) => {
    if (ids.has(d.id)) {
      problems.push(`${DEFINITIONS_DIR}: duplicate collection id "${d.id}"`);
      return false;
    }
    ids.add(d.id);
    return true;
  });

  const rows: Row[] = [];
  for (const def of unique) {
    const scan = await bridge.scan(def.folder);
    if (!scan.ok) {
      problems.push(`${def.folder}: ${scan.message}`);
      continue;
    }
    // A folder's README.md is its index, not a row.
    const files = scan.value.filter((n) => !/(^|\/)readme\.md$/i.test(n.path));
    const loaded = await mapLimit(files, 64, async (n) => ({
      n,
      r: await bridge.read(n.path),
    }));
    for (const { n, r } of loaded) {
      if (!r.ok) {
        ignored.push({ path: n.path, reason: r.message });
        continue;
      }
      const note = parseNote(r.value.text);
      if (note.error) ignored.push({ path: n.path, reason: note.error });
      else rows.push(noteToRow(def, n.path, note, r.value.mtimeMs));
    }
  }

  const parts = defsToModel(unique, opts);
  const model = makeModel(parts.collections, parts.views);
  for (const u of unplaceableRows(model, rows)) ignored.push({ path: u.id, reason: u.reason });
  return { snapshot: { ...parts, rows }, ignored, problems, notes: rows.length };
}
