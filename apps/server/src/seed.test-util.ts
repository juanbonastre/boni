import { parseNote } from "@boni/calendar";
import {
  type FieldDef,
  type FieldType,
  label,
  type Sensitivity,
  type TypeDef,
} from "@boni/entities";
import type { AiLevel, UserStore, Writes, Zone } from "@boni/store";
import { leadingTitle } from "@boni/views";
import { createByName, propWrites } from "./byName.ts";
import { calendarDefs, saveCalendarDefs } from "./calendarStore.ts";
import { FILE_FIELD, FOLDER_FIELD, HASH_FIELD, mimeOf, PATH_FIELD } from "./paths.ts";

/**
 * Invented data for the server's tests and the e2e (never real notes): collections made as declared, and their
 * entries from note texts by the path each would have had, the way Juan's own data came into Boni (every value
 * `imported` from its note, a note titled by its first heading or else its file's name). A file that is not a note
 * becomes a row of a collection that keeps files. `vaultPaths` also keeps each note's path in the hidden fields the
 * vault's import left, for the tests of what clears them away (`reshape.ts`).
 */

/** A property's field: its type, or a list's options, or the collection a link points to (by its key). */
export type FieldSpec =
  | FieldType
  | { type: "select" | "multiselect"; options?: string[] }
  | { type: "relation"; to: string; many?: boolean };

export interface TypeSpec {
  /** The collection is `t_<key>` (dashes as underscores). */
  key: string;
  name: string;
  /** Its notes are those under this folder (the longest match wins; "" takes any other note). */
  folder: string;
  /**
   * Properties with a field type of their own, by name; any other property gets a field from its first value (text,
   * number or checkbox), as a capture does.
   */
  fields?: Record<string, FieldSpec>;
  sensitivity?: Sensitivity;
  thirdParty?: boolean;
  /** Where it came from: one of the zones no model ever sees. */
  zone?: Zone;
  /** What the AI sees of it, when not everything. */
  ai?: AiLevel;
  /** Its files that are not notes become rows holding the file (and the folder it was in). */
  files?: boolean;
  /** A calendar of Boni Calendar: its definition (the `collection:` map); its columns are the fields. */
  calendar?: Record<string, unknown>;
  /** The collection it is inside (its mother's key, declared before it): it has her fields and her title. */
  parent?: string;
}

const baseName = (p: string) => (p.split("/").pop() ?? p).replace(/\.md$/i, "");
const SCHEMA = label("imported", "public", [{ kind: "vault", id: "seed" }]);
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
const fieldId = (key: string) => `f_${key.replace(/-/g, "_")}`.slice(0, 64);
export const typeId = (key: string) => `t_${key.replace(/-/g, "_")}`;

function fieldOf(prop: string, spec: FieldSpec, name = prop): FieldDef {
  const key = keyOf(prop);
  const f: FieldDef = { id: fieldId(key), key, name, type: "text", label: SCHEMA };
  if (typeof spec === "string") return { ...f, type: spec };
  if (spec.type === "relation")
    return { ...f, type: "relation", relation: { target: typeId(spec.to), many: !!spec.many } };
  return {
    ...f,
    type: spec.type,
    options: (spec.options ?? []).map((o) => ({
      id: `o_${keyOf(o).replace(/-/g, "_")}`,
      name: o,
      label: SCHEMA,
    })),
  };
}

/** A type's fields as declared: the calendar's columns, then the other declared properties. */
function fieldsOf(t: TypeSpec, vaultPaths: boolean): { fields: FieldDef[]; title: string } {
  const out: FieldDef[] = [];
  let title = "";
  const cal = t.calendar as
    | { columns?: { id: string; name: string; type: string }[]; mapping?: { title?: string } }
    | undefined;
  const simple = new Set([
    "text",
    "number",
    "checkbox",
    "date",
    "time",
    "datetime",
    "dates",
    "url",
  ]);
  for (const c of cal?.columns ?? []) {
    const spec = t.fields?.[c.id] ?? (simple.has(c.type) ? (c.type as FieldType) : "text");
    out.push(fieldOf(c.id, spec, c.name));
    if (c.id === cal?.mapping?.title) title = fieldId(keyOf(c.id));
  }
  for (const [prop, spec] of Object.entries(t.fields ?? {})) {
    if (out.some((f) => f.key === keyOf(prop))) continue;
    out.push(fieldOf(prop, spec));
    if (prop === "title") title = fieldId(keyOf(prop));
  }
  if (!title && !t.parent) {
    out.unshift({ id: "f_title", key: "title", name: "Título", type: "text", label: SCHEMA });
    title = "f_title";
  }
  if (t.files)
    out.push(
      { id: FILE_FIELD, key: "boni-archivo", name: "Archivo", type: "file", label: SCHEMA },
      { id: FOLDER_FIELD, key: "carpeta", name: "Carpeta", type: "text", label: SCHEMA },
    );
  // A daughter inherits her mother's (the path included).
  if (t.parent || !vaultPaths) return { fields: out, title };
  out.push(
    {
      id: PATH_FIELD,
      key: "vault-path",
      name: "Nota del vault",
      type: "text",
      hidden: true,
      label: SCHEMA,
    },
    {
      id: HASH_FIELD,
      key: "vault-hash",
      name: "Huella de la nota",
      type: "text",
      hidden: true,
      label: SCHEMA,
    },
  );
  return { fields: out, title };
}

/**
 * Makes the collections and their entries; returns each path's entity id. Links (`[[note]]`) are resolved once
 * every entry exists, so a note may point to one that comes after it.
 */
export function seed(
  store: UserStore,
  types: readonly TypeSpec[],
  notes: Readonly<Record<string, string | Uint8Array>>,
  o: { run?: string; vaultPaths?: boolean } = {},
): Map<string, string> {
  const meta = { actor: "import" as const, device: "seed", ...(o.run ? { run: o.run } : {}) };
  // A note goes to the collection with the longest folder that holds it (one that keeps files only when no
  // other does); a file, to one that keeps files.
  const typeOf = (path: string): TypeSpec => {
    const best = (pool: readonly TypeSpec[]) =>
      pool
        .filter((t) => path.startsWith(t.folder))
        .sort((a, b) => b.folder.length - a.folder.length)[0];
    const hit = path.endsWith(".md")
      ? (best(types.filter((t) => !t.files)) ?? best(types))
      : best(types.filter((t) => t.files));
    if (!hit) throw new Error(`seed: no collection takes ${path}`);
    return hit;
  };
  // A list's options are the values its notes use, besides the declared ones.
  const used = new Map<TypeSpec, Map<string, Set<string>>>();
  for (const [path, content] of Object.entries(notes)) {
    if (!path.endsWith(".md") || typeof content !== "string") continue;
    const t = typeOf(path);
    for (const [prop, v] of Object.entries(parseNote(content).values)) {
      const spec = t.fields?.[prop];
      if (typeof spec !== "object" || spec.type === "relation" || v === null || v === "") continue;
      const byProp = used.get(t) ?? new Map<string, Set<string>>();
      used.set(t, byProp);
      const set = byProp.get(prop) ?? new Set(spec.options ?? []);
      byProp.set(prop, set);
      for (const x of Array.isArray(v) ? v : [v]) set.add(String(x));
    }
  }
  const withOptions = (t: TypeSpec): TypeSpec => {
    const byProp = used.get(t);
    if (!byProp) return t;
    const fields = { ...t.fields };
    for (const [prop, set] of byProp) {
      const spec = fields[prop];
      if (typeof spec === "object" && spec.type !== "relation")
        fields[prop] = { ...spec, options: [...set] };
    }
    return { ...t, fields };
  };
  // The collections first, then their links (a link may point to a collection made after it).
  for (const t of types) {
    const { fields, title } = fieldsOf(withOptions(t), !!o.vaultPaths);
    const mother = t.parent ? store.schema().types[typeId(t.parent)] : undefined;
    const def: TypeDef = {
      id: typeId(t.key),
      key: t.key,
      name: t.name,
      ...(mother ? { parent: mother.id } : {}),
      fields: fields.filter((f) => f.type !== "relation"),
      titleField: title || (mother?.titleField ?? "f_title"),
      sensitivity: t.sensitivity ?? "personal",
      ...(t.thirdParty ? { thirdParty: true } : {}),
      schemaVersion: 1,
      label: SCHEMA,
    };
    store.applySchema({ op: "create_type", type: def }, meta);
  }
  for (const t of types)
    for (const f of fieldsOf(withOptions(t), !!o.vaultPaths).fields.filter(
      (x) => x.type === "relation",
    ))
      store.applySchema({ op: "add_field", type: typeId(t.key), field: f }, meta);
  for (const t of types) {
    if (t.zone) store.setZone(typeId(t.key), t.zone, "seed");
    if (t.ai) store.setAiAccess(typeId(t.key), t.ai, "seed", { unlock: true });
    if (t.calendar)
      saveCalendarDefs(store, [
        ...calendarDefs(store).map((p) => ({ type: p.type, raw: p.raw })),
        { type: typeId(t.key), raw: t.calendar },
      ]);
  }

  const ids = new Map<string, string>();
  const from = (path: string) => ({
    integrity: "imported" as const,
    source: { kind: "vault" as const, id: path },
  });
  const isRelation = (def: TypeDef, prop: string) =>
    def.fields.some((f) => f.type === "relation" && (f.name === prop || f.key === keyOf(prop)));
  for (const [path, content] of Object.entries(notes).sort(([a], [b]) => (a < b ? -1 : 1))) {
    const t = typeOf(path);
    const type = typeId(t.key);
    const def = store.schema().types[type] as TypeDef;
    const l = label("imported", def.sensitivity, [from(path).source], !!def.thirdParty);
    if (path.endsWith(".md") && typeof content === "string") {
      const parsed = parseNote(content);
      if (parsed.error) throw new Error(`seed: ${path} does not parse: ${parsed.error}`);
      const titleName = def.fields.find((f) => f.id === def.titleField)?.name ?? "";
      const own =
        parsed.values[titleName] ??
        parsed.values[def.fields.find((f) => f.id === def.titleField)?.key ?? ""];
      const head = typeof own === "string" && own ? null : leadingTitle(parsed.body);
      const values = Object.fromEntries(
        Object.entries(parsed.values).filter(([prop]) => !isRelation(def, prop)),
      );
      const id = createByName(
        store,
        type,
        {
          title: typeof own === "string" && own ? own : (head?.title ?? baseName(path)),
          values,
          body: head ? head.rest : parsed.body,
        },
        "seed",
        { from: from(path), ...(o.run ? { run: o.run } : {}) },
      );
      if (o.vaultPaths)
        store.update(
          id,
          {
            [PATH_FIELD]: { value: path, label: l },
            [HASH_FIELD]: { value: `seed-${path}`, label: l },
          },
          meta,
        );
      ids.set(path, id);
      continue;
    }
    const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content;
    const name = path.slice(path.lastIndexOf("/") + 1);
    const writes: Writes = {
      [def.titleField]: { value: name, label: l },
      [FILE_FIELD]: { value: store.putFile(bytes, mimeOf(name)), label: l },
      [FOLDER_FIELD]: {
        value: path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "",
        label: l,
      },
      ...(o.vaultPaths ? { [PATH_FIELD]: { value: path, label: l } } : {}),
    };
    ids.set(path, store.create(type, writes, meta).entity.id);
  }
  // The links, now that every entry exists: `[[name]]` is the note of that file name (any folder).
  const byFile = new Map<string, string>();
  for (const [path, id] of ids) byFile.set(baseName(path).toLowerCase(), id);
  const linked = (v: unknown) => {
    const s = String(v ?? "").trim();
    const m = /^\[\[([^\]|#]+)/.exec(s)?.[1]?.trim();
    return m ? (byFile.get((m.split("/").pop() ?? m).toLowerCase()) ?? s) : s;
  };
  for (const [path, content] of Object.entries(notes)) {
    if (!path.endsWith(".md") || typeof content !== "string") continue;
    const type = typeId(typeOf(path).key);
    const def = store.schema().types[type] as TypeDef;
    const links = Object.fromEntries(
      Object.entries(parseNote(content).values)
        .filter(([prop]) => isRelation(def, prop))
        .map(([prop, v]) => [prop, Array.isArray(v) ? v.map(linked) : linked(v)]),
    );
    if (!Object.keys(links).length) continue;
    const l = (f: FieldDef | null) =>
      label("imported", f?.sensitivity ?? def.sensitivity, [from(path).source], !!def.thirdParty);
    store.update(ids.get(path) as string, propWrites(store, type, links, l, meta), meta);
  }
  return ids;
}

/**
 * A calendar's definition as Boni Calendar's tests use it (the `collection:` map): a title, a day with its start and
 * end, all day, a time zone, done, a place, a series; new rows get the area `[[area]]`.
 */
export const calendarDef = (id: string, name: string, folder: string, area = id) => ({
  id,
  name,
  folder,
  account: "Agenda",
  color: "#60a5fa",
  columns: [
    { id: "title", name: "Título", type: "text" },
    { id: "date", name: "Fecha", type: "date" },
    { id: "startTime", name: "Inicio", type: "time" },
    { id: "endTime", name: "Fin", type: "time" },
    { id: "endDate", name: "Fecha de fin", type: "date" },
    { id: "allDay", name: "Todo el día", type: "checkbox" },
    { id: "timezone", name: "Zona", type: "text" },
    { id: "completed", name: "Hecha", type: "checkbox" },
    { id: "location", name: "Lugar", type: "text" },
    { id: "series", name: "Serie", type: "text" },
    { id: "series_rule", name: "Regla", type: "text" },
  ],
  mapping: {
    title: "title",
    location: "location",
    when: {
      kind: "split",
      date: "date",
      startTime: "startTime",
      endTime: "endTime",
      endDate: "endDate",
      allDay: "allDay",
      timezone: "timezone",
    },
    task: { column: "completed" },
    series: { id: "series", rule: "series_rule" },
  },
  newNote: { name: "{date} {title}", body: "", properties: { area: `[[${area}]]` } },
});
