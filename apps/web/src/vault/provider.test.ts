import { type CalEvent, eventToRow, makeModel, makeProjector, type Row } from "@boni-calendar/core";
import { beforeEach, describe, expect, it } from "vitest";
import { makeVaultProvider, VaultWriteError } from "./provider.ts";
import { aliases, readVault, resetVaultIndex, vaultEntries } from "./sync.ts";
import { definitionNote, memoryVault } from "./testing.ts";

const LESSON = "agenda/docencia/2026-12-22 Clase de ejemplo.md";
const lesson = `---
title: "Clase de ejemplo"
date: "2026-12-22"
startTime: "09:30"
endTime: "10:30"
timezone: "Europe/Madrid"
location: "Aula 8"
notion_id: "00000000-0000-0000-0000-000000000000"
completed:
---
Area: [[docencia]]

## Notas
`;

async function setup() {
  const vault = memoryVault({
    "_system/colecciones/docencia.md": definitionNote(
      "docencia",
      "Docencia",
      "agenda/docencia",
      "docencia",
    ),
    "_system/colecciones/planes.md": definitionNote("planes", "Planes", "agenda/planes", "planes"),
    [LESSON]: lesson,
  });
  const load = await readVault(vault.bridge, { readOnly: false });
  const model = makeModel(load.snapshot.collections, load.snapshot.views, {
    defaultTz: "Europe/Madrid",
  });
  const projector = makeProjector(model);
  const provider = makeVaultProvider(vault.bridge);
  const rowOf = (id: string) => load.snapshot.rows.find((r) => r.id === id) as Row;
  const edit = (id: string, patch: Partial<CalEvent>): Row => {
    const row = rowOf(id);
    const ev = projector.event(row) as CalEvent;
    return eventToRow(model, row, { ...ev, ...patch });
  };
  return { vault, provider, model, projector, rowOf, edit };
}

beforeEach(() => {
  resetVaultIndex();
  aliases.clear();
});

describe("the vault provider", () => {
  it("changes only the edited lines of a note and keeps everything else", async () => {
    const t = await setup();
    const row = t.edit(LESSON, { title: "Clase cambiada", isTask: true });
    await t.provider.apply([{ op: "upsert", row }]);
    const after = t.vault.files.get(LESSON) as string;
    const before = lesson.split("\n");
    const lines = after.split("\n");
    expect(lines).toHaveLength(before.length);
    expect(lines.filter((l, i) => l !== before[i])).toEqual([
      'title: "Clase cambiada"',
      "completed: false",
    ]);
    expect(after).toContain('notion_id: "00000000-0000-0000-0000-000000000000"');
    expect(after.endsWith("Area: [[docencia]]\n\n## Notas\n")).toBe(true);
  });

  it("writes nothing when the row did not change, and remembers what it wrote", async () => {
    const t = await setup();
    const mtime = (await t.vault.bridge.read(LESSON)).ok ? t.vault.files.get(LESSON) : "";
    await t.provider.apply([{ op: "upsert", row: { ...t.rowOf(LESSON) } }]);
    expect(t.vault.files.get(LESSON)).toBe(mtime);
    const row = t.edit(LESSON, { title: "Otra" });
    await t.provider.apply([{ op: "upsert", row }]);
    const entry = vaultEntries().get(LESSON);
    expect(entry?.row).toBe(row);
    // the next scan sees the same stat the write left, so nothing is read again
    const scan = await t.vault.bridge.scan("agenda/docencia");
    expect(scan.ok && scan.value[0]?.mtimeMs).toBe(entry?.mtimeMs);
    expect(scan.ok && scan.value[0]?.size).toBe(entry?.size);
  });

  it("refuses to overwrite a note that changed outside the app", async () => {
    const t = await setup();
    t.vault.editOutside(LESSON, lesson.replace("Aula 8", "Aula 9"));
    const row = t.edit(LESSON, { title: "Mi cambio" });
    await expect(t.provider.apply([{ op: "upsert", row }])).rejects.toMatchObject({
      kind: "conflict",
    });
    expect(t.vault.files.get(LESSON)).toContain("Aula 9");
    expect(t.vault.files.get(LESSON)).not.toContain("Mi cambio");
  });

  it("creates a note for a new row once it has a title, named from the date and title", async () => {
    const t = await setup();
    const base = t.edit(LESSON, { title: "" });
    const draft: Row = {
      ...base,
      id: "ev-temp-1",
      values: { ...base.values, title: "", date: "2026-12-24" },
    };
    await t.provider.apply([{ op: "upsert", row: draft }]);
    expect([...t.vault.files.keys()].filter((p) => p.startsWith("agenda/"))).toEqual([LESSON]);

    const titled: Row = { ...draft, values: { ...draft.values, title: "Cena de Nochebuena" } };
    await t.provider.apply([{ op: "upsert", row: titled }]);
    const path = "agenda/docencia/2026-12-24 Cena de Nochebuena.md";
    expect(t.vault.files.get(path)).toBe(
      '---\ntitle: "Cena de Nochebuena"\ndate: "2026-12-24"\nstartTime: "09:30"\nendTime: "10:30"\ntimezone: "Europe/Madrid"\nlocation: "Aula 8"\nnotion_id: "00000000-0000-0000-0000-000000000000"\n---\nArea: [[docencia]]\n\n## Notas\n',
    );
    expect(aliases.get("ev-temp-1")).toBe(path);
    // a later edit of the same (still temporarily named) row goes to that note
    await t.provider.apply([
      { op: "upsert", row: { ...titled, values: { ...titled.values, location: "Casa" } } },
    ]);
    expect(t.vault.files.get(path)).toContain('location: "Casa"');
    expect([...t.vault.files.keys()].filter((p) => p.startsWith("agenda/"))).toHaveLength(2);
  });

  it("puts a counter on the file name, not on the title, when the name is taken", async () => {
    const t = await setup();
    const mk = (id: string): Row => {
      const base = t.rowOf(LESSON);
      return { ...base, id, values: { ...base.values, title: "Clase de ejemplo" } };
    };
    await t.provider.apply([{ op: "upsert", row: mk("ev-a") }]);
    await t.provider.apply([{ op: "upsert", row: mk("ev-b") }]);
    expect(t.vault.files.has(LESSON)).toBe(true);
    expect(t.vault.files.has("agenda/docencia/2026-12-22 Clase de ejemplo 2.md")).toBe(true);
    expect(t.vault.files.has("agenda/docencia/2026-12-22 Clase de ejemplo 3.md")).toBe(true);
    expect(t.vault.files.get("agenda/docencia/2026-12-22 Clase de ejemplo 3.md")).toContain(
      'title: "Clase de ejemplo"',
    );
  });

  it("sends a removed note to the trash and brings it back on undo", async () => {
    const t = await setup();
    const row = t.rowOf(LESSON);
    await t.provider.apply([{ op: "remove", collectionId: "docencia", id: LESSON }]);
    expect(t.vault.trashed).toEqual([LESSON]);
    expect(t.vault.files.has(LESSON)).toBe(false);
    expect(vaultEntries().has(LESSON)).toBe(false);
    await t.provider.apply([{ op: "upsert", row }]);
    expect(t.vault.files.get(LESSON)).toBe(lesson);
  });

  it("moves the file and its Area line when a row changes calendar, keeping the title and the rest", async () => {
    const t = await setup();
    const row = t.edit(LESSON, { calendarId: "planes" });
    await t.provider.apply([
      { op: "remove", collectionId: "docencia", id: LESSON },
      { op: "upsert", row },
    ]);
    const target = "agenda/planes/2026-12-22 Clase de ejemplo.md";
    expect(t.vault.files.has(LESSON)).toBe(false);
    expect(t.vault.trashed).toEqual([]);
    const text = t.vault.files.get(target) as string;
    expect(text).toContain("Area: [[planes]]");
    expect(text).not.toContain("Area: [[docencia]]");
    expect(text).toContain('notion_id: "00000000-0000-0000-0000-000000000000"');
    expect(aliases.get(LESSON)).toBe(target);
  });

  it("ignores rows that never became notes when they are removed", async () => {
    const t = await setup();
    await t.provider.apply([{ op: "remove", collectionId: "docencia", id: "ev-never-saved" }]);
    expect(t.vault.trashed).toEqual([]);
  });

  it("keeps two writes in order even when applied back to back", async () => {
    const t = await setup();
    const a = t.edit(LESSON, { title: "Primero" });
    const b: Row = { ...a, values: { ...a.values, title: "Segundo" } };
    await Promise.all([
      t.provider.apply([{ op: "upsert", row: a }]),
      t.provider.apply([{ op: "upsert", row: b }]),
    ]);
    expect(t.vault.files.get(LESSON)).toContain('title: "Segundo"');
  });

  it("exposes a typed error", () => {
    expect(new VaultWriteError("conflict", "x").kind).toBe("conflict");
  });
});
