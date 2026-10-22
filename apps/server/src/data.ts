import { type FieldDef, label, type Value } from "@boni/entities";
import { AI_LEVELS, type AiLevel, BODY, StoreError, type UserStore, type Zone } from "@boni/store";
import { filterErrors } from "@boni/views";

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
  /** How much the models may see of it (Juan's choice). */
  level: AiLevel;
  /** The vault zone it came from, if any. */
  zone?: Zone;
  /** Parts of it with their own level (Notion's filters). */
  rules: { id: string; filter: unknown[]; level: AiLevel }[];
  /** How its rows open as pages: properties unfolded or not, and the ones hidden one by one (Juan, 2026-10-22). */
  rowUi: RowUi;
}
export interface RowUi {
  open: boolean;
  hidden: string[];
}
/** Where a collection's `RowUi` is kept (the store's settings: the account's, on every device). */
export const ROW_UI = "ui/row/";
export function rowUiOf(store: UserStore, typeId: string): RowUi {
  try {
    const v = JSON.parse(store.setting(`${ROW_UI}${typeId}`) ?? "{}") as Partial<RowUi>;
    return {
      open: v.open === true,
      hidden: Array.isArray(v.hidden) ? v.hidden.filter((x) => typeof x === "string") : [],
    };
  } catch {
    return { open: false, hidden: [] };
  }
}
/** Folds or unfolds a collection's properties, or hides or shows some of them (fields it has). */
export function setRowUi(
  store: UserStore,
  typeId: string,
  body: Record<string, unknown>,
): RowUi | { status: number; error: string } {
  const t = userTypes(store).find((x) => x.id === typeId);
  if (!t) return { status: 404, error: "not-found" };
  const next = rowUiOf(store, typeId);
  if (body.open !== undefined) {
    if (typeof body.open !== "boolean") return { status: 400, error: "bad-open" };
    next.open = body.open;
  }
  if (body.hidden !== undefined) {
    const ids = new Set(t.fields.map((f) => f.id));
    if (
      !Array.isArray(body.hidden) ||
      body.hidden.some((x) => typeof x !== "string" || !ids.has(x))
    )
      return { status: 400, error: "bad-hidden" };
    next.hidden = [...new Set(body.hidden as string[])];
  }
  store.setSetting(`${ROW_UI}${typeId}`, JSON.stringify(next));
  return next;
}
/** A pending proposal drawn as a row (`ghostRows`): its proposal's id, never an entity. */
export interface GhostRow {
  id: string;
  proposal: string;
  values: Record<string, Value>;
  updated: number;
}
export interface DataRow {
  id: string;
  values: Record<string, Value>;
  updated: number;
  /** The row's free text (a note's body, Markdown), only when one row is asked for. */
  body?: string;
}

export class DataError extends Error {
  code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

/** The vault path a note was imported from (vault-import's hidden field). */
const PATH_FIELD = "f_vault_path";

/** A row as a view shows it: a note imported without a title property takes its file's name, as
 * Obsidian shows it (only for display; editing the title writes the property). */
function shown(values: Record<string, Value>, titleField: string): Record<string, Value> {
  const title = values[titleField];
  const path = values[PATH_FIELD];
  if ((title === undefined || title === null || title === "") && typeof path === "string") {
    const name = path.split("/").pop()?.replace(/\.md$/i, "") ?? "";
    if (name) return { ...values, [titleField]: name };
  }
  return values;
}

const userTypes = (store: UserStore) =>
  Object.values(store.schema().types).filter((t) => !t.system && !t.archived);

export function listTypes(store: UserStore): DataType[] {
  const zones = store.zones();
  const levels = store.aiAccess();
  const rules = store.aiRules();
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
      count: store.count(t.id),
      level: levels[t.id] ?? "visible",
      ...(zones[t.id] ? { zone: zones[t.id] } : {}),
      rules: rules
        .filter((r) => r.type === t.id)
        .map((r) => ({ id: r.id, filter: r.filter, level: r.level })),
      rowUi: rowUiOf(store, t.id),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "es"));
}

/**
 * Juan changes how much the models may see of a collection (from a personal device; the agent never can).
 * Lowering a private one needs `unlock`, which the app sends only from the collection's own page after he
 * confirms, so it is not undone by a slip.
 */
export function setProtection(
  store: UserStore,
  typeId: string,
  body: Record<string, unknown>,
  device: string,
): { id: string; level: AiLevel } | { status: number; error: string } {
  const level = body.level as AiLevel;
  if (!AI_LEVELS.includes(level)) return { status: 400, error: "bad-level" };
  const type = store.schema().types[typeId];
  if (!type || type.system) return { status: 404, error: "not-found" };
  try {
    store.setAiAccess(type.id, level, device, { unlock: body.unlock === true });
  } catch (e) {
    if (e instanceof StoreError && e.code === "locked") return { status: 409, error: "locked" };
    throw e;
  }
  return { id: type.id, level };
}

/**
 * A part of a collection with its own level: adds (no `ruleId`), changes or (`remove`) deletes a rule. The filter
 * is Notion's, on the collection's own fields. Whatever would lower something private needs `unlock`, which the
 * app sends only from the collection's own page.
 */
export function setRule(
  store: UserStore,
  at: { type?: string; ruleId?: string },
  body: Record<string, unknown>,
  device: string,
  remove = false,
): { id: string } | { status: number; error: string } {
  const unlock = body.unlock === true;
  const was = at.ruleId ? store.aiRules().find((r) => r.id === at.ruleId) : undefined;
  if (at.ruleId && !was) return { status: 404, error: "not-found" };
  const typeId = was?.type ?? at.type ?? "";
  const type = store.schema().types[typeId];
  if (!type || type.system) return { status: 404, error: "not-found" };
  try {
    if (remove && was) {
      store.removeAiRule(was.id, device, { unlock });
      return { id: was.id };
    }
    const level = body.level as AiLevel;
    if (!AI_LEVELS.includes(level)) return { status: 400, error: "bad-level" };
    const filter = body.filter;
    if (!Array.isArray(filter) || !filter.length || filterErrors(filter).length)
      return { status: 400, error: "bad-filter" };
    const fields = new Set(type.fields.map((f) => f.id));
    if (!filter.every((r) => fields.has((r as { field: string }).field)))
      return { status: 400, error: "bad-filter" };
    const id = store.setAiRule(
      { ...(was ? { id: was.id } : {}), type: type.id, filter, level },
      device,
      { unlock },
    );
    return { id };
  } catch (e) {
    if (e instanceof StoreError && e.code === "locked") return { status: 409, error: "locked" };
    throw e;
  }
}

const ROW_LIMIT = 2000;

/** The rows of a type (the latest changed first), with the titles of what their relations point to. */
/**
 * The collection's pending proposals to create an entry, as rows drawn apart (Juan, 2026-10-22: ghost rows): not
 * entities, so nothing counts them (the AI, totals, charts); the app shows them dashed, accepted or rejected there.
 * Values come from the proposal's painted rows by field key: what a field cannot take is left out.
 */
export function ghostRows(store: UserStore, typeId: string): GhostRow[] {
  const def = userTypes(store).find((t) => t.id === typeId);
  if (!def) return [];
  const out: GhostRow[] = [];
  for (const p of store.journal.proposals("pending")) {
    if (p.tool !== "entities.create") continue;
    const rows = (p.view as { rows?: { arg: string; value?: unknown }[] } | null)?.rows ?? [];
    const key = String(rows.find((r) => r.arg === "type")?.value ?? "");
    if (key !== def.key && key !== def.id) continue;
    const values: Record<string, Value> = {};
    for (const r of rows) {
      if (!r.arg.startsWith("values.")) continue;
      const k = r.arg.slice("values.".length);
      const f =
        def.fields.find((x) => x.key === k || x.id === k) ??
        (k === "title" ? def.fields.find((x) => x.id === def.titleField) : undefined);
      if (!f || f.hidden) continue;
      const raw = typeof r.value === "string" ? r.value : r.value == null ? "" : String(r.value);
      if (!raw) continue;
      if (f.type === "select") {
        const o = f.options?.find((x) => x.name === raw || x.id === raw);
        if (o) values[f.id] = o.id;
      } else if (f.type === "number") {
        const n = Number(raw.replace(",", "."));
        if (Number.isFinite(n)) values[f.id] = n;
      } else if (f.type === "checkbox") values[f.id] = raw === "true";
      else if (["text", "longtext", "date", "time", "url"].includes(f.type)) values[f.id] = raw;
    }
    out.push({ id: `ghost:${p.id}`, proposal: p.id, values, updated: p.created });
  }
  return out;
}

export function listRows(
  store: UserStore,
  type: string,
): { rows: DataRow[]; titles: Record<string, string>; truncated: boolean; ghosts: GhostRow[] } {
  const def = userTypes(store).find((t) => t.id === type);
  if (!def) throw new DataError("not-found");
  const all = store
    .entities(type)
    .sort((a, b) => b.updated - a.updated)
    .map((e) => ({
      id: e.id,
      values: shown(e.values, def.titleField),
      updated: e.updated,
    }));
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
  return { rows, titles, truncated: all.length > rows.length, ghosts: ghostRows(store, type) };
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

/**
 * The row a vault note became (Boni Calendar's "Abrir en Boni": its rows are the vault's notes, by path), found
 * by the hidden path the import keeps.
 */
export function findByPath(store: UserStore, path: string): { type: string; id: string } {
  if (!path || path.length > 500) throw new DataError("not-found");
  const mine = new Set(userTypes(store).map((t) => t.id));
  const hit = store.findByValue(PATH_FIELD, path).find((x) => mine.has(x.type));
  if (!hit) throw new DataError("not-found");
  return hit;
}

/** One row with its body (a row opened as a page). */
export function getRow(store: UserStore, id: string): DataRow & { type: string } {
  const e = store.get(id);
  if (!e || e.entity.deleted !== undefined || !userTypes(store).some((t) => t.id === e.entity.type))
    throw new DataError("not-found");
  const def = userTypes(store).find((t) => t.id === e.entity.type);
  return {
    id: e.entity.id,
    type: e.entity.type,
    values: def ? shown(e.entity.values, def.titleField) : e.entity.values,
    updated: e.entity.updated,
    body: e.entity.body ?? "",
  };
}

export function updateRow(
  store: UserStore,
  id: string,
  values: unknown,
  device?: string,
  body?: unknown,
) {
  const e = store.get(id);
  if (!e || e.entity.deleted !== undefined || !userTypes(store).some((t) => t.id === e.entity.type))
    throw new DataError("not-found");
  try {
    const writes = writesOf(store, e.entity.type, values ?? {}, device);
    if (body !== undefined) {
      if (typeof body !== "string" || body.length > 200_000) throw new DataError("bad-body");
      const def = userTypes(store).find((t) => t.id === e.entity.type);
      writes[BODY] = {
        value: body || null,
        label: label(
          "user",
          def?.sensitivity ?? "personal",
          [{ kind: "user-edit", id: device ?? "device" }],
          Boolean(def?.thirdParty),
        ),
      };
    }
    const u = store.update(id, writes, meta(device));
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
