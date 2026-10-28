import { createHash } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { constants, DatabaseSync } from "node:sqlite";
import {
  ancestors,
  applySchemaOp,
  branch,
  checkValue,
  convertValue,
  type Entity,
  type EntityId,
  type FieldDef,
  join,
  type Label,
  newId,
  raiseSensitivity,
  type Schema,
  type SchemaOp,
  type TypeDef,
  type TypeId,
  type Value,
} from "@boni/entities";
import { type Audit, auditWriter, type By, byOf, openAudit } from "./audit.ts";
import type { BlameVersion } from "./blame.ts";
import { type Journal, openJournal } from "./journal.ts";
import { open, openFile, seal, sealFile } from "./keys.ts";
import { migrate } from "./migrations.ts";

/**
 * One user's store (docs/nucleo.md, 5): entities, their schema and links, the label of every field,
 * and an operation log with the before and after of every change. Undo applies the inverse of an
 * operation as a new operation, so the history is never rewritten; a whole run (one request to the
 * agent) can be undone at once. Every method is one transaction. node:sqlite is synchronous, so the
 * calls of one process never interleave.
 */

export type Actor = "user" | "agent" | "import" | "connector" | "system";

export interface OpMeta {
  actor: Actor;
  device?: string;
  /** The agent run (or import) this change belongs to: `undoRun` undoes all of them. */
  run?: string;
  /** Who made it, for the audit (`model:planner:<provider>/<model>`, `mcp:<device>`…); by default from the actor
   * and device. Set by code, never by a model. */
  by?: By;
  /** The audit action this change was made in. */
  action?: number;
}

/** A value to write, with where it came from. `$body` is the entity's free text. */
export interface Write {
  value: unknown;
  label: Label;
}
export type Writes = Record<string, Write>;
export const BODY = "$body";

/**
 * How much of a collection the models may see (Juan's choice; docs/nucleo.md 7.3): `visible`; `opaque` (the
 * planner knows it, code computes with it, no model reads its values); `restricted` (closed to them as if it did
 * not exist; one conversation may open it when Juan says so); `private` (closed, and locked: only an explicit
 * unlock lowers it, so it is not undone by a slip).
 */
export type AiLevel = "visible" | "opaque" | "restricted" | "private";
export const AI_LEVELS: readonly AiLevel[] = ["visible", "opaque", "restricted", "private"];
const LEVEL_RANK: Record<AiLevel, number> = { visible: 0, opaque: 1, restricted: 2, private: 3 };
/** Whether no model may see a collection at this level. */
export const closedToAi = (level: AiLevel | undefined) =>
  level === "restricted" || level === "private";

/** A part of a collection with its own level: the rows that match `filter` (Notion's rules, every one). */
export interface AiRule {
  id: string;
  type: TypeId;
  /** DatabaseFilter[] (checked by the caller with @boni/views' `filterErrors`). */
  filter: unknown[];
  level: AiLevel;
}
export const levelRank = (l: AiLevel | undefined) => LEVEL_RANK[l ?? "visible"];

/** The vault's zones, where a collection came from; each starts at the level of the same name. */
export type Zone = "restricted" | "private";
const ZONE_RANK: Record<Zone, number> = { restricted: 1, private: 2 };

/** An attachment kept in the store (a `file` value is its sha256). */
export interface StoredFile {
  mime: string;
  size: number;
  data: Uint8Array;
}
/** The largest attachment the store keeps (the server reads one whole into memory to send it). */
export const MAX_FILE_BYTES = 50 * 1024 * 1024;

/** One operation of the log, as stored (`before` / `after` / `label` parsed). */
export interface LogRow {
  seq: number;
  at: number;
  actor: string;
  device: string | null;
  run: string | null;
  kind: string;
  target: string;
  before: unknown;
  after: unknown;
  label: unknown;
  undoes: number | null;
  /** Who made it (the audit's `by`). */
  by: string;
}

/** An operation without what it changed: who, what kind, on what, when (cheap at any size of the log). */
export type RecentOp = Omit<LogRow, "before" | "after" | "label">;

export interface StoredEntity {
  entity: Entity;
  /** By field id (and `$body`). */
  labels: Record<string, Label>;
}

export class StoreError extends Error {
  code: "invalid" | "not-found" | "conflict" | "undo" | "locked";
  constructor(code: StoreError["code"], message: string) {
    super(message);
    this.code = code;
  }
}

type OpKind = "schema" | "create" | "update" | "delete" | "restore";

interface FieldState {
  values: Record<string, Value>;
  labels: Record<string, Label | null>;
  body?: string | null;
  /** The record's collection, when the operation moved it (`retype`). */
  type?: TypeId;
}

interface OpRow {
  seq: number;
  kind: OpKind;
  target: string;
  run: string | null;
  before: string | null;
  after: string | null;
}

/** Tables the read-only query API may read (views compile to SELECTs over them). */
const READABLE = new Set(["entities", "links", "types", "entities_fts", "field_prov"]);

export interface UserStore {
  schema(): Schema;
  applySchema(op: SchemaOp, meta: OpMeta): number;
  create(type: TypeId, writes: Writes, meta: OpMeta, id?: EntityId): StoredEntity;
  update(id: EntityId, writes: Writes, meta: OpMeta, expectedVersion?: number): StoredEntity;
  remove(id: EntityId, meta: OpMeta): void;
  restore(id: EntityId, meta: OpMeta): void;
  get(id: EntityId): StoredEntity | null;
  /** A type's entities; `deep`: its whole branch's too (docs/clases.md §2.3), the type's first. */
  list(type: TypeId, opts?: { includeDeleted?: boolean; deep?: boolean }): StoredEntity[];
  /** A type's entities (not in the trash) without their labels, in one query: for a view's rows. */
  entities(type: TypeId, opts?: { deep?: boolean }): Entity[];
  /**
   * Moves a record to another collection keeping its id and its history (docs/clases.md §2.5): the values of the
   * fields both share (the same id) stay; the others leave the record, kept in the operation's log (undo puts them
   * back).
   */
  /** With `writes`, values given in the same operation (checked against the new collection). */
  retype(id: EntityId, type: TypeId, meta: OpMeta, writes?: Writes): StoredEntity;
  /**
   * Many changes as one transaction: other connections see all of them or none, and an error takes all of them back
   * (a reshape of the whole tree, `apps/server/src/reshape.ts`).
   */
  batch<T>(fn: () => T): T;
  /** The last operation on an entity (its number and the device that made it), or null. */
  lastChange(id: EntityId): { seq: number; device: string | null } | null;
  /** How many entities a type has (not in the trash), without reading them. */
  count(type: TypeId): number;
  /** The entities (not in the trash) whose `field` holds exactly `value` (a text), by one query. */
  findByValue(field: string, value: string): { id: EntityId; type: TypeId }[];
  linksTo(id: EntityId): { src: EntityId; field: string }[];
  search(text: string, opts?: { type?: TypeId; limit?: number }): EntityId[];
  /** The last operation's number: the version devices sync from. */
  version(): number;
  changesSince(version: number): {
    version: number;
    entities: StoredEntity[];
    schemaChanged: boolean;
  };
  undo(seq: number, meta: OpMeta): number;
  undoRun(run: string, meta: OpMeta): number[];
  /** What a run changed, oldest first (schema changes left out), and whether each was undone since (the Registro). */
  runOps(run: string): { kind: Exclude<OpKind, "schema">; target: EntityId; undone: boolean }[];
  /** Every version of an entity's text with who wrote it, oldest first (for `blame`). */
  bodyVersions(id: EntityId): BlameVersion[];
  /** A SELECT over the readable tables only (an authorizer refuses anything else). */
  readQuery(sql: string, params?: (string | number | null)[]): Record<string, unknown>[];
  /** The operation log, oldest first; never the agent's journal. With `target`, `run` or `action`, only that entity's,
   * run's or action's operations (by their indexes). Without one it is the whole log with every before and after:
   * read it with `logPage` or `recentOps` instead, never whole (a big store's log is more than the server's memory). */
  log(q?: { target?: string; run?: string; action?: number }): LogRow[];
  /** The operations after `afterSeq`, oldest first, at most `limit`: the whole log a page at a time (an export). */
  logPage(afterSeq: number, limit: number): LogRow[];
  /** The latest operations, newest first, without what each changed (what changed lately, at any size). */
  recentOps(limit: number): RecentOp[];
  /**
   * What the models may see of each type: `visible` (the default), `opaque` (the planner knows the type and
   * code works with its values, but no model reads them) or `hidden` (as if it did not exist). Juan sets it
   * (a personal device, `setAiAccess`); no tool of the agent can.
   */
  aiAccess(): Record<TypeId, AiLevel>;
  /** Lowering a `private` type needs `unlock` (StoreError "locked" otherwise). */
  setAiAccess(type: TypeId, level: AiLevel, by: string, opts?: { unlock?: boolean }): void;
  /** The rules that give a part of a collection its own level, oldest first. */
  aiRules(): AiRule[];
  /**
   * Adds (no `id`) or changes a rule. Needs `unlock` when it would lower something private: a private rule made
   * less closed, or a rule that opens part of a private collection.
   */
  setAiRule(
    rule: Omit<AiRule, "id"> & { id?: string },
    by: string,
    opts?: { unlock?: boolean },
  ): string;
  /** Removes a rule; a private one only with `unlock`. */
  removeAiRule(id: string, by: string, opts?: { unlock?: boolean }): void;
  /** The types that came from a vault zone. */
  zones(): Record<TypeId, Zone>;
  /** Marks a type as from a zone (only the import Juan runs) and raises its level to the zone's, never lowers it. */
  setZone(type: TypeId, zone: Zone, by: string): void;
  /** Keeps an attachment (by content: the same bytes are kept once) and gives its sha256. */
  putFile(data: Uint8Array, mime: string): string;
  getFile(sha256: string): StoredFile | null;
  /** An attachment's type and size without its bytes (the export lists them before reading each one). */
  fileInfo(sha256: string): { mime: string; size: number } | null;
  /**
   * A setting or working state of the user's extensions (docs/extensiones.md 4), outside the operation log
   * and out of readQuery's reach; null when absent. Writing null removes it. Secrets go in sealed by the
   * caller with the user's data key.
   */
  setting(key: string): string | null;
  setSetting(key: string, value: string | null): void;
  /** An encrypted copy of the whole store, coherent while it is in use. */
  backupTo(path: string, key: Buffer): void;
  /** A plain copy at `path` (never over a file), as the store is now, without stopping its writers (a dry run). */
  copyTo(path: string): void;
  /** The agent's runs, proposals and confirmations, in this same database. */
  journal: Journal;
  /** Who did and saw what (audit.ts): never readable by `readQuery` nor by any tool of a model. */
  audit: Audit;
  close(): void;
}

/** An operation's row without what it changed. */
const opHead = (r: Record<string, unknown>): RecentOp => ({
  seq: Number(r.seq),
  at: Number(r.at),
  actor: r.actor as string,
  device: (r.device as string | null) ?? null,
  run: (r.run as string | null) ?? null,
  kind: r.kind as string,
  target: r.target as string,
  undoes: r.undoes === null ? null : Number(r.undoes),
  by: (r.by as string | null) ?? byOf(r.actor as string, r.device as string | null),
});
const parseJson = (x: unknown) => (typeof x === "string" ? JSON.parse(x) : null);
/** An operation's row with what it changed (keys in the order an export has always written them). */
const logRow = (r: Record<string, unknown>): LogRow => {
  const { undoes, by, ...head } = opHead(r);
  return {
    ...head,
    before: parseJson(r.before),
    after: parseJson(r.after),
    label: parseJson(r.label),
    undoes,
    by,
  };
};

export function openUserStore(path: string, opts: { now?: () => number } = {}): UserStore {
  const now = opts.now ?? Date.now;
  const db = new DatabaseSync(path);
  // Another process (the import, a command) may be writing: wait for it instead of failing at once.
  // WAL with synchronous NORMAL: never corrupt, and a commit does not wait for the disk (on the NAS's
  // encrypted volume FULL made the vault import take most of an hour); a power cut can lose the last
  // commits, which the daily copies cover.
  db.exec(
    "PRAGMA busy_timeout = 15000; PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON;",
  );
  db.enableDefensive(true);
  migrate(db);
  const audited = auditWriter(db);

  let schema: Schema = loadSchema();
  // Another connection to this file (the vault import, `cli.ts mirror`, a second server process) may have
  // changed the schema: SQLite's data_version moves when someone else commits, and then it is read again.
  const versionQuery = db.prepare("PRAGMA data_version");
  const dataVersion = () => Number((versionQuery.get() as { data_version: number }).data_version);
  // One statement for every file: a statement keeps its bound blob until it is garbage collected, so a new
  // one per file held every attachment of a vault import in memory at once.
  const insertFile = db.prepare(
    "INSERT INTO files (sha256, mime, size, data, at) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING",
  );
  let seen = dataVersion();
  function fresh(): Schema {
    const v = dataVersion();
    if (v !== seen) {
      seen = v;
      schema = loadSchema();
    }
    return schema;
  }

  function loadSchema(): Schema {
    const rows = db.prepare("SELECT def FROM types").all() as { def: string }[];
    const types: Record<TypeId, TypeDef> = {};
    for (const r of rows) {
      const def = JSON.parse(r.def) as TypeDef;
      types[def.id] = def;
    }
    return { types };
  }

  // How deep in `batch` we are: inside one, every method's transaction is part of it (all or nothing).
  let depth = 0;
  function tx<T>(fn: () => T): T {
    if (depth > 0) return fn();
    db.exec("BEGIN IMMEDIATE");
    depth++;
    fresh(); // with the write lock held: nobody else can change it now
    try {
      const out = fn();
      db.exec("COMMIT");
      return out;
    } catch (e) {
      db.exec("ROLLBACK");
      schema = loadSchema(); // a failed schema change must not linger in memory
      throw e;
    } finally {
      depth--;
    }
  }

  function logOp(
    kind: OpKind,
    target: string,
    meta: OpMeta,
    before: unknown,
    after: unknown,
    l: Label | null,
    undoes?: number,
  ): number {
    const r = db
      .prepare(
        "INSERT INTO ops (at, actor, device, run, by, action, kind, target, before, after, label, undoes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        now(),
        meta.actor,
        meta.device ?? null,
        meta.run ?? null,
        meta.by ?? byOf(meta.actor, meta.device),
        meta.action ?? null,
        kind,
        target,
        before === null ? null : JSON.stringify(before),
        after === null ? null : JSON.stringify(after),
        l ? JSON.stringify(l) : null,
        undoes ?? null,
      );
    const seq = Number(r.lastInsertRowid);
    audited.op(seq, kind, target, meta.by ?? byOf(meta.actor, meta.device));
    return seq;
  }

  // ------------------------------------------------------------ reading

  interface EntityRow {
    id: string;
    type: string;
    vals: string;
    body: string | null;
    created: number;
    updated: number;
    version: number;
    deleted: number | null;
  }
  const toEntity = (row: EntityRow): Entity => ({
    id: row.id,
    type: row.type,
    values: JSON.parse(row.vals) as Record<string, Value>,
    created: row.created,
    updated: row.updated,
    version: row.version,
    ...(row.body !== null ? { body: row.body } : {}),
    ...(row.deleted !== null ? { deleted: row.deleted } : {}),
  });

  /** A whole type in two queries (its entities, then all their labels), not one per entity. */
  function readType(type: TypeId, includeDeleted: boolean): StoredEntity[] {
    const alive = includeDeleted ? "" : " AND deleted IS NULL";
    const rows = db
      .prepare(`SELECT * FROM entities WHERE type = ?${alive} ORDER BY created, id`)
      .all(type) as unknown as EntityRow[];
    const labels = new Map<string, Record<string, Label>>();
    // Most labels of a type are the same text (one import, one source): each is parsed once (shared, and
    // labels are never changed in place).
    const parsed = new Map<string, Label>();
    for (const p of db
      .prepare(
        `SELECT p.entity, p.field, p.label FROM field_prov p JOIN entities e ON e.id = p.entity WHERE e.type = ?${alive.replace("deleted", "e.deleted")}`,
      )
      .all(type) as { entity: string; field: string; label: string }[]) {
      let m = labels.get(p.entity);
      if (!m) {
        m = {};
        labels.set(p.entity, m);
      }
      let l = parsed.get(p.label);
      if (!l) {
        l = JSON.parse(p.label) as Label;
        parsed.set(p.label, l);
      }
      m[p.field] = l;
    }
    return rows.map((r) => ({ entity: toEntity(r), labels: labels.get(r.id) ?? {} }));
  }

  function readEntity(id: EntityId): StoredEntity | null {
    const row = db.prepare("SELECT * FROM entities WHERE id = ?").get(id) as EntityRow | undefined;
    if (!row) return null;
    const entity: Entity = {
      id: row.id,
      type: row.type,
      values: JSON.parse(row.vals) as Record<string, Value>,
      created: row.created,
      updated: row.updated,
      version: row.version,
      ...(row.body !== null ? { body: row.body } : {}),
      ...(row.deleted !== null ? { deleted: row.deleted } : {}),
    };
    const labels: Record<string, Label> = {};
    for (const p of db.prepare("SELECT field, label FROM field_prov WHERE entity = ?").all(id) as {
      field: string;
      label: string;
    }[])
      labels[p.field] = JSON.parse(p.label) as Label;
    return { entity, labels };
  }

  function typeOf(id: TypeId): TypeDef {
    const def = schema.types[id];
    if (!def) throw new StoreError("not-found", `unknown type "${id}"`);
    return def;
  }

  // ------------------------------------------------------------ writing

  /** The label as stored: at least as sensitive as its field and type say, third party if the type is. */
  function storedLabel(def: TypeDef, field: FieldDef | null, l: Label): Label {
    let out = raiseSensitivity(l, def.sensitivity);
    if (field?.sensitivity) out = raiseSensitivity(out, field.sensitivity);
    if (def.thirdParty && !out.thirdParty) out = { ...out, thirdParty: true };
    return out;
  }

  /** Checks `writes` against the type and returns what they change, or throws without writing. */
  function prepare(def: TypeDef, writes: Writes, meta: OpMeta) {
    if (def.system && meta.actor !== "system")
      throw new StoreError("invalid", `"${def.id}" is one of Boni's own types`);
    if (def.archived) throw new StoreError("invalid", `"${def.id}" is archived`);
    const values: Record<string, Value> = {};
    const labels: Record<string, Label> = {};
    let body: string | null | undefined;
    for (const [fid, w] of Object.entries(writes)) {
      if (fid === BODY) {
        if (w.value !== null && typeof w.value !== "string")
          throw new StoreError("invalid", "the body is text");
        body = (w.value as string | null) ?? null;
        labels[BODY] = storedLabel(def, null, w.label);
        continue;
      }
      const field = def.fields.find((f) => f.id === fid);
      if (!field || field.archived)
        throw new StoreError("invalid", `no field "${fid}" in "${def.id}"`);
      const checked = checkValue(field, w.value);
      if (!checked.ok) throw new StoreError("invalid", `${field.key}: ${checked.error}`);
      if (field.type === "relation" && checked.value !== null) {
        const ids = Array.isArray(checked.value) ? checked.value : [checked.value as string];
        for (const target of ids) {
          const t = readEntity(target);
          if (!t || t.entity.deleted !== undefined || t.entity.type !== field.relation?.target)
            throw new StoreError(
              "invalid",
              `${field.key}: no ${field.relation?.target} "${target}"`,
            );
        }
      }
      values[fid] = checked.value;
      labels[fid] = storedLabel(def, field, w.label);
    }
    return { values, labels, body };
  }

  function writeRow(raw: Entity): void {
    // `null` and a missing key mean the same ("not set"): only set values are stored.
    const e: Entity = {
      ...raw,
      values: Object.fromEntries(Object.entries(raw.values).filter(([, v]) => v !== null)),
    };
    db.prepare(
      `INSERT INTO entities (id, type, vals, body, created, updated, version, deleted) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET type = excluded.type, vals = excluded.vals, body = excluded.body, updated = excluded.updated,
       version = excluded.version, deleted = excluded.deleted`,
    ).run(
      e.id,
      e.type,
      JSON.stringify(e.values),
      e.body ?? null,
      e.created,
      e.updated,
      e.version,
      e.deleted ?? null,
    );
    const def = schema.types[e.type];
    // Links of relation fields, kept in step with the values.
    db.prepare("DELETE FROM links WHERE src = ?").run(e.id);
    for (const f of def?.fields ?? []) {
      if (f.type !== "relation") continue;
      const v = e.values[f.id];
      const ids = v === null || v === undefined ? [] : Array.isArray(v) ? v : [v as string];
      const insert = db.prepare("INSERT INTO links (src, field, dst, pos) VALUES (?, ?, ?, ?)");
      for (const [pos, dst] of ids.entries()) insert.run(e.id, f.id, dst, pos);
    }
    // The search index: title and every text, nothing of deleted entities.
    db.prepare("DELETE FROM entities_fts WHERE entity = ?").run(e.id);
    if (e.deleted === undefined && def) {
      const title = e.values[def.titleField];
      const texts = def.fields
        .filter((f) => (f.type === "text" || f.type === "longtext") && f.id !== def.titleField)
        .map((f) => e.values[f.id])
        .filter((v): v is string => typeof v === "string");
      db.prepare("INSERT INTO entities_fts (entity, title, text) VALUES (?, ?, ?)").run(
        e.id,
        typeof title === "string" ? title : "",
        [...texts, e.body ?? ""].join("\n"),
      );
    }
  }

  function writeLabels(id: EntityId, labels: Record<string, Label | null>, seq: number): void {
    for (const [field, l] of Object.entries(labels)) {
      if (l === null)
        db.prepare("DELETE FROM field_prov WHERE entity = ? AND field = ?").run(id, field);
      else
        db.prepare(
          "INSERT INTO field_prov (entity, field, label, op) VALUES (?, ?, ?, ?) ON CONFLICT(entity, field) DO UPDATE SET label = excluded.label, op = excluded.op",
        ).run(id, field, JSON.stringify(l), seq);
    }
  }

  const labelOf = (labels: Record<string, Label>): Label | null => {
    const ls = Object.values(labels);
    return ls.length ? join(ls[0] as Label, ...ls.slice(1)) : null;
  };

  function doCreate(
    type: TypeId,
    writes: Writes,
    meta: OpMeta,
    id: EntityId,
    undoes?: number,
  ): StoredEntity {
    const def = typeOf(type);
    if (readEntity(id)) throw new StoreError("conflict", `"${id}" already exists`);
    const p = prepare(def, writes, meta);
    const t = now();
    const entity: Entity = {
      id,
      type,
      values: p.values,
      created: t,
      updated: t,
      version: 1,
      ...(typeof p.body === "string" ? { body: p.body } : {}),
    };
    writeRow(entity);
    const seq = logOp(
      "create",
      id,
      meta,
      null,
      { entity, labels: p.labels },
      labelOf(p.labels),
      undoes,
    );
    writeLabels(id, p.labels, seq);
    return { entity, labels: p.labels };
  }

  function doUpdate(
    id: EntityId,
    state: FieldState,
    meta: OpMeta,
    expected: number | undefined,
    undoes?: number,
    rawLabels = false,
  ): StoredEntity {
    const cur = readEntity(id);
    if (!cur) throw new StoreError("not-found", `no entity "${id}"`);
    if (expected !== undefined && cur.entity.version !== expected)
      throw new StoreError("conflict", `"${id}" changed since version ${expected}`);
    const def = typeOf(cur.entity.type);
    let values = state.values;
    let labels: Record<string, Label | null> = state.labels;
    let body = state.body;
    if (!rawLabels) {
      const writes: Writes = {};
      for (const [f, v] of Object.entries(state.values))
        writes[f] = { value: v, label: state.labels[f] as Label };
      if (state.body !== undefined)
        writes[BODY] = { value: state.body, label: state.labels[BODY] as Label };
      const p = prepare(def, writes, meta);
      values = p.values;
      labels = p.labels;
      body = p.body;
    }
    const before: FieldState = { values: {}, labels: {} };
    if (state.type !== undefined && state.type !== cur.entity.type) before.type = cur.entity.type;
    for (const f of Object.keys(values)) {
      before.values[f] = cur.entity.values[f] ?? null;
      before.labels[f] = cur.labels[f] ?? null;
    }
    if (body !== undefined) {
      before.body = cur.entity.body ?? null;
      before.labels[BODY] = cur.labels[BODY] ?? null;
    }
    const entity: Entity = {
      ...cur.entity,
      ...(state.type !== undefined ? { type: state.type } : {}),
      values: { ...cur.entity.values, ...values },
      updated: now(),
      version: cur.entity.version + 1,
    };
    if (body !== undefined) {
      if (body === null) delete entity.body;
      else entity.body = body;
    }
    writeRow(entity);
    const after: FieldState & { version: number } = {
      values,
      labels,
      version: entity.version,
      ...(body !== undefined ? { body } : {}),
      ...(before.type !== undefined ? { type: entity.type } : {}),
    };
    const real = Object.values(labels).filter((l): l is Label => l !== null);
    const seq = logOp(
      "update",
      id,
      meta,
      { ...before, version: cur.entity.version },
      after,
      real.length ? join(real[0] as Label, ...real.slice(1)) : null,
      undoes,
    );
    writeLabels(id, labels, seq);
    return readEntity(id) as StoredEntity;
  }

  function doDelete(id: EntityId, meta: OpMeta, deleted: boolean, undoes?: number): number {
    const cur = readEntity(id);
    if (!cur) throw new StoreError("not-found", `no entity "${id}"`);
    if ((cur.entity.deleted !== undefined) === deleted)
      throw new StoreError(
        "conflict",
        `"${id}" is already ${deleted ? "in the trash" : "restored"}`,
      );
    const entity: Entity = { ...cur.entity, updated: now(), version: cur.entity.version + 1 };
    if (deleted) entity.deleted = now();
    else delete entity.deleted;
    writeRow(entity);
    return logOp(
      deleted ? "delete" : "restore",
      id,
      meta,
      { version: cur.entity.version },
      { version: entity.version },
      null,
      undoes,
    );
  }

  function doSchema(
    op: SchemaOp,
    meta: OpMeta,
    undoes?: number,
    restoreValues?: Record<string, Record<string, Value>>,
  ): number {
    const r = applySchemaOp(schema, op, { system: meta.actor === "system" });
    if (!r.ok) throw new StoreError("invalid", r.error);
    const changed: Record<string, Record<string, Value>> = {}; // values as they were, for undo
    const typeId = op.op === "create_type" ? op.type.id : op.type;
    if (op.op === "remove_type") {
      const n = (
        db.prepare("SELECT count(*) AS n FROM entities WHERE type = ?").get(op.type) as {
          n: number;
        }
      ).n;
      if (n > 0) throw new StoreError("invalid", `"${op.type}" still has ${n} entities`);
      db.prepare("DELETE FROM types WHERE id = ?").run(op.type);
    }
    // The type and, when it is a mother, every collection of its branch that changed with it.
    for (const [id, next] of Object.entries(r.schema.types))
      if (JSON.stringify(schema.types[id]) !== JSON.stringify(next))
        db.prepare(
          "INSERT INTO types (id, def) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET def = excluded.def",
        ).run(id, JSON.stringify(next));
    const prev = schema;
    schema = r.schema;
    // A field that changes type converts its values; what does not convert is left empty (and kept in the log).
    if (op.op === "change_field_type" || restoreValues) {
      const oldField = prev.types[typeId]?.fields.find((f) => "field" in op && f.id === op.field);
      const newField = schema.types[typeId]?.fields.find((f) => "field" in op && f.id === op.field);
      // The field is the same (by id) in every collection of the branch: their values change too.
      const rows = branch(schema, typeId).flatMap(
        (t) => db.prepare("SELECT id FROM entities WHERE type = ?").all(t) as { id: string }[],
      );
      for (const row of rows) {
        const e = readEntity(row.id) as StoredEntity;
        const fid = (op as { field: string }).field;
        const old = e.entity.values[fid];
        if (old === undefined && !restoreValues?.[row.id]) continue;
        let next: Value;
        if (restoreValues?.[row.id] && fid in (restoreValues[row.id] ?? {}))
          next = restoreValues[row.id]?.[fid] ?? null;
        else if (oldField && newField && old !== undefined) {
          const c = convertValue(oldField, newField, old);
          next = c.ok ? c.value : null;
        } else continue;
        changed[row.id] = { [fid]: old ?? null };
        writeRow({
          ...e.entity,
          values: { ...e.entity.values, [fid]: next },
          updated: now(),
          version: e.entity.version + 1,
        });
      }
    }
    return logOp("schema", typeId, meta, { op: r.inverse, values: changed }, { op }, null, undoes);
  }

  // ------------------------------------------------------------ undo

  /** Whether an operation's effect is in place: not undone, or undone and that undo itself undone (a redo). */
  function active(seq: number): boolean {
    const by = db.prepare("SELECT seq FROM ops WHERE undoes = ?").get(seq) as
      | { seq: number }
      | undefined;
    return by ? !active(by.seq) : true;
  }

  /**
   * An operation can be undone while nothing later on the same entity (or type) is still in effect:
   * later changes that were undone again do not count, so a run undone newest first never conflicts
   * with itself, and an undo never silently throws away a change made after it.
   */
  function laterInEffect(op: OpRow): boolean {
    const later = db
      .prepare("SELECT seq FROM ops WHERE target = ? AND seq > ? AND undoes IS NULL")
      .all(op.target, op.seq) as { seq: number }[];
    return later.some((l) => active(l.seq));
  }

  function undoOne(seq: number, meta: OpMeta): number {
    const op = db
      .prepare("SELECT seq, kind, target, run, before, after FROM ops WHERE seq = ?")
      .get(seq) as OpRow | undefined;
    if (!op) throw new StoreError("not-found", `no operation ${seq}`);
    if (db.prepare("SELECT 1 FROM ops WHERE undoes = ?").get(seq))
      throw new StoreError("undo", `operation ${seq} is already undone`);
    if (laterInEffect(op))
      throw new StoreError("conflict", `"${op.target}" changed since operation ${seq}`);
    const before = op.before ? JSON.parse(op.before) : null;
    switch (op.kind) {
      case "create":
        return doDelete(op.target, meta, true, seq);
      case "delete":
      case "restore":
        return doDelete(op.target, meta, op.kind === "restore", seq);
      case "update": {
        doUpdate(op.target, before as FieldState, meta, undefined, seq, true);
        return version();
      }
      case "schema":
        return doSchema(before.op as SchemaOp, meta, seq, before.values);
    }
  }

  function version(): number {
    return Number(
      (db.prepare("SELECT coalesce(max(seq), 0) AS s FROM ops").get() as { s: number }).s,
    );
  }

  // ------------------------------------------------------------ the API

  return {
    schema: () => fresh(),
    applySchema: (op, meta) => tx(() => doSchema(op, meta)),
    create: (type, writes, meta, id = newId("e")) => tx(() => doCreate(type, writes, meta, id)),
    update: (id, writes, meta, expectedVersion) =>
      tx(() => {
        const state: FieldState = { values: {}, labels: {} };
        for (const [f, w] of Object.entries(writes)) {
          if (f === BODY) state.body = (w.value as string | null) ?? null;
          else state.values[f] = w.value as Value;
          state.labels[f] = w.label;
        }
        return doUpdate(id, state, meta, expectedVersion);
      }),
    remove: (id, meta) => void tx(() => doDelete(id, meta, true)),
    restore: (id, meta) => void tx(() => doDelete(id, meta, false)),
    get: readEntity,
    list: (type, o = {}) =>
      (o.deep ? branch(schema, type) : [type]).flatMap((t) => readType(t, !!o.includeDeleted)),
    entities: (type, o = {}) =>
      (o.deep ? branch(schema, type) : [type]).flatMap((t) =>
        (
          db
            .prepare(
              "SELECT * FROM entities WHERE type = ? AND deleted IS NULL ORDER BY created, id",
            )
            .all(t) as unknown as EntityRow[]
        ).map(toEntity),
      ),
    batch: (fn) => tx(fn),
    retype: (id, type, meta, writes) =>
      tx(() => {
        const cur = readEntity(id);
        if (!cur) throw new StoreError("not-found", `no entity "${id}"`);
        if (cur.entity.deleted !== undefined)
          throw new StoreError("invalid", `"${id}" is in the trash`);
        const from = typeOf(cur.entity.type);
        const to = typeOf(type);
        if (!!from.system !== !!to.system || to.archived)
          throw new StoreError("invalid", `"${id}" cannot move to "${type}"`);
        const state: FieldState = { values: {}, labels: {}, type };
        for (const [f, v] of Object.entries(cur.entity.values)) {
          const field = to.fields.find((x) => x.id === f);
          if (field && checkValue(field, v).ok) continue;
          state.values[f] = null;
          state.labels[f] = null;
        }
        if (writes && Object.keys(writes).length) {
          const p = prepare(to, writes, meta);
          Object.assign(state.values, p.values);
          Object.assign(state.labels, p.labels);
          if (p.body !== undefined) state.body = p.body;
        }
        return doUpdate(id, state, meta, undefined, undefined, true);
      }),
    lastChange: (id) => {
      const r = db
        .prepare("SELECT seq, device FROM ops WHERE target = ? ORDER BY seq DESC LIMIT 1")
        .get(id) as { seq: number; device: string | null } | undefined;
      return r ? { seq: Number(r.seq), device: r.device ?? null } : null;
    },
    count: (type) =>
      Number(
        (
          db
            .prepare("SELECT COUNT(*) AS n FROM entities WHERE type = ? AND deleted IS NULL")
            .get(type) as { n: number }
        ).n,
      ),
    findByValue: (field, value) =>
      db
        .prepare(
          "SELECT id, type FROM entities WHERE deleted IS NULL AND json_extract(vals, ?) = ? ORDER BY created, id",
        )
        .all(`$."${field.replace(/"/g, "")}"`, value) as { id: string; type: string }[],
    linksTo: (id) =>
      db.prepare("SELECT src, field FROM links WHERE dst = ? ORDER BY src, pos").all(id) as {
        src: string;
        field: string;
      }[],
    search(text, o = {}) {
      // Every word as a quoted prefix: the text is never FTS syntax (no operators, no columns).
      const words = text.match(/[\p{L}\p{N}]+/gu) ?? [];
      if (!words.length) return [];
      const q = words.map((w) => `"${w}"*`).join(" ");
      const rows = db
        .prepare(
          `SELECT f.entity AS id FROM entities_fts f JOIN entities e ON e.id = f.entity
           WHERE entities_fts MATCH ? AND e.deleted IS NULL ${o.type ? "AND e.type = ?" : ""} ORDER BY rank LIMIT ?`,
        )
        .all(...([q, ...(o.type ? [o.type] : []), o.limit ?? 50] as (string | number)[])) as {
        id: string;
      }[];
      return rows.map((r) => r.id);
    },
    version,
    changesSince(since) {
      const ops = db.prepare("SELECT DISTINCT kind, target FROM ops WHERE seq > ?").all(since) as {
        kind: OpKind;
        target: string;
      }[];
      const ids = [...new Set(ops.filter((o) => o.kind !== "schema").map((o) => o.target))];
      return {
        version: version(),
        schemaChanged: ops.some((o) => o.kind === "schema"),
        entities: ids.map((id) => readEntity(id)).filter((e): e is StoredEntity => e !== null),
      };
    },
    undo: (seq, meta) => tx(() => undoOne(seq, meta)),
    undoRun: (run, meta) =>
      tx(() => {
        const seqs = (
          db
            .prepare("SELECT seq FROM ops WHERE run = ? AND undoes IS NULL ORDER BY seq DESC")
            .all(run) as { seq: number }[]
        )
          .map((r) => r.seq)
          .filter((s) => !db.prepare("SELECT 1 FROM ops WHERE undoes = ?").get(s));
        if (!seqs.length) throw new StoreError("undo", `nothing to undo in run "${run}"`);
        return seqs.map((s) => undoOne(s, meta)); // newest first; any conflict rolls all of it back
      }),
    runOps: (run) =>
      (
        db
          .prepare(
            `SELECT o.kind, o.target, EXISTS (SELECT 1 FROM ops u WHERE u.undoes = o.seq) AS undone
             FROM ops o WHERE o.run = ? AND o.undoes IS NULL AND o.kind <> 'schema' ORDER BY o.seq`,
          )
          .all(run) as { kind: Exclude<OpKind, "schema">; target: string; undone: number }[]
      ).map((r) => ({ kind: r.kind, target: r.target, undone: r.undone === 1 })),
    aiAccess() {
      const own: Record<TypeId, AiLevel> = {};
      for (const r of db.prepare("SELECT type, level FROM ai_access").all())
        own[r.type as string] = r.level as AiLevel;
      // A collection is at least as closed to the AI as its mother (docs/clases.md §2.8; A-06).
      const out: Record<TypeId, AiLevel> = { ...own };
      for (const id of Object.keys(schema.types)) {
        let level = own[id];
        for (const a of ancestors(schema, id))
          if (levelRank(own[a]) > levelRank(level)) level = own[a];
        if (level && level !== "visible") out[id] = level;
      }
      return out;
    },
    aiRules() {
      return db
        .prepare("SELECT id, type, filter, level FROM ai_rules ORDER BY at, id")
        .all()
        .map((r) => ({
          id: r.id as string,
          type: r.type as string,
          filter: JSON.parse(r.filter as string) as unknown[],
          level: r.level as AiLevel,
        }));
    },
    setAiRule(rule, by, opts = {}) {
      if (!AI_LEVELS.includes(rule.level))
        throw new StoreError("invalid", `bad level ${rule.level}`);
      if (!Array.isArray(rule.filter) || !rule.filter.length || rule.filter.length > 20)
        throw new StoreError("invalid", "a rule needs 1 to 20 conditions");
      if (!fresh().types[rule.type]) throw new StoreError("not-found", `no type ${rule.type}`);
      const was = rule.id
        ? (db.prepare("SELECT type, level FROM ai_rules WHERE id = ?").get(rule.id) as
            | { type: string; level: AiLevel }
            | undefined)
        : undefined;
      if (rule.id && (!was || was.type !== rule.type))
        throw new StoreError("not-found", `no rule ${rule.id}`);
      const typeLevel = (
        db.prepare("SELECT level FROM ai_access WHERE type = ?").get(rule.type) as
          | { level: AiLevel }
          | undefined
      )?.level;
      const lowers =
        (was?.level === "private" && rule.level !== "private") ||
        (typeLevel === "private" && rule.level !== "private");
      if (lowers && !opts.unlock)
        throw new StoreError("locked", "it would lower something private: only an unlock does");
      const id = rule.id ?? `r${newId("o", now()).slice(1)}`;
      db.prepare(
        "INSERT INTO ai_rules (id, type, filter, level, at, by) VALUES (?, ?, ?, ?, ?, ?) " +
          "ON CONFLICT (id) DO UPDATE SET filter = excluded.filter, level = excluded.level, by = excluded.by",
      ).run(id, rule.type, JSON.stringify(rule.filter), rule.level, now(), by);
      return id;
    },
    removeAiRule(id, _by, opts = {}) {
      const was = db.prepare("SELECT level FROM ai_rules WHERE id = ?").get(id) as
        | { level: AiLevel }
        | undefined;
      if (!was) throw new StoreError("not-found", `no rule ${id}`);
      if (was.level === "private" && !opts.unlock)
        throw new StoreError("locked", "a private rule: only an unlock removes it");
      db.prepare("DELETE FROM ai_rules WHERE id = ?").run(id);
    },
    zones() {
      const out: Record<TypeId, Zone> = {};
      for (const r of db.prepare("SELECT type, zone FROM zones").all())
        out[r.type as string] = r.zone as Zone;
      return out;
    },
    setZone(type, zone, by) {
      if (!(zone in ZONE_RANK)) throw new StoreError("invalid", `bad zone ${zone}`);
      if (!fresh().types[type]) throw new StoreError("not-found", `no type ${type}`);
      const was = db.prepare("SELECT zone FROM zones WHERE type = ?").get(type) as
        | { zone: Zone }
        | undefined;
      if (!was || ZONE_RANK[was.zone] < ZONE_RANK[zone])
        db.prepare(
          "INSERT INTO zones (type, zone, at, by) VALUES (?, ?, ?, ?) " +
            "ON CONFLICT (type) DO UPDATE SET zone = excluded.zone, at = excluded.at, by = excluded.by",
        ).run(type, zone, now(), by);
      const level = db.prepare("SELECT level FROM ai_access WHERE type = ?").get(type) as
        | { level: AiLevel }
        | undefined;
      if (LEVEL_RANK[level?.level ?? "visible"] < LEVEL_RANK[zone])
        db.prepare(
          "INSERT INTO ai_access (type, level, at, by) VALUES (?, ?, ?, ?) " +
            "ON CONFLICT (type) DO UPDATE SET level = excluded.level, at = excluded.at, by = excluded.by",
        ).run(type, zone, now(), by);
    },
    putFile(data, mime) {
      if (data.byteLength > MAX_FILE_BYTES) throw new StoreError("invalid", "file too large");
      if (!/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(mime)) throw new StoreError("invalid", "bad type");
      const sha256 = createHash("sha256").update(data).digest("hex");
      insertFile.run(sha256, mime.toLowerCase(), data.byteLength, data, now());
      return sha256;
    },
    getFile(sha256) {
      if (!/^[0-9a-f]{64}$/.test(sha256)) return null;
      const r = db.prepare("SELECT mime, size, data FROM files WHERE sha256 = ?").get(sha256) as
        | { mime: string; size: number; data: Uint8Array }
        | undefined;
      return r ? { mime: r.mime, size: Number(r.size), data: r.data } : null;
    },
    fileInfo(sha256) {
      if (!/^[0-9a-f]{64}$/.test(sha256)) return null;
      const r = db.prepare("SELECT mime, size FROM files WHERE sha256 = ?").get(sha256) as
        | { mime: string; size: number }
        | undefined;
      return r ? { mime: r.mime, size: Number(r.size) } : null;
    },
    setting(key) {
      const r = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as
        | { value: string }
        | undefined;
      return r?.value ?? null;
    },
    setSetting(key, value) {
      if (value === null) db.prepare("DELETE FROM settings WHERE key = ?").run(key);
      else
        db.prepare(
          "INSERT INTO settings (key, value, updated) VALUES (?, ?, ?) " +
            "ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated = excluded.updated",
        ).run(key, value, now());
    },
    setAiAccess(type, level, by, opts = {}) {
      if (!AI_LEVELS.includes(level)) throw new StoreError("invalid", `bad level ${level}`);
      if (!fresh().types[type]) throw new StoreError("not-found", `no type ${type}`);
      const was = db.prepare("SELECT level FROM ai_access WHERE type = ?").get(type) as
        | { level: AiLevel }
        | undefined;
      if (was?.level === "private" && level !== "private" && !opts.unlock)
        throw new StoreError("locked", `type ${type} is private: only an unlock lowers it`);
      db.prepare(
        "INSERT INTO ai_access (type, level, at, by) VALUES (?, ?, ?, ?) " +
          "ON CONFLICT (type) DO UPDATE SET level = excluded.level, at = excluded.at, by = excluded.by",
      ).run(type, level, now(), by);
    },
    log(q = {}) {
      const rows =
        q.target !== undefined
          ? db.prepare("SELECT * FROM ops WHERE target = ? ORDER BY seq").all(q.target)
          : q.run !== undefined
            ? db.prepare("SELECT * FROM ops WHERE run = ? ORDER BY seq").all(q.run)
            : q.action !== undefined
              ? db.prepare("SELECT * FROM ops WHERE action = ? ORDER BY seq").all(q.action)
              : db.prepare("SELECT * FROM ops ORDER BY seq").all();
      return rows.map(logRow);
    },
    logPage(afterSeq, limit) {
      return db
        .prepare("SELECT * FROM ops WHERE seq > ? ORDER BY seq LIMIT ?")
        .all(afterSeq, Math.max(1, Math.min(10_000, Math.floor(limit))))
        .map(logRow);
    },
    recentOps(limit) {
      return db
        .prepare(
          "SELECT seq, at, actor, device, run, kind, target, undoes, by FROM ops ORDER BY seq DESC LIMIT ?",
        )
        .all(Math.max(1, Math.min(10_000, Math.floor(limit))))
        .map(opHead);
    },
    readQuery(sql, params = []) {
      db.setAuthorizer((action, a1, a2) => {
        if (action === constants.SQLITE_SELECT) return constants.SQLITE_OK;
        // FTS5 reads its own shadow tables (entities_fts_data, _idx…) when a query uses entities_fts.
        if (action === constants.SQLITE_READ)
          return a1 && (READABLE.has(a1) || a1.startsWith("entities_fts_"))
            ? constants.SQLITE_OK
            : constants.SQLITE_DENY;
        // For a function the name is the second argument.
        if (action === constants.SQLITE_FUNCTION)
          return a2 === "load_extension" ? constants.SQLITE_DENY : constants.SQLITE_OK;
        // FTS5 asks for this read-only pragma to read its config; every other pragma stays refused.
        if (action === constants.SQLITE_PRAGMA)
          return a1 === "data_version" && a2 === null ? constants.SQLITE_OK : constants.SQLITE_DENY;
        return constants.SQLITE_DENY;
      });
      try {
        return db.prepare(sql).all(...params) as Record<string, unknown>[];
      } finally {
        db.setAuthorizer(null);
      }
    },
    copyTo(dest) {
      if (existsSync(dest)) throw new StoreError("invalid", `${dest} exists`);
      db.prepare("VACUUM INTO ?").run(dest);
    },
    backupTo(dest, key) {
      const tmp = `${dest}.tmp-${process.pid}`;
      rmSync(tmp, { force: true });
      db.prepare("VACUUM INTO ?").run(tmp);
      try {
        sealFile(key, tmp, dest, "boni-backup");
      } finally {
        rmSync(tmp, { force: true });
      }
    },
    bodyVersions: (id) => {
      const out: BlameVersion[] = [];
      for (const r of db
        .prepare(
          "SELECT seq, at, actor, device, by, kind, after FROM ops WHERE target = ? AND kind IN ('create', 'update') ORDER BY seq",
        )
        .all(id) as {
        seq: number;
        at: number;
        actor: string;
        device: string | null;
        by: string | null;
        kind: string;
        after: string | null;
      }[]) {
        const after = r.after ? (JSON.parse(r.after) as Record<string, unknown>) : {};
        const text =
          r.kind === "create" ? (after.entity as { body?: string } | undefined)?.body : after.body;
        if (text === undefined) continue;
        out.push({
          text: (text as string | null) ?? null,
          by: r.by ?? byOf(r.actor, r.device),
          at: r.at,
          seq: r.seq,
        });
      }
      return out;
    },
    journal: openJournal(db),
    audit: openAudit(db, tx),
    close: () => db.close(),
  };
}

/** Writes the database inside an encrypted backup to `dest` (to open it with `openUserStore`). */
/** A sealed copy back into a database file, a megabyte at a time (`openFile`); nothing is written on a bad key. */
export function restoreBackup(src: string, key: Buffer, dest: string): void {
  openFile(key, src, dest, "boni-backup");
}

/** The label of a whole entity: all its fields and body joined (null when nothing is set). */
export function entityLabel(e: StoredEntity): Label | null {
  const ls = Object.values(e.labels);
  return ls.length ? join(ls[0] as Label, ...ls.slice(1)) : null;
}
