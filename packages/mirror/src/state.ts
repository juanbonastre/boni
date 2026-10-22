import { DatabaseSync } from "node:sqlite";

/**
 * What the mirror remembers, apart from the core (it is an edge, docs/nucleo.md 9.4): which types are
 * mirrored and how, which note each entity has and the sha256 of what the mirror last wrote there, and
 * the hand edits it already turned into proposals. A file of its own next to the user's store.
 */
export type Profile = "generic" | "vault";

export interface MirroredType {
  type: string;
  profile: Profile;
  /** The folder of its new notes (relative to the vault). */
  folder: string;
  /** Field id -> the property it is written as ("" = the file name, for a title the notes never had). */
  props: Record<string, string>;
  /** The type's schema version the notes were last written with. */
  schema: number;
}

export interface NoteRow {
  entity: string;
  type: string;
  path: string;
  sha: string;
  /** What the mirror last wrote there: the base a hand edit is compared with (three-way). */
  text: string;
}

export interface EditRow {
  path: string;
  sha: string;
  proposal: string;
  /** What the proposal does: change the entity, create one from a new note, or remove it. */
  kind: "update" | "create" | "delete";
  /** The entity it changes or removes; for "create", the type the new note belongs to. */
  entity: string | null;
}

export interface MirrorState {
  types(): MirroredType[];
  type(id: string): MirroredType | null;
  setType(t: MirroredType): void;
  dropType(id: string): void;
  notes(type?: string): NoteRow[];
  /** The notes without their text (a round of the mirror reads only what it needs). */
  refs(type?: string): Omit<NoteRow, "text">[];
  note(entity: string): NoteRow | null;
  noteAt(path: string): NoteRow | null;
  setNote(n: NoteRow): void;
  dropNote(entity: string): void;
  edit(path: string, sha: string): EditRow | null;
  edits(): EditRow[];
  addEdit(e: EditRow): void;
  dropEdit(path: string, sha: string): void;
  /** The store version the mirror wrote up to. */
  synced(): number;
  setSynced(v: number): void;
  close(): void;
}

export function openMirrorState(path: string): MirrorState {
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA busy_timeout = 15000;
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    CREATE TABLE IF NOT EXISTS types (type TEXT PRIMARY KEY, profile TEXT NOT NULL, folder TEXT NOT NULL,
      props TEXT NOT NULL, schema INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS notes (entity TEXT PRIMARY KEY, type TEXT NOT NULL, path TEXT NOT NULL UNIQUE,
      sha TEXT NOT NULL, text TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS edits (path TEXT NOT NULL, sha TEXT NOT NULL, proposal TEXT NOT NULL,
      kind TEXT NOT NULL, entity TEXT, PRIMARY KEY (path, sha));
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
  const typeOf = (r: Record<string, unknown>): MirroredType => ({
    type: r.type as string,
    profile: r.profile as Profile,
    folder: r.folder as string,
    props: JSON.parse(r.props as string),
    schema: Number(r.schema),
  });
  const noteOf = (r: Record<string, unknown>): NoteRow => ({
    entity: r.entity as string,
    type: r.type as string,
    path: r.path as string,
    sha: r.sha as string,
    text: r.text as string,
  });
  const editOf = (r: Record<string, unknown>): EditRow => ({
    path: r.path as string,
    sha: r.sha as string,
    proposal: r.proposal as string,
    kind: r.kind as EditRow["kind"],
    entity: (r.entity as string | null) ?? null,
  });
  return {
    types: () => db.prepare("SELECT * FROM types ORDER BY type").all().map(typeOf),
    type(id) {
      const r = db.prepare("SELECT * FROM types WHERE type = ?").get(id);
      return r ? typeOf(r) : null;
    },
    setType(t) {
      db.prepare(
        "INSERT INTO types (type, profile, folder, props, schema) VALUES (?, ?, ?, ?, ?) " +
          "ON CONFLICT (type) DO UPDATE SET profile = excluded.profile, folder = excluded.folder, " +
          "props = excluded.props, schema = excluded.schema",
      ).run(t.type, t.profile, t.folder, JSON.stringify(t.props), t.schema);
    },
    dropType(id) {
      db.prepare("DELETE FROM types WHERE type = ?").run(id);
      db.prepare("DELETE FROM notes WHERE type = ?").run(id);
    },
    notes: (type) =>
      (type
        ? db.prepare("SELECT * FROM notes WHERE type = ? ORDER BY path").all(type)
        : db.prepare("SELECT * FROM notes ORDER BY path").all()
      ).map(noteOf),
    refs: (type) =>
      (
        (type
          ? db
              .prepare("SELECT entity, type, path, sha FROM notes WHERE type = ? ORDER BY path")
              .all(type)
          : db.prepare("SELECT entity, type, path, sha FROM notes ORDER BY path").all()) as {
          entity: string;
          type: string;
          path: string;
          sha: string;
        }[]
      ).map((r) => ({ entity: r.entity, type: r.type, path: r.path, sha: r.sha })),
    note(entity) {
      const r = db.prepare("SELECT * FROM notes WHERE entity = ?").get(entity);
      return r ? noteOf(r) : null;
    },
    noteAt(path) {
      const r = db.prepare("SELECT * FROM notes WHERE path = ?").get(path);
      return r ? noteOf(r) : null;
    },
    setNote(n) {
      db.prepare(
        "INSERT INTO notes (entity, type, path, sha, text) VALUES (?, ?, ?, ?, ?) " +
          "ON CONFLICT (entity) DO UPDATE SET type = excluded.type, path = excluded.path, sha = excluded.sha, " +
          "text = excluded.text",
      ).run(n.entity, n.type, n.path, n.sha, n.text);
    },
    dropNote(entity) {
      db.prepare("DELETE FROM notes WHERE entity = ?").run(entity);
    },
    edit(path, sha) {
      const r = db.prepare("SELECT * FROM edits WHERE path = ? AND sha = ?").get(path, sha);
      return r ? editOf(r) : null;
    },
    edits: () => db.prepare("SELECT * FROM edits ORDER BY path").all().map(editOf),
    addEdit(e) {
      db.prepare(
        "INSERT OR REPLACE INTO edits (path, sha, proposal, kind, entity) VALUES (?, ?, ?, ?, ?)",
      ).run(e.path, e.sha, e.proposal, e.kind, e.entity);
    },
    dropEdit(path, sha) {
      db.prepare("DELETE FROM edits WHERE path = ? AND sha = ?").run(path, sha);
    },
    synced() {
      const r = db.prepare("SELECT value FROM meta WHERE key = 'synced'").get();
      return r ? Number(r.value) : 0;
    },
    setSynced(v) {
      db.prepare(
        "INSERT INTO meta (key, value) VALUES ('synced', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
      ).run(String(v));
    },
    close: () => db.close(),
  };
}
