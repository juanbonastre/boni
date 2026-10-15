import { describe, expect, it } from "vitest";
import {
  type CollectionDef,
  defsToModel,
  frontmatterData,
  makeModel,
  makeProjector,
  noteFileName,
  noteToRow,
  parseCollectionDef,
  parseNote,
  uniqueNotePath,
  unplaceableRows,
  validateModel,
  withAreaLine,
} from "./index.ts";

// A definition note as it would sit in the vault (all data invented).
const definitionNote = `---
type: wiki
summary: Definition of the "Docencia" calendar collection.
collection:
  id: docencia
  name: Docencia
  folder: agenda/docencia
  account: Agenda
  color: "#60a5fa"
  tz: Europe/Madrid
  columns:
    - { id: title, name: Título, type: text }
    - { id: date, name: Fecha, type: date }
    - { id: startTime, name: Hora de inicio, type: time }
    - { id: endTime, name: Hora de fin, type: time }
    - { id: endDate, name: Fecha de fin, type: date }
    - { id: allDay, name: Todo el día, type: checkbox }
    - { id: timezone, name: Zona horaria, type: text }
    - { id: completed, name: Hecha, type: checkbox }
    - { id: location, name: Lugar, type: text }
    - { id: estimate_h, name: Estimación (h), type: number }
  mapping:
    title: title
    location: location
    when: { kind: split, date: date, startTime: startTime, endTime: endTime, endDate: endDate, allDay: allDay, timezone: timezone }
    task: { column: completed }
  newNote:
    name: "{date} {title}"
    body: "Area: [[docencia]]\\n\\n## Notas\\n"
---
Notes live in agenda/docencia.
`;

function load(text = definitionNote): CollectionDef {
  const fm = frontmatterData(text);
  if ("error" in fm) throw new Error(fm.error);
  const r = parseCollectionDef(fm.data.collection);
  if (!r.ok) throw new Error(r.errors.join("; "));
  return r.def;
}

describe("collection definitions", () => {
  it("are read from the properties of a note, nested maps included", () => {
    const def = load();
    expect(def).toMatchObject({
      id: "docencia",
      folder: "agenda/docencia",
      account: "Agenda",
      color: "#60a5fa",
      tz: "Europe/Madrid",
      newNote: { name: "{date} {title}", body: "Area: [[docencia]]\n\n## Notas\n" },
    });
    expect(def.columns).toHaveLength(10);
    expect(def.mapping.when).toMatchObject({ kind: "split", date: "date", endDate: "endDate" });
    expect(def.mapping.task).toEqual({ column: "completed" });
    // The flat reader leaves the nested map out; the definition reader sees it.
    expect(parseNote(definitionNote).values.collection).toBeUndefined();
  });

  it("explain what is wrong instead of failing silently", () => {
    const bad = (patch: object) => {
      const fm = frontmatterData(definitionNote);
      if ("error" in fm) throw new Error("fixture");
      const base = fm.data.collection as Record<string, unknown>;
      return parseCollectionDef({ ...base, ...patch });
    };
    expect(bad({ id: "Docencia" })).toMatchObject({ ok: false });
    expect(bad({ color: "blue" })).toMatchObject({ ok: false });
    expect(bad({ folder: "../private" })).toMatchObject({ ok: false });
    expect(bad({ columns: [{ id: "title", name: "T", type: "wat" }] })).toMatchObject({
      ok: false,
    });
    const missing = bad({ mapping: { title: "nope", when: { kind: "split", date: "date" } } });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.errors.join(" ")).toContain('column "nope" does not exist');
    expect(parseCollectionDef(null)).toMatchObject({ ok: false });
  });

  it("build collections, read-only calendar views and sidebar accounts", () => {
    const def = load();
    const m = defsToModel(
      [def, { ...def, id: "planes", name: "Planes", folder: "agenda/planes" }],
      {
        readOnly: true,
      },
    );
    expect(m.collections.map((c) => c.name)).toEqual(["Docencia", "Planes"]);
    expect(m.views.every((v) => v.readOnly === true)).toBe(true);
    expect(m.accounts).toEqual([{ id: "acc-agenda", name: "Agenda", email: "Agenda" }]);
    expect(validateModel(m.collections, m.views).filter((i) => i.severity === "error")).toEqual([]);
    expect(defsToModel([def], { readOnly: false }).views[0]?.readOnly).toBeUndefined();
  });
});

describe("notes as rows", () => {
  const def = load();
  const m = defsToModel([def], { readOnly: false });
  const model = makeModel(m.collections, m.views, { defaultTz: "Europe/Madrid" });

  const row = (path: string, text: string) =>
    noteToRow(def, path, parseNote(text), 1_700_000_000_000);

  it("keep every property and become events through the mapping", () => {
    const r = row(
      "agenda/docencia/2026-12-22 Clase de ejemplo.md",
      '---\ntitle: "Clase de ejemplo"\ndate: "2026-12-22"\nstartTime: "09:30"\nendTime: "10:30"\ntimezone: "Europe/Madrid"\nnotion_id: "abc"\ncompleted:\n---\nArea: [[docencia]]\n',
    );
    expect(r.id).toBe("agenda/docencia/2026-12-22 Clase de ejemplo.md");
    expect(r.values.notion_id).toBe("abc");
    const ev = makeProjector(model).event(r);
    expect(ev?.title).toBe("Clase de ejemplo");
    expect(ev?.isTask).toBe(false);
    expect(ev?.props).toEqual({});
    expect(ev?.when.kind).toBe("timed");
  });

  it("read tasks and all-day notes the way the vault writes them", () => {
    const task = makeProjector(model).event(
      row(
        "agenda/docencia/t.md",
        '---\ntitle: "Entregar"\ndate: "2026-11-02"\nallDay: true\ncompleted: false\nestimate_h: 1.5\n---\n',
      ),
    );
    expect(task).toMatchObject({ isTask: true, done: false, props: { estimate_h: 1.5 } });
    expect(task?.when.kind).toBe("allday");
  });

  it("list the notes that have no usable date", () => {
    const rows = [
      row("agenda/docencia/a.md", '---\ntitle: "Con fecha"\ndate: "2026-12-22"\n---\n'),
      row("agenda/docencia/b.md", '---\ntitle: "Sin fecha"\n---\n'),
      row("agenda/docencia/c.md", '---\ntitle: "Fecha rota"\ndate: "pronto"\n---\n'),
    ];
    expect(unplaceableRows(model, rows)).toEqual([
      { id: "agenda/docencia/b.md", reason: "no-date" },
      { id: "agenda/docencia/c.md", reason: "no-date" },
    ]);
  });
});

describe("names of new notes", () => {
  const def = load();

  it("expand the pattern with the row's values and clean what files do not allow", () => {
    expect(noteFileName(def, { date: "2026-12-22", title: "Clase de ejemplo" })).toBe(
      "2026-12-22 Clase de ejemplo",
    );
    expect(noteFileName(def, { date: "2026-12-22", title: 'A/B: "C"? [x] #1' })).toBe(
      "2026-12-22 A-B- -C-- x 1",
    );
    expect(noteFileName(def, { date: "2026-12-22", title: "  mucho   espacio.  " })).toBe(
      "2026-12-22 mucho espacio",
    );
    expect(
      noteFileName(def, { date: "2026-12-22", title: "x".repeat(300) }).length,
    ).toBeLessThanOrEqual(120);
    expect(noteFileName({ ...def, newNote: undefined }, { title: "Solo título" })).toBe(
      "Solo título",
    );
  });

  it("get a counter on the file name when the name is taken", () => {
    const taken = new Set([
      "agenda/docencia/2026-12-22 Clase.md",
      "agenda/docencia/2026-12-22 Clase 2.md",
    ]);
    expect(uniqueNotePath("agenda/docencia", "2026-12-22 Clase", (p) => taken.has(p))).toBe(
      "agenda/docencia/2026-12-22 Clase 3.md",
    );
    expect(uniqueNotePath("agenda/docencia", "2026-12-23 Otra", (p) => taken.has(p))).toBe(
      "agenda/docencia/2026-12-23 Otra.md",
    );
    expect(uniqueNotePath("agenda/docencia", "", () => false)).toBe(
      "agenda/docencia/Sin título.md",
    );
  });

  it("switch the Area line when a note moves to another collection", () => {
    expect(
      withAreaLine("Area: [[docencia]]\n\n## Notas\nTexto\n", "Area: [[planes]]\n\n## Notas\n"),
    ).toBe("Area: [[planes]]\n\n## Notas\nTexto\n");
    expect(withAreaLine("Sin línea de área\n", "Area: [[planes]]\n")).toBe("Sin línea de área\n");
    expect(withAreaLine("Area: [[docencia]]\n", "Sin área\n")).toBe("Area: [[docencia]]\n");
  });
});
