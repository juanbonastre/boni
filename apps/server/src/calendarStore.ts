import {
  type CalEvent,
  type CollectionDef,
  type CollectionSnapshot,
  defsToModel,
  diffRows,
  extendSeries,
  isProposalId,
  makeModel,
  PALETTE,
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
  rolesOf,
  type Schema,
  type TypeDef,
} from "@boni/entities";
import { BODY, type UserStore, type Writes } from "@boni/store";
import { ghostRows } from "./data.ts";
import { timed } from "./perf.ts";

/**
 * Boni Calendar over Boni's own collections (Juan, 2026-10-22: no vault, one truth): the API the apps use (a
 * snapshot, changes since a version, a live stream, writes with a conflict check, reminders in a definition,
 * series kept going), with the account's store as the truth. Each calendar is a collection (a type) and its
 * definition (columns, mapping, colour, reminders) lives in the store's settings (`calendar/defs`).
 *
 * A row is an entity seen as the apps know it: its id the entity's own (docs/clases.md §4 and D-17: no paths); its
 * values by property name (the name of the column, or the field's own name), options by their names, relations by
 * the titles they point to. A write changes only the properties that differ from what the store has, with Juan's label from
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
 * The column a calendar keeps a record's link to an external calendar's event in (task 50): added to the definition
 * the first time the user links in that calendar, mapped `external`; the collection gets the field on the first
 * write, as every column of a definition.
 */
export const EVENT_LINK_COLUMN = {
  id: "evento-externo",
  name: "Evento externo",
  type: "text" as const,
};

/**
 * Which records of a calendar's branch it shows (D-14: a calendar is any collection with a date, split by a field the
 * user chooses): those whose `field` holds `value` (for a relation, the id of the record it points to) and, with
 * `orEmpty`, those where it holds nothing.
 */
export interface Where {
  field: string;
  value: string;
  orEmpty?: boolean;
  /** More conditions a value split again adds below it (every one must hold). */
  also?: Where[];
}
/** A node above a calendar a split made: the definition, or a value split again; with the field it splits by. */
export interface PathNode {
  id: string;
  name: string;
  field: string;
  fieldName: string;
}
/** How a definition is split (D-24): by a field; and any of its values, by its key, split again (`by`). */
export interface SplitNode {
  field: string;
  by?: Record<string, SplitNode>;
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
  /** For a calendar a split made: the node right above it, and every node above it (the definition first). */
  group?: PathNode;
  path?: PathNode[];
}

/**
 * A calendar's definition as kept (`calendar/defs`): its type, the definition as written, and how its records are
 * picked (`where`), made (`make`) or split (`split`, D-24: one calendar per value of a field, expanded when read).
 */
export interface Stored {
  type: string;
  raw: Record<string, unknown>;
  where?: Where;
  make?: Make;
  split?: SplitNode;
}

/** A split as kept, checked (a field name per node; values split again under `by`; at most six levels). */
function parseSplit(v: unknown, depth = 0): SplitNode | undefined {
  if (!isObj(v) || typeof v.field !== "string" || depth > 6) return undefined;
  const by = isObj(v.by)
    ? Object.fromEntries(
        Object.entries(v.by).flatMap(([k, n]) => {
          const c = parseSplit(n, depth + 1);
          return c ? [[k, c]] : [];
        }),
      )
    : {};
  return { field: v.field, ...(Object.keys(by).length ? { by } : {}) };
}

/** The definitions as kept, checked against the schema (a type gone, gone with it); never expanded. */
export function storedCalendarDefs(store: UserStore): Stored[] {
  const text = store.setting(CALENDAR_DEFS);
  if (!text) return [];
  try {
    const list = JSON.parse(text) as {
      type?: unknown;
      raw?: unknown;
      where?: unknown;
      make?: unknown;
      split?: unknown;
    }[];
    const schema = store.schema();
    const types = schema.types;
    return list.flatMap((x) => {
      if (typeof x.type !== "string" || !types[x.type] || !x.raw || typeof x.raw !== "object")
        return [];
      const s: Stored = { type: x.type, raw: x.raw as Record<string, unknown> };
      const w = x.where as Partial<Where> | undefined;
      if (w && typeof w.field === "string" && typeof w.value === "string")
        s.where = { field: w.field, value: w.value, ...(w.orEmpty ? { orEmpty: true } : {}) };
      // Only daughters of the calendar's own branch, never archived.
      const inBranch = (t: unknown): t is string =>
        typeof t === "string" &&
        !!types[t] &&
        !types[t]?.archived &&
        branch(schema, x.type as string).includes(t);
      const m = x.make as Partial<Make> | undefined;
      if (m && inBranch(m.event))
        s.make = { event: m.event, ...(inBranch(m.task) ? { task: m.task } : {}) };
      const sp = parseSplit(x.split);
      if (sp) s.split = sp;
      return [s];
    });
  } catch {
    return [];
  }
}

/** The fields a collection could be split by: its options and its single relations, by id and name. */
export function splitChoices(schema: Schema, type: string): { id: string; name: string }[] {
  return (schema.types[type]?.fields ?? [])
    .filter(
      (f) =>
        !f.archived &&
        !f.hidden &&
        (f.type === "select" || (f.type === "relation" && !f.relation?.many)),
    )
    .map((f) => ({ id: f.id, name: f.name }));
}

const isEmptyValue = (v: unknown) =>
  v === undefined || v === null || v === "" || (Array.isArray(v) && !v.length);
const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * A split definition read as calendars (D-24; Juan, 2026-11-02): at the top, one per value of the field (every
 * option of a list, or every record the relation may point to, so a new value shows up by itself); a value split
 * again (`by`) gives, under it, one per value found among its records; and «Sin …» for the records that hold
 * nothing, only while there are some. Each calendar gets its id (`<definition>--<value>--…`), the colour kept for
 * its values in the definition (`colors`, the values joined with "/") or the palette's by its place, and the
 * definition's reminders and tasks; `path` says the nodes above it, the definition first.
 */
function expandNode(
  store: UserStore,
  schema: Schema,
  s: Stored,
  def: CollectionDef,
  node: SplitNode,
  at: { id: string; name: string },
  conds: Where[],
  path: PathNode[],
  depth: number,
  pool: Listed,
  watch: Set<string>,
): Placed[] {
  const t = schema.types[s.type];
  const choices = splitChoices(schema, s.type);
  const usable = (id: string) =>
    choices.some((c) => c.id === id) && !conds.some((w) => w.field === id);
  const field = t?.fields.find((f) => f.id === node.field && usable(f.id));
  if (!field) return [];
  const titleOf = (e: Entity) => String(e.values[schema.types[e.type]?.titleField ?? ""] ?? e.id);
  const records = pool.filter((e) => conds.every((w) => matches(e.entity, w)));
  if (field.type === "relation" && field.relation?.target) watch.add(field.relation.target);
  const all: { key: string; name: string }[] =
    field.type === "select"
      ? (field.options ?? []).map((o) => ({ key: o.id, name: o.name }))
      : store
          .list(field.relation?.target as string)
          .map((e) => ({ key: e.entity.id, name: titleOf(e.entity) }));
  // At the top every value; a value split again shows the values found among its own records.
  const present = new Set(
    records.flatMap((e) => {
      const v = e.entity.values[field.id];
      return Array.isArray(v) ? v.map(String) : isEmptyValue(v) ? [] : [String(v)];
    }),
  );
  const values = depth === 0 ? all : all.filter((v) => present.has(v.key));
  const empty = records.some((e) => isEmptyValue(e.entity.values[field.id]));
  const colors = isObj(s.raw.colors) ? (s.raw.colors as Record<string, string>) : {};
  const palette = Object.values(PALETTE);
  const taskType = s.make?.task ?? s.type;
  const here: PathNode = { id: at.id, name: at.name, field: field.id, fieldName: field.name };
  const below = [...path, here];
  const member = (v: { key: string; name: string }, i: number, orEmpty: boolean): Placed[] => {
    const id = `${at.id}--${orEmpty ? "sin" : keyOf(v.key)}`;
    const w: Where = { field: field.id, value: v.key, ...(orEmpty ? { orEmpty: true } : {}) };
    const next = [...conds, w];
    const child = orEmpty ? undefined : node.by?.[v.key];
    if (child && t?.fields.some((f) => f.id === child.field && usable(f.id) && f.id !== field.id))
      return expandNode(
        store,
        schema,
        s,
        def,
        child,
        { id, name: v.name },
        next,
        below,
        depth + 1,
        pool,
        watch,
      );
    const key = next.map((c) => c.value).join("/");
    const { colors: _c, ...rest } = s.raw;
    const raw: Record<string, unknown> = {
      ...rest,
      id,
      name: v.name,
      color: colors[key] ?? palette[i % palette.length] ?? def.color,
    };
    const r = parseCollectionDef(raw);
    if (!r.ok) return [];
    const [first, ...also] = next;
    const where: Where = { ...(first as Where), ...(also.length ? { also } : {}) };
    const p: Placed = {
      type: s.type,
      raw,
      def: r.def,
      where,
      ...(s.make ? { make: s.make } : {}),
      group: here,
      path: below,
    };
    p.def = {
      ...withRoles(schema, s.type, r.def, taskType),
      group: here,
      path: below,
      split: { field: null, choices: choices.filter((c) => !next.some((x) => x.field === c.id)) },
    };
    return [p];
  };
  return [
    ...values.flatMap((v, i) => member(v, i, false)),
    ...(empty
      ? member({ key: "", name: `Sin ${field.name.toLowerCase()}` }, values.length, true)
      : []),
  ];
}

/**
 * The calendars as last read, per store: the same answer while neither the store (its records and its schema: its
 * version) nor the kept definitions changed. Reading them lists every record of a split collection (the values
 * present, «Sin …»), and the calendar asks every second and on every request (2026-11-03: about 70 ms a time with
 * Juan's Agenda split by area, a quarter of the NAS's thread; task 35). Callers never change what they get.
 */
const readDefs = new WeakMap<UserStore, DefsMemo>();
interface DefsMemo {
  version: number;
  kept: string | null;
  placed: Placed[];
  watch: Set<string>;
  split: SplitWatch;
}
/**
 * What the split definitions read of their records (task 43): per type of a split branch, the definitions it counts
 * in (their root and the fields they split by); each record's signature (those fields' values) and how many records
 * share each one. A change that keeps every signature found among the records leaves the definitions as they were.
 */
interface SplitWatch {
  of: Map<string, { root: string; fields: string[] }[]>;
  sig: Map<string, string>;
  count: Map<string, number>;
}
const splitFields = (node: SplitNode): string[] => [
  node.field,
  ...Object.values(node.by ?? {}).flatMap(splitFields),
];
const signature = (
  defs: { root: string; fields: string[] }[],
  e: { values: Record<string, unknown> },
) => JSON.stringify(defs.map((d) => [d.root, d.fields.map((f) => e.values[f] ?? null)]));

/**
 * Whether what changed leaves the definitions as they were: records of no calendar's concern, or a split branch's
 * records whose split values are still among the others' (a title, a time or a place changed: the usual edit; task
 * 43: every edit of the Agenda read its 2,805 records again, half a second on the NAS). A value new to the branch,
 * the last record of one gone, or a change in a collection a split names (an area renamed) read them again. The
 * signatures are kept up to date as it goes.
 */
function splitUnchanged(
  was: DefsMemo,
  changed: {
    entity: { id: string; type: string; values: Record<string, unknown>; deleted?: number };
  }[],
): boolean {
  const { of, sig, count } = was.split;
  for (const { entity: e } of changed) {
    const known = sig.get(e.id);
    const watched = was.watch.has(e.type);
    if (!watched && known === undefined) continue;
    const defs = of.get(e.type);
    if (watched && !defs) return false;
    const next = e.deleted === undefined && defs ? signature(defs, e) : undefined;
    if (next === known) continue;
    if (known !== undefined && (count.get(known) ?? 0) <= 1) return false;
    if (next !== undefined && !count.get(next)) return false;
    if (known !== undefined) count.set(known, (count.get(known) ?? 0) - 1);
    if (next === undefined) sig.delete(e.id);
    else {
      count.set(next, (count.get(next) ?? 0) + 1);
      sig.set(e.id, next);
    }
  }
  return true;
}

/** The calendars of a store as the apps read them: each definition, a split one expanded (none: no calendar). */
export function calendarDefs(store: UserStore): Placed[] {
  const version = store.version();
  const kept = store.setting(CALENDAR_DEFS);
  const was = readDefs.get(store);
  if (was && was.kept === kept) {
    if (was.version === version) return was.placed;
    // Only a change of the schema, or of a record the definitions read (a split collection's, its values'), reads
    // them again: the rest of Boni's writes (mail, pages, money) leave them as they were (2026-11-03: every write
    // cost the NAS half a second; task 35).
    const ch = store.changesSince(was.version);
    if (!ch.schemaChanged && splitUnchanged(was, ch.entities)) {
      was.version = version;
      return was.placed;
    }
  }
  const watch = new Set<string>();
  const split: SplitWatch = { of: new Map(), sig: new Map(), count: new Map() };
  const placed = readCalendarDefs(store, watch, split);
  readDefs.set(store, { version, kept, placed, watch, split });
  return placed;
}

/** The records of a store as `list` gives them. */
type Listed = ReturnType<UserStore["list"]>;

/**
 * Reads the definitions; `watch` gets the types whose records the reading depended on, and `split` what the split
 * ones read of their records (their signatures).
 */
function readCalendarDefs(
  store: UserStore,
  watch: Set<string>,
  split: SplitWatch = { of: new Map(), sig: new Map(), count: new Map() },
): Placed[] {
  const schema = store.schema();
  const pools: Listed[] = [];
  const placed = storedCalendarDefs(store).flatMap((s) => {
    const r = parseCollectionDef(s.raw);
    if (!r.ok) return [];
    const choices = splitChoices(schema, s.type);
    if (s.split && choices.some((c) => c.id === s.split?.field)) {
      // The branch's records, listed once for every node of the split.
      const fields = splitFields(s.split);
      for (const t of branch(schema, s.type)) {
        watch.add(t);
        split.of.set(t, [...(split.of.get(t) ?? []), { root: s.type, fields }]);
      }
      const pool = store.list(s.type, { deep: true });
      pools.push(pool);
      return expandNode(
        store,
        schema,
        s,
        r.def,
        s.split,
        { id: r.def.id, name: r.def.name },
        [],
        [],
        0,
        pool,
        watch,
      );
    }
    const one: Placed = {
      type: s.type,
      raw: s.raw,
      def: r.def,
      ...(s.where ? { where: s.where } : {}),
      ...(s.make ? { make: s.make } : {}),
    };
    one.def = {
      ...withRoles(schema, s.type, r.def, s.make?.task ?? s.type),
      // A calendar picked by a field (the first restructurings) is not split again.
      ...(s.where ? {} : { split: { field: null, choices } }),
    };
    return [one];
  });
  // Each split record's signature, once all the definitions it counts in are known.
  const seen = new Set<string>();
  for (const pool of pools)
    for (const { entity: e } of pool) {
      const defs = split.of.get(e.type);
      if (!defs || seen.has(e.id)) continue;
      seen.add(e.id);
      const sig = signature(defs, e);
      split.sig.set(e.id, sig);
      split.count.set(sig, (split.count.get(sig) ?? 0) + 1);
    }
  return placed;
}

/** Whether a record belongs to a calendar: its type in the calendar's branch, its field as `where` says. */
/** A calendar column of the type a role's field has (the calendar roles take dates, times, instants and boxes). */
const columnTypeOf = (t: FieldType): "date" | "time" | "datetime" | "checkbox" | "text" =>
  t === "date" || t === "time" || t === "datetime" || t === "checkbox" ? t : "text";

/**
 * The calendar's day, times, end and task box as the collection's roles say (docs/clases.md §6, D-20; Juan,
 * 2026-11-01: the roles go from each calendar's definition to the collection). The definition keeps the rest: the
 * title, the place, the colour, the reminders, how the branch is split. A collection whose roles are not set yet
 * keeps its definition's mapping, as before, role by role; the task box is the role of the collection its tasks are
 * made in (`make.task`). A role's field is read by the column named like it or, without one, by the field's own
 * name, which is how the rows carry it (`fieldsOf`).
 */
export function withRoles(
  schema: Schema,
  type: string,
  def: CollectionDef,
  taskType = type,
): CollectionDef {
  const roles = rolesOf(schema, type);
  const done = rolesOf(schema, taskType).done;
  if (!roles.date && !roles.start && !done) return def;
  const columns = [...def.columns];
  const col = (t: string, id: string | undefined): string | undefined => {
    const f = id ? schema.types[t]?.fields.find((x) => x.id === id) : undefined;
    if (!f) return undefined;
    const c = columns.find((x) => x.name === f.name);
    if (c) return c.id;
    columns.push({ id: f.name, name: f.name, type: columnTypeOf(f.type) });
    return f.name;
  };
  const was = def.mapping.when;
  const timezone = was.timezone ? { timezone: was.timezone } : {};
  let when = was;
  if (roles.date) {
    const startTime = col(type, roles.time);
    const endTime = col(type, roles.endTime);
    const endDate = col(type, roles.endDate);
    when = {
      kind: "split",
      date: col(type, roles.date) as string,
      ...(startTime ? { startTime } : {}),
      ...(endTime ? { endTime } : {}),
      ...(endDate ? { endDate } : {}),
      ...(was.kind === "split" && was.allDay ? { allDay: was.allDay } : {}),
      ...timezone,
    };
  } else if (roles.start) {
    const end = col(type, roles.end);
    when = {
      kind: "range",
      start: col(type, roles.start) as string,
      ...(end ? { end } : {}),
      ...timezone,
    };
  }
  const task = done ? { column: col(taskType, done) as string } : def.mapping.task;
  return { ...def, columns, mapping: { ...def.mapping, when, ...(task ? { task } : {}) } };
}

/** Whether a record's field holds what a condition asks: the value (a relation may hold several), or nothing. */
function matches(e: { values: Record<string, unknown> }, w: Where): boolean {
  const v = e.values[w.field];
  if (isEmptyValue(v)) return !!w.orEmpty;
  return Array.isArray(v) ? v.includes(w.value) : v === w.value;
}

function inCalendar(
  schema: Schema,
  p: Placed,
  e: { type: string; values: Record<string, unknown> },
) {
  if (e.type !== p.type && !(p.where && branch(schema, p.type).includes(e.type))) return false;
  if (!p.where) return true;
  return matches(e, p.where) && (p.where.also ?? []).every((w) => matches(e, w));
}

/**
 * The checkbox that marks an entry of `type` done: the field playing its `done` role (docs/clases.md §6) or, for a
 * collection whose roles are not set yet, its calendar's task column (`mapping.task`), the field with that column's
 * name. Null when it keeps no tasks ("Ya lo hice" needs one).
 */
export function taskDoneField(store: UserStore, type: string): FieldDef | null {
  const schema = store.schema();
  const byRole = rolesOf(schema, type).done;
  if (byRole) return schema.types[type]?.fields.find((f) => f.id === byRole) ?? null;
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

/** A collection Boni Calendar may add as a calendar. */
export interface CalendarCandidate {
  type: string;
  name: string;
  icon: string;
  count: number;
}

/**
 * The collections that could be calendars (Juan, 2026-11-02, D-23: everything dated is a candidate, and he picks
 * which show from Boni Calendar): the user's, not archived, with a day or an instant (its `date` or `start` role),
 * and not a calendar yet (nor in the branch a calendar over a mother shows).
 */
export function calendarCandidates(store: UserStore): CalendarCandidate[] {
  const schema = store.schema();
  const taken = new Set(
    storedCalendarDefs(store).flatMap((s) =>
      s.where || s.split ? branch(schema, s.type) : [s.type],
    ),
  );
  return Object.values(schema.types)
    .filter((t) => !t.system && !t.archived && !taken.has(t.id))
    .filter((t) => {
      const r = rolesOf(schema, t.id);
      return !!(r.date || r.start);
    })
    .map((t) => ({ type: t.id, name: t.name, icon: t.icon ?? "", count: store.count(t.id) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Adds a candidate as a calendar («+ Añadir calendario»): a definition with its title and its day (its roles fill the
 * times, the end and the task box: `withRoles`), the first colour of the palette no calendar has, under the account
 * the others have. Null when the collection is no candidate.
 */
export function addCalendar(store: UserStore, type: string): { id: string } | null {
  const schema = store.schema();
  const t = schema.types[type];
  if (!t || !calendarCandidates(store).some((c) => c.type === type)) return null;
  const roles = rolesOf(schema, type);
  const field = (id: string | undefined) => (id ? t.fields.find((f) => f.id === id) : undefined);
  const title = field(t.titleField);
  const day = field(roles.date ?? roles.start);
  if (!title || !day) return null;
  const defs = storedCalendarDefs(store);
  const used = new Set(defs.map((p) => String(p.raw.id ?? "")));
  const base = keyOf(t.name);
  let id = base;
  for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
  const colours = Object.values(PALETTE);
  const inUse = new Set(calendarDefs(store).map((p) => p.def.color));
  const color =
    colours.find((c) => !inUse.has(c)) ?? colours[defs.length % colours.length] ?? "#60a5fa";
  const raw: Record<string, unknown> = {
    id,
    name: t.name,
    folder: t.key,
    account: typeof defs[0]?.raw.account === "string" ? defs[0].raw.account : "Boni",
    color,
    columns: [
      { id: title.name, name: title.name, type: "text" },
      ...(day.id === title.id
        ? []
        : [{ id: day.name, name: day.name, type: columnTypeOf(day.type) }]),
    ],
    mapping: {
      title: title.name,
      when: roles.date ? { kind: "split", date: day.name } : { kind: "range", start: day.name },
    },
  };
  if (!parseCollectionDef(raw).ok) return null;
  saveCalendarDefs(store, [...defs, { type, raw }]);
  return { id };
}

/**
 * Takes a calendar away (its definition only: the collection and its records stay; a split one goes whole, with
 * every calendar it made). False when there is none.
 */
export function removeCalendar(store: UserStore, calendarId: string): boolean {
  const defs = storedCalendarDefs(store);
  const rest = defs.filter((s) => s.raw.id !== calendarId || s.where);
  if (rest.length === defs.length) return false;
  saveCalendarDefs(store, rest);
  return true;
}

/**
 * Splits a node by a field, or makes it whole again (`field` null): the definition itself (its id), or any of the
 * calendars it makes (a value, by the calendar's or the group row's id: split again below it, D-24). The kept
 * definition changes; what the apps read comes from `calendarDefs`. "bad-field": not one the collection can be
 * split by, or one a node above already uses.
 */
export function setSplit(
  store: UserStore,
  id: string,
  field: string | null,
): "ok" | "no-such-calendar" | "bad-field" {
  const defs = storedCalendarDefs(store);
  const schema = store.schema();
  let i = defs.findIndex((s) => s.raw.id === id && !s.where);
  let keys: string[] = [];
  if (i < 0) {
    const read = calendarDefs(store);
    const leaf = read.find((p) => p.def.id === id);
    const under = leaf ?? read.find((p) => p.path?.some((n) => n.id === id));
    if (!under?.where || !under.path) return "no-such-calendar";
    const conds = [under.where, ...(under.where.also ?? [])];
    // path[j] is the node above conds[j]: the definition first, then one node per value.
    const j = leaf ? conds.length : under.path.findIndex((n) => n.id === id);
    keys = conds.slice(0, j).map((c) => c.value);
    i = defs.findIndex((s) => s.raw.id === under.path?.[0]?.id && s.split);
    if (i < 0 || !keys.length) return "no-such-calendar";
  }
  const at = defs[i] as Stored;
  if (field !== null && !splitChoices(schema, at.type).some((c) => c.id === field))
    return "bad-field";
  let split: SplitNode | undefined;
  if (!keys.length) {
    split = field
      ? { field, ...(at.split?.field === field && at.split.by ? { by: at.split.by } : {}) }
      : undefined;
  } else {
    if (!at.split) return "no-such-calendar";
    const root: SplitNode = structuredClone(at.split);
    let node = root;
    const above = [root.field];
    for (const k of keys.slice(0, -1)) {
      const n = node.by?.[k];
      if (!n) return "no-such-calendar";
      node = n;
      above.push(n.field);
    }
    if (field !== null && above.includes(field)) return "bad-field";
    const last = keys[keys.length - 1] as string;
    const below = { ...(node.by ?? {}) };
    const was = below[last];
    if (field) below[last] = { field, ...(was?.field === field && was.by ? { by: was.by } : {}) };
    else delete below[last];
    if (Object.keys(below).length) node.by = below;
    else delete node.by;
    split = root;
  }
  const { split: _old, ...rest } = at;
  const next: Stored = split ? { ...rest, split } : rest;
  saveCalendarDefs(
    store,
    defs.map((s, k) => (k === i ? next : s)),
  );
  return "ok";
}

/**
 * A calendar's colour, kept in its definition: one a split made, by its values (`colors`, joined with "/"); a whole
 * one, as its own.
 */
export function setCalendarColor(store: UserStore, calendarId: string, color: string): boolean {
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) return false;
  const placed = calendarDefs(store).find((p) => p.def.id === calendarId);
  if (!placed) return false;
  const groupId = placed.path?.[0]?.id ?? placed.def.id;
  const defs = storedCalendarDefs(store);
  const i = defs.findIndex((s) => s.raw.id === groupId);
  const at = defs[i];
  if (!at) return false;
  const raw = { ...at.raw };
  if (placed.path?.length && placed.where) {
    const key = [placed.where, ...(placed.where.also ?? [])].map((w) => w.value).join("/");
    raw.colors = { ...(isObj(raw.colors) ? raw.colors : {}), [key]: color };
  } else raw.color = color;
  saveCalendarDefs(
    store,
    defs.map((s, k) => (k === i ? { ...at, raw } : s)),
  );
  return true;
}

/** Keeps the calendars' definitions (as written: `parseCollectionDef` reads them back). */
export function saveCalendarDefs(store: UserStore, list: readonly Stored[]): void {
  store.setSetting(
    CALENDAR_DEFS,
    JSON.stringify(
      list.map((p) => ({
        type: p.type,
        raw: p.raw,
        ...(p.where ? { where: p.where } : {}),
        ...(p.make ? { make: p.make } : {}),
        ...(p.split ? { split: p.split } : {}),
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
  /** The collections that could be calendars, and adding or taking away one (docs/clases.md §6, step 4). */
  candidates(): Promise<CalendarCandidate[]>;
  addCalendar(type: string): Promise<{ id: string } | null>;
  removeCalendar(calendarId: string): Promise<boolean>;
  /** A definition split by a field or made whole (D-24), and a calendar's colour kept in its definition. */
  setSplit(
    calendarId: string,
    field: string | null,
  ): Promise<"ok" | "no-such-calendar" | "bad-field">;
  setColor(calendarId: string, color: string): Promise<boolean>;
  /** The column that links a record to an external calendar's event, made and mapped if missing (task 50). */
  ensureLinkColumn(collectionId: string): Promise<string | null>;
  /** The field a record of `typeId` keeps that link in, made if missing (task 51: a card accepted with «Enlazar»). */
  ensureLinkField(typeId: string, device: string): Promise<{ key: string } | null>;
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

  /** Titles of the records relations point to, once per poll (3,000 rows asked for the same areas again and again). */
  private titles = new Map<string, string>();
  private titleOf(id: string): string {
    const hit = this.titles.get(id);
    if (hit !== undefined) return hit;
    const e = this.store.get(id);
    const tf = e ? this.store.schema().types[e.entity.type]?.titleField : undefined;
    const title = e && tf ? String(e.entity.values[tf] ?? "") : "";
    this.titles.set(id, title);
    return title;
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
        // By the title it points to, as Boni shows it (Juan, 2026-11-02: the same datum looked different in the
        // two apps); the apps write a title back, with or without the vault's brackets (`linked`).
        const ids = Array.isArray(v) ? v : [v];
        const titles = ids.map((id) => this.titleOf(String(id)) || String(id));
        return f.relation?.many ? titles : (titles[0] ?? null);
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
    timed("calendar poll", 250, () => this.pollNow());
  }

  private pollNow(): void {
    const storeVersion = this.store.version();
    const placed = calendarDefs(this.store);
    // The same definitions as last time (calendarDefs answers from memory): nothing to compare.
    const defsKey =
      placed === this.placed && this.seenStore >= 0 ? this.defsKey : JSON.stringify(placed);
    this.titles.clear();
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
    for (const w of [p.where, ...(p.where.also ?? [])]) {
      // A «Sin …» calendar (an empty value) writes nothing: the record just has no value there.
      if (!w.value || (cur && matches(cur, w))) continue;
      const f = this.store.schema().types[type]?.fields.find((x) => x.id === w.field);
      if (!f) continue;
      const value = f.type === "relation" && f.relation?.many ? [w.value] : w.value;
      writes[f.id] = { value, label: this.labelFor(type, f, device) };
    }
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
    // One change per record, the last of the batch: a row made, titled and moved before the server answered comes
    // as several changes of one id, and out of one calendar and into another (the app sends the removal first) is
    // one move, never a removal (2026-11-04: an event made and moved to another calendar went to the trash, and
    // one moved before the server answered was made twice).
    const last = new Map<string, RowChange>();
    for (const c of changes) last.set(idOf(c), c);
    const batch = [...last.values()];
    const conflict = batch.map(idOf).filter((id) => {
      const c = this.changedAt.get(id);
      return !!c && c.version > base && c.by !== device;
    });
    if (conflict.length > 0) return { ok: false, conflict: [...new Set(conflict)] };
    const meta = { actor: "user" as const, device };
    const touched: string[] = [];
    for (const c of batch) {
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
    const read = calendarDefs(this.store).find((x) => x.def.id === collectionId);
    const kept = storedCalendarDefs(this.store);
    const p = kept.find((x) => x.raw.id === (read?.group?.id ?? read?.def.id));
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
      kept.map((x) => (x === p ? { ...x, raw } : x)),
    );
    this.poll();
    return "ok";
  }

  /**
   * The column that links a record of `collectionId`'s calendar to an external calendar's event (task 50): the one
   * its definition maps as `external`, or «Evento externo» added and mapped now. Null for a calendar this store has
   * no definition of.
   */
  async ensureLinkColumn(collectionId: string): Promise<string | null> {
    if (!this.writable) throw new Error("This server does not write (BONI_WRITE)");
    const read = calendarDefs(this.store).find((x) => x.def.id === collectionId);
    const kept = storedCalendarDefs(this.store);
    const p = kept.find((x) => x.raw.id === (read?.group?.id ?? read?.def.id));
    if (!p) return null;
    const raw: Record<string, unknown> = { ...p.raw };
    const mapping = { ...((raw.mapping as Record<string, unknown>) ?? {}) };
    if (typeof mapping.external === "string" && mapping.external) return mapping.external;
    const columns = Array.isArray(raw.columns) ? [...raw.columns] : [];
    if (!columns.some((c) => (c as { id?: unknown }).id === EVENT_LINK_COLUMN.id))
      columns.push(EVENT_LINK_COLUMN);
    raw.columns = columns;
    raw.mapping = { ...mapping, external: EVENT_LINK_COLUMN.id };
    if (!parseCollectionDef(raw).ok) return null;
    saveCalendarDefs(
      this.store,
      kept.map((x) => (x === p ? { ...x, raw } : x)),
    );
    this.poll();
    return EVENT_LINK_COLUMN.id;
  }

  /**
   * The field a record of `typeId` keeps its link to an external event in (task 51: a proposal accepted with
   * «Enlazar»): its calendar's link column (made if missing, as `ensureLinkColumn`) as a field of the calendar's own
   * collection, made now when the column had none yet. Null when no calendar takes that collection.
   */
  async ensureLinkField(typeId: string, device: string): Promise<FieldDef | null> {
    const schema = this.store.schema();
    const p = this.placed.find(
      (x) => x.type === typeId || (x.where && branch(schema, x.type).includes(typeId)),
    );
    if (!p) return null;
    const col = await this.ensureLinkColumn(p.def.id);
    if (!col) return null;
    this.pollNow();
    const now = this.placed.find((x) => x.def.id === p.def.id) ?? p;
    return this.fieldFor(now, now.type, col, "", device);
  }

  async candidates(): Promise<CalendarCandidate[]> {
    return calendarCandidates(this.store);
  }

  async addCalendar(type: string): Promise<{ id: string } | null> {
    if (!this.writable) throw new Error("This server does not write (BONI_WRITE)");
    const r = addCalendar(this.store, type);
    if (r) this.poll();
    return r;
  }

  async removeCalendar(calendarId: string): Promise<boolean> {
    if (!this.writable) throw new Error("This server does not write (BONI_WRITE)");
    const r = removeCalendar(this.store, calendarId);
    if (r) this.poll();
    return r;
  }

  async setSplit(
    calendarId: string,
    field: string | null,
  ): Promise<"ok" | "no-such-calendar" | "bad-field"> {
    if (!this.writable) throw new Error("This server does not write (BONI_WRITE)");
    const r = setSplit(this.store, calendarId, field);
    if (r === "ok") this.poll();
    return r;
  }

  async setColor(calendarId: string, color: string): Promise<boolean> {
    if (!this.writable) throw new Error("This server does not write (BONI_WRITE)");
    const r = setCalendarColor(this.store, calendarId, color);
    if (r) this.poll();
    return r;
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
