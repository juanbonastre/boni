import {
  type FieldDef,
  INTEGRITY_ORDER,
  join,
  type Label,
  label,
  SENSITIVITY_ORDER,
  type TypeDef,
} from "@boni/entities";
import { BODY, type OpMeta, type UserStore, type Writes } from "@boni/store";
import { type ExportRecord, FORMAT } from "./export.ts";

/**
 * An export back into a store (`json/` and `schema.json`; the Markdown and CSV are for people). Types that
 * are missing are created (first without relations, then the relations, as the vault import does); an
 * entity whose id is already there is left as it is and reported. A dry run (the default) only reports.
 *
 * The labels in the file are what the file says, and a file can be edited: by default each value is
 * at most `imported`, with the export as a source (what came from outside stays `external`). Only for an
 * export of one's own that never left (moving to another server) does `trustLabels` keep them as they are.
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
}

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

export function importExport(
  files: Map<string, Buffer>,
  store: UserStore,
  o: ReimportOptions = {},
): ReimportReport {
  const raw = files.get("schema.json");
  if (!raw) throw new ExportFormatError("no schema.json: not a Boni export");
  const schema = JSON.parse(raw.toString("utf8")) as {
    format?: string;
    version?: number;
    types?: TypeDef[];
    aiAccess?: Record<string, string>;
    zones?: Record<string, string>;
    files?: Record<string, string>;
  };
  if (schema.format !== FORMAT || schema.version !== 1 || !Array.isArray(schema.types))
    throw new ExportFormatError("not a Boni export (version 1)");
  const apply = !!o.apply;
  const meta: OpMeta = { actor: "import", run: o.run ?? `reimport-${Date.now()}` };
  const report: ReimportReport = {
    applied: apply,
    types: [],
    created: 0,
    existing: [],
    failed: [],
  };
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
  // Attachments, by content (a `file` value is their sha256).
  if (apply)
    for (const [sha, mime] of Object.entries(schema.files ?? {})) {
      const data = files.get(`files/${sha}`);
      if (data && !store.getFile(sha)) store.putFile(data, mime);
    }
  // What the models may see comes back too (never changing a choice already made here).
  if (apply)
    for (const [type, level] of Object.entries(schema.aiAccess ?? {}))
      if (
        have()[type] &&
        !(type in store.aiAccess()) &&
        !store.zones()[type] &&
        (level === "visible" || level === "opaque" || level === "hidden")
      )
        store.setAiAccess(type, level, "import");

  // Entities: first without relations, then the relations.
  const later: { id: string; writes: Writes }[] = [];
  for (const t of schema.types) {
    const target = have()[t.id] ?? (t.system ? undefined : t);
    const text = files.get(`json/${t.key}.ndjson`)?.toString("utf8") ?? "";
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
  return report;
}
