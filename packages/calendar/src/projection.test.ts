import { describe, expect, it } from "vitest";
import {
  type CalEvent,
  type CalendarView,
  type Collection,
  type CollectionSnapshot,
  daysFromCivil,
  diffRows,
  editOccurrence,
  eventToRow,
  fromLocal,
  makeModel,
  makeProjector,
  memoryProvider,
  type Row,
  reconcileRows,
  rowToEvent,
  supportsTasks,
  validateModel,
} from "./index.ts";

const TZ = "Europe/Madrid";
const D = (y: number, m: number, d: number) => daysFromCivil(y, m, d);

// A collection shaped like the `agenda/` notes (all data invented): date and time in separate
// columns, `completed` as the task column, a link to a project.
const agendaColumns: Collection["columns"] = [
  { id: "title", name: "Título", type: "text" },
  { id: "date", name: "Fecha", type: "date" },
  { id: "startTime", name: "Inicio", type: "time" },
  { id: "endTime", name: "Fin", type: "time" },
  { id: "allDay", name: "Todo el día", type: "checkbox" },
  { id: "endDate", name: "Fecha de fin", type: "date" },
  { id: "timezone", name: "Zona", type: "text" },
  { id: "completed", name: "Hecha", type: "checkbox" },
  { id: "project", name: "Proyecto", type: "relation", target: "projects" },
  { id: "estimate_h", name: "Estimación (h)", type: "number" },
  { id: "recurrence", name: "Repetición", type: "text" },
  { id: "exdates", name: "Excepciones", type: "dates" },
];
const agenda: Collection = { id: "agenda", name: "Agenda", columns: agendaColumns };
const projects: Collection = {
  id: "projects",
  name: "Proyectos",
  columns: [{ id: "title", name: "Título", type: "text" }],
};
const agendaView: CalendarView = {
  id: "agenda",
  collectionId: "agenda",
  accountId: "acc",
  color: "#7b8cff",
  visible: true,
  mapping: {
    title: "title",
    when: {
      kind: "split",
      date: "date",
      startTime: "startTime",
      endTime: "endTime",
      endDate: "endDate",
      allDay: "allDay",
      timezone: "timezone",
    },
    task: { column: "completed" },
    recurrence: "recurrence",
    exdates: "exdates",
  },
};

// A second collection with ISO start/end columns, a status column for tasks and the note body
// as description.
const jobs: Collection = {
  id: "jobs",
  name: "Gestiones",
  columns: [
    { id: "name", name: "Nombre", type: "text" },
    { id: "from", name: "Desde", type: "datetime" },
    { id: "to", name: "Hasta", type: "datetime" },
    {
      id: "state",
      name: "Estado",
      type: "select",
      options: [
        { id: "todo", label: "Pendiente", color: "#94a3b8" },
        { id: "doing", label: "En curso", color: "#fbbf24" },
        { id: "done", label: "Hecho", color: "#4ade80" },
      ],
    },
    { id: "kind", name: "Tipo", type: "text" },
  ],
};
const jobsView: CalendarView = {
  id: "jobs",
  collectionId: "jobs",
  accountId: "acc",
  color: "#ef4444",
  visible: true,
  tz: TZ,
  mapping: {
    title: "name",
    description: "$body",
    when: { kind: "range", start: "from", end: "to" },
    task: { column: "state", doneValues: ["done"], openValue: "todo" },
  },
};

const model = makeModel([agenda, projects, jobs], [agendaView, jobsView], { defaultTz: TZ });
const stamp = 1_700_000_000_000;

const row = (collectionId: string, id: string, values: Row["values"], body?: string): Row => ({
  id,
  collectionId,
  values,
  ...(body ? { body } : {}),
  created: stamp,
  updated: stamp,
});

const classRow = row("agenda", "a1", {
  title: "Clase de ejemplo",
  date: "2026-10-19",
  startTime: "09:30",
  endTime: "10:30",
  timezone: TZ,
  completed: null,
  project: "[[proyecto-ejemplo]]",
  estimate_h: 1.5,
  note: "unknown to the schema",
});

describe("rows of an agenda-like collection", () => {
  it("become timed events with the properties left over as props", () => {
    const ev = rowToEvent(model, classRow);
    expect(ev).not.toBeNull();
    expect(ev?.id).toBe("a1");
    expect(ev?.calendarId).toBe("agenda");
    expect(ev?.title).toBe("Clase de ejemplo");
    expect(ev?.when).toEqual({
      kind: "timed",
      start: fromLocal(D(2026, 10, 19), 570, TZ),
      end: fromLocal(D(2026, 10, 19), 630, TZ),
      tz: TZ,
    });
    expect(ev?.isTask).toBe(false);
    expect(ev?.done).toBe(false);
    // Mapped columns are not props; unmapped columns of the schema are; keys outside it are ignored.
    expect(ev?.props).toEqual({ project: "[[proyecto-ejemplo]]", estimate_h: 1.5 });
    expect(ev?.recurrence).toBeUndefined();
  });

  it("read the task column the way the vault does: empty = event, false = open, true = done", () => {
    const open = rowToEvent(model, {
      ...classRow,
      values: { ...classRow.values, completed: false },
    });
    const done = rowToEvent(model, {
      ...classRow,
      values: { ...classRow.values, completed: true },
    });
    expect([open?.isTask, open?.done]).toEqual([true, false]);
    expect([done?.isTask, done?.done]).toEqual([true, true]);
  });

  it("are all-day without a start time, honouring a multi-day end date", () => {
    const one = rowToEvent(model, row("agenda", "a2", { title: "Plazo", date: "2026-10-20" }));
    expect(one?.when).toEqual({
      kind: "allday",
      startDay: D(2026, 10, 20),
      endDay: D(2026, 10, 20),
    });
    const span = rowToEvent(
      model,
      row("agenda", "a3", {
        title: "Viaje",
        date: "2026-10-20",
        endDate: "2026-10-23",
        allDay: true,
      }),
    );
    expect(span?.when).toEqual({
      kind: "allday",
      startDay: D(2026, 10, 20),
      endDay: D(2026, 10, 23),
    });
    // allDay wins over a leftover start time.
    const flagged = rowToEvent(
      model,
      row("agenda", "a4", { title: "X", date: "2026-10-20", startTime: "10:00", allDay: true }),
    );
    expect(flagged?.when.kind).toBe("allday");
  });

  it("get a default length without an end time and cross midnight with an end date", () => {
    const noEnd = rowToEvent(
      model,
      row("agenda", "a5", { title: "X", date: "2026-10-20", startTime: "18:00", timezone: TZ }),
    );
    expect(noEnd?.when).toMatchObject({ kind: "timed" });
    if (noEnd?.when.kind === "timed") expect(noEnd.when.end - noEnd.when.start).toBe(3_600_000);
    const night = rowToEvent(
      model,
      row("agenda", "a6", {
        title: "Fiesta",
        date: "2026-10-24",
        startTime: "22:00",
        endTime: "02:30",
        endDate: "2026-10-25",
        timezone: TZ,
      }),
    );
    expect(night?.when).toEqual({
      kind: "timed",
      start: fromLocal(D(2026, 10, 24), 22 * 60, TZ),
      end: fromLocal(D(2026, 10, 25), 150, TZ),
      tz: TZ,
    });
  });

  it("use the model's default zone when the row has none", () => {
    const ev = rowToEvent(
      model,
      row("agenda", "a7", { title: "X", date: "2026-10-20", startTime: "09:00", endTime: "10:00" }),
    );
    expect(ev?.when).toMatchObject({ tz: TZ, start: fromLocal(D(2026, 10, 20), 540, TZ) });
  });

  it("are skipped when they have no usable date or no calendar", () => {
    expect(rowToEvent(model, row("agenda", "b1", { title: "Sin fecha" }))).toBeNull();
    expect(rowToEvent(model, row("agenda", "b2", { title: "X", date: "mañana" }))).toBeNull();
    expect(rowToEvent(model, row("projects", "p1", { title: "Proyecto" }))).toBeNull();
    expect(rowToEvent(model, row("nope", "b3", { title: "X", date: "2026-10-20" }))).toBeNull();
  });
});

describe("rows with ISO start/end, a status task column and the note body", () => {
  const job = row(
    "jobs",
    "j1",
    {
      name: "Renovar DNI",
      from: "2026-10-21T08:00:00Z",
      to: "2026-10-21T09:30:00Z",
      state: "doing",
      kind: "papeleo",
    },
    "Llevar fotos.",
  );

  it("become events with description from the body", () => {
    const ev = rowToEvent(model, job);
    expect(ev?.title).toBe("Renovar DNI");
    expect(ev?.description).toBe("Llevar fotos.");
    expect(ev?.when).toEqual({
      kind: "timed",
      start: Date.parse("2026-10-21T08:00:00Z"),
      end: Date.parse("2026-10-21T09:30:00Z"),
      tz: TZ,
    });
    expect([ev?.isTask, ev?.done]).toEqual([true, false]);
    expect(ev?.props).toEqual({ kind: "papeleo" });
  });

  it("are done when the status is a done value, and not tasks when it is empty", () => {
    expect(rowToEvent(model, { ...job, values: { ...job.values, state: "done" } })?.done).toBe(
      true,
    );
    const plain = rowToEvent(model, { ...job, values: { ...job.values, state: null } });
    expect(plain?.isTask).toBe(false);
  });

  it("are all-day when start is a plain date", () => {
    const ev = rowToEvent(
      model,
      row("jobs", "j2", { name: "X", from: "2026-10-22", to: "2026-10-24" }),
    );
    expect(ev?.when).toEqual({
      kind: "allday",
      startDay: D(2026, 10, 22),
      endDay: D(2026, 10, 24),
    });
  });

  it("write the status back from the event's task state", () => {
    const ev = rowToEvent(model, job) as CalEvent;
    const set = (patch: Partial<CalEvent>) =>
      eventToRow(model, job, { ...ev, ...patch }).values.state;
    expect(set({ done: true })).toBe("done");
    expect(set({ isTask: false })).toBeNull();
    const asEvent = { ...job, values: { ...job.values, state: null } };
    expect(eventToRow(model, asEvent, { ...ev, isTask: true, done: false }).values.state).toBe(
      "todo",
    );
  });
});

describe("events back to rows", () => {
  it("is the identity for a row that was just projected", () => {
    for (const r of [classRow, row("agenda", "a8", { title: "Plazo", date: "2026-10-20" })]) {
      const ev = rowToEvent(model, r) as CalEvent;
      const back = eventToRow(model, r, ev);
      expect(rowToEvent(model, back)).toEqual(ev);
    }
  });

  it("rewrites date and time columns when the event moves, keeping unknown keys", () => {
    const ev = rowToEvent(model, classRow) as CalEvent;
    const moved: CalEvent = {
      ...ev,
      when: {
        kind: "timed",
        start: fromLocal(D(2026, 10, 20), 11 * 60, TZ),
        end: fromLocal(D(2026, 10, 21), 90, TZ),
        tz: TZ,
      },
    };
    const back = eventToRow(model, classRow, moved);
    expect(back.values).toMatchObject({
      date: "2026-10-20",
      startTime: "11:00",
      endTime: "01:30",
      endDate: "2026-10-21",
      note: "unknown to the schema",
      project: "[[proyecto-ejemplo]]",
    });
    expect(back.id).toBe("a1");
  });

  it("clears the end date, the times and the all-day flag when the shape changes", () => {
    const span = row("agenda", "a9", {
      title: "Viaje",
      date: "2026-10-20",
      endDate: "2026-10-23",
      allDay: true,
    });
    const ev = rowToEvent(model, span) as CalEvent;
    const timed = eventToRow(model, span, {
      ...ev,
      when: {
        kind: "timed",
        start: fromLocal(D(2026, 10, 20), 600, TZ),
        end: fromLocal(D(2026, 10, 20), 660, TZ),
        tz: TZ,
      },
    });
    expect(timed.values).toMatchObject({
      startTime: "10:00",
      endTime: "11:00",
      endDate: null,
      allDay: null,
    });
    const allDay = eventToRow(model, classRow, {
      ...(rowToEvent(model, classRow) as CalEvent),
      when: { kind: "allday", startDay: D(2026, 10, 19), endDay: D(2026, 10, 19) },
    });
    expect(allDay.values).toMatchObject({ startTime: null, endTime: null, allDay: true });
  });

  it("drops props that the target collection does not have when an event changes calendar", () => {
    const ev = rowToEvent(model, classRow) as CalEvent;
    const moved = eventToRow(model, classRow, { ...ev, calendarId: "jobs" });
    expect(moved.collectionId).toBe("jobs");
    expect(moved.values.name).toBe("Clase de ejemplo");
    expect(moved.values.estimate_h).toBeUndefined();
    expect(moved.values.note).toBeUndefined();
    expect(moved.values.from).toBe("2026-10-19T07:30:00.000Z");
  });

  it("writes tasks only where the calendar maps a task column", () => {
    const noTasks = makeModel(
      [agenda],
      [{ ...agendaView, mapping: { ...agendaView.mapping, task: undefined } }],
      { defaultTz: TZ },
    );
    expect(supportsTasks(model, "agenda")).toBe(true);
    expect(supportsTasks(noTasks, "agenda")).toBe(false);
    const ev = rowToEvent(noTasks, {
      ...classRow,
      values: { ...classRow.values, completed: true },
    });
    expect(ev?.isTask).toBe(false);
    expect(ev?.props).toMatchObject({ completed: true }); // an unmapped column is just a property
  });
});

describe("projector", () => {
  it("returns the same event object for an untouched row", () => {
    const p = makeProjector(model);
    const rows = [classRow, row("agenda", "a2", { title: "Plazo", date: "2026-10-20" })];
    const first = p.project(rows);
    const second = p.project([...rows]);
    expect(first).toHaveLength(2);
    expect(second[0]).toBe(first[0]);
    expect(second[1]).toBe(first[1]);
  });

  it("drops unplaceable rows from the projection", () => {
    const p = makeProjector(model);
    const rows = [
      classRow,
      row("projects", "p1", { title: "P" }),
      row("agenda", "b1", { title: "?" }),
    ];
    expect(p.project(rows).map((e) => e.id)).toEqual(["a1"]);
  });
});

describe("reconcileRows", () => {
  const rows = [
    classRow,
    row("agenda", "a2", { title: "Plazo", date: "2026-10-20" }),
    row("projects", "p1", { title: "Proyecto" }),
    row("agenda", "a3", {
      title: "Viaje",
      date: "2026-10-22",
      endDate: "2026-10-23",
      allDay: true,
    }),
  ];
  const projector = makeProjector(model);
  const events = projector.project(rows);

  it("keeps untouched rows and rows that never were events", () => {
    const out = reconcileRows(model, rows, events, events);
    expect(out).toHaveLength(4);
    for (const [i, r] of out.entries()) expect(r).toBe(rows[i]);
  });

  it("rebuilds only the edited row", () => {
    const next = events.map((e) => (e.id === "a2" ? { ...e, title: "Plazo nuevo" } : e));
    const out = reconcileRows(model, rows, events, next);
    expect(out[0]).toBe(rows[0]);
    expect(out[1]).not.toBe(rows[1]);
    expect(out[1]?.values.title).toBe("Plazo nuevo");
    expect(out[2]).toBe(rows[2]);
    expect(out[3]).toBe(rows[3]);
  });

  it("drops removed events and appends new ones", () => {
    const added: CalEvent = { ...(events[0] as CalEvent), id: "new", title: "Nuevo" };
    const next = [...events.filter((e) => e.id !== "a3"), added];
    const out = reconcileRows(model, rows, events, next);
    expect(out.map((r) => r.id)).toEqual(["a1", "a2", "p1", "new"]);
    expect(out[3]?.values.title).toBe("Nuevo");
  });

  it("turns edits of recurring events into row changes (all, this, following)", () => {
    const series = row("agenda", "s1", {
      title: "Clase semanal",
      date: "2026-10-05",
      startTime: "09:00",
      endTime: "10:00",
      timezone: TZ,
      recurrence: "FREQ=WEEKLY",
    });
    const base = [series];
    const evs = makeProjector(model).project(base);
    expect(evs[0]?.recurrence).toEqual({ freq: "weekly", interval: 1 });
    const ctx = { newId: () => "fresh", now: stamp + 1 };
    const occ = `s1~${D(2026, 10, 19)}`;

    for (const scope of ["all", "this", "following"] as const) {
      const edited = editOccurrence(evs, occ, scope, { patch: { title: "Cambiada" } }, ctx);
      const rows2 = reconcileRows(model, base, evs, edited);
      const projected = makeProjector(model).project(rows2);
      // Same events once nulls and empty exception lists are normalised away (a row cannot tell
      // `null` or `[]` from "absent").
      const norm = (e: CalEvent) =>
        JSON.parse(
          JSON.stringify(e, (_k, v) =>
            v === null || (Array.isArray(v) && v.length === 0) ? undefined : v,
          ),
        );
      expect(projected.map(norm)).toEqual(edited.map(norm));
    }
    const split = reconcileRows(
      model,
      base,
      evs,
      editOccurrence(evs, occ, "this", { patch: { title: "Cambiada" } }, ctx),
    );
    expect(split.find((r) => r.id === "s1")?.values.exdates).toEqual(["2026-10-19"]);
    expect(split.find((r) => r.id === "fresh")?.values.recurrence).toBeUndefined();
    const cut = reconcileRows(
      model,
      base,
      evs,
      editOccurrence(evs, occ, "following", { remove: true }, ctx),
    );
    expect(cut).toHaveLength(1);
    expect(cut[0]?.values.recurrence).toBe("FREQ=WEEKLY;UNTIL=2026-10-18");
  });
});

describe("diffRows and the memory provider", () => {
  const a = row("agenda", "a", { title: "A", date: "2026-10-20" });
  const b = row("agenda", "b", { title: "B", date: "2026-10-21" });
  const b2 = { ...b, values: { ...b.values, title: "B2" } };
  const c = row("agenda", "c", { title: "C", date: "2026-10-22" });

  it("lists upserts for changed and new rows and removals for missing ones", () => {
    expect(diffRows([a, b], [a, b])).toEqual([]);
    expect(diffRows([a, b], [a, b2, c])).toEqual([
      { op: "upsert", row: b2 },
      { op: "upsert", row: c },
    ]);
    expect(diffRows([a, b], [b])).toEqual([{ op: "remove", collectionId: "agenda", id: "a" }]);
  });

  it("removes a row from its old collection when it moves", () => {
    const moved = { ...a, collectionId: "jobs" };
    expect(diffRows([a], [moved])).toEqual([
      { op: "remove", collectionId: "agenda", id: "a" },
      { op: "upsert", row: moved },
    ]);
  });

  it("applies changes in memory", async () => {
    const snap: CollectionSnapshot = {
      accounts: [],
      collections: [agenda],
      views: [agendaView],
      rows: [a, b],
    };
    const p = memoryProvider(snap);
    await p.apply(diffRows([a, b], [b2, c]));
    expect(p.rows().map((r) => r.id)).toEqual(["b", "c"]);
    expect(p.rows()[0]).toBe(b2);
    expect((await p.load()).rows).toHaveLength(2);
  });
});

describe("validateModel", () => {
  it("accepts the fixtures", () => {
    const issues = validateModel([agenda, projects, jobs], [agendaView, jobsView]);
    expect(issues.filter((i) => i.severity === "error")).toEqual([]);
  });

  it("reports missing and wrong-typed mapped columns", () => {
    const bad: CalendarView = {
      ...agendaView,
      mapping: {
        ...agendaView.mapping,
        title: "nope",
        when: { kind: "split", date: "startTime", startTime: "date" },
        task: { column: "title" },
      },
    };
    const msgs = validateModel([agenda, projects], [bad]).map((i) => `${i.severity}: ${i.where}`);
    expect(msgs).toContain('error: view "agenda" / title');
    expect(msgs).toContain('error: view "agenda" / when.date');
    expect(msgs).toContain('error: view "agenda" / when.startTime');
    expect(msgs).toContain('error: view "agenda" / task.column');
    expect(msgs).toContain('warning: view "agenda" / when.endDate');
  });

  it("checks status task columns, relations, duplicates and one view per collection", () => {
    const noDone: CalendarView = {
      ...jobsView,
      mapping: { ...jobsView.mapping, task: { column: "state" } },
    };
    expect(validateModel([jobs], [noDone]).some((i) => i.where.endsWith("task.doneValues"))).toBe(
      true,
    );
    const allDone: CalendarView = {
      ...jobsView,
      mapping: {
        ...jobsView.mapping,
        task: { column: "state", doneValues: ["todo", "doing", "done"] },
      },
    };
    expect(validateModel([jobs], [allDone]).some((i) => i.where.endsWith("task.openValue"))).toBe(
      true,
    );
    const dangling: Collection = {
      id: "x",
      name: "X",
      columns: [
        { id: "r", name: "R", type: "relation", target: "ghost" },
        { id: "r", name: "R2", type: "text" },
      ],
    };
    const msgs = validateModel([dangling], []).map((i) => i.message);
    expect(msgs).toContain('relation target "ghost" does not exist');
    expect(msgs).toContain("duplicate column id");
    const twin = { ...agendaView, id: "twin" };
    expect(
      validateModel([agenda], [agendaView, twin]).some((i) =>
        /already has a calendar view/.test(i.message),
      ),
    ).toBe(true);
  });
});

describe("series kept as separate notes", () => {
  const seriesColl: Collection = {
    id: "notes",
    name: "Notas",
    columns: [
      { id: "title", name: "Título", type: "text" },
      { id: "date", name: "Fecha", type: "date" },
      { id: "startTime", name: "Inicio", type: "time" },
      { id: "endTime", name: "Fin", type: "time" },
      { id: "series", name: "Serie", type: "text" },
      { id: "series_rule", name: "Regla", type: "text" },
    ],
  };
  const seriesView: CalendarView = {
    id: "notes",
    collectionId: "notes",
    accountId: "acc",
    color: "#60a5fa",
    visible: true,
    mapping: {
      title: "title",
      when: { kind: "split", date: "date", startTime: "startTime", endTime: "endTime" },
      series: { id: "series", rule: "series_rule" },
    },
  };
  const m = makeModel([seriesColl], [seriesView], { defaultTz: TZ });
  const r = row("notes", "n1", {
    title: "Revisión",
    date: "2026-10-19",
    startTime: "09:00",
    endTime: "09:30",
    series: "s-1",
    series_rule: "FREQ=WEEKLY;COUNT=4",
  });

  it("reads the series and its rule, never as an expanding master", () => {
    const ev = rowToEvent(m, r);
    expect(ev?.series).toEqual({ id: "s-1", rule: { freq: "weekly", interval: 1, count: 4 } });
    expect(ev?.recurrence).toBeUndefined();
    expect(ev?.props).toEqual({});
  });

  it("writes it back, and clears it", () => {
    const ev = rowToEvent(m, r) as CalEvent;
    expect(eventToRow(m, r, ev).values).toMatchObject({
      series: "s-1",
      series_rule: "FREQ=WEEKLY;COUNT=4",
    });
    const plain = eventToRow(m, r, { ...ev, series: undefined });
    expect(plain.values.series).toBeNull();
    expect(plain.values.series_rule).toBeNull();
    expect(rowToEvent(m, plain)?.series).toBeUndefined();
    // a note that never had a series gets no empty keys
    const fresh = eventToRow(m, null, { ...ev, series: undefined });
    expect("series" in fresh.values).toBe(false);
  });

  it("is validated: both columns must be text, and it excludes a master recurrence", () => {
    expect(validateModel([seriesColl], [seriesView]).filter((i) => i.severity === "error")).toEqual(
      [],
    );
    const bad: CalendarView = {
      ...seriesView,
      mapping: {
        ...seriesView.mapping,
        series: { id: "date", rule: "nope" },
        recurrence: "series_rule",
      },
    };
    const msgs = validateModel([seriesColl], [bad]).map((i) => i.where);
    expect(msgs).toContain('view "notes" / series.id');
    expect(msgs).toContain('view "notes" / series.rule');
    expect(msgs).toContain('view "notes" / series');
  });
});
