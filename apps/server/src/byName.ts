import { createHash } from "node:crypto";
import type { PropValue } from "@boni/calendar";
import {
  branch,
  type FieldDef,
  type FieldType,
  type Label,
  label,
  type SourceRef,
  type TypeDef,
} from "@boni/entities";
import { BODY, type UserStore, type Writes } from "@boni/store";

/**
 * Records Boni writes itself by property name (a captured movement, a statement's line): each property into the
 * field of its name (made when missing), options by name (made when missing), a relation by the id of a record of
 * its target's branch or by that record's exact title (`[[Title]]` too). Nothing is found by a path: records are
 * known by their id (D-17). The values are the user's (the capture came from one of his devices) unless `from`
 * says where they came from.
 */

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
const LINK = /^\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]$/;

export interface ByName {
  title: string;
  values: Record<string, PropValue>;
  /** Its text (Markdown), when it has one. */
  body?: string;
}

/** A new record of a type from its title, its properties by name and its text; returns its id. */
export function createByName(
  store: UserStore,
  typeId: string,
  rec: ByName,
  device: string,
  /** Where the values came from when it is not the user typing them (a bank statement: `imported`, its file). */
  o: { from?: { integrity: "imported"; source: SourceRef }; run?: string } = {},
): string {
  const meta = {
    actor: o.from ? ("import" as const) : ("user" as const),
    device,
    ...(o.run ? { run: o.run } : {}),
  };
  const def = () => store.schema().types[typeId] as TypeDef;
  if (!def()) throw new Error(`no type ${typeId}`);
  const l = (f: FieldDef | null) =>
    label(
      o.from?.integrity ?? "user",
      f?.sensitivity ?? def().sensitivity,
      [o.from?.source ?? { kind: "user-edit", id: device }],
      Boolean(def().thirdParty),
    );
  const writes = propWrites(store, typeId, rec.values, l, meta);
  writes[def().titleField] = { value: rec.title, label: l(null) };
  if (rec.body) writes[BODY] = { value: rec.body, label: l(null) };
  return store.create(typeId, writes, meta).entity.id;
}

/**
 * The records a relation to `target` may point to (her whole branch, D-18): by id, and by title (the first of
 * each title, case and spaces aside).
 */
export function relationTargets(
  store: UserStore,
  target: string,
): { ids: Set<string>; titled: Map<string, string> } {
  const schema = store.schema();
  const ids = new Set<string>();
  const titled = new Map<string, string>();
  for (const k of branch(schema, target)) {
    const t = schema.types[k];
    if (!t) continue;
    for (const e of store.entities(k)) {
      ids.add(e.id);
      const v = e.values[t.titleField];
      const key = typeof v === "string" ? v.trim().toLowerCase() : "";
      if (key && !titled.has(key)) titled.set(key, e.id);
    }
  }
  return { ids, titled };
}

/** A relation's value as the id it names: an id of the branch, or a title (`[[Title]]` too); null if none. */
export function relationId(
  targets: { ids: Set<string>; titled: Map<string, string> },
  v: unknown,
): string | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  if (targets.ids.has(s)) return s;
  const link = LINK.exec(s)?.[1]?.trim();
  return targets.titled.get((link ?? s).toLowerCase()) ?? null;
}

/**
 * Properties by name as a type's writes: each into the field of its name (made when missing), options by name
 * (made when missing), a relation by id or title.
 */
export function propWrites(
  store: UserStore,
  typeId: string,
  values: Record<string, PropValue>,
  l: (f: FieldDef | null) => Label,
  meta: { actor: "user" | "import" | "agent"; device?: string; run?: string },
): Writes {
  const def = () => store.schema().types[typeId] as TypeDef;
  const fieldFor = (prop: string, v: PropValue): FieldDef => {
    const k = keyOf(prop);
    const known = def().fields.find((f) => !f.archived && (f.name === prop || f.key === k));
    if (known) return known;
    const type: FieldType =
      typeof v === "boolean" ? "checkbox" : typeof v === "number" ? "number" : "text";
    const field: FieldDef = {
      id: `f_${k.replace(/-/g, "_")}`.slice(0, 64),
      key: k,
      name: prop,
      type,
      label: l(null),
    };
    store.applySchema({ op: "add_field", type: typeId, field }, meta);
    return field;
  };
  const option = (f: FieldDef, name: string) => {
    const o = f.options?.find((x) => x.name === name);
    if (o) return o.id;
    const id = `o_${keyOf(name).replace(/-/g, "_").slice(0, 40)}_${createHash("sha256").update(name).digest("hex").slice(0, 8)}`;
    store.applySchema(
      {
        op: "set_options",
        type: typeId,
        field: f.id,
        options: [...(f.options ?? []), { id, name, label: l(f) }],
      },
      meta,
    );
    return id;
  };
  const writes: Writes = {};
  for (const [prop, raw] of Object.entries(values)) {
    if (raw === null || raw === "" || (Array.isArray(raw) && !raw.length)) continue;
    const f = fieldFor(prop, raw);
    const items = Array.isArray(raw) ? raw : [raw];
    let value: unknown;
    switch (f.type) {
      case "relation": {
        const targets = relationTargets(store, f.relation?.target ?? "");
        const ids = items.map((x) => relationId(targets, x)).filter((x): x is string => !!x);
        value = f.relation?.many ? ids : (ids[0] ?? null);
        break;
      }
      case "multiselect":
        value = items.map((x) =>
          option(def().fields.find((y) => y.id === f.id) as FieldDef, String(x)),
        );
        break;
      case "select":
        value = option(f, String(raw));
        break;
      case "number":
        value = Number(raw);
        break;
      case "checkbox":
        value = raw === true || raw === "true";
        break;
      case "text":
      case "longtext":
        value = Array.isArray(raw) ? raw.join(", ") : String(raw);
        break;
      default:
        value = raw;
    }
    writes[f.id] = { value, label: l(f) };
  }
  return writes;
}
