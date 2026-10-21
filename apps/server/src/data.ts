import { type FieldDef, label, type Value } from "@boni/entities";
import type { UserStore } from "@boni/store";

/**
 * The user's collections as Notion's databases (docs/nucleo.md plan PR 19): their types and fields, their
 * rows, and changes the user makes in a view (a cell edited in place, a row added, moved between a board's
 * columns or deleted). Only the user's own types (Boni's system types are not data to edit); every value
 * written here is the user's (integrity `user`, from this device), checked by the store against its field.
 */

export interface DataField {
  id: string;
  name: string;
  type: FieldDef["type"];
  options?: { id: string; name: string; color?: string }[];
  relation?: { target: string; many: boolean };
}
export interface DataType {
  id: string;
  name: string;
  icon: string;
  titleField: string;
  fields: DataField[];
  count: number;
}
export interface DataRow {
  id: string;
  values: Record<string, Value>;
  updated: number;
}

export class DataError extends Error {
  code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

const userTypes = (store: UserStore) =>
  Object.values(store.schema().types).filter((t) => !t.system && !t.archived);

export function listTypes(store: UserStore): DataType[] {
  return userTypes(store)
    .map((t) => ({
      id: t.id,
      name: t.name,
      icon: t.icon ?? "",
      titleField: t.titleField,
      fields: t.fields
        .filter((f) => !f.hidden && !f.archived)
        .map((f) => ({
          id: f.id,
          name: f.name,
          type: f.type,
          ...(f.options
            ? { options: f.options.map((o) => ({ id: o.id, name: o.name, color: o.color })) }
            : {}),
          ...(f.relation ? { relation: { target: f.relation.target, many: f.relation.many } } : {}),
        })),
      count: store.list(t.id).length,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "es"));
}

const ROW_LIMIT = 2000;

/** The rows of a type (the latest changed first), with the titles of what their relations point to. */
export function listRows(
  store: UserStore,
  type: string,
): { rows: DataRow[]; titles: Record<string, string>; truncated: boolean } {
  const def = userTypes(store).find((t) => t.id === type);
  if (!def) throw new DataError("not-found");
  const all = store
    .list(type)
    .sort((a, b) => b.entity.updated - a.entity.updated)
    .map((e) => ({ id: e.entity.id, values: e.entity.values, updated: e.entity.updated }));
  const rows = all.slice(0, ROW_LIMIT);
  const titles: Record<string, string> = {};
  const types = store.schema().types;
  for (const f of def.fields.filter((x) => x.type === "relation")) {
    for (const r of rows) {
      const v = r.values[f.id];
      for (const id of Array.isArray(v) ? v : typeof v === "string" ? [v] : []) {
        if (titles[id] !== undefined) continue;
        const e = store.get(id);
        const tf = e ? types[e.entity.type]?.titleField : undefined;
        titles[id] = e && tf ? String(e.entity.values[tf] ?? "") : "";
      }
    }
  }
  return { rows, titles, truncated: all.length > rows.length };
}

const writesOf = (
  store: UserStore,
  type: string,
  values: unknown,
  device: string | undefined,
): Record<string, { value: unknown; label: ReturnType<typeof label> }> => {
  const def = userTypes(store).find((t) => t.id === type);
  if (!def) throw new DataError("not-found");
  if (typeof values !== "object" || values === null || Array.isArray(values))
    throw new DataError("bad-values");
  const out: Record<string, { value: unknown; label: ReturnType<typeof label> }> = {};
  for (const [fid, value] of Object.entries(values as Record<string, unknown>)) {
    const f = def.fields.find((x) => x.id === fid && !x.archived);
    if (!f) throw new DataError("bad-field");
    out[fid] = {
      value,
      label: label(
        "user",
        f.sensitivity ?? def.sensitivity,
        [{ kind: "user-edit", id: device ?? "device" }],
        Boolean(def.thirdParty),
      ),
    };
  }
  return out;
};

const meta = (device?: string) => ({ actor: "user" as const, ...(device ? { device } : {}) });

export function createRow(store: UserStore, type: string, values: unknown, device?: string) {
  try {
    const e = store.create(type, writesOf(store, type, values, device), meta(device));
    return { id: e.entity.id, values: e.entity.values, updated: e.entity.updated };
  } catch (err) {
    if (err instanceof DataError) throw err;
    throw new DataError("bad-values");
  }
}

export function updateRow(store: UserStore, id: string, values: unknown, device?: string) {
  const e = store.get(id);
  if (!e || e.entity.deleted !== undefined || !userTypes(store).some((t) => t.id === e.entity.type))
    throw new DataError("not-found");
  try {
    const u = store.update(id, writesOf(store, e.entity.type, values, device), meta(device));
    return { id: u.entity.id, values: u.entity.values, updated: u.entity.updated };
  } catch (err) {
    if (err instanceof DataError) throw err;
    throw new DataError("bad-values");
  }
}

export function removeRow(store: UserStore, id: string, device?: string) {
  const e = store.get(id);
  if (!e || e.entity.deleted !== undefined || !userTypes(store).some((t) => t.id === e.entity.type))
    throw new DataError("not-found");
  store.remove(id, meta(device));
}

export function restoreRow(store: UserStore, id: string, device?: string) {
  const e = store.get(id);
  if (!e || e.entity.deleted === undefined || !userTypes(store).some((t) => t.id === e.entity.type))
    throw new DataError("not-found");
  store.restore(id, meta(device));
}
