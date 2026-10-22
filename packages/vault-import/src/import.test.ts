import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { BODY, openUserStore, type UserStore } from "@boni/store";
import { afterEach, describe, expect, it } from "vitest";
import { FILE_FIELD, importVault, keyOf, PATH_FIELD } from "./import.ts";
import { hasIdentityNumbers, withoutSecrets } from "./secrets.ts";

/** An invented vault with the shapes of the real one (conventions.md), never real notes. */
const DEF = `---
type: wiki
collection:
  id: docencia
  name: Docencia
  folder: agenda/docencia
  account: Agenda
  color: "#60a5fa"
  columns:
    - { id: title, name: Título, type: text }
    - { id: date, name: Fecha, type: date }
    - { id: startTime, name: Hora de inicio, type: time }
    - { id: endTime, name: Hora de fin, type: time }
    - { id: completed, name: Hecha, type: checkbox }
    - { id: estimate_h, name: Estimación (h), type: number }
  mapping:
    title: title
    when: { kind: split, date: date, startTime: startTime, endTime: endTime }
    task: { column: completed }
---
`;
const FILES: Record<string, string> = {
  "_system/colecciones/agenda-docencia.md": DEF,
  "_system/colecciones/README.md": "# no",
  "agenda/docencia/2026-10-19 Clase de ejemplo.md":
    '---\ntitle: "Clase de ejemplo"\ndate: "2026-10-19"\nstartTime: "10:00"\nendTime: "11:30"\ncompleted:\nproject: "[[curso-ejemplo]]"\n---\nArea: [[docencia]]\n\n## Notas\n',
  "agenda/docencia/2026-10-20 Tutoría.md":
    '---\ntitle: "Tutoría"\ndate: "2026-10-20"\ncompleted: false\nestimate_h: 1.5\n---\n',
  "registros/personas/ana-ejemplo.md":
    "---\ntype: person\nsummary: Invented colleague.\ntags: [ucam, profesor]\n---\n# Ana\n",
  "registros/personas/luis-ejemplo.md":
    "---\ntype: person\nsummary: Invented friend.\ntags: [amigo]\n---\n",
  "registros/finanzas/movimientos/2026/10/2026-10-19-cafe.md":
    '---\ntype: movement\ndate: "2026-10-19"\namount: -1.6\ncurrency: EUR\ncategory: bebida/cafe\npeople: ["[[ana-ejemplo]]", "[[luis-ejemplo]]"]\nstatus: pendiente\n---\n',
  "proyectos/curso-ejemplo.md":
    '---\ntype: project\nstatus: activo\narea: "[[docencia]]"\nparent: "[[programa-ejemplo]]"\n---\n',
  "proyectos/programa-ejemplo.md": "---\ntype: project\nstatus: activo\n---\n",
  "areas/docencia.md": "---\ntype: area\n---\nLo de la docencia.\n",
  "NotionImport/Management/Sueño 1.md":
    '---\nnotion-id: "abc"\n"Calidad (1-8)": 6\n"Sueño/s": 7.5\nFecha: "2026-01-02"\n---\n',
  "bandeja/con-secreto.md":
    "---\ntype: note\n---\nUna línea normal.\napi_key: sk-ant-abcdefghijklmnopqrstuvwxyz0123\nMi DNI de ejemplo es 12345678Z.\nOtra línea.\n",
  "bandeja/README.md": "---\ntype: index\n---\n",
  "bandeja/foto.png": "binario",
  "private/diario.md": "---\ntitle: MARCA-PRIVADA\n---\nNo se debe leer.\n",
  "restricted/medico.md": "---\ntitle: MARCA-RESTRINGIDA\n---\n",
  "algo/Private/otra.md": "---\ntitle: MARCA-ANIDADA\n---\n",
  ".obsidian/workspace.md": "MARCA-OBSIDIAN",
};

const dirs: string[] = [];
const stores: UserStore[] = [];
afterEach(() => {
  for (const s of stores.splice(0)) s.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function vault(files = FILES): string {
  const root = mkdtempSync(join(tmpdir(), "boni-vault-"));
  dirs.push(root);
  for (const [p, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, p)), { recursive: true });
    writeFileSync(join(root, p), text);
  }
  return root;
}
function store(): UserStore {
  const s = openUserStore(":memory:");
  stores.push(s);
  return s;
}

describe("importing the vault", () => {
  it("a dry run reports and writes nothing", () => {
    const s = store();
    const r = importVault(vault(), s);
    expect(r.applied).toBe(false);
    expect(r.types.map((t) => [t.id, t.notes]).sort()).toEqual([
      ["t_area", 1],
      ["t_docencia", 2],
      ["t_movimiento", 1],
      ["t_nota", 1],
      ["t_notion", 1],
      ["t_persona", 2],
      ["t_proyecto", 2],
    ]);
    expect(r.created).toBe(10);
    expect(r.skipped).toEqual({
      "folder index (README.md)": 1,
      "not a note (attachment or other file)": 1,
    });
    expect(Object.keys(s.schema().types)).toEqual([]);
    expect(s.version()).toBe(0);
  });

  it("keeps the journal from the AI by default, and never overrides Juan's choice", () => {
    const files = {
      ...FILES,
      "diario/reflexiones/2026-10-19.md": "---\ntype: journal\n---\nUn día inventado.\n",
    };
    const s = store();
    expect(importVault(vault(files), s).hiddenFromModels).toEqual(["t_diario"]);
    expect(s.aiAccess()).toEqual({});
    importVault(vault(files), s, { apply: true });
    expect(s.aiAccess()).toEqual({ t_diario: "restricted" });
    s.setAiAccess("t_diario", "visible", "portatil");
    importVault(vault(files), s, { apply: true });
    expect(s.aiAccess()).toEqual({ t_diario: "visible" });
  });

  it("never reads private/, restricted/ or dot folders, at any depth", () => {
    const s = store();
    importVault(vault(), s, { apply: true });
    const titles = Object.keys(s.schema().types).flatMap((t) =>
      s.list(t).map((e) => JSON.stringify(e.entity)),
    );
    for (const forbidden of [
      "MARCA-PRIVADA",
      "MARCA-RESTRINGIDA",
      "MARCA-ANIDADA",
      "MARCA-OBSIDIAN",
      "private/",
      "restricted/",
      ".obsidian",
    ])
      expect(titles.join("\n"), forbidden).not.toContain(forbidden);
  });

  it("makes typed fields, relations between notes and the right labels", () => {
    const s = store();
    importVault(vault(), s, { apply: true });
    const types = s.schema().types;
    const field = (t: string, key: string) => types[t]?.fields.find((f) => f.key === key);
    expect(field("t_docencia", "date")?.type).toBe("date");
    expect(field("t_docencia", "starttime")?.type).toBe("time");
    expect(field("t_docencia", "estimate-h")).toMatchObject({
      type: "number",
      name: "Estimación (h)",
    });
    expect(field("t_docencia", "project")).toMatchObject({
      type: "relation",
      relation: { target: "t_proyecto", many: false },
    });
    expect(field("t_movimiento", "people")).toMatchObject({
      type: "relation",
      relation: { target: "t_persona", many: true },
    });
    expect(field("t_proyecto", "parent")?.relation?.target).toBe("t_proyecto"); // a cycle of its own type
    expect(field("t_persona", "tags")?.type).toBe("multiselect");
    // Names Juan wrote are kept; keys are ASCII.
    expect(field("t_notion", "calidad-1-8")).toMatchObject({
      name: "Calidad (1-8)",
      type: "number",
    });
    expect(field("t_notion", "sueno-s")?.name).toBe("Sueño/s");

    const cafe = s.list("t_movimiento")[0];
    expect(cafe?.entity.values.f_amount).toBe(-1.6);
    expect(cafe?.labels.f_amount).toMatchObject({
      integrity: "imported",
      sensitivity: "sensitive",
    });
    expect(cafe?.labels.f_amount?.sources[0]?.id).toMatch(
      /^registros\/finanzas\/movimientos\/2026\/10\/2026-10-19-cafe\.md@/,
    );
    const people = s.list("t_persona");
    expect(people.every((p) => p.labels.f_title?.thirdParty)).toBe(true);
    expect([...((cafe?.entity.values.f_people ?? []) as string[])].sort()).toEqual(
      people.map((p) => p.entity.id).sort(),
    );
    const clase = s.list("t_docencia").find((e) => e.entity.values.f_title === "Clase de ejemplo");
    expect(clase?.entity.body).toContain("Area: [[docencia]]");
    expect(s.search("Tutoría")).toHaveLength(1);
  });

  it("leaves access secrets out and marks identity numbers sensitive", () => {
    const s = store();
    const r = importVault(vault(), s, { apply: true });
    expect(r.secrets).toEqual([
      { path: "bandeja/con-secreto.md", line: 5, kind: "Anthropic or OpenAI-style key" },
    ]);
    expect(r.identityNumbers).toBe(1);
    const note = s.list("t_nota")[0];
    expect(note?.entity.body).not.toContain("sk-ant-");
    expect(note?.entity.body).toContain("12345678Z"); // kept as it is (Juan, 2026-10-19)
    expect(note?.labels[BODY]?.sensitivity).toBe("sensitive");
  });

  it("imports again only what changed, and sends notes that are gone to the trash", () => {
    const s = store();
    const root = vault();
    importVault(root, s, { apply: true });
    const v = s.version();
    const again = importVault(root, s, { apply: true });
    expect(again).toMatchObject({ created: 0, updated: 0, unchanged: 10, removed: 0 });
    expect(s.version()).toBe(v); // nothing written

    writeFileSync(
      join(root, "agenda/docencia/2026-10-20 Tutoría.md"),
      '---\ntitle: "Tutoría movida"\ndate: "2026-10-21"\ncompleted: true\nestimate_h: 2\n---\n',
    );
    unlinkSync(join(root, "areas/docencia.md"));
    writeFileSync(join(root, "bandeja/nueva.md"), "---\ntype: note\ncolor: azul\n---\nNueva.\n");
    const third = importVault(root, s, { apply: true, run: "import-3" });
    expect(third).toMatchObject({ created: 1, updated: 1, removed: 1 });
    expect(
      s
        .list("t_docencia")
        .map((e) => e.entity.values.f_title)
        .sort(),
    ).toEqual(["Clase de ejemplo", "Tutoría movida"]);
    expect(s.list("t_area")).toEqual([]);
    expect(s.schema().types.t_nota?.fields.some((f) => f.key === "color")).toBe(true); // a new key, a new field

    // A type whose truth is Boni now (the mirror switched it): its notes are left alone, none to the trash.
    s.setSetting("mirror/core/t_docencia", "vault");
    unlinkSync(join(root, "agenda/docencia/2026-10-19 Clase de ejemplo.md"));
    const fourth = importVault(root, s, { apply: true, run: "import-4" });
    expect(fourth.removed).toBe(0);
    expect(fourth.skipped["kept in Boni (core)"]).toBe(1);
    expect(s.list("t_docencia")).toHaveLength(2);
    s.setSetting("mirror/core/t_docencia", null);

    // The whole import can be undone at once.
    s.undoRun("import-3", { actor: "user" });
    expect(s.list("t_area")).toHaveLength(1);
    expect(
      s
        .list("t_docencia")
        .map((e) => e.entity.values.f_title)
        .sort(),
    ).toEqual(["Clase de ejemplo", "Tutoría"]);
  });
});

describe("importing a zone (only Juan gives its folder)", () => {
  /** An invented `private/` folder: notes at its root, a folder with a note, a link and a PDF. */
  const ZONE: Record<string, string> = {
    "suelto.md": "---\ntitle: Nota suelta inventada\n---\nTexto.\n",
    "Documentos/seguro.md":
      '---\nvence: "2027-01-01"\nrelacionado: "[[suelto]]"\n---\nPóliza inventada.\npassword: hunter2-inventada-0123456789\n',
    "Documentos/poliza.pdf": "%PDF-1.7 inventado",
    "Documentos/README.md": "# índice",
    ".obsidian/x.json": "{}",
  };

  it("makes a type per folder, keeps attachments, and puts every type in the zone", () => {
    const s = store();
    const dry = importVault(vault(ZONE), s, { zone: "private" });
    expect(dry).toMatchObject({ applied: false, zone: "private", files: 1, created: 3 });
    expect(s.version()).toBe(0);

    const r = importVault(vault(ZONE), s, { zone: "private", apply: true });
    expect(r.types.map((t) => [t.id, t.name, t.notes]).sort()).toEqual([
      ["t_private_documentos", "Documentos", 2],
      ["t_private_root", "Privado", 1],
    ]);
    expect(r.skipped).toEqual({ "folder index (README.md)": 1 });
    expect(r.secrets).toHaveLength(1); // left out, as everywhere
    expect(s.zones()).toEqual({ t_private_documentos: "private", t_private_root: "private" });
    expect(s.aiAccess()).toEqual({ t_private_documentos: "private", t_private_root: "private" });
    expect(() => s.setAiAccess("t_private_root", "visible", "portatil")).toThrow(); // locked

    const docs = s.list("t_private_documentos");
    const pdf = docs.find((e) => e.entity.values[FILE_FIELD]);
    expect(pdf?.entity.values.f_title).toBe("poliza.pdf");
    expect(pdf?.entity.values[PATH_FIELD]).toBe("private/Documentos/poliza.pdf");
    const f = s.getFile(String(pdf?.entity.values[FILE_FIELD]));
    expect(f?.mime).toBe("application/pdf");
    expect(Buffer.from(f?.data ?? []).toString()).toBe("%PDF-1.7 inventado");
    expect(pdf?.labels[FILE_FIELD]?.sensitivity).toBe("sensitive");
    const seguro = docs.find((e) => e.entity.values.f_title === "seguro");
    const suelto = s.list("t_private_root")[0];
    expect(seguro?.entity.values.f_relacionado).toBe(suelto?.entity.id);
    expect(seguro?.entity.body).not.toContain("hunter2");
  });

  it("the vault's import and a zone's never touch each other's rows", () => {
    const s = store();
    const root = vault();
    const zone = vault(ZONE);
    importVault(root, s, { apply: true });
    importVault(zone, s, { zone: "private", apply: true });
    expect(importVault(root, s, { apply: true })).toMatchObject({ removed: 0, unchanged: 10 });
    expect(importVault(zone, s, { zone: "private", apply: true })).toMatchObject({
      removed: 0,
      unchanged: 3,
    });
    // Another zone does not see this one's rows either; a file gone goes to the trash.
    expect(
      importVault(vault({ "a.md": "---\n---\n" }), s, { zone: "restricted", apply: true }),
    ).toMatchObject({ created: 1, removed: 0 });
    unlinkSync(join(zone, "Documentos/poliza.pdf"));
    expect(importVault(zone, s, { zone: "private", apply: true })).toMatchObject({ removed: 1 });
    expect(s.list("t_private_documentos")).toHaveLength(1);
    expect(s.zones().t_restricted_root).toBe("restricted");
  });
});

describe("secrets and keys", () => {
  it("finds access secrets by line and real identity numbers only", () => {
    const r = withoutSecrets(
      "a\npassword: hunter2-ejemplo-9\nb\nghp_abcdefghijklmnopqrstuvwxyz0123456789\nc\n[audio](https://s3.example/x.opus?X-Amz-Signature=abcdef0123456789)",
    );
    expect(r.text).toBe("a\nb\nc");
    expect(r.found.map((f) => f.line)).toEqual([2, 4, 6]);
    // Prose about secrets is not a secret (both seen in a real vault).
    for (const prose of [
      "La contraseña es la de siempre",
      "(edit token: everything except AGENTS.md)",
      "- Rotate the app password: new one in the console",
    ])
      expect(withoutSecrets(prose).found, prose).toEqual([]);
    expect(hasIdentityNumbers("DNI 12345678Z")).toBe(true);
    expect(hasIdentityNumbers("pedido 12345678A")).toBe(false); // wrong letter: not a DNI
    expect(hasIdentityNumbers("tarjeta 4111 1111 1111 1111")).toBe(true);
    expect(hasIdentityNumbers("teléfono 600 000 000")).toBe(false);
    expect(keyOf("Created time")).toBe("created-time");
    expect(keyOf("2024 resumen")).toBe("p-2024-resumen");
  });
});
