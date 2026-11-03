import { leaf, rec } from "@boni/agent";
import type { Row } from "@boni/calendar";
import { label } from "@boni/entities";
import { openUserStore, type UserStore } from "@boni/store";
import { afterEach, describe, expect, it } from "vitest";
import {
  addCalendar,
  calendarCandidates,
  calendarDefs,
  removeCalendar,
  StoreCalendar,
  saveCalendarDefs,
  setSplit,
  storedCalendarDefs,
  taskDoneField,
} from "./calendarStore.ts";
import { acceptEdits } from "./proposalEdits.ts";
import { seed, type TypeSpec } from "./seed.test-util.ts";
import { applySplit, splitPlan, undoSplit } from "./split.ts";

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
  seeded.set(store, seed(store, types, notes));
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
const seeded = new WeakMap<UserStore, Map<string, string>>();
const idAt = (store: UserStore, path: string) => seeded.get(store)?.get(path) as string;

/** An agenda split by its area (a relation) or its kind (a list), as Juan's is: invented areas and entries. */
function agendaEnv(): {
  store: UserStore;
  cal: StoreCalendar;
  area: string;
  tipo: string;
  type: string;
} {
  const store = openUserStore(":memory:");
  const types: TypeSpec[] = [
    { key: "area", name: "Área", folder: "areas/" },
    {
      key: "agenda",
      name: "Agenda",
      folder: "agenda/",
      fields: {
        area: { type: "relation", to: "area" },
        tipo: { type: "select", options: ["clase", "reunión"] },
      },
      calendar: { ...RAW, id: "agenda", name: "Agenda", folder: "agenda" },
    },
  ];
  seed(store, types, {
    "areas/docencia.md": "---\ntype: area\n---\n# Docencia\n",
    "areas/gestiones.md": "---\ntype: area\n---\n# Gestiones\n",
    "agenda/2026-10-22 Clase.md":
      '---\ntitle: "Clase"\ndate: "2026-10-22"\narea: "[[docencia]]"\ntipo: clase\n---\n',
    "agenda/2026-10-23 Reunión.md":
      '---\ntitle: "Reunión"\ndate: "2026-10-23"\narea: "[[gestiones]]"\ntipo: reunión\n---\n',
    "agenda/2026-10-24 Suelto.md": '---\ntitle: "Suelto"\ndate: "2026-10-24"\n---\n',
  });
  const type = Object.values(store.schema().types).find((t) => t.key === "agenda")?.id as string;
  const fields = store.schema().types[type]?.fields ?? [];
  const area = fields.find((f) => f.name === "area")?.id as string;
  const tipo = fields.find((f) => f.name === "tipo")?.id as string;
  const cal = new StoreCalendar(store, { write: true, pollMs: 60_000 });
  cleanups.push(() => {
    cal.close();
    store.close();
  });
  return { store, cal, area, tipo, type };
}

describe("a definition split by a field (D-24)", () => {
  it("one calendar per value, «Sin …» while some record holds nothing, colours kept by value; whole again", async () => {
    const { store, cal, area, tipo } = agendaEnv();
    const whole = calendarDefs(store);
    expect(whole.map((p) => p.def.id)).toEqual(["agenda"]);
    expect(whole[0]?.def.split).toMatchObject({ field: null });
    expect(whole[0]?.def.split?.choices.map((c) => c.name).sort()).toEqual(["area", "tipo"]);
    expect(setSplit(store, "agenda", "f_nope")).toBe("bad-field");
    expect(setSplit(store, "nope", area)).toBe("no-such-calendar");
    expect(await cal.setSplit("agenda", area)).toBe("ok");
    const byArea = calendarDefs(store);
    // The areas come in the store's order (not fixed between runs): by name, never by position.
    const byName = (name: string) => byArea.find((p) => p.def.name === name);
    expect(byArea.map((p) => p.def.name).sort()).toEqual(["Docencia", "Gestiones", "Sin area"]);
    expect(byArea.at(-1)?.def.name).toBe("Sin area");
    expect(byArea.map((p) => p.group?.id)).toEqual(["agenda", "agenda", "agenda"]);
    expect(byArea.map((p) => p.where?.orEmpty ?? false)).toEqual([false, false, true]);
    expect(new Set(byArea.map((p) => p.def.color)).size).toBe(3);
    // Each calendar carries the node above it and its own split (none yet; the field above is no choice).
    expect(byName("Docencia")?.group).toMatchObject({ id: "agenda", field: area });
    expect(byName("Docencia")?.path?.map((n) => n.name)).toEqual(["Agenda"]);
    expect(byName("Docencia")?.def.split).toMatchObject({ field: null });
    expect(byName("Docencia")?.def.split?.choices.map((c) => c.name)).toEqual(["tipo"]);
    // The kept definition is one; what the apps read is three.
    expect(storedCalendarDefs(store)).toHaveLength(1);
    // Each calendar shows its own entries; the one without an area goes to «Sin area».
    const snap = await cal.snapshot();
    const rowsOf = (id: string) =>
      snap.rows.filter((r) => r.collectionId === id).map((r) => r.values.title);
    const [docencia, gestiones, sin] = ["Docencia", "Gestiones", "Sin area"].map(
      (n) => byName(n)?.def.id,
    );
    expect(rowsOf(docencia as string)).toEqual(["Clase"]);
    expect(rowsOf(gestiones as string)).toEqual(["Reunión"]);
    expect(rowsOf(sin as string)).toEqual(["Suelto"]);
    expect(snap.views.find((v) => v.id === docencia)?.group).toMatchObject({
      id: "agenda",
      name: "Agenda",
      fieldName: "area",
    });
    // A colour kept for a value, by the member's id.
    expect(await cal.setColor(docencia as string, "#123456")).toBe(true);
    expect(calendarDefs(store).find((p) => p.def.id === docencia)?.def.color).toBe("#123456");
    const docenciaValue = byName("Docencia")?.where?.value ?? "";
    expect(storedCalendarDefs(store)[0]?.raw.colors).toEqual({ [docenciaValue]: "#123456" });
    // By a list instead: its options, in order, and the record without one under «Sin tipo».
    expect(await cal.setSplit("agenda", tipo)).toBe("ok");
    expect(calendarDefs(store).map((p) => p.def.name)).toEqual(["clase", "reunión", "Sin tipo"]);
    // Whole again: one calendar, every entry in it; the colours kept wait in the definition.
    expect(await cal.setSplit("agenda", null)).toBe("ok");
    expect(calendarDefs(store).map((p) => p.def.id)).toEqual(["agenda"]);
    expect((await cal.snapshot()).rows.filter((r) => r.collectionId === "agenda")).toHaveLength(3);
    // Taking the split definition away takes every calendar it made.
    expect(await cal.setSplit("agenda", area)).toBe("ok");
    expect(await cal.removeCalendar("agenda")).toBe(true);
    expect(calendarDefs(store)).toEqual([]);
  });

  it("a value split again: its own values below it, colours by the path, whole again from any node", async () => {
    const { store, cal, area, tipo } = agendaEnv();
    expect(await cal.setSplit("agenda", area)).toBe("ok");
    const docencia = calendarDefs(store).find((p) => p.def.name === "Docencia");
    const docenciaId = docencia?.def.id as string;
    expect(setSplit(store, docenciaId, area)).toBe("bad-field");
    expect(await cal.setSplit(docenciaId, tipo)).toBe("ok");
    const read = calendarDefs(store);
    // Under Docencia, the kinds found among its records (Clase: clase); Gestiones and «Sin area» stay whole.
    expect(read.map((p) => p.def.name).sort()).toEqual(["Gestiones", "Sin area", "clase"]);
    const clase = read.find((p) => p.def.name === "clase");
    expect(clase?.def.id).toBe(`${docenciaId}--o-clase`);
    expect(clase?.path?.map((n) => n.name)).toEqual(["Agenda", "Docencia"]);
    expect(clase?.group).toMatchObject({ id: docenciaId, field: tipo });
    expect(clase?.where).toMatchObject({ field: area, also: [{ field: tipo }] });
    expect(clase?.def.split?.choices).toEqual([]);
    const snap = await cal.snapshot();
    expect(
      snap.rows.filter((r) => r.collectionId === clase?.def.id).map((r) => r.values.title),
    ).toEqual(["Clase"]);
    expect(snap.views.find((v) => v.id === clase?.def.id)?.path?.length).toBe(2);
    // Its colour is kept by the values' path.
    expect(await cal.setColor(clase?.def.id as string, "#abcdef")).toBe(true);
    const colors = storedCalendarDefs(store)[0]?.raw.colors as Record<string, string>;
    expect(Object.keys(colors)[0]).toMatch(/\/o_clase$/);
    // (By id: the relation's targets come in no fixed order, so the calendars by area do not either.)
    expect(calendarDefs(store).find((p) => p.def.id === clase?.def.id)?.def.color).toBe("#abcdef");
    // The node whole again by the group row's id (Docencia's), then the definition whole.
    expect(await cal.setSplit(docenciaId, null)).toBe("ok");
    expect(
      calendarDefs(store)
        .map((p) => p.def.name)
        .sort(),
    ).toEqual(["Docencia", "Gestiones", "Sin area"]);
    expect(await cal.setSplit("agenda", null)).toBe("ok");
    expect(calendarDefs(store).map((p) => p.def.id)).toEqual(["agenda"]);
  });

  it("«split»: calendars picked by hand over one field become one definition split by it, colours kept; undone whole", () => {
    const { store, area, type } = agendaEnv();
    // The areas by their title: the store's order is not fixed between runs.
    const areaTitle = store.schema().types.t_area?.titleField ?? "";
    const areaOf = (title: string) =>
      store.list("t_area").find((e) => e.entity.values[areaTitle] === title)?.entity.id as string;
    const member = (id: string, name: string, value: string, color: string) => ({
      type,
      raw: {
        ...RAW,
        id,
        name,
        folder: `agenda/${id}`,
        color,
        newNote: { name: "{title}", properties: { area: `[[${id}]]` } },
      },
      where: { field: area, value },
    });
    saveCalendarDefs(store, [
      member("docencia", "Docencia", areaOf("Docencia"), "#60a5fa"),
      member("gestiones", "Gestiones", areaOf("Gestiones"), "#4ade80"),
    ]);
    expect(
      calendarDefs(store)
        .map((p) => p.def.name)
        .sort(),
    ).toEqual(["Docencia", "Gestiones"]);
    expect(calendarCandidates(store)).toEqual([]);
    const plan = splitPlan(store);
    expect(plan).toMatchObject([
      {
        name: "Agenda",
        id: "agenda",
        fieldName: "area",
        members: [{ name: "Docencia" }, { name: "Gestiones" }],
      },
    ]);
    expect(applySplit(store, plan)).toBe(1);
    const kept = storedCalendarDefs(store);
    expect(kept).toHaveLength(1);
    expect(kept[0]).toMatchObject({
      type,
      split: { field: area },
      raw: { id: "agenda", name: "Agenda" },
    });
    const keptRaw = (kept[0]?.raw ?? {}) as { newNote?: unknown };
    expect(keptRaw.newNote).toEqual({ name: "{title}" });
    // The same calendars as before, with their colours, plus «Sin area» for the entry that had none.
    const after = calendarDefs(store);
    expect(Object.fromEntries(after.map((p) => [p.def.name, p.def.color]))).toEqual({
      Docencia: "#60a5fa",
      Gestiones: "#4ade80",
      "Sin area": expect.any(String),
    });
    expect(splitPlan(store)).toEqual([]);
    expect(undoSplit(store)).toBe(2);
    expect(
      calendarDefs(store)
        .map((p) => p.def.id)
        .sort(),
    ).toEqual(["docencia", "gestiones"]);
    expect(undoSplit(store)).toBeNull();
  });
});

describe("the calendars Boni Calendar may add (D-23)", () => {
  it("a dated collection without a calendar is a candidate; added, it shows its rows; taken away, they stay", async () => {
    const { store, cal } = env();
    // «Viajes»: a date field playing `date`; «Proyecto» has no day; «Docencia» is a calendar already.
    seed(store, [{ key: "viaje", name: "Viajes", folder: "viajes/", fields: { salida: "date" } }], {
      "viajes/roma.md": '---\nsalida: "2026-11-20"\n---\n# Roma\n',
    });
    const viajes = Object.values(store.schema().types).find((t) => t.key === "viaje");
    const salida = viajes?.fields.find((f) => f.name === "salida");
    expect(calendarCandidates(store)).toEqual([]);
    store.applySchema(
      { op: "set_roles", type: viajes?.id as string, roles: { date: salida?.id as string } },
      { actor: "import" },
    );
    expect(calendarCandidates(store)).toMatchObject([
      { type: viajes?.id, name: "Viajes", count: 1 },
    ]);
    expect(addCalendar(store, "t_proyecto")).toBeNull();
    const added = await cal.addCalendar(viajes?.id as string);
    expect(added).toEqual({ id: "viajes" });
    expect(calendarCandidates(store)).toEqual([]);
    const def = calendarDefs(store).find((p) => p.def.id === "viajes")?.def;
    expect(def).toMatchObject({
      name: "Viajes",
      account: "Agenda",
      mapping: { title: expect.any(String), when: { kind: "split", date: "salida" } },
    });
    expect(def?.color).not.toBe(RAW.color);
    const snap = await cal.snapshot();
    expect(snap.views.some((v) => v.id === "viajes")).toBe(true);
    expect(
      snap.rows.filter((r) => r.collectionId === "viajes").map((r) => r.values.salida),
    ).toEqual(["2026-11-20"]);
    // A second one of the same name gets its own id; nothing is added twice.
    expect(addCalendar(store, viajes?.id as string)).toBeNull();
    expect(await cal.removeCalendar("viajes")).toBe(true);
    expect(await cal.removeCalendar("viajes")).toBe(false);
    expect(calendarCandidates(store)).toMatchObject([{ name: "Viajes" }]);
    expect(store.count(viajes?.id as string)).toBe(1);
    expect((await cal.snapshot()).views.some((v) => v.id === "viajes")).toBe(false);
  });
});

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
        project: "curso-ejemplo",
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
    const areaId = (p: string) => idAt(store, `areas/${p}.md`);
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
    const e = store.get(idAt(store, CLASS));
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
    const ids = seed(
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
    const area = (n: string) => ids.get(`areas/${n}.md`) as string;
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

  it("a new row sent again before the device heard back is the same record", async () => {
    const { store, cal } = env();
    const snap = await cal.snapshot();
    // A new row sent again before the device heard back: still one record.
    const fresh: Row = {
      id: "ev-doble",
      collectionId: "docencia",
      values: { title: "Una vez", date: "2026-10-30" },
      created: 0,
      updated: 0,
    };
    const a = await cal.apply(snap.version, [{ op: "upsert", row: fresh }], "token-a", "portatil");
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

describe("a calendar reads its collection's roles (docs/clases.md §6, D-20)", () => {
  it("a calendar's day, times and task box come from its collection's roles; its definition until they are set", async () => {
    const store = openUserStore(":memory:");
    cleanups.push(() => store.close());
    seed(
      store,
      [
        { key: "proyecto", name: "Proyecto", folder: "proyectos/" },
        {
          key: "docencia",
          name: "Docencia",
          folder: "agenda/docencia/",
          fields: { ...PROJECT, dia: "date", lista: "checkbox" },
          calendar: RAW,
        },
      ],
      NOTES,
    );
    const open = () => new StoreCalendar(store, { write: true, pollMs: 60_000 });
    // No roles yet: the definition's mapping, as before.
    let cal = open();
    let snap = await cal.snapshot();
    expect(snap.views[0]?.mapping.when).toEqual({
      kind: "split",
      date: "date",
      startTime: "startTime",
      endTime: "endTime",
    });
    expect(snap.views[0]?.mapping.task).toEqual({ column: "completed" });
    cal.close();
    // The roles name other fields, two with no column in the definition: the calendar follows the roles, those
    // fields travel by their name, and the end time (no role) is no longer the calendar's.
    store.applySchema(
      {
        op: "set_roles",
        type: "t_docencia",
        roles: { date: "f_dia", time: "f_starttime", done: "f_lista" },
      },
      { actor: "user" },
    );
    cal = open();
    cleanups.push(() => cal.close());
    snap = await cal.snapshot();
    expect(snap.views[0]?.mapping.when).toEqual({
      kind: "split",
      date: "dia",
      startTime: "startTime",
    });
    expect(snap.views[0]?.mapping.task).toEqual({ column: "lista" });
    expect(snap.collections[0]?.columns.filter((c) => c.id === "dia" || c.id === "lista")).toEqual([
      { id: "dia", name: "dia", type: "date" },
      { id: "lista", name: "lista", type: "checkbox" },
    ]);
    expect(taskDoneField(store, "t_docencia")?.id).toBe("f_lista");
    // A row written with them lands in those fields, and comes back by their names.
    const fresh: Row = {
      id: "ev-nuevo",
      collectionId: "docencia",
      values: { title: "Clase inventada", dia: "2026-11-06", startTime: "09:00", lista: true },
      created: 0,
      updated: 0,
    };
    const made = await cal.apply(
      snap.version,
      [{ op: "upsert", row: fresh }],
      "token-a",
      "portatil",
    );
    const id = made.ok ? (made.aliases["ev-nuevo"] as string) : "";
    expect(store.get(id)?.entity.values).toMatchObject({
      f_dia: "2026-11-06",
      f_starttime: "09:00",
      f_lista: true,
    });
    expect((await rowOf(cal, id)).values).toMatchObject({ dia: "2026-11-06", lista: true });
  });
});
