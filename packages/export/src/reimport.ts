import {
  type FieldDef,
  INTEGRITY_ORDER,
  join,
  type Label,
  label,
  SENSITIVITY_ORDER,
  type TypeDef,
} from "@boni/entities";
import {
  AI_LEVELS,
  type AiLevel,
  BODY,
  type FileWriter,
  type OpMeta,
  StoreError,
  type UserStore,
  type Writes,
} from "@boni/store";
import { type ExportRecord, FORMAT } from "./export.ts";
import { type ZipArchive, ZipError } from "./zip.ts";

/**
 * An export back into a store (`json/` and `schema.json`; the Markdown and CSV are for people). Types that
 * are missing are created (first without relations, then the relations, as the vault import does); an
 * entity whose id is already there is left as it is and reported. A dry run (the default) only reports.
 *
 * The labels in the file are what the file says, and a file can be edited: by default each value is
 * at most `imported`, with the export as a source (what came from outside stays `external`). Only for an
 * export of one's own that never left (moving to another server) does `trustLabels` keep them as they are.
 *
 * The export is read from disk a part at a time (`openZipFile`), and each attachment goes into the store as it
 * is read, under the hash it had (task 101: files of up to 1 GB, backups past 4 GB, a container of 384 MB). The
 * attachments come back first, each on its own; then everything else in one transaction, so an import that stops
 * there (a damaged record file, a full disk) leaves the store's records as they were. An attachment that cannot
 * come back (missing from the zip, damaged) does not stop the rest: the report names it, with the records that
 * point at it. The attachments already back stay: kept by content, unseen until a record names them, and taken
 * as they are by the next try.
 */
export interface ReimportOptions {
  apply?: boolean;
  trustLabels?: boolean;
  /** Names the export in the labels' source ("export:<name>"). */
  name?: string;
  run?: string;
}

export interface ReimportReport {
  applied: boolean;
  types: { key: string; name: string; created: boolean; entities: number }[];
  created: number;
  /** Ids already in the store (left as they are). */
  existing: string[];
  /** Records that could not be written, with why. */
  failed: { id: string; error: string }[];
  /** The attachments: brought back (in a dry run, to bring), already here, and those that do not come back. */
  files: { added: number; present: number; missing: MissingFile[] };
}

/** An attachment of the export that does not come back, and the records whose values name it. */
export interface MissingFile {
  sha256: string;
  mime: string;
  error: string;
  records: string[];
}

/** Where an import reads the export from: a zip opened from disk (`openZipFile`), or its entries in memory. */
export type ExportSource = Map<string, Buffer> | ZipArchive;
type Reader = Pick<ZipArchive, "read" | "size" | "chunks">;

const readerOf = (s: ExportSource): Reader =>
  s instanceof Map
    ? {
        read: (n) => s.get(n) ?? null,
        size: (n) => s.get(n)?.length ?? null,
        *chunks(n) {
          const b = s.get(n);
          if (b) yield b;
        },
      }
    : s;

export class ExportFormatError extends Error {}

const isLabel = (l: unknown): l is Label => {
  const x = l as Label;
  return (
    !!x &&
    INTEGRITY_ORDER.includes(x.integrity) &&
    SENSITIVITY_ORDER.includes(x.sensitivity) &&
    typeof x.thirdParty === "boolean" &&
    Array.isArray(x.sources) &&
    x.sources.every((s) => typeof s?.kind === "string" && typeof s?.id === "string")
  );
};

interface Schema {
  format?: string;
  version?: number;
  types: TypeDef[];
  aiAccess?: Record<string, string>;
  zones?: Record<string, string>;
  files?: Record<string, string>;
}

export function importExport(
  source: ExportSource,
  store: UserStore,
  o: ReimportOptions = {},
): ReimportReport {
  const zip = readerOf(source);
  const raw = zip.read("schema.json");
  if (!raw) throw new ExportFormatError("no schema.json: not a Boni export");
  const schema = JSON.parse(raw.toString("utf8")) as Schema;
  if (schema.format !== FORMAT || schema.version !== 1 || !Array.isArray(schema.types))
    throw new ExportFormatError("not a Boni export (version 1)");
  const report: ReimportReport = {
    applied: !!o.apply,
    types: [],
    created: 0,
    existing: [],
    failed: [],
    files: { added: 0, present: 0, missing: [] },
  };
  const missing = importFiles(schema, zip, store, !!o.apply, report);
  if (o.apply) store.batch(() => importRecords(schema, zip, store, o, report, missing));
  else importRecords(schema, zip, store, o, report, missing);
  report.files.missing = [...missing.values()];
  return report;
}

/**
 * The attachments, by content (a `file` value is their sha256), each streamed into the store on its own and kept
 * only under the hash it had. Gives the ones that do not come back.
 */
function importFiles(
  schema: Schema,
  zip: Reader,
  store: UserStore,
  apply: boolean,
  report: ReimportReport,
): Map<string, MissingFile> {
  const missing = new Map<string, MissingFile>();
  for (const [sha, mime] of Object.entries(schema.files ?? {})) {
    const lost = (error: string) => missing.set(sha, { sha256: sha, mime, error, records: [] });
    if (!/^[0-9a-f]{64}$/.test(sha)) {
      lost("bad name");
      continue;
    }
    if (store.fileInfo(sha)) {
      report.files.present++;
      continue;
    }
    const name = `files/${sha}`;
    const size = zip.size(name);
    if (size === null) {
      lost("not in the export");
      continue;
    }
    if (!apply) {
      report.files.added++;
      continue;
    }
    let w: FileWriter | undefined;
    try {
      w = store.fileWriter(mime, size);
      for (const part of zip.chunks(name)) w.write(part);
      w.finish(sha);
      report.files.added++;
    } catch (e) {
      w?.abort();
      // This one is damaged or odd: the others still come. Anything else (a full disk) stops the import here,
      // before any record is written.
      if (!(e instanceof ZipError || e instanceof StoreError)) throw e;
      lost(e.message);
    }
  }
  return missing;
}

/** The types, zones, choices and records of an export (one transaction when applied). */
function importRecords(
  schema: Schema,
  zip: Reader,
  store: UserStore,
  o: ReimportOptions,
  report: ReimportReport,
  missing: Map<string, MissingFile>,
): void {
  const apply = !!o.apply;
  const meta: OpMeta = { actor: "import", run: o.run ?? `reimport-${Date.now()}` };
  const from = label("imported", "public", [{ kind: "export", id: o.name ?? "export" }]);
  const labelOf = (l: unknown, t: TypeDef): Label => {
    const base = isLabel(l) ? l : from;
    return o.trustLabels && isLabel(l) ? base : join(base, { ...from, sensitivity: t.sensitivity });
  };

  // Types: what is missing, first without relations (a target always exists by then).
  const have = () => store.schema().types;
  const wanted = schema.types.filter((t) => !t.system);
  for (const t of wanted) {
    const exists = !!have()[t.id];
    report.types.push({ key: t.key, name: t.name, created: !exists, entities: 0 });
    if (!exists && apply)
      store.applySchema(
        {
          op: "create_type",
          type: { ...t, fields: t.fields.filter((f) => f.type !== "relation") },
        },
        meta,
      );
  }
  if (apply)
    for (const t of wanted) {
      const current = have()[t.id] as TypeDef;
      for (const f of t.fields)
        if (!current.fields.some((x) => x.id === f.id))
          store.applySchema({ op: "add_field", type: t.id, field: f }, meta);
    }

  // A zone comes back before anything else of it, so no model sees it even for a moment.
  if (apply)
    for (const [type, zone] of Object.entries(schema.zones ?? {}))
      if (have()[type] && (zone === "restricted" || zone === "private"))
        store.setZone(type, zone, "import");
  // What the models may see comes back too (never changing a choice already made here).
  if (apply)
    for (const [type, raw] of Object.entries(schema.aiAccess ?? {})) {
      const level = raw === "hidden" ? "restricted" : raw; // an export from before the four levels
      if (
        have()[type] &&
        !(type in store.aiAccess()) &&
        (AI_LEVELS as readonly string[]).includes(level)
      )
        store.setAiAccess(type, level as AiLevel, "import");
    }

  // Entities: first without relations, then the relations.
  const later: { id: string; writes: Writes }[] = [];
  for (const t of schema.types) {
    const target = have()[t.id] ?? (t.system ? undefined : t);
    const text = zip.read(`json/${t.key}.ndjson`)?.toString("utf8") ?? "";
    const entry = report.types.find((x) => x.key === t.key);
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      const r = JSON.parse(line) as ExportRecord;
      if (entry) entry.entities++;
      if (!target) {
        report.failed.push({ id: r.id, error: `no type ${t.key} here` });
        continue;
      }
      if (store.get(r.id)) {
        report.existing.push(r.id);
        continue;
      }
      const byKey = new Map<string, FieldDef>(target.fields.map((f) => [f.key, f]));
      const writes: Writes = {};
      const rel: Writes = {};
      for (const [k, v] of Object.entries(r.values ?? {})) {
        const f = byKey.get(k);
        if (!f) {
          report.failed.push({ id: r.id, error: `unknown field ${k}` });
          continue;
        }
        if (f.type === "file" && typeof v === "string") missing.get(v)?.records.push(r.id);
        (f.type === "relation" ? rel : writes)[f.id] = {
          value: v,
          label: labelOf(r.labels?.[k], target),
        };
      }
      if (r.body) writes[BODY] = { value: r.body, label: labelOf(r.labels?.$body, target) };
      try {
        if (apply) store.create(target.id, writes, meta, r.id);
        report.created++;
        if (Object.keys(rel).length) later.push({ id: r.id, writes: rel });
      } catch (e) {
        report.failed.push({ id: r.id, error: e instanceof Error ? e.message : String(e) });
      }
    }
  }
  if (apply)
    for (const r of later)
      try {
        store.update(r.id, r.writes, meta);
      } catch (e) {
        report.failed.push({ id: r.id, error: e instanceof Error ? e.message : String(e) });
      }
}
