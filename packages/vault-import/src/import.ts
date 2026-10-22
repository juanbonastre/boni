import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import {
  type CollectionDef,
  frontmatterData,
  type PropValue,
  parseCollectionDef,
  parseNote,
} from "@boni/calendar";
import {
  type FieldDef,
  type FieldType,
  type Label,
  label,
  newId,
  type SelectOption,
  type Sensitivity,
  type TypeDef,
  typeErrors,
  type Value,
} from "@boni/entities";
import type { OpMeta, UserStore, Writes, Zone } from "@boni/store";
import { BODY, MAX_FILE_BYTES } from "@boni/store";
import { scanVault } from "./scan.ts";
import { hasIdentityNumbers, withoutSecrets } from "./secrets.ts";

/**
 * The vault as Boni's first import (docs/nucleo.md, 9.1). Notes become entities of a type chosen by
 * their folder (agenda calendars by their collection definitions), each property a field whose type is
 * inferred from all its values, every key kept (nothing is lost), `[[links]]` that all resolve to one
 * type become relations. Every value is labelled `imported` with its note as the source; finance,
 * health and the journal are sensitive, people third parties. Access secrets are left out, identity
 * numbers make the value sensitive. Running it again updates only what changed (each entity keeps its
 * note's path and hash in two hidden fields) and sends notes that are gone to the trash.
 * A dry run (the default) reads the vault and the store and writes nothing.
 */

interface Group {
  prefix: string;
  key: string;
  name: string;
  sensitivity: Sensitivity;
  thirdParty?: boolean;
  /** Kept from the models until Juan says otherwise (docs/nucleo.md 7.3; decided by Juan, 2026-10-20). */
  hiddenFromModels?: boolean;
}

/** Folder → type, most specific first (vault conventions). Anything else is a "nota". */
const GROUPS: Group[] = [
  {
    prefix: "registros/finanzas/movimientos/",
    key: "movimiento",
    name: "Movimiento",
    sensitivity: "sensitive",
  },
  {
    prefix: "registros/finanzas/deudas/",
    key: "deuda",
    name: "Deuda",
    sensitivity: "sensitive",
    thirdParty: true,
  },
  {
    prefix: "registros/personas/",
    key: "persona",
    name: "Persona",
    sensitivity: "personal",
    thirdParty: true,
  },
  {
    prefix: "registros/pertenencias/",
    key: "pertenencia",
    name: "Pertenencia",
    sensitivity: "personal",
  },
  { prefix: "proyectos/", key: "proyecto", name: "Proyecto", sensitivity: "personal" },
  { prefix: "areas/", key: "area", name: "Área", sensitivity: "personal" },
  {
    prefix: "diario/",
    key: "diario",
    name: "Diario",
    sensitivity: "sensitive",
    hiddenFromModels: true,
  },
  {
    prefix: "NotionImport/",
    key: "notion",
    name: "Notion (por integrar)",
    sensitivity: "personal",
  },
];
const NOTE_GROUP: Group = { prefix: "", key: "nota", name: "Nota", sensitivity: "personal" };
/** Calendars whose events are sensitive by nature (and kept from the models until Juan says otherwise). */
const SENSITIVE_CALENDARS = new Set(["salud"]);

/** Hidden fields where each entity keeps its note's path and hash (the mirror reads the path too). */
export const PATH_FIELD = "f_vault_path";
export const HASH_FIELD = "f_vault_hash";
/** The field that holds an attachment imported from a zone (a row per file). */
export const FILE_FIELD = "f_boni_file";

/** The vault's zones, as the folders they are (zone 2 and zone 3 of the vault's AGENTS.md). */
export const ZONES: readonly Zone[] = ["restricted", "private"];
const ZONE_NAMES: Record<Zone, string> = { restricted: "Restringido", private: "Privado" };
const inZone = (path: string) => ZONES.some((z) => path.startsWith(`${z}/`));

/** Attachment types by extension; anything else is kept as bytes. */
const MIME: Record<string, string> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".heic": "image/heic",
  ".svg": "image/svg+xml",
  ".txt": "text/plain",
  ".csv": "text/csv",
  ".json": "application/json",
  ".zip": "application/zip",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".odt": "application/vnd.oasis.opendocument.text",
  ".ods": "application/vnd.oasis.opendocument.spreadsheet",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".mp4": "video/mp4",
};
export const mimeOf = (name: string) =>
  MIME[extname(name).toLowerCase()] ?? "application/octet-stream";

export interface ImportOptions {
  apply?: boolean;
  /**
   * Import one of the vault's zones: `root` is that folder (only Juan can give it: the server never sees
   * it), each first-level folder a type, attachments a row each, every type put in the zone (no model may
   * ever see it). Paths are kept as `<zone>/...`, so the vault's own import never touches them.
   */
  zone?: Zone;
  /** The run of this import in the store's log (undoRun undoes it whole). */
  run?: string;
  now?: number;
}

export interface ImportReport {
  applied: boolean;
  types: {
    id: string;
    name: string;
    notes: number;
    fields: { key: string; name: string; type: FieldType; relationTo?: string }[];
  }[];
  created: number;
  updated: number;
  unchanged: number;
  removed: number;
  skipped: Record<string, number>;
  /** Notes whose properties could not be read (imported with their body only). */
  unreadable: string[];
  /** Where access secrets were left out: path, line, kind (never the value). */
  secrets: { path: string; line: number; kind: string }[];
  /** How many notes hold identity or bank numbers (imported as sensitive). */
  identityNumbers: number;
  /** Links that do not point to any note (kept as text). */
  unresolvedLinks: number;
  /** Notes that could not be written (a value that does not fit its field), with why. */
  failed: { path: string; error: string }[];
  /** Types that would not check (nothing is written while there is any). */
  typeProblems: string[];
  /** Types kept from the models by default (unless Juan already chose otherwise). */
  hiddenFromModels: string[];
  /** A zone's import: the zone, and how many attachments became rows. */
  zone?: Zone;
  files: number;
}

interface Note {
  /** As kept in the store (`<zone>/...` for a zone). */
  path: string;
  /** An attachment instead of a note. */
  file?: { data: Uint8Array; mime: string; name: string };
  group: Group | null;
  calendar: CollectionDef | null;
  values: Record<string, PropValue>;
  body: string;
  hash: string;
  sensitive: boolean;
}

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

/** An ASCII key for a property name ("Calidad (1-8)" -> "calidad-1-8"; "Sueño/s" -> "sueno-s"). */
export function keyOf(name: string): string {
  const k = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 36);
  return /^[a-z]/.test(k) ? k : `p-${k || "x"}`;
}
const fieldIdOf = (key: string) => `f_${key.replace(/-/g, "_")}`.slice(0, 64);

/**
 * The key of each property of a type's notes (`props`, sorted), as the import gives them: ASCII, unique,
 * `title` taken by the title field when no note has one. The mirror uses it to write a field back under
 * the property it came from.
 */
export function propertyKeys(props: readonly string[]): Map<string, string> {
  const used = new Set<string>(props.includes("title") ? [] : ["title"]);
  const out = new Map<string, string>();
  for (const prop of [...props].sort()) {
    let key = keyOf(prop);
    while (used.has(key)) key = `${key}-2`.slice(0, 40);
    used.add(key);
    out.set(prop, key);
  }
  return out;
}
/** Property name -> field id, for the properties of a type's notes (see `propertyKeys`). */
export const propertyFields = (props: readonly string[]): Map<string, string> =>
  new Map([...propertyKeys(props)].map(([prop, key]) => [prop, fieldIdOf(key)]));

const LINK = /^\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]$/;
const linkTarget = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const m = LINK.exec(v.trim());
  return m ? ((m[1] as string).trim().split("/").pop()?.toLowerCase() ?? null) : null;
};

export function readDefinitions(root: string): CollectionDef[] {
  const dir = join(root, "_system", "colecciones");
  let files: string[] = [];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".md") && f !== "README.md");
  } catch {
    return [];
  }
  const defs: CollectionDef[] = [];
  for (const f of files.sort()) {
    const fm = frontmatterData(readFileSync(join(dir, f), "utf8"));
    if ("error" in fm) continue;
    const r = parseCollectionDef(fm.data.collection);
    if (r.ok) defs.push(r.def);
  }
  return defs;
}

function inferType(
  values: unknown[],
  linked: (target: string) => string | null,
): { type: FieldType; relationTo?: string; many?: boolean; options?: string[] } {
  const xs = values.filter((v) => v !== null && v !== undefined && v !== "");
  if (!xs.length) return { type: "text" };
  if (xs.every((v) => typeof v === "boolean")) return { type: "checkbox" };
  if (xs.every((v) => typeof v === "number" && Number.isFinite(v))) return { type: "number" };
  const strings = xs.every((v) => typeof v === "string") ? (xs as string[]) : null;
  const lists = xs.every((v) => Array.isArray(v)) ? (xs as string[][]) : null;
  const relationOf = (items: string[]) => {
    const targets = items.map((s) => linkTarget(s));
    if (!items.length || targets.some((t) => t === null)) return null;
    const types = new Set(targets.map((t) => linked(t as string)));
    return types.size === 1 && !types.has(null) ? ([...types][0] as string) : null;
  };
  if (strings) {
    if (strings.every((s) => /^\d{4}-\d{2}-\d{2}$/.test(s))) return { type: "date" };
    if (strings.every((s) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s))) return { type: "time" };
    const rel = relationOf(strings);
    if (rel) return { type: "relation", relationTo: rel, many: false };
    return { type: strings.some((s) => s.length > 2000 || s.includes("\n")) ? "longtext" : "text" };
  }
  if (lists) {
    const flat = lists.flat();
    const rel = relationOf(flat);
    if (rel) return { type: "relation", relationTo: rel, many: true };
    if (flat.every((s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s)))
      return { type: "dates" };
    if (flat.every((s) => typeof s === "string" && s.length <= 200))
      return { type: "multiselect", options: [...new Set(flat)].sort() };
  }
  return { type: "longtext" }; // mixed shapes: kept as text
}

/** Unique per value: two values that read the same in ASCII ("foto 1.jpg", "foto_1.jpg") still differ. */
const optionId = (value: string) =>
  `o_${keyOf(value).replace(/-/g, "_").slice(0, 40)}_${sha(value).slice(0, 8)}`;

/** A property's value as the field's value (the inference made sure it fits). */
function toValue(
  field: FieldDef,
  raw: PropValue,
  resolve: (target: string) => string | null,
): Value {
  if (raw === null || raw === "") return null;
  switch (field.type) {
    case "relation": {
      const ids = (Array.isArray(raw) ? raw : [raw]).map((s) => {
        const t = linkTarget(s);
        return t ? resolve(t) : null;
      });
      const ok = ids.filter((x): x is string => x !== null);
      return field.relation?.many ? ok : (ok[0] ?? null);
    }
    case "multiselect":
      return (Array.isArray(raw) ? raw : [raw]).map((s) => optionId(String(s)));
    case "text":
    case "longtext":
      return Array.isArray(raw) ? raw.join(", ") : typeof raw === "string" ? raw : String(raw);
    default:
      return raw as Value;
  }
}

export function importVault(
  root: string,
  store: UserStore,
  opts: ImportOptions = {},
): ImportReport {
  const now = opts.now ?? Date.now();
  const zone = opts.zone;
  if (zone && !ZONES.includes(zone)) throw new Error(`not a zone: ${zone}`);
  const scan = scanVault(root);
  const defs = zone ? [] : readDefinitions(root);
  const stored = (rel: string) => (zone ? `${zone}/${rel}` : rel);
  // In a zone each first-level folder is a type (its name, Juan's own), the notes at its root another.
  const zoneGroups = new Map<string, Group>();
  const zoneGroup = (rel: string): Group => {
    const z = zone as Zone;
    const folder = rel.includes("/") ? (rel.split("/")[0] as string) : "";
    let g = zoneGroups.get(folder);
    if (!g) {
      const key = `${z}_${folder ? keyOf(folder).replace(/-/g, "_") : "root"}`.slice(0, 48);
      g = {
        prefix: folder ? `${folder}/` : "",
        key,
        name: folder || ZONE_NAMES[z],
        sensitivity: "sensitive",
        hiddenFromModels: true,
      };
      zoneGroups.set(folder, g);
    }
    return g;
  };
  const report: ImportReport = {
    applied: !!opts.apply,
    types: [],
    created: 0,
    updated: 0,
    unchanged: 0,
    removed: 0,
    skipped: scan.skipped,
    unreadable: [],
    secrets: [],
    identityNumbers: 0,
    unresolvedLinks: 0,
    failed: [],
    typeProblems: [],
    hiddenFromModels: [],
    ...(zone ? { zone } : {}),
    files: 0,
  };

  // ------------------------------------------------ read every note once
  const notes: Note[] = [];
  for (const rel of scan.notes) {
    const path = stored(rel);
    const raw = readFileSync(join(root, rel), "utf8");
    const calendar = defs.find((d) => rel.startsWith(`${d.folder}/`)) ?? null;
    const group = calendar
      ? null
      : zone
        ? zoneGroup(rel)
        : (GROUPS.find((g) => rel.startsWith(g.prefix)) ?? NOTE_GROUP);
    const clean = withoutSecrets(raw);
    for (const s of clean.found) report.secrets.push({ path, ...s });
    const parsed = parseNote(clean.text);
    if (parsed.error) report.unreadable.push(path);
    const sensitive = hasIdentityNumbers(clean.text);
    if (sensitive) report.identityNumbers++;
    notes.push({
      path,
      group,
      calendar,
      values: parsed.error ? {} : parsed.values,
      body: parsed.body,
      hash: sha(raw),
      sensitive,
    });
  }
  // A zone's attachments: a row each, in the type of its folder (outside a zone they stay skipped).
  if (zone)
    for (const rel of scan.files) {
      const data = readFileSync(join(root, rel));
      if (data.byteLength > MAX_FILE_BYTES) {
        report.skipped["file over 50 MB"] = (report.skipped["file over 50 MB"] ?? 0) + 1;
        continue;
      }
      const name = basename(rel);
      notes.push({
        path: stored(rel),
        file: { data, mime: mimeOf(name), name },
        group: zoneGroup(rel),
        calendar: null,
        values: {},
        body: "",
        hash: createHash("sha256").update(data).digest("hex"),
        sensitive: true,
      });
    }
  if (zone) {
    const why = "not a note (attachment or other file)";
    const left = (scan.skipped[why] ?? 0) - scan.files.length;
    report.skipped = { ...report.skipped };
    if (left > 0) report.skipped[why] = left;
    else delete report.skipped[why];
  }

  // ------------------------------------------------ types and their fields
  const typeIdOf = (n: Note) =>
    n.calendar ? `t_${n.calendar.id.replace(/-/g, "_")}` : `t_${(n.group as Group).key}`;
  const byName = new Map<string, Note>(); // link target (file name) -> note
  for (const n of notes) if (!n.file) byName.set(basename(n.path, ".md").toLowerCase(), n);
  const linkedType = (target: string) => {
    const n = byName.get(target);
    return n ? typeIdOf(n) : null;
  };
  const source = (n: Note) => [{ kind: "vault" as const, id: `${n.path}@${n.hash.slice(0, 12)}` }];
  const typeLabel: Label = label("imported", "public", [{ kind: "vault", id: "import" }]);

  const groups = new Map<string, Note[]>();
  for (const n of notes) groups.set(typeIdOf(n), [...(groups.get(typeIdOf(n)) ?? []), n]);
  const wanted = new Map<string, TypeDef>();
  const fieldKeyOf = new Map<string, Map<string, FieldDef>>(); // type -> property name -> field
  for (const [typeId, members] of groups) {
    const first = members[0] as Note;
    const g = first.group;
    const cal = first.calendar;
    const props = [...new Set(members.flatMap((n) => Object.keys(n.values)))].sort();
    const fields: FieldDef[] = [];
    const byProp = new Map<string, FieldDef>();
    const hasTitle = props.includes("title");
    if (!hasTitle)
      fields.push({ id: "f_title", key: "title", name: "Título", type: "text", label: typeLabel });
    if (members.some((n) => n.file))
      fields.push({
        id: FILE_FIELD,
        key: "boni-archivo",
        name: "Archivo",
        type: "file",
        label: typeLabel,
      });
    const keys = propertyKeys(props);
    for (const prop of props) {
      const key = keys.get(prop) as string;
      const col = cal?.columns.find((c) => c.id === prop);
      const inferred = inferType(
        members.map((n) => n.values[prop]),
        linkedType,
      );
      // The values decide; a calendar's declared type is used only for a column that is still empty.
      const empty = members.every(
        (n) => n.values[prop] === null || n.values[prop] === undefined || n.values[prop] === "",
      );
      const simple: FieldType[] = ["text", "number", "checkbox", "date", "time", "dates", "url"];
      const type: FieldType =
        empty && col && simple.includes(col.type as FieldType)
          ? (col.type as FieldType)
          : inferred.type;
      const f: FieldDef = {
        id: fieldIdOf(key),
        key,
        name: col?.name ?? prop,
        type,
        label: typeLabel,
      };
      if (type === "relation" && inferred.relationTo)
        f.relation = { target: inferred.relationTo, many: !!inferred.many };
      if (type === "multiselect") {
        const opts = inferred.options ?? [];
        f.options = opts.map((o): SelectOption => ({ id: optionId(o), name: o, label: typeLabel }));
        if (!f.options.length) f.type = "text";
      }
      if (type === "relation" && !f.relation) f.type = "text";
      fields.push(f);
      byProp.set(prop, f);
    }
    fields.push(
      {
        id: PATH_FIELD,
        key: "vault-path",
        name: "Nota del vault",
        type: "text",
        hidden: true,
        label: typeLabel,
      },
      {
        id: HASH_FIELD,
        key: "vault-hash",
        name: "Huella de la nota",
        type: "text",
        hidden: true,
        label: typeLabel,
      },
    );
    const sensitivity: Sensitivity = cal
      ? SENSITIVE_CALENDARS.has(cal.id)
        ? "sensitive"
        : "personal"
      : (g as Group).sensitivity;
    wanted.set(typeId, {
      id: typeId,
      key: keyOf(cal ? cal.id : (g as Group).key),
      name: cal ? cal.name : (g as Group).name,
      fields,
      titleField: hasTitle ? (byProp.get("title") as FieldDef).id : "f_title",
      sensitivity,
      ...((g?.thirdParty ?? false) ? { thirdParty: true } : {}),
      schemaVersion: 1,
      label: typeLabel,
    });
    fieldKeyOf.set(typeId, byProp);
    report.types.push({
      id: typeId,
      name: cal ? cal.name : (g as Group).name,
      notes: members.length,
      fields: fields
        .filter((f) => !f.hidden)
        .map((f) => ({
          key: f.key,
          name: f.name,
          type: f.type,
          ...(f.relation ? { relationTo: f.relation.target } : {}),
        })),
    });
  }

  // ------------------------------------------------ what is already in the store
  const existing = new Map<string, { id: string; hash: string }>(); // path -> entity
  for (const typeId of Object.keys(store.schema().types))
    for (const e of store.list(typeId)) {
      const p = e.entity.values[PATH_FIELD];
      // Each import sees only its own notes: the vault's never a zone's, a zone's only its own.
      const mine = typeof p === "string" && (zone ? p.startsWith(`${zone}/`) : !inZone(p));
      if (mine)
        existing.set(p, { id: e.entity.id, hash: String(e.entity.values[HASH_FIELD] ?? "") });
    }
  const idOf = new Map<string, string>(); // path -> entity id (existing or new)
  for (const n of notes) idOf.set(n.path, existing.get(n.path)?.id ?? newId("e", now));
  const resolve = (target: string) => {
    const n = byName.get(target);
    if (!n) {
      report.unresolvedLinks++;
      return null;
    }
    return idOf.get(n.path) ?? null;
  };

  const meta: OpMeta = { actor: "import", run: opts.run ?? `import-${now}` };
  const apply = !!opts.apply;

  // Every type is checked before anything is written (a dry run sees the same problems).
  const all = { types: Object.fromEntries([...wanted.values()].map((d) => [d.id, d])) };
  for (const def of wanted.values())
    for (const e of typeErrors(def, all)) report.typeProblems.push(`${def.id}: ${e}`);
  if (report.typeProblems.length) {
    if (apply)
      throw new Error(
        `Nothing written; the types do not check:\n${report.typeProblems.join("\n")}`,
      );
    return report;
  }

  // ------------------------------------------------ schema
  // Every type first without its relations, then the relations: a target always exists by then,
  // whatever the order or the cycles (a project's parent is a project).
  if (apply) {
    for (const def of wanted.values())
      if (!store.schema().types[def.id])
        store.applySchema(
          {
            op: "create_type",
            type: { ...def, fields: def.fields.filter((f) => f.type !== "relation") },
          },
          meta,
        );
    for (const def of wanted.values()) {
      const have = store.schema().types[def.id] as TypeDef;
      for (const f of def.fields)
        if (!have.fields.some((x) => x.id === f.id))
          store.applySchema({ op: "add_field", type: def.id, field: f }, meta);
    }
  }

  // What the models may see: Diario and Salud start hidden; a choice Juan already made is never changed.
  for (const [typeId, members] of groups) {
    const first = members[0] as Note;
    const hide = first.calendar
      ? SENSITIVE_CALENDARS.has(first.calendar.id)
      : !!(first.group as Group).hiddenFromModels;
    if (!hide) continue;
    report.hiddenFromModels.push(typeId);
    if (apply && zone) store.setZone(typeId, zone, "import");
    else if (apply && !(typeId in store.aiAccess())) store.setAiAccess(typeId, "hidden", "import");
  }

  // ------------------------------------------------ entities: first without relations, then relations
  const fieldsOf = (n: Note) => {
    const typeId = typeIdOf(n);
    const def =
      (apply ? store.schema().types[typeId] : undefined) ?? (wanted.get(typeId) as TypeDef);
    return { typeId, def, byProp: fieldKeyOf.get(typeId) as Map<string, FieldDef> };
  };
  const later: { id: string; writes: Writes; path: string }[] = [];
  for (const n of notes) {
    const { typeId, def, byProp } = fieldsOf(n);
    const was = existing.get(n.path);
    if (was && was.hash === n.hash) {
      report.unchanged++;
      continue;
    }
    const sens: Sensitivity = n.sensitive ? "sensitive" : def.sensitivity;
    const l = label("imported", sens, source(n), !!def.thirdParty);
    const writes: Writes = {};
    const rel: Writes = {};
    if (n.file) {
      writes[def.titleField] = { value: n.file.name, label: l };
      if (apply) writes[FILE_FIELD] = { value: store.putFile(n.file.data, n.file.mime), label: l };
      report.files++;
    } else if (!byProp.has("title")) writes.f_title = { value: basename(n.path, ".md"), label: l };
    for (const [prop, f] of n.file ? [] : byProp) {
      const raw = n.values[prop] ?? null;
      const target = def.fields.find((x) => x.id === f.id) ?? f;
      if (target.type === "relation") {
        if (raw !== null) rel[f.id] = { value: toValue(target, raw, resolve), label: l };
        continue;
      }
      writes[f.id] = { value: toValue(target, raw, resolve), label: l };
    }
    writes[BODY] = { value: n.body || null, label: l };
    writes[PATH_FIELD] = { value: n.path, label: l };
    writes[HASH_FIELD] = { value: n.hash, label: l };
    const id = idOf.get(n.path) as string;
    try {
      if (was) {
        if (apply) store.update(id, writes, meta);
        report.updated++;
      } else {
        if (apply) store.create(typeId, writes, meta, id);
        report.created++;
      }
      if (Object.keys(rel).length) later.push({ id, writes: rel, path: n.path });
    } catch (e) {
      // A value that no longer fits its field (the note changed shape): reported, the rest goes on.
      report.failed.push({ path: n.path, error: e instanceof Error ? e.message : String(e) });
    }
  }
  if (apply)
    for (const r of later)
      try {
        store.update(r.id, r.writes, meta);
      } catch (e) {
        report.failed.push({ path: r.path, error: e instanceof Error ? e.message : String(e) });
      }
  // Notes that are gone go to the trash (Undo brings them back; a note that comes back is imported again).
  const present = new Set(notes.map((n) => n.path));
  for (const [path, e] of existing)
    if (!present.has(path)) {
      report.removed++;
      if (apply) store.remove(e.id, meta);
    }
  return report;
}
