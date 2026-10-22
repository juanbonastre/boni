import { type CalEvent, eventToRow, makeModel, makeProjector, type Row } from "@boni/calendar";
import { makeVaultProvider } from "@boni/calendar-web/src/vault/provider.ts";
import { aliases, readVault, resetVaultIndex } from "@boni/calendar-web/src/vault/sync.ts";
import { definitionNote } from "@boni/calendar-web/src/vault/testing.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { obsidianBridge } from "./bridge.ts";
import { fakeObsidian } from "./fakeObsidian.ts";

const LESSON = "agenda/docencia/2026-12-22 Clase de ejemplo.md";
const lesson = `---
title: "Clase de ejemplo"
date: "2026-12-22"
startTime: "09:30"
endTime: "10:30"
timezone: "Europe/Madrid"
location: "Aula 8"
completed:
---
Area: [[docencia]]

## Notas
`;

const FILES = {
  "_system/colecciones/docencia.md": definitionNote(
    "docencia",
    "Docencia",
    "agenda/docencia",
    "docencia",
  ),
  "_system/colecciones/planes.md": definitionNote("planes", "Planes", "agenda/planes", "planes"),
  [LESSON]: lesson,
  "agenda/docencia/2026/2026-12-23 Tutoría.md": '---\ntitle: "Tutoría"\ndate: "2026-12-23"\n---\n',
  "agenda/docencia/imagen.png": "not a note",
  "agenda/docencia/.borrador/oculta.md": "---\ntitle: x\n---\n",
  "agenda/planes/2026-12-24 Cena.md": '---\ntitle: "Cena"\ndate: "2026-12-24"\n---\n',
  "private/diario.md": "never read",
};

function setup(files: Record<string, string> = FILES) {
  const fake = fakeObsidian(files);
  const cache = { saved: null as string | null };
  const bridge = obsidianBridge(fake.app, {
    delayMs: 300,
    cache: {
      read: async () => cache.saved,
      write: async (t) => {
        cache.saved = t;
      },
    },
  });
  return { fake, bridge, cache };
}

const value = <T>(r: { ok: true; value: T } | { ok: false; code: string }): T => {
  if (!r.ok) throw new Error(`failed: ${r.code}`);
  return r.value;
};

describe("the Obsidian bridge", () => {
  it("lists the notes below a folder, like the desktop shell (no dot folders, no other files)", async () => {
    const { bridge } = setup();
    const notes = value(await bridge.scan("agenda/docencia"));
    expect(notes.map((n) => n.path).sort()).toEqual([
      "agenda/docencia/2026-12-22 Clase de ejemplo.md",
      "agenda/docencia/2026/2026-12-23 Tutoría.md",
    ]);
    expect(notes[0]?.mtimeMs).toBeGreaterThan(0);
    expect(notes[0]?.size).toBe(new TextEncoder().encode(lesson).length);
    expect(await bridge.scan("agenda/nada")).toMatchObject({ ok: false, code: "not-found" });
  });

  it("never reaches the reserved zones or outside the notes", async () => {
    const { bridge } = setup();
    expect(await bridge.scan("private")).toMatchObject({ ok: false, code: "denied" });
    expect(await bridge.read("private/diario.md")).toMatchObject({ ok: false, code: "denied" });
    expect(await bridge.read("restricted/x.md")).toMatchObject({ ok: false, code: "denied" });
    expect(await bridge.read("../fuera.md")).toMatchObject({ ok: false, code: "bad-path" });
    expect(await bridge.read(".obsidian/app.md")).toMatchObject({ ok: false, code: "bad-path" });
    expect(await bridge.read("agenda/docencia/imagen.png")).toMatchObject({
      ok: false,
      code: "bad-path",
    });
    expect(await bridge.create("private/nueva.md", "x")).toMatchObject({ ok: false });
    expect(await bridge.rename(LESSON, "restricted/x.md")).toMatchObject({ ok: false });
  });

  it("writes a note only when it did not change since it was read", async () => {
    const { bridge, fake } = setup();
    const read = value(await bridge.read(LESSON));
    expect(read.text).toBe(lesson);
    const w = value(await bridge.write(LESSON, `${lesson}Uno\n`, read.mtimeMs));
    expect(w.conflict).toBe(false);
    expect(w.mtimeMs).toBeGreaterThan(read.mtimeMs);
    expect(fake.text.get(LESSON)).toBe(`${lesson}Uno\n`);

    fake.editOutside(LESSON, `${lesson}Desde Obsidian\n`);
    const stale = value(await bridge.write(LESSON, `${lesson}Dos\n`, w.mtimeMs));
    expect(stale.conflict).toBe(true);
    expect(fake.text.get(LESSON)).toBe(`${lesson}Desde Obsidian\n`);
    expect(await bridge.write("agenda/docencia/no.md", "x", null)).toMatchObject({
      ok: false,
      code: "not-found",
    });
  });

  it("creates notes (and their folders) without ever replacing one", async () => {
    const { bridge, fake } = setup();
    expect(value(await bridge.create(LESSON, "otra"))).toEqual({ exists: true });
    expect(fake.text.get(LESSON)).toBe(lesson);
    const made = value(await bridge.create("agenda/salud/2027/2027-01-02 Revisión.md", "hola"));
    expect(made).toMatchObject({ exists: false, size: 4 });
    expect(fake.text.get("agenda/salud/2027/2027-01-02 Revisión.md")).toBe("hola");
  });

  it("moves notes with Obsidian's file manager (links follow) and never over another note", async () => {
    const { bridge, fake } = setup();
    const target = "agenda/planes/2026-12-22 Clase de ejemplo.md";
    expect(value(await bridge.rename(LESSON, "agenda/planes/2026-12-24 Cena.md"))).toEqual({
      exists: true,
    });
    expect(value(await bridge.rename(LESSON, target))).toMatchObject({ exists: false });
    expect(fake.log.renamed).toEqual([[LESSON, target]]);
    expect(fake.text.get(target)).toBe(lesson);
    // into a folder that does not exist yet
    value(await bridge.rename(target, "agenda/nueva/2026-12-22 Clase de ejemplo.md"));
    expect(fake.text.has("agenda/nueva/2026-12-22 Clase de ejemplo.md")).toBe(true);
  });

  it("sends notes to the trash through Obsidian (its setting decides where)", async () => {
    const { bridge, fake } = setup();
    value(await bridge.trash(LESSON));
    expect(fake.log.trashed).toEqual([LESSON]);
    expect(fake.text.has(LESSON)).toBe(false);
    expect(await bridge.trash(LESSON)).toMatchObject({ ok: false, code: "not-found" });
  });

  it("opens a note in a tab, or brings forward the tab that already shows it", async () => {
    const { bridge, fake } = setup();
    value(await bridge.openNote(LESSON));
    value(await bridge.openNote(LESSON));
    expect(fake.log.opened).toEqual([LESSON]);
    expect(fake.log.revealed).toEqual([LESSON]);
  });

  it("keeps the index where the host says, never in the vault", async () => {
    const { bridge, cache, fake } = setup();
    expect(value(await bridge.cacheRead())).toBeNull();
    value(await bridge.cacheWrite("{}"));
    expect(cache.saved).toBe("{}");
    expect([...fake.text.keys()].some((p) => p.includes("index"))).toBe(false);
  });
});

describe("changes made in Obsidian", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("are announced once per burst, only for notes of the watched folders", async () => {
    const { bridge, fake } = setup();
    const seen = vi.fn();
    const off = bridge.onChanged(seen);
    value(await bridge.watch(["agenda/docencia", "_system/colecciones"]));

    fake.editOutside(LESSON, "a");
    fake.editOutside(LESSON, "b");
    fake.createOutside("agenda/docencia/2026-12-30 Nueva.md", "c");
    vi.advanceTimersByTime(299);
    expect(seen).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(seen).toHaveBeenCalledTimes(1);

    // other folders, other files and dot folders do not count
    fake.editOutside("agenda/planes/2026-12-24 Cena.md", "x");
    fake.createOutside("agenda/docencia/foto.png", "x");
    fake.createOutside("agenda/docencia/.tmp/x.md", "x");
    vi.advanceTimersByTime(1000);
    expect(seen).toHaveBeenCalledTimes(1);

    // a note moved out of a watched folder counts (it left this calendar)
    await fake.app.fileManager.renameFile(
      fake.app.vault.getAbstractFileByPath(LESSON) as never,
      "agenda/planes/Clase.md",
    );
    vi.advanceTimersByTime(300);
    expect(seen).toHaveBeenCalledTimes(2);

    off();
    expect(fake.listenerCount()).toBe(0);
    fake.editOutside("agenda/docencia/2026/2026-12-23 Tutoría.md", "y");
    vi.advanceTimersByTime(1000);
    expect(seen).toHaveBeenCalledTimes(2);
  });

  it("stop being listened to when the plugin unloads", () => {
    const { bridge, fake } = setup();
    bridge.onChanged(() => {});
    expect(fake.listenerCount()).toBe(4);
    bridge.dispose();
    expect(fake.listenerCount()).toBe(0);
  });
});

describe("the calendar's write rules over the Obsidian bridge", () => {
  beforeEach(() => {
    resetVaultIndex();
    aliases.clear();
  });

  async function calendar() {
    const t = setup();
    const load = await readVault(t.bridge, { readOnly: false });
    const model = makeModel(load.snapshot.collections, load.snapshot.views, {
      defaultTz: "Europe/Madrid",
    });
    const projector = makeProjector(model);
    const provider = makeVaultProvider(t.bridge);
    const rowOf = (id: string) => load.snapshot.rows.find((r) => r.id === id) as Row;
    const edit = (id: string, patch: Partial<CalEvent>): Row => {
      const row = rowOf(id);
      return eventToRow(model, row, { ...(projector.event(row) as CalEvent), ...patch });
    };
    return { ...t, load, provider, rowOf, edit };
  }

  it("reads the definitions and the notes, and keeps the index with the host", async () => {
    const c = await calendar();
    expect(c.load.snapshot.collections.map((x) => x.id).sort()).toEqual(["docencia", "planes"]);
    expect(c.load.snapshot.rows.map((r) => r.id).sort()).toEqual([
      "agenda/docencia/2026-12-22 Clase de ejemplo.md",
      "agenda/docencia/2026/2026-12-23 Tutoría.md",
      "agenda/planes/2026-12-24 Cena.md",
    ]);
    expect(c.cache.saved).toContain(LESSON);
  });

  it("changes only the edited lines of a note", async () => {
    const c = await calendar();
    await c.provider.apply([{ op: "upsert", row: c.edit(LESSON, { location: "Aula 2" }) }]);
    expect(c.fake.text.get(LESSON)).toBe(lesson.replace('"Aula 8"', '"Aula 2"'));
  });

  it("does not overwrite a note edited in Obsidian since it was read", async () => {
    const c = await calendar();
    c.fake.editOutside(LESSON, lesson.replace("## Notas", "## Notas\nEscrito en Obsidian"));
    await expect(
      c.provider.apply([{ op: "upsert", row: c.edit(LESSON, { title: "Otra" }) }]),
    ).rejects.toMatchObject({ kind: "conflict" });
    expect(c.fake.text.get(LESSON)).toContain("Escrito en Obsidian");
    expect(c.fake.text.get(LESSON)).toContain('title: "Clase de ejemplo"');
  });

  it("moves a note to another calendar through the file manager, and trashes removed ones", async () => {
    const c = await calendar();
    await c.provider.apply([
      { op: "remove", collectionId: "docencia", id: LESSON },
      { op: "upsert", row: c.edit(LESSON, { calendarId: "planes" }) },
    ]);
    const target = "agenda/planes/2026-12-22 Clase de ejemplo.md";
    expect(c.fake.log.renamed).toEqual([[LESSON, target]]);
    expect(c.fake.text.get(target)).toContain("Area: [[planes]]");
    expect(c.fake.log.trashed).toEqual([]);

    await c.provider.apply([
      { op: "remove", collectionId: "planes", id: "agenda/planes/2026-12-24 Cena.md" },
    ]);
    expect(c.fake.log.trashed).toEqual(["agenda/planes/2026-12-24 Cena.md"]);
  });
});
