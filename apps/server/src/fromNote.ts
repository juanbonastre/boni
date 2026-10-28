import { createHash } from "node:crypto";
import { type PropValue, parseNote } from "@boni/calendar";
import {
  type FieldDef,
  type FieldType,
  type Label,
  label,
  type SourceRef,
  type TypeDef,
} from "@boni/entities";
import { BODY, type UserStore, type Writes } from "@boni/store";
import { leadingTitle } from "@boni/views";
import { HASH_FIELD, PATH_FIELD } from "./paths.ts";

/**
 * A note made by Boni itself (a captured movement, a statement's line) taken as an entity of a type: each
 * property into the field of its name (made when missing), options by name, `[[links]]` to the entity of the
 * target type whose note has that name; the path that note would have had kept, which is how it is found again
 * until notes stop having paths. The values are the user's (the capture came from one of his devices).
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
const baseName = (p: string) => (p.split("/").pop() ?? p).replace(/\.md$/i, "");
const LINK = /^\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]$/;

export function entityFromNote(
  store: UserStore,
  typeId: string,
  path: string,
  text: string,
  device: string,
  /**
   * Where the values came from when it is not Juan typing them (a bank statement: `imported`, its file as the
   * source), and whether the note's first `# Heading` is its title (as Juan's first import took it).
   */
  o: {
    from?: { integrity: "imported"; source: SourceRef };
    headingTitle?: boolean;
    /** The run it belongs to (undone whole). */
    run?: string;
  } = {},
): string {
  const parsed = parseNote(text);
  if (parsed.error) throw new Error(`the note does not parse: ${parsed.error}`);
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
  const writes = propWrites(store, typeId, parsed.values, l, meta);
  const t = def();
  let body = parsed.body;
  const head = o.headingTitle && !writes[t.titleField] ? leadingTitle(body) : null;
  if (head) {
    writes[t.titleField] = { value: head.title, label: l(null) };
    body = head.rest;
  }
  if (!writes[t.titleField]) writes[t.titleField] = { value: baseName(path), label: l(null) };
  if (t.fields.some((f) => f.id === PATH_FIELD)) {
    writes[PATH_FIELD] = { value: path, label: l(null) };
    writes[HASH_FIELD] = { value: createHash("sha256").update(text).digest("hex"), label: l(null) };
  }
  if (body) writes[BODY] = { value: body, label: l(null) };
  return store.create(typeId, writes, meta).entity.id;
}

/**
 * Properties by name as a type's writes: each into the field of its name (made when missing), options by name
 * (made when missing), `[[links]]` to the entity of the target type whose note has that name.
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
  /** A target's entities by the note they are (its name) and, those that never were a note, by title. */
  const byNote = (target: string) => {
    const notes = new Map<string, string>();
    const titled = new Map<string, string>();
    const t = store.schema().types[target];
    for (const e of store.entities(target)) {
      const p = e.values[PATH_FIELD];
      if (typeof p === "string") notes.set(baseName(p).toLowerCase(), e.id);
      else if (t && typeof e.values[t.titleField] === "string")
        titled.set(String(e.values[t.titleField]).trim().toLowerCase(), e.id);
    }
    return { notes, titled };
  };
  const writes: Writes = {};
  for (const [prop, raw] of Object.entries(values)) {
    if (raw === null || raw === "") continue;
    const f = fieldFor(prop, raw);
    const items = Array.isArray(raw) ? raw : [raw];
    let value: unknown;
    switch (f.type) {
      case "relation": {
        const { notes, titled } = byNote(f.relation?.target ?? "");
        // `[[note]]` (or a whole title, "comida/restaurante" for a row of Categorías).
        const ids = items
          .map((x) => {
            const s = String(x).trim();
            const link = LINK.exec(s)?.[1]?.trim();
            const whole = (link ?? s).toLowerCase();
            return (
              titled.get(whole) ??
              (link ? notes.get(link.split("/").pop()?.toLowerCase() ?? "") : undefined)
            );
          })
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
  return writes;
}
