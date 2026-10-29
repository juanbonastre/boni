import { leaf, rec } from "@boni/agent";
import type { Row } from "@boni/calendar";
import { label } from "@boni/entities";
import { openUserStore, type UserStore } from "@boni/store";
import { afterEach, describe, expect, it } from "vitest";
import { calendarDefs, StoreCalendar, saveCalendarDefs, taskDoneField } from "./calendarStore.ts";
import { acceptEdits } from "./proposalEdits.ts";
import { seed, type TypeSpec } from "./seed.test-util.ts";

/** Invented notes (never real ones): one calendar and its definition, as `_system/colecciones/` had it. */
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
const CLASS = "agenda/docencia/2026-10-22 Clase de ejemplo.md";
const NOTES: Record<string, string> = {
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
/** Each calendar gives its new rows its area (`newNote.properties`). */
const areaOf = (area: string) => ({
  name: "{title}",
  body: "",
  properties: { area: `[[${area}]]` },
});
/** With `planes`: a second calendar, to move events between them. */
const PLANES = { ...RAW, id: "planes", name: "Planes", folder: "agenda/planes" };
const PROJECT = { project: { type: "relation" as const, to: "proyecto" } };
function env(two = false): { store: UserStore; cal: StoreCalendar } {
  const types: TypeSpec[] = [
    { key: "proyecto", name: "Proyecto", folder: "proyectos/" },
    ...(two
      ? [
          { key: "area", name: "Área", folder: "areas/" },
          {
            key: "docencia",
            name: "Docencia",
            folder: "agenda/docencia/",
            fields: PROJECT,
            calendar: { ...RAW, newNote: areaOf("docencia") },
          },
          {
            key: "planes",
            name: "Planes",
            folder: "agenda/planes/",
            calendar: { ...PLANES, newNote: areaOf("planes") },
          },
        ]
      : [
          {
            key: "docencia",
            name: "Docencia",
            folder: "agenda/docencia/",
            fields: PROJECT,
            calendar: RAW,
          },
        ]),
  ];
  const notes: Record<string, string> = two
    ? {
        ...NOTES,
        "agenda/planes/2026-10-25 Cena.md": '---\ntitle: "Cena"\ndate: "2026-10-25"\n---\n',
        "areas/docencia.md": "---\ntype: area\n---\n# Docencia\n",
        "areas/planes.md": "---\ntype: area\n---\n# Planes\n",
      }
    : NOTES;
  const store = openUserStore(":memory:");
  seed(store, types, notes);
  const cal = new StoreCalendar(store, { write: true, pollMs: 60_000 });
  cleanups.push(() => {
    cal.close();
    store.close();
  });
  return { store, cal };
}
const rowOf = async (cal: StoreCalendar, id: string) =>
  (await cal.snapshot()).rows.find((r) => r.id === id) as Row;
/** The record an invented note became (rows are known by the record's id). */
const idAt = (store: UserStore, path: string) =>
  store.findByValue("f_vault_path", path)[0]?.id as string;

describe("the calendar over Boni's collections", () => {
  it("serves the rows as the apps know them: the record's id, values by property", async () => {
    const { store, cal } = env();
    expect(calendarDefs(store).map((p) => p.def.id)).toEqual(["docencia"]);
    const snap = await cal.snapshot();
    expect(snap.collections.map((c) => c.id)).toEqual(["docencia"]);
    expect(snap.views[0]).toMatchObject({ id: "docencia", color: "#60a5fa" });
    const row = await rowOf(cal, idAt(store, CLASS));
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
    const row = await rowOf(cal, idAt(store, CLASS));
    const moved: Row = { ...row, values: { ...row.values, startTime: "12:00", completed: true } };
    const r = await cal.apply(snap.version, [{ op: "upsert", row: moved }], "token-a", "portatil");
    expect(r.ok).toBe(true);
    const e = store.get(idAt(store, CLASS));
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
    // Its id is the record's (no path is made up for it).
    const id = made.ok ? (made.aliases["ev-nuevo"] as string) : "";
    const entityAt = (x: string) => store.get(x);
    expect(entityAt(id)?.entity.values.f_title).toBe("Reunión inventada");
    expect(entityAt(id)?.entity.values.f_vault_path).toBeUndefined();
    expect(store.schema().types.t_docencia?.fields.some((f) => f.name === "avisos")).toBe(true);
    expect((await rowOf(cal, id)).values.avisos).toBe("1h");

    const gone = await cal.apply(
      made.ok ? made.version : 0,
      [{ op: "remove", collectionId: "docencia", id }],
      "token-a",
      "portatil",
    );
    expect(gone.ok).toBe(true);
    expect(entityAt(id)?.entity.deleted).toBeDefined();
    expect((await cal.snapshot()).rows.some((x) => x.id === id)).toBe(false);
  });

  it("an event moved to another calendar is the same record in that collection, with its id and history (D-12)", async () => {
    const { store, cal } = env(true);
    const snap = await cal.snapshot();
    const entityId = idAt(store, CLASS);
    const row = await rowOf(cal, entityId);
    const r = await cal.apply(
      snap.version,
      [{ op: "upsert", row: { ...row, collectionId: "planes" } }],
      "token-a",
      "portatil",
    );
    // The same row, by the same id, in the other calendar.
    expect(r).toMatchObject({ ok: true, aliases: {} });
    const rows = (await cal.snapshot()).rows.filter((x) => x.values.title === "Clase de ejemplo");
    expect(rows.map((x) => [x.id, x.collectionId])).toEqual([[entityId, "planes"]]);
    expect(rows[0]).toMatchObject({
      values: { date: "2026-10-22", startTime: "10:00" },
      body: "Preparar el tema 3.\n",
    });
    expect(store.list("t_docencia").map((e) => e.entity.values.f_title)).toEqual(["Tutoría"]);
    // The same record: its id, nothing in the trash.
    expect(store.get(entityId)?.entity).toMatchObject({ type: "t_planes" });
    expect(store.get(entityId)?.entity.deleted).toBeUndefined();
    // Its project stays; its area becomes the new calendar's.
    const areaId = (p: string) =>
      store.list("t_area").find((e) => e.entity.values.f_vault_path === `areas/${p}.md`)?.entity.id;
    const e = store.list("t_planes").find((x) => x.entity.values.f_title === "Clase de ejemplo");
    expect(e?.entity.values.f_project).toBeTruthy();
    expect(e?.entity.values.f_area).toBe(areaId("planes"));
    // A new row gets its calendar's area.
    const fresh: Row = {
      id: "ev-nuevo",
      collectionId: "docencia",
      values: { title: "Reunión inventada", date: "2026-10-24" },
      created: 0,
      updated: 0,
    };
    const made = await cal.apply(
      r.ok ? r.version : 0,
      [{ op: "upsert", row: fresh }],
      "token-a",
      "portatil",
    );
    const id = made.ok ? (made.aliases["ev-nuevo"] as string) : "";
    expect(store.get(id)?.entity).toMatchObject({
      type: "t_docencia",
      values: { f_area: areaId("docencia") },
    });
  });

  it("a device's draft sent again before the server's copy came back keeps what the server added (the area)", async () => {
    const { store, cal } = env(true);
    const snap = await cal.snapshot();
    const draft: Row = {
      id: "ev-borrador",
      collectionId: "docencia",
      values: { title: "Borrador", date: "2026-10-26", startTime: "09:00" },
      created: 0,
      updated: 0,
    };
    const made = await cal.apply(snap.version, [{ op: "upsert", row: draft }], "t", "portatil");
    const id = made.ok ? (made.aliases["ev-borrador"] as string) : "";
    const area = () => store.get(id)?.entity.values.f_area;
    expect(area()).toBeTruthy();
    // The same draft, a moment later, without the area the server gave it.
    const again = await cal.apply(
      made.ok ? made.version : 0,
      [{ op: "upsert", row: { ...draft, id, values: { ...draft.values, startTime: "10:00" } } }],
      "t",
      "portatil",
    );
    expect(again.ok).toBe(true);
    expect((await rowOf(cal, id)).values.startTime).toBe("10:00");
    expect(area()).toBeTruthy();
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
      [e?.entity.id, "Clase cambiada en Boni"],
    ]);
    const row = await rowOf(cal, e?.entity.id as string);
    const stale = await cal.apply(
      v0,
      [{ op: "upsert", row: { ...row, values: { ...row.values, title: "Otra" } } }],
      "token-a",
      "portatil",
    );
    expect(stale).toEqual({ ok: false, conflict: [e?.entity.id] });
    // The same device's own change is not a conflict for it.
    const mine = await cal.apply(
      v0,
      [{ op: "upsert", row: { ...row, values: { ...row.values, title: "Otra" } } }],
      "token-b",
      "movil",
    );
    expect(mine.ok).toBe(true);
  });

  it("draws a pending proposal as a read-only row, never written, gone once decided", async () => {
    const { store, cal } = env();
    const v0 = (await cal.snapshot()).version;
    store.journal.startRun({
      id: "r1",
      turn: null,
      origin: "background",
      device: null,
      started: 1,
    });
    store.journal.addProposal({
      id: "p1",
      run: "r1",
      tool: "entities.create",
      args: { values: {}, origins: [] },
      view: {
        tool: "entities.create",
        title: "Crear",
        rows: [
          { arg: "type", role: "type", value: "docencia", detail: "Docencia" },
          { arg: "values.title", value: "Revisar actas inventadas" },
          { arg: "values.date", value: "2026-10-29" },
        ],
      },
      sources: ["mail:ejemplo@example.edu"],
      created: 2,
    });
    const c = cal.changes(v0);
    expect(c.upserts.map((r) => [r.id, r.collectionId, r.values.title, r.values.date])).toEqual([
      ["ghost:p1", "docencia", "Revisar actas inventadas", "2026-10-29"],
    ]);
    const before = store.list("t_docencia").length;
    const ghost = await rowOf(cal, "ghost:p1");
    // A device cannot change or remove it: it is decided in Boni.
    const v1 = (await cal.snapshot()).version;
    const r = await cal.apply(
      v1,
      [
        { op: "upsert", row: { ...ghost, values: { ...ghost.values, title: "Otra" } } },
        { op: "remove", collectionId: "docencia", id: "ghost:p1" },
      ],
      "token-a",
      "portatil",
    );
    expect(r.ok).toBe(true);
    expect(store.list("t_docencia")).toHaveLength(before);
    expect((await rowOf(cal, "ghost:p1")).values.title).toBe("Revisar actas inventadas");
    store.journal.setProposal("p1", "rejected", 5);
    const v2 = (await cal.snapshot()).version;
    expect((await cal.snapshot()).rows.some((x) => x.id === "ghost:p1")).toBe(false);
    expect(cal.changes(v1).removes).toEqual(["ghost:p1"]);
    expect(v2).toBeGreaterThan(v1);
  });

  it("«Ya lo hice»: the task is made already done, in its calendar's task column", async () => {
    const { store } = env();
    expect(taskDoneField(store, "t_docencia")?.name).toBe("Hecha");
    const l = label("external", "personal", [{ kind: "mail", id: "x" }]);
    store.journal.startRun({
      id: "r1",
      turn: null,
      origin: "background",
      device: null,
      started: 1,
    });
    store.journal.addProposal({
      id: "p1",
      run: "r1",
      tool: "entities.create",
      args: {
        values: {
          type: leaf("docencia", l),
          values: rec(
            { title: leaf("Revisar actas inventadas", l), date: leaf("2026-10-29", l) },
            l,
          ),
        },
        origins: [],
      },
      view: { tool: "entities.create", title: "Crear", rows: [] },
      sources: ["mail:ejemplo@example.edu"],
      created: 2,
    });
    const p = store.journal.proposal("p1") as NonNullable<
      ReturnType<typeof store.journal.proposal>
    >;
    const done = taskDoneField(store, "t_docencia")?.key as string;
    expect(acceptEdits(store, p, { done: true })).toEqual({ values: { [done]: true } });
    expect(acceptEdits(store, p, { done: "sí" })).toEqual({});
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

  it("a calendar over a branch split by a field (D-14): its records wherever they are, new ones where they go", async () => {
    // Invented: an Agenda with Tareas and Eventos inside, and two calendars by «area» (Casa takes those without one).
    const { columns, mapping } = RAW;
    const agendaDef = { ...RAW, columns: columns.filter((c) => c.id !== "completed") };
    const store = openUserStore(":memory:");
    seed(
      store,
      [
        { key: "area", name: "Área", folder: "areas/" },
        {
          key: "agenda",
          name: "Agenda",
          folder: "agenda/",
          fields: { area: { type: "relation", to: "area" } },
          calendar: { ...agendaDef, mapping: { title: mapping.title, when: mapping.when } },
        },
        {
          key: "tarea",
          name: "Tarea",
          folder: "agenda/tareas/",
          parent: "agenda",
          fields: { Hecha: "checkbox" },
        },
        { key: "evento", name: "Evento", folder: "agenda/eventos/", parent: "agenda" },
      ],
      {
        "areas/trabajo.md": "---\ntype: area\n---\n# Trabajo\n",
        "areas/casa.md": "---\ntype: area\n---\n# Casa\n",
        "agenda/tareas/Informe.md":
          '---\ntitle: "Informe"\ndate: "2026-11-02"\nHecha: false\narea: "[[trabajo]]"\n---\n',
        "agenda/eventos/Reunión.md":
          '---\ntitle: "Reunión"\ndate: "2026-11-03"\nstartTime: "10:00"\narea: "[[trabajo]]"\n---\n',
        "agenda/eventos/Cena.md": '---\ntitle: "Cena"\ndate: "2026-11-04"\narea: "[[casa]]"\n---\n',
        "agenda/eventos/Dentista.md": '---\ntitle: "Dentista"\ndate: "2026-11-05"\n---\n',
      },
    );
    const area = (n: string) =>
      store.list("t_area").find((e) => e.entity.values.f_vault_path === `areas/${n}.md`)?.entity
        .id as string;
    const make = { event: "t_evento", task: "t_tarea" };
    saveCalendarDefs(store, [
      {
        type: "t_agenda",
        raw: { ...RAW, id: "trabajo", name: "Trabajo", folder: "agenda/trabajo" },
        where: { field: "f_area", value: area("trabajo") },
        make,
      },
      {
        type: "t_agenda",
        raw: { ...RAW, id: "casa", name: "Casa", folder: "agenda/casa" },
        where: { field: "f_area", value: area("casa"), orEmpty: true },
        make,
      },
    ]);
    const cal = new StoreCalendar(store, { write: true, pollMs: 60_000 });
    cleanups.push(() => {
      cal.close();
      store.close();
    });
    const snap = await cal.snapshot();
    const where = Object.fromEntries(snap.rows.map((r) => [r.values.title, r.collectionId]));
    expect(where).toEqual({
      Informe: "trabajo",
      Reunión: "trabajo",
      Cena: "casa",
      Dentista: "casa",
    });
    expect(snap.rows.find((r) => r.values.title === "Informe")?.values.completed).toBe(false);
    expect(snap.rows.find((r) => r.values.title === "Reunión")?.values.completed).toBeUndefined();
    const entity = (title: string) =>
      store.list("t_agenda", { deep: true }).find((e) => e.entity.values.f_title === title)?.entity;

    // New: an event where events go, a task where tasks go, each with its calendar's area.
    const row = (id: string, collectionId: string, values: Row["values"]): Row => ({
      id,
      collectionId,
      values,
      created: 0,
      updated: 0,
    });
    let r = await cal.apply(
      snap.version,
      [
        { op: "upsert", row: row("ev-1", "trabajo", { title: "Claustro", date: "2026-11-06" }) },
        {
          op: "upsert",
          row: row("ev-2", "casa", { title: "Fontanero", date: "2026-11-07", completed: false }),
        },
      ],
      "token-a",
      "portatil",
    );
    expect(r.ok).toBe(true);
    expect(entity("Claustro")).toMatchObject({
      type: "t_evento",
      values: { f_area: area("trabajo") },
    });
    expect(entity("Fontanero")).toMatchObject({
      type: "t_tarea",
      values: { f_area: area("casa"), f_hecha: false },
    });

    // Marked as a task: the same record moves to Tarea; to another calendar: only its area changes.
    const reunion = (await cal.snapshot()).rows.find((x) => x.values.title === "Reunión") as Row;
    const id = entity("Reunión")?.id;
    r = await cal.apply(
      r.ok ? r.version : 0,
      [{ op: "upsert", row: { ...reunion, values: { ...reunion.values, completed: false } } }],
      "token-a",
      "portatil",
    );
    expect(entity("Reunión")).toMatchObject({ id, type: "t_tarea", values: { f_hecha: false } });
    const cena = (await cal.snapshot()).rows.find((x) => x.values.title === "Cena") as Row;
    r = await cal.apply(
      r.ok ? r.version : 0,
      [{ op: "upsert", row: { ...cena, collectionId: "trabajo" } }],
      "token-a",
      "portatil",
    );
    expect(entity("Cena")).toMatchObject({ type: "t_evento", values: { f_area: area("trabajo") } });
    expect((await cal.snapshot()).rows.find((x) => x.values.title === "Cena")?.collectionId).toBe(
      "trabajo",
    );
    // «Ya lo hice» finds the task column in the collection of tasks.
    expect(taskDoneField(store, "t_tarea")?.id).toBe("f_hecha");
    // The definitions keep where and what they make.
    expect(
      calendarDefs(store).map((p) => [p.def.id, p.where?.orEmpty ?? false, p.make?.task]),
    ).toEqual([
      ["trabajo", false, "t_tarea"],
      ["casa", true, "t_tarea"],
    ]);
  });

  it("a row known by an older id is the same record: its note's path, or a new row's id sent again", async () => {
    const { store, cal } = env();
    const snap = await cal.snapshot();
    const id = idAt(store, CLASS);
    const row = await rowOf(cal, id);
    // A device that still knows the class by its note's path (rows were known by it until 2026-10-29).
    const r = await cal.apply(
      snap.version,
      [{ op: "upsert", row: { ...row, id: CLASS, values: { ...row.values, startTime: "09:00" } } }],
      "token-a",
      "portatil",
    );
    expect(r).toMatchObject({ ok: true, aliases: { [CLASS]: id } });
    expect(store.get(id)?.entity.values.f_starttime).toBe("09:00");
    // A new row sent again before the device heard back: still one record.
    const fresh: Row = {
      id: "ev-doble",
      collectionId: "docencia",
      values: { title: "Una vez", date: "2026-10-30" },
      created: 0,
      updated: 0,
    };
    const a = await cal.apply(
      r.ok ? r.version : 0,
      [{ op: "upsert", row: fresh }],
      "token-a",
      "portatil",
    );
    const b = await cal.apply(
      a.ok ? a.version : 0,
      [{ op: "upsert", row: fresh }],
      "token-a",
      "portatil",
    );
    const made = a.ok ? a.aliases["ev-doble"] : "";
    expect(made).toMatch(/^e_/);
    expect(b).toMatchObject({ ok: true, aliases: { "ev-doble": made } });
    expect(
      store.list("t_docencia").filter((e) => e.entity.values.f_title === "Una vez"),
    ).toHaveLength(1);
  });
});
