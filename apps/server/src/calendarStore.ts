import {
  type CalEvent,
  type CollectionDef,
  type CollectionSnapshot,
  defsToModel,
  diffRows,
  extendSeries,
  isProposalId,
  makeModel,
  type PropValue,
  parseCollectionDef,
  type Row,
  type RowChange,
  reconcileRows,
  rowToEvent,
  systemTimeZone,
  todayIn,
  withMovedRowProperties,
  withNewRowProperties,
} from "@boni/calendar";
import {
  branch,
  type Entity,
  type FieldDef,
  type FieldType,
  label,
  type Schema,
  type TypeDef,
} from "@boni/entities";
import { BODY, type UserStore, type Writes } from "@boni/store";
import { ghostRows } from "./data.ts";

/**
 * Boni Calendar over Boni's own collections (Juan, 2026-10-22: no vault, one truth): the API the apps use (a
 * snapshot, changes since a version, a live stream, writes with a conflict check, reminders in a definition,
 * series kept going), with the account's store as the truth. Each calendar is a collection (a type) and its
 * definition (columns, mapping, colour, reminders) lives in the store's settings (`calendar/defs`).
 *
 * A row is an entity seen as the apps know it: its id the entity's own (docs/clases.md §4 and D-17: no paths); its
 * values by property name (the name of the column, or the field's own name), options by their names, relations as
 * `[[title]]`. A write changes only the properties that differ from what the store has, with Juan's label from
 * that device.
 */

/** What a client needs to show the calendar: definitions and rows (`ignored` and `problems` stay empty here). */
export interface Snapshot extends CollectionSnapshot {
  version: number;
  ignored: { path: string; reason: string }[];
  problems: string[];
}

/**
 * What changed between two versions: rows added or changed, rows gone. `full` when the definitions changed (or
 * the version is too old to know): the client takes a new snapshot instead.
 */
export interface Changes {
  version: number;
  full?: boolean;
  upserts: Row[];
  removes: string[];
}

/** What a write through the server came to. */
export type ApplyResult =
  | { ok: true; version: number; aliases: Record<string, string> }
  | { ok: false; conflict: string[] };

/** The calendars of an account in Boni: each type and the definition the apps read. */
export const CALENDAR_DEFS = "calendar/defs";
const KEEP = 500;
/** The column added the first time an event gets reminders of its own (as the apps' writer did). */
const EVENT_REMINDERS_COLUMN = { id: "avisos", name: "Avisos", type: "text" as const };

/**
 * Which records of a calendar's branch it shows (D-14: a calendar is any collection with a date, split by a field the
 * user chooses): those whose `field` holds `value` (for a relation, the id of the record it points to) and, with
 * `orEmpty`, those where it holds nothing.
 */
export interface Where {
  field: string;
  value: string;
  orEmpty?: boolean;
}
/** Where a calendar over a branch makes its records: tasks (a value in its task column) and events. */
export interface Make {
  event: string;
  task?: string;
}

/**
 * A calendar kept in Boni: its type, and its definition as written (the `collection:` map) and as read. With
 * `where`, the calendar is the type's whole branch (her daughters' records too) filtered by a field; with `make`,
 * its new records go to one of her daughters, and a record marked as a task (or no longer one) moves between them.
 */
export interface Placed {
  type: string;
  raw: Record<string, unknown>;
  def: CollectionDef;
  where?: Where;
  make?: Make;
}

/** The calendars kept in a store (none: the account has no calendar). */
export function calendarDefs(store: UserStore): Placed[] {
  const text = store.setting(CALENDAR_DEFS);
  if (!text) return [];
  try {
    const list = JSON.parse(text) as {
      type?: unknown;
      raw?: unknown;
      where?: unknown;
      make?: unknown;
    }[];
    const schema = store.schema();
    const types = schema.types;
    return list.flatMap((x) => {
      if (typeof x.type !== "string" || !types[x.type] || !x.raw || typeof x.raw !== "object")
        return [];
      const r = parseCollectionDef(x.raw);
      if (!r.ok) return [];
      const placed: Placed = { type: x.type, raw: x.raw as Record<string, unknown>, def: r.def };
      const w = x.where as Partial<Where> | undefined;
      if (w && typeof w.field === "string" && typeof w.value === "string")
        placed.where = { field: w.field, value: w.value, ...(w.orEmpty ? { orEmpty: true } : {}) };
      // Only daughters of the calendar's own branch, never archived.
      const inBranch = (t: unknown): t is string =>
        typeof t === "string" &&
        !!types[t] &&
        !types[t]?.archived &&
        branch(schema, x.type as string).includes(t);
      const m = x.make as Partial<Make> | undefined;
      if (m && inBranch(m.event))
        placed.make = { event: m.event, ...(inBranch(m.task) ? { task: m.task } : {}) };
      return [placed];
    });
  } catch {
    return [];
  }
}

/** Whether a record belongs to a calendar: its type in the calendar's branch, its field as `where` says. */
function inCalendar(
  schema: Schema,
  p: Placed,
  e: { type: string; values: Record<string, unknown> },
) {
  if (e.type !== p.type && !(p.where && branch(schema, p.type).includes(e.type))) return false;
  if (!p.where) return true;
  const v = e.values[p.where.field];
  const empty = v === undefined || v === null || v === "" || (Array.isArray(v) && !v.length);
  if (empty) return !!p.where.orEmpty;
  return Array.isArray(v) ? v.includes(p.where.value) : v === p.where.value;
}

/**
 * The checkbox that marks an entry of `type` done: its calendar's task column (`mapping.task`), the field with
 * that column's name. Null when the type is no calendar or its calendar has no tasks ("Ya lo hice" needs one).
 */
export function taskDoneField(store: UserStore, type: string): FieldDef | null {
  const schema = store.schema();
  const p = calendarDefs(store).find(
    (x) => x.type === type || (x.where && branch(schema, x.type).includes(type)),
  );
  const col = p?.def.mapping.task?.column;
  if (!p || !col) return null;
  const name = p.def.columns.find((c) => c.id === col)?.name ?? col;
  const f = store
    .schema()
    .types[type]?.fields.find((x) => (x.name === name || x.key === col) && !x.archived);
  return f?.type === "checkbox" ? f : null;
}

/** Keeps the calendars' definitions (as written: `parseCollectionDef` reads them back). */
export function saveCalendarDefs(
  store: UserStore,
  list: readonly { type: string; raw: Record<string, unknown>; where?: Where; make?: Make }[],
): void {
  store.setSetting(
    CALENDAR_DEFS,
    JSON.stringify(
      list.map((p) => ({
        type: p.type,
        raw: p.raw,
        ...(p.where ? { where: p.where } : {}),
        ...(p.make ? { make: p.make } : {}),
      })),
    ),
  );
}

/** What the server serves as an account's calendar (its store: `StoreCalendar`). */
export interface CalendarSource {
  readonly writable: boolean;
  snapshot(): Promise<Snapshot>;
  changes(since: number): Changes;
  subscribe(fn: (c: Changes) => void): () => void;
  apply(
    base: number,
    changes: readonly RowChange[],
    who: string,
    device?: string,
  ): Promise<ApplyResult>;
  setReminders(
    collectionId: string,
    edit: { reminders?: { timed: string; allDay: string } | null; eventColumn?: boolean },
  ): Promise<"ok" | "conflict">;
  topUpSeries(): Promise<number>;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const keyOf = (name: string) => {
  const k = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 36);
  return /^[a-z]/.test(k) ? k : `p-${k || "x"}`;
};

export class StoreCalendar implements CalendarSource {
  readonly writable: boolean;
  private store: UserStore;
  private version = 0;
  private seenStore = -1;
  private defsKey = "";
  private placed: Placed[] = [];
  private rows = new Map<string, Row>();
  /** Row id -> entity id. */
  private entityOf = new Map<string, string>();
  private rowIdOf = new Map<string, string>();
  private changedAt = new Map<string, { version: number; by: string | null }>();
  private log: { version: number; upserts: Row[]; removes: string[]; full: boolean }[] = [];
  private listeners = new Set<(c: Changes) => void>();
  private ghostKey = "";
  /** A device's temporary id of a row it made -> the record (a resend before it heard back makes no second one). */
  private madeFrom = new Map<string, string>();
  private ghostIds = new Set<string>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private daily: ReturnType<typeof setInterval> | null = null;
  private topUpTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(store: UserStore, opts: { write?: boolean; pollMs?: number } = {}) {
    this.store = store;
    this.writable = !!opts.write;
    this.poll();
    // Other writers of the same store (Boni's pages, the agent, the import) reach the devices within a second.
    this.timer = setInterval(() => this.poll(), opts.pollMs ?? 1000);
    this.timer.unref?.();
    if (this.writable) {
      this.daily = setInterval(() => this.scheduleTopUp(), 6 * 3_600_000);
      this.daily.unref?.();
    }
  }

  // ------------------------------------------------------------ rows

  /** The fields a calendar shows of a record of `type` (her own collection's: a branch's daughters differ). */
  private fieldsOf(p: Placed, type = p.type): { prop: string; field: FieldDef }[] {
    const def = this.store.schema().types[type];
    if (!def) return [];
    return def.fields
      .filter((f) => !f.hidden && !f.archived)
      .map((f) => ({ prop: p.def.columns.find((c) => c.name === f.name)?.id ?? f.name, field: f }));
  }

  /** The entity of `type` that `[[name]]` (or a plain name) names: by its title (any case). */
  private linked(type: string, link: string): string | null {
    const name = (/^\[\[([^\]|#]+)/.exec(link.trim())?.[1] ?? link)
      .trim()
      .split("/")
      .pop()
      ?.toLowerCase();
    if (!name) return null;
    const tf = this.store.schema().types[type]?.titleField;
    for (const s of this.store.list(type)) {
      const title = tf ? String(s.entity.values[tf] ?? "") : "";
      if (title.trim().toLowerCase() === name) return s.entity.id;
    }
    return null;
  }

  private titleOf(id: string): string {
    const e = this.store.get(id);
    const tf = e ? this.store.schema().types[e.entity.type]?.titleField : undefined;
    return e && tf ? String(e.entity.values[tf] ?? "") : "";
  }

  private toProp(f: FieldDef, v: unknown): PropValue {
    if (v === null || v === undefined) return null;
    switch (f.type) {
      case "select":
        return f.options?.find((o) => o.id === v)?.name ?? String(v);
      case "multiselect":
        return (Array.isArray(v) ? v : [v]).map(
          (x) => f.options?.find((o) => o.id === x)?.name ?? String(x),
        );
      case "relation": {
        const ids = Array.isArray(v) ? v : [v];
        const links = ids.map((id) => `[[${this.titleOf(String(id)) || id}]]`);
        return f.relation?.many ? links : (links[0] ?? null);
      }
      case "money":
        return typeof v === "object" && v && "amount" in v
          ? Number((v as { amount: number }).amount)
          : null;
      default:
        return v as PropValue;
    }
  }

  private rowOf(e: Entity, p: Placed): Row {
    const values: Record<string, PropValue> = {};
    for (const { prop, field } of this.fieldsOf(p, e.type)) {
      const v = this.toProp(field, e.values[field.id]);
      if (v !== null) values[prop] = v;
    }
    return {
      id: e.id,
      collectionId: p.def.id,
      values,
      ...(e.body ? { body: e.body } : {}),
      created: e.created,
      updated: e.updated,
    };
  }

  /** The calendar a record is in (the first that takes it), or none. */
  private placedOf(e: { type: string; values: Record<string, unknown> }) {
    const schema = this.store.schema();
    return this.placed.find((p) => inCalendar(schema, p, e));
  }

  /** The records a calendar takes, each once (the first calendar that takes it wins). */
  private entitiesOf(p: Placed, taken: Set<string>): Entity[] {
    const schema = this.store.schema();
    const types = p.where
      ? branch(schema, p.type).filter((t) => !schema.types[t]?.archived)
      : [p.type];
    const out: Entity[] = [];
    for (const t of types)
      for (const e of this.store.entities(t))
        if (!taken.has(e.id) && inCalendar(schema, p, e)) {
          taken.add(e.id);
          out.push(e);
        }
    return out;
  }

  /** Reads what changed in the store since the last look; a new version when anything did. */
  private poll(): void {
    const storeVersion = this.store.version();
    const placed = calendarDefs(this.store);
    const defsKey = JSON.stringify(placed);
    const first = this.seenStore < 0;
    const full = !first && defsKey !== this.defsKey;
    const ghostKey = this.store.journal.pendingKey();
    const ghostsChanged = ghostKey !== this.ghostKey;
    if (!first && !full && storeVersion === this.seenStore && !ghostsChanged) return;
    this.placed = placed;
    let upserts: Row[] = [];
    let removes: string[] = [];
    const who = new Map<string, string | null>();
    if (first || full) {
      const next = new Map<string, Row>();
      this.entityOf.clear();
      this.rowIdOf.clear();
      const taken = new Set<string>();
      for (const p of placed)
        for (const e of this.entitiesOf(p, taken)) {
          const row = this.rowOf(e, p);
          next.set(row.id, row);
          this.entityOf.set(row.id, e.id);
          this.rowIdOf.set(e.id, row.id);
        }
      removes = [...this.rows.keys()].filter((id) => !next.has(id));
      upserts = [...next.values()];
      this.rows = next;
    } else {
      const ch = this.store.changesSince(this.seenStore);
      for (const s of ch.entities) {
        const was = this.rowIdOf.get(s.entity.id);
        const p = s.entity.deleted === undefined ? this.placedOf(s.entity) : undefined;
        if (!p || s.entity.deleted !== undefined) {
          if (was) {
            this.rows.delete(was);
            this.entityOf.delete(was);
            this.rowIdOf.delete(s.entity.id);
            removes.push(was);
          }
          continue;
        }
        const row = this.rowOf(s.entity, p);
        if (was && was !== row.id) {
          this.rows.delete(was);
          this.entityOf.delete(was);
          removes.push(was);
        }
        this.rows.set(row.id, row);
        this.entityOf.set(row.id, s.entity.id);
        this.rowIdOf.set(s.entity.id, row.id);
        upserts.push(row);
        who.set(row.id, this.store.lastChange(s.entity.id)?.device ?? null);
      }
      // A schema change (a field renamed, an option added) can change every row: read them all again.
      if (ch.schemaChanged) {
        this.seenStore = -1;
        this.defsKey = defsKey;
        this.poll();
        return;
      }
    }
    this.seenStore = storeVersion;
    this.defsKey = defsKey;
    if (first || full || ghostsChanged) {
      // The pending proposals drawn as rows (only when they changed: the key is one cheap query a second).
      const next = new Map<string, Row>();
      const schema = this.store.schema();
      for (const p of placed) {
        const types = p.where ? branch(schema, p.type) : [p.type];
        for (const type of types)
          for (const g of ghostRows(this.store, type)) {
            const e = { id: g.id, type, values: g.values, created: g.updated, updated: g.updated };
            if (next.has(g.id) || !inCalendar(schema, p, e)) continue;
            next.set(g.id, this.rowOf(e as unknown as Entity, p));
          }
      }
      for (const id of this.ghostIds)
        if (!next.has(id)) {
          this.rows.delete(id);
          if (!removes.includes(id)) removes.push(id);
        }
      for (const [id, row] of next) {
        this.rows.set(id, row);
        upserts.push(row);
      }
      this.ghostIds = new Set(next.keys());
      this.ghostKey = ghostKey;
    }
    const changed = first || full || upserts.length > 0 || removes.length > 0;
    if (!changed) return;
    // Versions start from the clock: a device that had an earlier run's version takes a new snapshot, never
    // stuck "ahead".
    this.version = first ? Math.max(Date.now(), this.version + 1) : this.version + 1;
    if (first) return;
    for (const r of full ? [...this.rows.values()] : upserts)
      this.changedAt.set(r.id, { version: this.version, by: who.get(r.id) ?? null });
    for (const id of removes) this.changedAt.set(id, { version: this.version, by: null });
    this.log.push({ version: this.version, upserts, removes, full });
    if (this.log.length > KEEP) this.log.shift();
    const c: Changes = full
      ? { version: this.version, full: true, upserts: [], removes: [] }
      : { version: this.version, upserts, removes };
    for (const l of this.listeners) l(c);
    if (this.writable) this.scheduleTopUp();
  }

  async snapshot(): Promise<Snapshot> {
    this.poll();
    const model = defsToModel(
      this.placed.map((p) => p.def),
      { readOnly: !this.writable },
    );
    return {
      ...model,
      rows: [...this.rows.values()],
      version: this.version,
      ignored: [],
      problems: [],
    };
  }

  changes(since: number): Changes {
    this.poll();
    if (since === this.version) return { version: this.version, upserts: [], removes: [] };
    const after = this.log.filter((c) => c.version > since);
    if (
      since > this.version ||
      after.length === 0 ||
      after[0]?.version !== since + 1 ||
      after.some((c) => c.full)
    )
      return { version: this.version, full: true, upserts: [], removes: [] };
    const up = new Map<string, Row>();
    const gone = new Set<string>();
    for (const c of after) {
      for (const r of c.upserts) {
        up.set(r.id, r);
        gone.delete(r.id);
      }
      for (const id of c.removes) {
        up.delete(id);
        gone.add(id);
      }
    }
    return { version: this.version, upserts: [...up.values()], removes: [...gone] };
  }

  subscribe(fn: (c: Changes) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  // ------------------------------------------------------------ writes

  /** A property's value as the field keeps it (options by id; a new option is added to the field). */
  private fromProp(type: string, f: FieldDef, v: PropValue, device: string): unknown {
    if (v === null || v === undefined || v === "") return null;
    const optionId = (name: string) => {
      const def = this.store.schema().types[type];
      const field = def?.fields.find((x) => x.id === f.id);
      const o = field?.options?.find((x) => x.name === name || x.id === name);
      if (o) return o.id;
      const id = `o_${keyOf(name).replace(/-/g, "_").slice(0, 40)}_${Date.now().toString(36)}`;
      this.store.applySchema(
        {
          op: "set_options",
          // An inherited field is changed in the collection it comes from.
          type: field?.from ?? type,
          field: f.id,
          options: [...(field?.options ?? []), { id, name, label: this.labelFor(type, f, device) }],
        },
        { actor: "user", device },
      );
      return id;
    };
    switch (f.type) {
      case "select":
        return optionId(String(v));
      case "multiselect":
        return (Array.isArray(v) ? v : [v]).map((x) => optionId(String(x)));
      case "checkbox":
        return v === true || v === "true";
      case "number":
      case "duration":
        return typeof v === "number" ? v : Number(v);
      case "relation": {
        // The calendar does not edit links, but a new row (its collection's `newNote.properties`, the area) and a
        // moved one carry them: `[[name]]` is the target's entity by its title or its note's name. A link to
        // nothing is left as it was.
        const target = f.relation?.target;
        if (!target) return undefined;
        const ids = (Array.isArray(v) ? v : [v]).map((x) => this.linked(target, String(x)));
        if (ids.some((x) => x === null)) return undefined;
        return f.relation?.many ? ids : ids[0];
      }
      case "money":
        return { amount: Number(v), currency: "EUR" };
      case "text":
      case "longtext":
      case "url":
      case "email":
        return Array.isArray(v) ? v.join(", ") : String(v);
      default:
        return v;
    }
  }

  private labelFor(type: string, f: FieldDef | null, device: string) {
    const def = this.store.schema().types[type] as TypeDef;
    return label(
      "user",
      f?.sensitivity ?? def.sensitivity,
      [{ kind: "user-edit", id: device }],
      Boolean(def.thirdParty),
    );
  }

  /**
   * The field of a property for a record of `of`, made (from its value's shape) when it does not have one yet: in
   * the calendar's own collection, so every daughter of a branch gets it too.
   */
  private fieldFor(p: Placed, of: string, prop: string, v: PropValue, device: string): FieldDef {
    const known = this.fieldsOf(p, of).find((x) => x.prop === prop)?.field;
    if (known) return known;
    const col = p.def.columns.find((c) => c.id === prop);
    const type: FieldType =
      col && ["text", "number", "checkbox", "date", "time", "dates", "url"].includes(col.type)
        ? (col.type as FieldType)
        : typeof v === "boolean"
          ? "checkbox"
          : typeof v === "number"
            ? "number"
            : typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)
              ? "date"
              : typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v)
                ? "time"
                : "text";
    // `[[x]]` naming a note Boni has (an area): a link to that collection.
    const target =
      type === "text" && typeof v === "string" && /^\[\[[^\]]+\]\]$/.test(v.trim())
        ? Object.values(this.store.schema().types).find(
            (t) => !t.system && !t.archived && this.linked(t.id, v) !== null,
          )
        : undefined;
    const def = this.store.schema().types[p.type] as TypeDef;
    let key = keyOf(prop);
    while (def.fields.some((f) => f.key === key)) key = `${key}-2`.slice(0, 40);
    const field: FieldDef = {
      id: `f_${key.replace(/-/g, "_")}`.slice(0, 64),
      key,
      name: col?.name ?? prop,
      type: target ? "relation" : type,
      ...(target ? { relation: { target: target.id, many: false } } : {}),
      label: this.labelFor(p.type, null, device),
    };
    this.store.applySchema({ op: "add_field", type: p.type, field }, { actor: "user", device });
    return field;
  }

  private writesFor(
    p: Placed,
    type: string,
    before: Row | null,
    after: Row,
    device: string,
  ): Writes {
    const writes: Writes = {};
    const props = new Set([...Object.keys(after.values), ...Object.keys(before?.values ?? {})]);
    for (const prop of props) {
      const next = after.values[prop] ?? null;
      if (before && same(before.values[prop], next)) continue;
      if (next === null && !this.fieldsOf(p, type).some((x) => x.prop === prop)) continue;
      // A device edits only the calendar's columns: a property it lacks that is none of them (the area its
      // collection gives new rows, a project set in Boni) is one it never got back yet (its draft, sent again before
      // the server's copy arrived), never one it cleared.
      if (before && next === null && !p.def.columns.some((c) => c.id === prop)) continue;
      const f = this.fieldFor(p, type, prop, next, device);
      const value = this.fromProp(type, f, next, device);
      if (value === undefined) continue;
      writes[f.id] = { value, label: this.labelFor(type, f, device) };
    }
    if (!before || (before.body ?? "") !== (after.body ?? ""))
      writes[BODY] = { value: after.body || null, label: this.labelFor(type, null, device) };
    return writes;
  }

  /** Whether a row is a task: its calendar's task column holds a value (done or not). */
  private isTask(p: Placed, row: Row): boolean {
    const col = p.def.mapping.task?.column;
    return !!col && row.values[col] !== undefined && row.values[col] !== null;
  }

  /** The collection a row of calendar `p` belongs in: with `make`, its tasks' or its events'; else the calendar's. */
  private homeOf(p: Placed, row: Row): string {
    if (!p.make) return p.type;
    return this.isTask(p, row) ? (p.make.task ?? p.make.event) : p.make.event;
  }

  /** The field value that puts a record in calendar `p` (its `where`), when it does not hold it yet. */
  private whereWrite(p: Placed, type: string, eid: string | null, writes: Writes, device: string) {
    if (!p.where) return;
    const cur = eid ? this.store.get(eid)?.entity : undefined;
    if (cur && inCalendar(this.store.schema(), p, cur)) return;
    const f = this.store.schema().types[type]?.fields.find((x) => x.id === p.where?.field);
    if (!f) return;
    const value = f.type === "relation" && f.relation?.many ? [p.where.value] : p.where.value;
    writes[f.id] = { value, label: this.labelFor(type, f, device) };
  }

  async apply(
    base: number,
    changes: readonly RowChange[],
    who: string,
    device = who,
  ): Promise<ApplyResult> {
    if (!this.writable) throw new Error("This server does not write (BONI_WRITE)");
    this.poll();
    const aliases: Record<string, string> = {};
    // A row the device knows by an older id is the same record: the temporary id of one it made and sent again
    // before it heard back.
    const known = (id: string): string => {
      if (this.rows.has(id) || isProposalId(id)) return id;
      const made = this.madeFrom.get(id);
      const hit = made && this.rows.has(made) ? made : undefined;
      if (!hit) return id;
      aliases[id] = hit;
      return hit;
    };
    const idOf = (c: RowChange) => known(c.op === "upsert" ? c.row.id : c.id);
    const conflict = changes.map(idOf).filter((id) => {
      const c = this.changedAt.get(id);
      return !!c && c.version > base && c.by !== device;
    });
    if (conflict.length > 0) return { ok: false, conflict: [...new Set(conflict)] };
    const meta = { actor: "user" as const, device };
    const touched: string[] = [];
    for (const c of changes) {
      const id = idOf(c);
      // A proposal (`ghost:<id>`) is decided in Boni, never written from a device.
      if (isProposalId(id)) continue;
      if (c.op === "remove") {
        const eid = this.entityOf.get(id);
        if (eid) this.store.remove(eid, meta);
        continue;
      }
      const p = this.placed.find((x) => x.def.id === c.row.collectionId);
      if (!p) continue;
      const row = id === c.row.id ? c.row : { ...c.row, id };
      const eid = this.entityOf.get(id);
      const before = eid ? (this.rows.get(id) ?? null) : null;
      if (eid && before && before.collectionId !== row.collectionId) {
        // Moved to another calendar: the same record (docs/clases.md §2.5: its id and its history stay; what both
        // share stays), in the collection it belongs in there (within one branch it may stay: only its field
        // changes), with that calendar's properties.
        const from = this.placed.find((x) => x.def.id === before.collectionId)?.def;
        const values = withMovedRowProperties(row.values, from, p.def);
        const home = this.homeOf(p, { ...row, values });
        if (this.store.get(eid)?.entity.type !== home) this.store.retype(eid, home, meta);
        const writes = this.writesFor(p, home, null, { ...row, values }, device);
        this.whereWrite(p, home, eid, writes, device);
        if (Object.keys(writes).length) this.store.update(eid, writes, meta);
        touched.push(id);
      } else if (eid && before) {
        // Marked as a task, or no longer one: to the collection of tasks or of events (same record).
        const type = this.store.get(eid)?.entity.type ?? p.type;
        const home = this.homeOf(p, row);
        if (p.make && home !== type) this.store.retype(eid, home, meta);
        const writes = this.writesFor(p, p.make ? home : type, before, row, device);
        if (Object.keys(writes).length) this.store.update(eid, writes, meta);
        touched.push(id);
      } else {
        const fresh = { ...row, values: withNewRowProperties(row.values, p.def) };
        const home = this.homeOf(p, fresh);
        const writes = this.writesFor(p, home, null, fresh, device);
        this.whereWrite(p, home, null, writes, device);
        const made = this.store.create(home, writes, meta);
        aliases[c.row.id] = made.entity.id;
        this.madeFrom.set(c.row.id, made.entity.id);
        if (this.madeFrom.size > 1000)
          this.madeFrom.delete(this.madeFrom.keys().next().value as string);
        touched.push(made.entity.id);
      }
    }
    this.poll();
    // What this device just wrote is not a conflict for its next write.
    for (const id of touched) {
      const c = this.changedAt.get(id);
      if (c) c.by = device;
    }
    return { ok: true, version: this.version, aliases };
  }

  async setReminders(
    collectionId: string,
    edit: { reminders?: { timed: string; allDay: string } | null; eventColumn?: boolean },
  ): Promise<"ok" | "conflict"> {
    if (!this.writable) throw new Error("This server does not write (BONI_WRITE)");
    const placed = calendarDefs(this.store);
    const p = placed.find((x) => x.def.id === collectionId);
    if (!p) return "conflict";
    const raw: Record<string, unknown> = { ...p.raw };
    if (edit.reminders === null) delete raw.reminders;
    else if (edit.reminders) raw.reminders = edit.reminders;
    const mapping = { ...((raw.mapping as Record<string, unknown>) ?? {}) };
    if (edit.eventColumn && !mapping.reminders) {
      const columns = Array.isArray(raw.columns) ? [...raw.columns] : [];
      if (!columns.some((c) => (c as { id?: unknown }).id === EVENT_REMINDERS_COLUMN.id))
        columns.push(EVENT_REMINDERS_COLUMN);
      raw.columns = columns;
      raw.mapping = { ...mapping, reminders: EVENT_REMINDERS_COLUMN.id };
    }
    if (!parseCollectionDef(raw).ok) return "conflict";
    saveCalendarDefs(
      this.store,
      placed.map((x) => (x === p ? { ...x, raw } : x)),
    );
    this.poll();
    return "ok";
  }

  /** Open-ended series get the events they are missing up to the apps' horizon (never refilling gaps). */
  async topUpSeries(): Promise<number> {
    if (!this.writable) return 0;
    const snap = await this.snapshot();
    const tz = systemTimeZone();
    const model = makeModel(snap.collections, snap.views, { defaultTz: tz });
    const events: CalEvent[] = [];
    for (const row of snap.rows) {
      const ev = rowToEvent(model, row);
      if (ev) events.push(ev);
    }
    const now = Date.now();
    const more = extendSeries(events, {
      newId: () => `ev-${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      now,
      today: todayIn(tz, now),
    });
    if (more.length === 0) return 0;
    const rows = reconcileRows(model, snap.rows, events, [...events, ...more]);
    await this.apply(this.version, diffRows(snap.rows, rows), "server", "server");
    return more.length;
  }

  private scheduleTopUp(): void {
    if (!this.writable || this.topUpTimer) return;
    this.topUpTimer = setTimeout(() => {
      this.topUpTimer = null;
      this.topUpSeries().catch((e) => console.warn("series", e instanceof Error ? e.message : e));
    }, 2000);
    this.topUpTimer.unref?.();
  }

  close(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.daily) clearInterval(this.daily);
    if (this.topUpTimer) clearTimeout(this.topUpTimer);
    this.listeners.clear();
  }
}
