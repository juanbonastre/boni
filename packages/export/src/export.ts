import { formatNote } from "@boni/calendar";
import type { FieldDef, Label, TypeDef, Value } from "@boni/entities";
import type { StoredEntity, UserStore } from "@boni/store";
import { type Links, render, safeName } from "./markdown.ts";
import { writeZip, type ZipEntry, zipChunks } from "./zip.ts";

/**
 * Export in one click (docs/nucleo.md 9.3): everything of an account in files any program reads, so
 * leaving Boni is always possible.
 *   README.md                what is what
 *   schema.json              every type as Boni keeps it, and a JSON Schema for each type's records
 *   json/<type>.ndjson       one entity per line: values by field key, body, labels, times (the faithful copy;
 *                            `importExport` reads it back)
 *   <type>/<title>.md        Markdown with YAML properties (markdown.ts; Obsidian or any editor opens it)
 *   csv/<type>.csv           for a spreadsheet
 *   files/<sha256>           the attachments (`file` values), their types in schema.json
 *   views.json               the account's charts and shortcuts (what the server passes)
 *   log.ndjson               the operation log, when asked for
 * Boni's own types (memory, jobs) go only to json/. Entities in the trash are left out. Text from a model or
 * from outside is neutralized in the Markdown (P17); the NDJSON keeps it as it is.
 */
export const FORMAT = "boni-export";
export const VERSION = 1;
const RESERVED = new Set(["json", "csv", "files"]);

export interface ExportOptions {
  /** The account's charts, shortcuts and the like (they live in system.db, not in the store). */
  views?: unknown;
  /** Adds log.ndjson. */
  log?: boolean;
  now?: number;
}

/** A record of json/<type>.ndjson. */
export interface ExportRecord {
  id: string;
  values: Record<string, Value>;
  body?: string;
  /** By field key, and `$body`. */
  labels: Record<string, Label>;
  created: number;
  updated: number;
  version: number;
}

const enc = (s: string) => Buffer.from(s, "utf8");
const fieldsOf = (t: TypeDef) => t.fields.filter((f) => !f.archived);

export function toRecord(s: StoredEntity, t: TypeDef): ExportRecord {
  const e = s.entity;
  const values: Record<string, Value> = {};
  const labels: Record<string, Label> = {};
  for (const f of fieldsOf(t)) {
    const v = e.values[f.id];
    if (v === undefined || v === null) continue;
    values[f.key] = v;
    const l = s.labels[f.id];
    if (l) labels[f.key] = l;
  }
  if (e.body) {
    const l = s.labels.$body;
    if (l) labels.$body = l;
  }
  return {
    id: e.id,
    values,
    ...(e.body ? { body: e.body } : {}),
    labels,
    created: e.created,
    updated: e.updated,
    version: e.version,
  };
}

/** The JSON Schema of a type's records (what `values` may hold, by field key). */
export function jsonSchemaOf(t: TypeDef): Record<string, unknown> {
  const of = (f: FieldDef): Record<string, unknown> => {
    const ids = (f.options ?? []).map((o) => o.id);
    const base: Record<string, unknown> = { title: f.name };
    switch (f.type) {
      case "number":
        return { ...base, type: "number" };
      case "duration":
        return { ...base, type: "integer", minimum: 0, description: "minutes" };
      case "checkbox":
        return { ...base, type: "boolean" };
      case "money":
        return {
          ...base,
          type: "object",
          properties: {
            amount: { type: "number" },
            currency: { type: "string", pattern: "^[A-Z]{3}$" },
          },
          required: ["amount", "currency"],
          additionalProperties: false,
        };
      case "select":
        return { ...base, enum: ids };
      case "multiselect":
        return { ...base, type: "array", items: { enum: ids }, uniqueItems: true };
      case "date":
        return { ...base, type: "string", format: "date" };
      case "dates":
        return { ...base, type: "array", items: { type: "string", format: "date" } };
      case "time":
        return { ...base, type: "string", pattern: "^([01]\\d|2[0-3]):[0-5]\\d$" };
      case "datetime":
        return { ...base, type: "string", format: "date-time" };
      case "url":
        return { ...base, type: "string", format: "uri" };
      case "email":
        return { ...base, type: "string", format: "email" };
      case "relation":
        return f.relation?.many
          ? { ...base, type: "array", items: { type: "string" }, description: "entity ids" }
          : { ...base, type: "string", description: "an entity id" };
      case "file":
        return {
          ...base,
          type: "string",
          pattern: "^[0-9a-f]{64}$",
          description: "sha256 of files/<sha256>",
        };
      default:
        return { ...base, type: "string" };
    }
  };
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: t.name,
    type: "object",
    properties: {
      id: { type: "string" },
      values: {
        type: "object",
        properties: Object.fromEntries(fieldsOf(t).map((f) => [f.key, of(f)])),
        additionalProperties: false,
      },
      body: { type: "string" },
      labels: { type: "object" },
      created: { type: "integer" },
      updated: { type: "integer" },
      version: { type: "integer" },
    },
    required: ["id", "values", "labels", "created", "updated", "version"],
  };
}

/** A spreadsheet cell: lists joined with "; ", options and links by their name, never a formula. */
function cell(f: FieldDef, v: Value, title: (id: string) => string): string {
  let s: string;
  if (v === null) s = "";
  else if (f.type === "select") s = f.options?.find((o) => o.id === v)?.name ?? String(v);
  else if (f.type === "multiselect")
    s = (v as string[]).map((id) => f.options?.find((o) => o.id === id)?.name ?? id).join("; ");
  else if (f.type === "relation") s = (Array.isArray(v) ? v : [v as string]).map(title).join("; ");
  else if (f.type === "money")
    s = `${(v as { amount: number }).amount} ${(v as { currency: string }).currency}`;
  else if (Array.isArray(v)) s = v.join("; ");
  else s = String(v);
  // A cell that starts like a formula is text, not a formula (CSV injection: outside text ends up here).
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r;]/.test(s) || s !== s.trim() ? `"${s.replace(/"/g, '""')}"` : s;
}

const README = (
  exported: string,
  types: { key: string; name: string; n: number }[],
  log: boolean,
) => `# Exportación de Boni

Exportada el ${exported}. Son tus datos completos, en formatos abiertos: puedes abrirlos sin Boni.

- \`json/<tipo>.ndjson\`: la copia fiel, un elemento por línea (valores por clave de campo, texto, procedencia de
  cada valor y fechas). Boni la vuelve a importar tal cual.
- \`schema.json\`: cada tipo como lo guarda Boni (campos, opciones, relaciones) y un JSON Schema de sus elementos.
- \`<tipo>/*.md\`: una nota Markdown por elemento, con propiedades YAML (se abre en Obsidian). El texto que vino de un
  modelo o de fuera lleva las imágenes y enlaces remotos desactivados.
- \`csv/<tipo>.csv\`: para una hoja de cálculo (las listas, separadas por "; ").
- \`views.json\`: tus gráficas y atajos.
${log ? "- `log.ndjson`: el registro de operaciones (qué cambió, cuándo y quién).\n" : ""}
Tipos:
${types.map((t) => `- ${t.name} (\`${t.key}\`): ${t.n}`).join("\n")}
`;

export function exportFiles(store: UserStore, o: ExportOptions = {}): ZipEntry[] {
  const now = o.now ?? Date.now();
  const schema = store.schema();
  const types = Object.values(schema.types)
    .filter((t) => !t.archived)
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const out: ZipEntry[] = [];
  const lists = new Map(types.map((t) => [t.id, store.list(t.id)]));

  // Markdown file names first: links between notes use them.
  const notePath = new Map<string, string>();
  const titleOf = new Map<string, string>();
  for (const t of types) {
    if (t.system) continue;
    const folder = RESERVED.has(t.key) ? `${t.key}-notas` : t.key;
    const used = new Set<string>();
    for (const s of lists.get(t.id) ?? []) {
      const title = s.entity.values[t.titleField];
      const name = safeName(typeof title === "string" ? title : s.entity.id);
      titleOf.set(s.entity.id, typeof title === "string" ? title : s.entity.id);
      let file = name;
      for (let i = 2; used.has(file.toLowerCase()); i++) file = `${name} ${i}`;
      used.add(file.toLowerCase());
      notePath.set(s.entity.id, `${folder}/${file}.md`);
    }
  }
  const links: Links = {
    nameOf: (id) => notePath.get(id)?.split("/").pop()?.replace(/\.md$/, "") ?? null,
  };
  const title = (id: string) => titleOf.get(id) ?? id;

  for (const t of types) {
    const list = lists.get(t.id) ?? [];
    out.push({
      path: `json/${t.key}.ndjson`,
      data: enc(list.map((s) => `${JSON.stringify(toRecord(s, t))}\n`).join("")),
    });
    if (t.system) continue;
    for (const s of list) {
      const r = render(s, t, links);
      out.push({
        path: notePath.get(s.entity.id) as string,
        data: enc(formatNote(r.props, r.body)),
      });
    }
    const fields = fieldsOf(t);
    const header = ["id", ...fields.map((f) => f.key), "body"].join(",");
    const rows = list.map((s) =>
      [
        s.entity.id,
        ...fields.map((f) => cell(f, s.entity.values[f.id] ?? null, title)),
        cell({ type: "longtext" } as FieldDef, s.entity.body ?? null, title),
      ].join(","),
    );
    // A BOM so spreadsheets read the accents right.
    out.push({ path: `csv/${t.key}.csv`, data: enc(`﻿${[header, ...rows].join("\r\n")}\r\n`) });
  }
  // Attachments once each, by content.
  const fileTypes: Record<string, string> = {};
  for (const t of types)
    for (const f of fieldsOf(t).filter((x) => x.type === "file"))
      for (const s of lists.get(t.id) ?? []) {
        const sha = s.entity.values[f.id];
        if (typeof sha !== "string" || sha in fileTypes) continue;
        const info = store.fileInfo(sha);
        if (!info) continue;
        fileTypes[sha] = info.mime;
        // Read when its turn comes to be written (zipChunks), one attachment at a time.
        out.push({
          path: `files/${sha}`,
          stored: true,
          data: () => {
            const d = store.getFile(sha)?.data ?? new Uint8Array();
            return Buffer.from(d.buffer, d.byteOffset, d.byteLength); // a view, not a copy
          },
        });
      }
  out.push({
    path: "schema.json",
    data: enc(
      `${JSON.stringify(
        {
          format: FORMAT,
          version: VERSION,
          exported: new Date(now).toISOString(),
          types,
          // What the models may see of each type (Juan's choice; missing = visible).
          aiAccess: store.aiAccess(),
          // The vault's zones moved into Boni (no model ever sees them) and each attachment's type.
          zones: store.zones(),
          files: fileTypes,
          jsonSchema: Object.fromEntries(types.map((t) => [t.key, jsonSchemaOf(t)])),
        },
        null,
        2,
      )}\n`,
    ),
  });
  out.push({ path: "views.json", data: enc(`${JSON.stringify(o.views ?? {}, null, 2)}\n`) });
  // Written a page of operations at a time as its turn comes: a big store's log is more than the server's memory,
  // even alone (2026-10-28: an invented store of 500 MB had a log of 280 MB).
  if (o.log) out.push({ path: "log.ndjson", chunks: () => logChunks(store) });
  out.push({
    path: "README.md",
    data: enc(
      README(
        new Date(now).toISOString().slice(0, 10),
        types
          .filter((t) => !t.system)
          .map((t) => ({ key: t.key, name: t.name, n: lists.get(t.id)?.length ?? 0 })),
        !!o.log,
      ),
    ),
  });
  return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** The operation log as NDJSON, one line per operation, oldest first, a page at a time. */
function* logChunks(store: UserStore): Generator<Buffer> {
  for (let after = 0; ; ) {
    const page = store.logPage(after, 200);
    if (!page.length) return;
    yield enc(page.map((r) => `${JSON.stringify(r)}\n`).join(""));
    after = (page[page.length - 1] as { seq: number }).seq;
  }
}

export const exportZip = (store: UserStore, o: ExportOptions = {}): Buffer =>
  writeZip(exportFiles(store, o), o.now ?? Date.now());

/** The export as chunks (`zipChunks`): what the server sends and the CLI writes, never whole in memory. */
export const exportChunks = (store: UserStore, o: ExportOptions = {}): Generator<Buffer> =>
  zipChunks(exportFiles(store, o), o.now ?? Date.now());
