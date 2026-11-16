/**
 * The engine's `Collections` over the user's store (docs/automatizaciones.md §5.2, §6; phase F14b). F14a ran against
 * a fake; this is the real one, and the only way an automation reaches the saved rows. The engine asks the policy
 * before every call of it (`guard`, effects.ts): this module decides nothing, it reads and writes what it is told.
 *
 * What a read gives:
 * - `shape(key)`: the collection by its key, with each field's key and type (a relation's target by its key); a
 *   collection in the trash (archived), or one of Boni's own (made on each read, outside the schema), is undefined.
 * - Each row with the label of its record (`entityLabel`) and, in `fields`, only the fields whose own label differs
 *   (what the store keeps per field): a value that came from outside stays from outside, field by field (AU-162,
 *   AU-164). Label objects are shared: the rows that have the same one hold one object, so 3,000 rows do not make
 *   3,000 labels.
 * - `origin`: the record's id and the version it was read at; `apply` refuses a change to a row that changed since.
 * - A fixed order: by the query's `sort` (the «Ordenar» step's own `compare`), then by id, so two runs over the same
 *   data give the same rows (AU-12).
 * - `related`: a relation holds the related row one level deep (its fields by key), labelled as that row is.
 * - The conditions are the views' filter (`FilterItem`), run by the same code as a view's (`matchesFilters`), with
 *   its operators; `today` is Juan's day in his time zone.
 *
 * How a search reads (A-15): the store has no query by a view's filter, so a search or an aggregate reads the
 * collection once (`list`: one query for the records and one for their labels, each label parsed once), as a view
 * does, and filters, sorts and cuts here; a row is made only for what the limit keeps. Timed with 3,000 rows in its
 * test.
 *
 * What a write does: `apply` writes the change or nothing, as the actor and device it was made with, each field with
 * its value's label; «trash» sends to the trash (AU-122). A test never calls it (AU-90): the gate answers `tested`.
 */
import {
  type Cell,
  type Change,
  type CollectionShape,
  type Collections,
  compare,
  type FieldLabel,
  type FieldShape,
  type FindQuery,
  type Labelled,
  measure,
  StepFault,
  type StoredRow,
} from "@boni/automations";
import { type FieldDef, join, type Label, SYSTEM_TYPES, type TypeDef } from "@boni/entities";
import {
  entityLabel,
  type OpMeta,
  type StoredEntity,
  StoreError,
  type UserStore,
  type Writes,
} from "@boni/store";
import { type FilterItem, isFilterGroup, matchesFilters } from "@boni/views";

export interface CollectionsFor {
  /** Who writes: Juan's hand on a test never does; a run for real is F14d's. */
  actor: "user" | "agent";
  device: string | null;
  /** Juan's IANA time zone: the day a condition's «today» is. */
  zone: string;
  /** The label of a field written with no label of its own (never in practice: the gate gives every value's). */
  own: Label;
}

const SYSTEM: ReadonlySet<string> = new Set(SYSTEM_TYPES);

export function storeCollections(store: UserStore, who: CollectionsFor): Collections {
  // One object per distinct label, for every row this gives (AU-162: shared, never changed in place).
  const interned = new Map<string, Label>();
  const intern = (l: Label): Label => {
    const k = JSON.stringify(l);
    const had = interned.get(k);
    if (had) return had;
    interned.set(k, l);
    return l;
  };
  const typeByKey = (key: string): TypeDef | undefined => {
    const t = Object.values(store.schema().types).find((x) => x.key === key);
    return t && !t.archived && !t.system && !SYSTEM.has(t.id) ? t : undefined;
  };
  const live = (t: TypeDef): FieldDef[] => t.fields.filter((f) => !f.archived);
  const keyOfType = (id: string) => store.schema().types[id]?.key;

  /** A record as a row: its fields by key; the record's label, and each field's own where it differs. */
  const rowOf = (t: TypeDef, e: StoredEntity): StoredRow => {
    const record = intern(entityLabel(e) ?? who.own);
    const json: Record<string, Cell> = {};
    const fields: Record<string, FieldLabel> = {};
    for (const f of live(t)) {
      json[f.key] = (e.entity.values[f.id] ?? null) as Cell;
      const own = e.labels[f.id];
      if (own && JSON.stringify(own) !== JSON.stringify(record))
        fields[f.key] = { label: intern(own), derived: false };
    }
    return {
      json,
      label: record,
      ...(Object.keys(fields).length ? { fields } : {}),
      origin: { collection: t.key, id: e.entity.id, version: e.entity.version },
    };
  };

  /** The records that match the conditions (field keys turned into the store's ids), not yet in rows. */
  const matching = (t: TypeDef, where: readonly FilterItem[]): StoredEntity[] => {
    const idOf = new Map(live(t).map((f) => [f.key, f.id]));
    const typeOf = new Map(live(t).map((f) => [f.id, f.type as string]));
    // A condition on a key the collection lacks stays as it is: no id has it, so the views' code leaves it out.
    const rule = <R extends { field: string }>(r: R): R => ({
      ...r,
      field: idOf.get(r.field) ?? r.field,
    });
    const byIds = where.map((x) =>
      isFilterGroup(x) ? { ...x, rules: x.rules.map(rule) } : rule(x),
    );
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: who.zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(Date.now());
    return store
      .list(t.id)
      .filter((e) => matchesFilters(e.entity.values, (f) => typeOf.get(f), byIds, today));
  };

  /** «Incluir relacionadas»: each relation holds the row it points to (a list of rows, for one to many). */
  const withRelated = (t: TypeDef, row: StoredRow): StoredRow => {
    const json = { ...row.json };
    const fields = { ...(row.fields ?? {}) };
    for (const f of live(t)) {
      if (f.type !== "relation" || !f.relation) continue;
      const target = store.schema().types[f.relation.target];
      if (!target) continue;
      const one = (id: Cell): StoredRow | null => {
        const e = typeof id === "string" ? store.get(id) : null;
        return e && e.entity.deleted === undefined ? rowOf(target, e) : null;
      };
      const v = json[f.key] ?? null;
      const related = Array.isArray(v) ? v.map(one) : v === null ? null : one(v);
      json[f.key] = Array.isArray(related)
        ? related.map((r) => r?.json ?? null)
        : (related?.json ?? null);
      const first = Array.isArray(related) ? related.find((r) => r) : related;
      if (first && first.label !== row.label)
        fields[f.key] = { label: first.label, derived: false };
    }
    return { ...row, json, ...(Object.keys(fields).length ? { fields } : {}) };
  };

  const meta = (): OpMeta => ({ actor: who.actor, ...(who.device ? { device: who.device } : {}) });
  const writesOf = (t: TypeDef, fields: Record<string, Cell>, values: Labelled): Writes => {
    const out: Writes = {};
    for (const [key, value] of Object.entries(fields)) {
      const f = live(t).find((x) => x.key === key);
      if (!f) throw new StepFault(`the collection has no field ${key}`, { code: "other" });
      out[f.id] = { value, label: values[key]?.label ?? who.own };
    }
    return out;
  };
  /** The saved record of a row, as it is now, if it is still the version read: `row.changed` otherwise. */
  const current = (row: { collection: string; id: string; version: number }) => {
    const e = store.get(row.id);
    if (!e || e.entity.deleted !== undefined || e.entity.version !== row.version)
      throw new StepFault(`the row ${row.id} changed since it was read`, { code: "row.changed" });
    return e;
  };

  /** One change, inside the caller's transaction: the row as saved (for `trash`, as it was). */
  const one = (change: Change, values: Labelled): StoredRow => {
    const key = change.kind === "create" ? change.collection : change.row.collection;
    const t = typeByKey(key);
    if (!t) throw new StepFault(`no collection ${key}`, { code: "other" });
    if (change.kind === "create")
      return rowOf(t, store.create(t.id, writesOf(t, change.fields, values), meta()));
    const before = current(change.row);
    if (change.kind === "trash") {
      store.remove(before.entity.id, meta());
      return rowOf(t, before);
    }
    try {
      return rowOf(
        t,
        store.update(
          before.entity.id,
          writesOf(t, change.fields, values),
          meta(),
          change.row.version,
        ),
      );
    } catch (e) {
      if (e instanceof StoreError && e.code === "conflict")
        throw new StepFault(`the row ${change.row.id} changed since it was read`, {
          code: "row.changed",
        });
      throw e;
    }
  };

  return {
    shape(key) {
      const t = typeByKey(key);
      if (!t) return undefined;
      const fields: FieldShape[] = live(t).map((f) => {
        const target = f.relation ? keyOfType(f.relation.target) : undefined;
        return { key: f.key, type: f.type, ...(target ? { target } : {}) };
      });
      return { key: t.key, fields } satisfies CollectionShape;
    },
    async find(q: FindQuery) {
      const t = typeByKey(q.collection);
      if (!t) return [];
      const idOf = new Map(live(t).map((f) => [f.key, f.id]));
      const sorted = matching(t, q.where).sort((a, b) => {
        for (const s of q.sort) {
          const id = idOf.get(s.field);
          const c =
            id === undefined
              ? 0
              : compare(
                  (a.entity.values[id] ?? null) as Cell,
                  (b.entity.values[id] ?? null) as Cell,
                );
          if (c) return s.direction === "desc" ? -c : c;
        }
        return a.entity.id < b.entity.id ? -1 : a.entity.id > b.entity.id ? 1 : 0;
      });
      const rows = sorted.slice(0, Math.max(0, q.limit)).map((e) => rowOf(t, e));
      return q.related ? rows.map((r) => withRelated(t, r)) : rows;
    },
    async get(collection, id) {
      const t = typeByKey(collection);
      const e = t ? store.get(id) : null;
      if (!t || !e || e.entity.deleted !== undefined || e.entity.type !== t.id) return undefined;
      return rowOf(t, e);
    },
    async aggregate(q) {
      const t = typeByKey(q.collection);
      if (!t) return [];
      const idOf = new Map(live(t).map((f) => [f.key, f.id]));
      const rows = matching(t, q.where);
      const groups = new Map<string, StoredEntity[]>();
      const groupId = q.groupBy === undefined ? undefined : idOf.get(q.groupBy);
      for (const e of rows) {
        const g =
          q.groupBy === undefined
            ? ""
            : JSON.stringify(groupId === undefined ? null : (e.entity.values[groupId] ?? null));
        const members = groups.get(g);
        if (members) members.push(e);
        else groups.set(g, [e]);
      }
      if (q.groupBy === undefined && !groups.size) groups.set("", []);
      const fieldId = q.field === undefined ? undefined : idOf.get(q.field);
      // What it read: the labels of the fields it counted, summed or grouped by, of every row it read.
      const read = [fieldId, groupId].filter((x): x is string => x !== undefined);
      return [...groups.entries()].map(([g, members]) => {
        const v =
          q.measure === "count"
            ? members.length
            : measure(
                q.measure,
                members.map((e) =>
                  fieldId === undefined ? null : ((e.entity.values[fieldId] ?? null) as Cell),
                ),
              );
        const labels = members.flatMap((e) => {
          const record = entityLabel(e) ?? who.own;
          return read.length ? read.map((f) => e.labels[f] ?? record) : [record];
        });
        return {
          ...(q.groupBy === undefined ? {} : { group: JSON.parse(g) as Cell }),
          value: typeof v === "number" ? v : null,
          label: intern(labels.length ? joinAll(labels) : who.own),
        };
      });
    },
    async apply(change: Change, values: Labelled = {}) {
      return store.batch(() => one(change, values));
    },
    async applyAll(changes) {
      // One transaction: a change that throws takes back every one before it (AU-174). A row changed earlier in the
      // same call is checked against the version that change left, so two requests for one row apply in order.
      return store.batch(() => {
        const left = new Map<string, number>();
        return changes.map(({ change, values }) => {
          const version = change.kind === "create" ? undefined : left.get(change.row.id);
          const row = one(
            version === undefined || change.kind === "create"
              ? change
              : { ...change, row: { ...change.row, version } },
            values,
          );
          left.set(row.origin.id, row.origin.version);
          return row;
        });
      });
    },
  };
}

function joinAll(labels: readonly Label[]): Label {
  return join(labels[0] as Label, ...labels.slice(1));
}
