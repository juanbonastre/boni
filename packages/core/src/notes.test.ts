import { describe, expect, it } from "vitest";
import { formatNote, NoteError, parseNote, patchDefinitionReminders, patchNote } from "./index.ts";

// Invented notes shaped like the ones Full Calendar writes.
const timed = `---
title: "Clase de ejemplo 3"
date: "2026-12-22"
startTime: "09:30"
endTime: "10:30"
timezone: "Europe/Madrid"
location: "Aula 8"
project: "[[proyecto-ejemplo]]"
notion_project: ["Proyecto de ejemplo"]
notion_id: "00000000-0000-0000-0000-000000000000"
---
Area: [[docencia]]

## Notas
`;

const task = `---
title: "Llamar al banco"
date: "2026-11-02"
# kept as it is
allDay: true
completed:
estimate_h: 0.5
---
Area: [[gestiones]]
`;

describe("parseNote", () => {
  it("reads scalars, lists and the body", () => {
    const n = parseNote(timed);
    expect(n.hasFrontmatter).toBe(true);
    expect(n.error).toBeUndefined();
    expect(n.values).toMatchObject({
      title: "Clase de ejemplo 3",
      date: "2026-12-22",
      startTime: "09:30",
      project: "[[proyecto-ejemplo]]",
      notion_project: ["Proyecto de ejemplo"],
    });
    expect(n.body).toBe("Area: [[docencia]]\n\n## Notas\n");
  });

  it("reads empty values as null, booleans and numbers as such", () => {
    const n = parseNote(task);
    expect(n.values.completed).toBeNull();
    expect(n.values.allDay).toBe(true);
    expect(n.values.estimate_h).toBe(0.5);
  });

  it("handles notes without properties, with empty ones and with broken ones", () => {
    expect(parseNote("just text\n")).toEqual({
      values: {},
      body: "just text\n",
      hasFrontmatter: false,
    });
    expect(parseNote("---\n---\nbody")).toEqual({ values: {}, body: "body", hasFrontmatter: true });
    const bad = parseNote("---\ntitle: [unclosed\n---\nbody");
    expect(bad.error).toBeTruthy();
    expect(bad.body).toBe("body");
  });

  it("leaves nested maps out of the values", () => {
    const n = parseNote('---\ntitle: "X"\nmeta:\n  a: 1\n---\n');
    expect(n.values).toEqual({ title: "X" });
  });

  it("reads CRLF notes", () => {
    const n = parseNote('---\r\ntitle: "X"\r\n---\r\nbody\r\n');
    expect(n.values.title).toBe("X");
    expect(n.body).toBe("body\r\n");
  });
});

describe("patchNote", () => {
  it("returns the very same text when nothing changes", () => {
    expect(patchNote(timed, {})).toBe(timed);
    expect(patchNote(timed, { date: "2026-12-22", startTime: "09:30" })).toBe(timed);
    expect(patchNote(task, { completed: null })).toBe(task);
  });

  it("changes only the lines that changed", () => {
    const out = patchNote(timed, { date: "2026-12-23", startTime: "10:00", endTime: "11:00" });
    const before = timed.split("\n");
    const after = out.split("\n");
    expect(after).toHaveLength(before.length);
    const changed = after.filter((l, i) => l !== before[i]);
    expect(changed).toEqual(['date: "2026-12-23"', 'startTime: "10:00"', 'endTime: "11:00"']);
  });

  it("keeps comments, unknown keys, empty values and the body", () => {
    const out = patchNote(task, { completed: true });
    expect(out).toContain("# kept as it is");
    expect(out).toContain("completed: true");
    expect(out).toContain("estimate_h: 0.5");
    expect(out.endsWith("Area: [[gestiones]]\n")).toBe(true);
    expect(patchNote(out, { completed: null })).toBe(task);
  });

  it("adds keys at the end, quotes new strings and writes lists in flow style", () => {
    const out = patchNote(timed, { endDate: "2026-12-23", people: ["Ana", "Leo"], series: "s-1" });
    const lines = out.split("\n");
    const at = lines.indexOf('endDate: "2026-12-23"');
    expect(lines.slice(at, at + 3)).toEqual([
      'endDate: "2026-12-23"',
      'people: ["Ana", "Leo"]',
      'series: "s-1"',
    ]);
    expect(parseNote(out).values.people).toEqual(["Ana", "Leo"]);
  });

  it("removes a key with undefined and clears one with null", () => {
    expect(patchNote(timed, { location: undefined })).not.toContain("location");
    const cleared = patchNote(timed, { location: null });
    expect(cleared).toContain("\nlocation:\n");
    expect(parseNote(cleared).values.location).toBeNull();
  });

  it("quotes values that YAML would read as something else", () => {
    const out = patchNote(timed, { startTime: "09:05", note: "true", other: "[[x]]" });
    expect(out).toContain('startTime: "09:05"');
    expect(out).toContain('note: "true"');
    expect(parseNote(out).values).toMatchObject({
      startTime: "09:05",
      note: "true",
      other: "[[x]]",
    });
  });

  it("replaces the body and creates properties for a note that had none", () => {
    expect(patchNote(timed, {}, { body: "nuevo\n" }).endsWith("---\nnuevo\n")).toBe(true);
    expect(patchNote("hello\n", { title: "X" })).toBe('---\ntitle: "X"\n---\nhello\n');
  });

  it("keeps CRLF line endings", () => {
    const crlf = '---\r\ntitle: "X"\r\n---\r\nbody\r\n';
    const out = patchNote(crlf, { title: "Y" });
    expect(out).toBe('---\r\ntitle: "Y"\r\n---\r\nbody\r\n');
  });

  it("refuses to touch a note whose properties are broken", () => {
    expect(() => patchNote("---\ntitle: [oops\n---\n", { title: "X" })).toThrow(NoteError);
  });

  it("does not fold long text", () => {
    const long = "palabra ".repeat(40).trim();
    const out = patchNote(timed, { description: long });
    expect(out).toContain(`description: "${long}"`);
  });
});

describe("formatNote", () => {
  it("writes properties in the given order, then the rest, then the body", () => {
    const text = formatNote(
      { completed: false, title: "Tarea", date: "2026-11-02", extra: 3 },
      "Area: [[gestiones]]\n",
      ["title", "date", "completed"],
    );
    expect(text).toBe(
      '---\ntitle: "Tarea"\ndate: "2026-11-02"\ncompleted: false\nextra: 3\n---\nArea: [[gestiones]]\n',
    );
    expect(parseNote(text).values).toEqual({
      title: "Tarea",
      date: "2026-11-02",
      completed: false,
      extra: 3,
    });
  });

  it("makes a note with only a body", () => {
    expect(formatNote({}, "hola\n")).toBe("---\n---\nhola\n");
  });
});

describe("patchDefinitionReminders", () => {
  const def = `---
type: wiki
# a comment that stays
collection:
  id: docencia
  name: Docencia
  columns:
    - { id: title, name: Título, type: text }
    - { id: date, name: Fecha, type: date }
  mapping:
    title: title
    when: { kind: split, date: date }
---
Cuerpo.
`;
  it("sets and removes a calendar's reminders, touching only those lines", () => {
    const on = patchDefinitionReminders(def, { reminders: { timed: "10m", allDay: "none" } });
    expect(on).toBe(
      def.replace(
        "    when: { kind: split, date: date }\n",
        "    when: { kind: split, date: date }\n  reminders: { timed: 10m, allDay: none }\n",
      ),
    );
    expect(patchDefinitionReminders(on, { reminders: null })).toBe(def);
    expect(patchDefinitionReminders(def, { reminders: null })).toBe(def);
  });
  it("adds the column for an event's own reminders once", () => {
    const col = { id: "avisos", name: "Avisos" };
    const once = patchDefinitionReminders(def, { eventColumn: col });
    expect(once).toContain("    - { id: avisos, name: Avisos, type: text }\n");
    expect(once).toContain("    reminders: avisos\n");
    expect(once).toContain("# a comment that stays");
    expect(patchDefinitionReminders(once, { eventColumn: col })).toBe(once);
  });
  it("refuses a note that is not a definition", () => {
    expect(() => patchDefinitionReminders("---\ntitle: x\n---\n", { reminders: null })).toThrow();
  });
});
