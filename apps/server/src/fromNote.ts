import { createHash } from "node:crypto";
import { type PropValue, parseNote } from "@boni/calendar";
import { type FieldDef, type FieldType, label, type TypeDef } from "@boni/entities";
import { BODY, type UserStore, type Writes } from "@boni/store";

/**
 * A note made by Boni itself (a captured movement) taken as an entity of a type that lives in Boni (core mode):
 * each property into the field of its name (made when missing), options by name, `[[links]]` to the entity of
 * the target type whose note has that name; the note's path kept, so Boni's mirror writes the note just there.
 * The values are the user's (the capture came from one of his devices).
 */
const PATH_FIELD = "f_vault_path";
const HASH_FIELD = "f_vault_hash";

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
const baseName = (p: string) => (p.split("/").pop() ?? p).replace(/\.md$/i, "");
const LINK = /^\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]$/;

export function entityFromNote(
  store: UserStore,
  typeId: string,
  path: string,
  text: string,
  device: string,
): string {
  const parsed = parseNote(text);
  if (parsed.error) throw new Error(`the note does not parse: ${parsed.error}`);
  const meta = { actor: "user" as const, device };
  const def = () => store.schema().types[typeId] as TypeDef;
  if (!def()) throw new Error(`no type ${typeId}`);
  const l = (f: FieldDef | null) =>
    label(
      "user",
      f?.sensitivity ?? def().sensitivity,
      [{ kind: "user-edit", id: device }],
      Boolean(def().thirdParty),
    );
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
  const byNote = (target: string) => {
    const m = new Map<string, string>();
    for (const e of store.entities(target)) {
      const p = e.values[PATH_FIELD];
      if (typeof p === "string") m.set(baseName(p).toLowerCase(), e.id);
    }
    return m;
  };
  const writes: Writes = {};
  for (const [prop, raw] of Object.entries(parsed.values)) {
    if (raw === null || raw === "") continue;
    const f = fieldFor(prop, raw);
    const items = Array.isArray(raw) ? raw : [raw];
    let value: unknown;
    switch (f.type) {
      case "relation": {
        const names = byNote(f.relation?.target ?? "");
        const ids = items
          .map((x) => LINK.exec(String(x).trim())?.[1]?.split("/").pop()?.toLowerCase())
          .map((n) => (n ? names.get(n) : undefined))
          .filter((x): x is string => !!x);
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
  const t = def();
  if (!writes[t.titleField]) writes[t.titleField] = { value: baseName(path), label: l(null) };
  if (t.fields.some((f) => f.id === PATH_FIELD)) {
    writes[PATH_FIELD] = { value: path, label: l(null) };
    writes[HASH_FIELD] = { value: createHash("sha256").update(text).digest("hex"), label: l(null) };
  }
  if (parsed.body) writes[BODY] = { value: parsed.body, label: l(null) };
  return store.create(typeId, writes, meta).entity.id;
}
