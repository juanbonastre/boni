import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Row } from "@boni/calendar";
import { openUserStore, type UserStore } from "@boni/store";
import { importVault } from "@boni/vault-import";
import { afterEach, describe, expect, it } from "vitest";
import { calendarDefs, StoreCalendar, saveCalendarDefs } from "./calendarStore.ts";

/** An invented vault (never real notes): one calendar and its definition, as `_system/colecciones/` has it. */
const RAW = {
  id: "docencia",
  name: "Docencia",
  folder: "agenda/docencia",
  account: "Agenda",
  color: "#60a5fa",
  columns: [
    { id: "title", name: "Título", type: "text" },
    { id: "date", name: "Fecha", type: "date" },
    { id: "startTime", name: "Hora de inicio", type: "time" },
    { id: "endTime", name: "Hora de fin", type: "time" },
    { id: "completed", name: "Hecha", type: "checkbox" },
  ],
  mapping: {
    title: "title",
    when: { kind: "split", date: "date", startTime: "startTime", endTime: "endTime" },
    task: { column: "completed" },
  },
};
const DEF = `---\ntype: wiki\ncollection:\n  id: docencia\n  name: Docencia\n  folder: agenda/docencia\n  account: Agenda\n  color: "#60a5fa"\n  columns:\n    - { id: title, name: Título, type: text }\n    - { id: date, name: Fecha, type: date }\n    - { id: startTime, name: Hora de inicio, type: time }\n    - { id: endTime, name: Hora de fin, type: time }\n    - { id: completed, name: Hecha, type: checkbox }\n  mapping:\n    title: title\n    when: { kind: split, date: date, startTime: startTime, endTime: endTime }\n    task: { column: completed }\n---\n`;
const CLASS = "agenda/docencia/2026-10-22 Clase de ejemplo.md";
const VAULT: Record<string, string> = {
  "_system/colecciones/agenda-docencia.md": DEF,
  [CLASS]:
    '---\ntitle: "Clase de ejemplo"\ndate: "2026-10-22"\nstartTime: "10:00"\nendTime: "11:30"\ncompleted: false\nproject: "[[curso-ejemplo]]"\n---\nPreparar el tema 3.\n',
  "agenda/docencia/2026-10-23 Tutoría.md":
    '---\ntitle: "Tutoría"\ndate: "2026-10-23"\ncompleted: false\n---\n',
  "proyectos/curso-ejemplo.md": "---\ntype: project\nstatus: activo\n---\n",
};

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
});
function env(): { store: UserStore; cal: StoreCalendar } {
  const root = mkdtempSync(join(tmpdir(), "boni-cal-"));
  for (const [p, t] of Object.entries(VAULT)) {
    mkdirSync(dirname(join(root, p)), { recursive: true });
    writeFileSync(join(root, p), t);
  }
  const store = openUserStore(":memory:");
  importVault(root, store, { apply: true });
  saveCalendarDefs(store, [{ type: "t_docencia", raw: RAW }]);
  const cal = new StoreCalendar(store, { write: true, pollMs: 60_000 });
  cleanups.push(() => {
    cal.close();
    store.close();
    rmSync(root, { recursive: true, force: true });
  });
  return { store, cal };
}
const rowOf = async (cal: StoreCalendar, id: string) =>
  (await cal.snapshot()).rows.find((r) => r.id === id) as Row;

describe("the calendar over Boni's collections", () => {
  it("serves the rows as the apps know them: the note's path as id, values by property", async () => {
    const { store, cal } = env();
    expect(calendarDefs(store).map((p) => p.def.id)).toEqual(["docencia"]);
    const snap = await cal.snapshot();
    expect(snap.collections.map((c) => c.id)).toEqual(["docencia"]);
    expect(snap.views[0]).toMatchObject({ id: "docencia", color: "#60a5fa" });
    const row = await rowOf(cal, CLASS);
    expect(row).toMatchObject({
      collectionId: "docencia",
      values: {
        title: "Clase de ejemplo",
        date: "2026-10-22",
        startTime: "10:00",
        endTime: "11:30",
        completed: false,
        project: "[[curso-ejemplo]]",
      },
      body: "Preparar el tema 3.\n",
    });
  });

  it("writes what a device changed, only that, with Juan's label; new and removed rows too", async () => {
    const { store, cal } = env();
    const snap = await cal.snapshot();
    const row = await rowOf(cal, CLASS);
    const moved: Row = { ...row, values: { ...row.values, startTime: "12:00", completed: true } };
    const r = await cal.apply(snap.version, [{ op: "upsert", row: moved }], "token-a", "portatil");
    expect(r.ok).toBe(true);
    const e = store.list("t_docencia").find((x) => x.entity.values.f_vault_path === CLASS);
    expect(e?.entity.values).toMatchObject({ f_starttime: "12:00", f_completed: true });
    expect(e?.labels.f_starttime).toMatchObject({ integrity: "user" });
    expect(e?.labels.f_title?.integrity).toBe("imported"); // untouched
    expect(e?.entity.values.f_project).toBeTruthy(); // the relation kept as it was

    const fresh: Row = {
      id: "ev-nuevo",
      collectionId: "docencia",
      values: { title: "Reunión inventada", date: "2026-10-24", startTime: "09:00", avisos: "1h" },
      created: 0,
      updated: 0,
    };
    const made = await cal.apply(
      r.ok ? r.version : 0,
      [{ op: "upsert", row: fresh }],
      "token-a",
      "portatil",
    );
    expect(made.ok && made.aliases["ev-nuevo"]).toMatch(/^e_/);
    const id = made.ok ? (made.aliases["ev-nuevo"] as string) : "";
    expect(store.get(id)?.entity.values.f_title).toBe("Reunión inventada");
    expect(store.schema().types.t_docencia?.fields.some((f) => f.name === "avisos")).toBe(true);
    expect((await rowOf(cal, id)).values.avisos).toBe("1h");

    const gone = await cal.apply(
      made.ok ? made.version : 0,
      [{ op: "remove", collectionId: "docencia", id }],
      "token-a",
      "portatil",
    );
    expect(gone.ok).toBe(true);
    expect(store.get(id)?.entity.deleted).toBeDefined();
    expect((await cal.snapshot()).rows.some((x) => x.id === id)).toBe(false);
  });

  it("sends only what changed since a version; a change by someone else after it is a conflict", async () => {
    const { store, cal } = env();
    const v0 = (await cal.snapshot()).version;
    // Boni's own page changes the class (another writer of the same store).
    const e = store.list("t_docencia").find((x) => x.entity.values.f_vault_path === CLASS);
    store.update(
      e?.entity.id as string,
      { f_title: { value: "Clase cambiada en Boni", label: e?.labels.f_title as never } },
      { actor: "user", device: "movil" },
    );
    const c = cal.changes(v0);
    expect(c.full).toBeUndefined();
    expect(c.upserts.map((r) => [r.id, r.values.title])).toEqual([
      [CLASS, "Clase cambiada en Boni"],
    ]);
    const row = await rowOf(cal, CLASS);
    const stale = await cal.apply(
      v0,
      [{ op: "upsert", row: { ...row, values: { ...row.values, title: "Otra" } } }],
      "token-a",
      "portatil",
    );
    expect(stale).toEqual({ ok: false, conflict: [CLASS] });
    // The same device's own change is not a conflict for it.
    const mine = await cal.apply(
      v0,
      [{ op: "upsert", row: { ...row, values: { ...row.values, title: "Otra" } } }],
      "token-b",
      "movil",
    );
    expect(mine.ok).toBe(true);
  });

  it("keeps reminders in the definition, in Boni", async () => {
    const { store, cal } = env();
    expect(
      await cal.setReminders("docencia", {
        reminders: { timed: "10m", allDay: "0d@09:00" },
        eventColumn: true,
      }),
    ).toBe("ok");
    const def = calendarDefs(store)[0]?.def;
    expect(def?.mapping.reminders).toBe("avisos");
    expect(def?.reminders?.timed).toEqual([{ kind: "before", minutes: 10 }]);
    expect((await cal.snapshot()).views[0]?.reminders).toBeDefined();
    expect(await cal.setReminders("nada", { reminders: null })).toBe("conflict");
  });
});
