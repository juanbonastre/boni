import {
  type CollectionDef,
  type CollectionProvider,
  formatNote,
  noteFileName,
  type PropValue,
  parseNote,
  patchNote,
  type Row,
  type RowChange,
  uniqueNotePath,
  withAreaLine,
} from "@boni-calendar/core";
import type { VaultBridge, VaultResult } from "../vaultBridge.ts";
import {
  aliases,
  currentDefs,
  dropEntry,
  persistSoon,
  setEntry,
  vaultEntries,
  withLock,
} from "./sync.ts";

/** A write that did not happen. `conflict`: the note changed outside the app since it was read. */
export class VaultWriteError extends Error {
  // A plain field (no parameter property): the server runs this file with Node's type stripping.
  readonly kind: "conflict" | "failed";
  constructor(kind: "conflict" | "failed", message: string) {
    super(message);
    this.kind = kind;
  }
}

const empty = (v: PropValue | undefined): boolean =>
  v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);

const same = (a: PropValue | undefined, b: PropValue | undefined): boolean =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** The properties that differ between a row and what the note has on disk (empty on both sides is no difference). */
function changesBetween(next: Row["values"], current: Row["values"]): Record<string, PropValue> {
  const out: Record<string, PropValue> = {};
  for (const [k, v] of Object.entries(next)) {
    if (empty(v) && empty(current[k])) continue;
    if (!same(v, current[k])) out[k] = v ?? null;
  }
  return out;
}

async function ok<T>(p: Promise<VaultResult<T>> | undefined, what: string): Promise<T> {
  if (!p) throw new VaultWriteError("failed", `${what}: not supported by this app shell`);
  const r = await p;
  if (!r.ok) throw new VaultWriteError("failed", `${what}: ${r.message}`);
  return r.value;
}

/**
 * Writes row changes to the vault's notes. An edited row changes only the properties that differ;
 * a new row becomes a note once it has a title; a removed row goes to the trash (its text is kept in
 * memory so Undo can bring it back); a row that moved to another collection moves its file.
 * Existing notes are never renamed.
 */
export function makeVaultProvider(bridge: VaultBridge): CollectionProvider {
  const deleted = new Map<string, string>();
  const defOf = (id: string): CollectionDef | undefined => currentDefs().find((d) => d.id === id);
  const pathOf = (id: string): string => aliases.get(id) ?? id;
  const known = (path: string): boolean => vaultEntries().has(path);

  async function update(path: string, row: Row, def: CollectionDef, movedTo?: CollectionDef) {
    const cur = await ok(bridge.read(path), path);
    const entry = vaultEntries().get(path);
    if (entry && Math.abs(entry.mtimeMs - cur.mtimeMs) > 1) {
      throw new VaultWriteError("conflict", path);
    }
    const note = parseNote(cur.text);
    if (note.error) throw new VaultWriteError("failed", `${path}: ${note.error}`);
    const body = movedTo?.newNote ? withAreaLine(note.body, movedTo.newNote.body) : note.body;
    const text = patchNote(
      cur.text,
      changesBetween(row.values, note.values),
      body === note.body ? {} : { body },
    );
    if (text === cur.text) return;
    const w = await ok(bridge.write(path, text, cur.mtimeMs), path);
    if (w.conflict) throw new VaultWriteError("conflict", path);
    setEntry(path, {
      mtimeMs: w.mtimeMs,
      size: w.size,
      note: parseNote(text),
      collectionId: def.id,
      row: row.id === path ? row : { ...row, id: path },
    });
  }

  /** Creates the note of a new row; `path` and `text` are given when a deleted note is being brought back. */
  async function create(row: Row, def: CollectionDef, path?: string, text?: string) {
    let content = text;
    if (content === undefined) {
      if (!String(row.values[def.mapping.title] ?? "").trim()) return; // it becomes a note once it has a title
      const values = Object.fromEntries(Object.entries(row.values).filter(([, v]) => !empty(v)));
      content = formatNote(
        values,
        def.newNote?.body ?? "",
        def.columns.map((c) => c.id),
      );
    }
    const taken = new Set<string>();
    for (;;) {
      const target =
        path ??
        uniqueNotePath(def.folder, noteFileName(def, row.values), (p) => known(p) || taken.has(p));
      const r = await ok(bridge.create(target, content), target);
      if (r.exists) {
        if (path) throw new VaultWriteError("failed", `${target}: already exists`);
        taken.add(target);
        continue;
      }
      setEntry(target, {
        mtimeMs: r.mtimeMs,
        size: r.size,
        note: parseNote(content),
        collectionId: def.id,
        row: row.id === target ? row : { ...row, id: target },
      });
      if (row.id !== target) aliases.set(row.id, target);
      return;
    }
  }

  async function move(from: string, row: Row, to: CollectionDef) {
    const base = (from.split("/").pop() ?? "").replace(/\.md$/i, "");
    const taken = new Set<string>();
    const before = vaultEntries().get(from);
    for (;;) {
      const target = uniqueNotePath(to.folder, base, (p) => known(p) || taken.has(p));
      const r = await ok(bridge.rename?.(from, target), `${from} → ${target}`);
      if (r.exists) {
        taken.add(target);
        continue;
      }
      dropEntry(from);
      if (before)
        setEntry(target, {
          ...before,
          mtimeMs: r.mtimeMs,
          size: r.size,
          collectionId: to.id,
          row: undefined,
        });
      aliases.set(row.id, target);
      await update(target, row, to, to);
      return;
    }
  }

  async function remove(path: string) {
    if (!known(path)) return; // a row that never became a note
    const cur = await ok(bridge.read(path), path);
    deleted.set(path, cur.text);
    await ok(bridge.trash?.(path), path);
    dropEntry(path);
  }

  async function run(changes: readonly RowChange[]) {
    const removes = new Map<string, Extract<RowChange, { op: "remove" }>>();
    for (const c of changes) if (c.op === "remove") removes.set(c.id, c);
    const consumed = new Set<string>();
    for (const c of changes) {
      if (c.op !== "upsert") continue;
      const def = defOf(c.row.collectionId);
      if (!def) continue;
      const path = pathOf(c.row.id);
      if (known(path)) {
        const gone = removes.get(c.row.id);
        const from =
          gone && gone.collectionId !== c.row.collectionId ? defOf(gone.collectionId) : undefined;
        if (from) {
          await move(path, c.row, def);
          consumed.add(c.row.id);
        } else await update(path, c.row, def);
        continue;
      }
      const text = deleted.get(path);
      if (text !== undefined) {
        await create(c.row, def, path, text);
        deleted.delete(path);
        await update(path, c.row, def);
      } else await create(c.row, def);
    }
    for (const c of changes) {
      if (c.op === "remove" && !consumed.has(c.id)) await remove(pathOf(c.id));
    }
  }

  return {
    load: async () => {
      throw new Error("The vault is loaded by loadVault, not by the provider");
    },
    apply: (changes) => withLock(() => run(changes)).finally(() => persistSoon(bridge)),
  };
}
