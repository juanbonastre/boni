import { label } from "@boni/entities";
import { openUserStore, type ProposalRow, type UserStore } from "@boni/store";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setSplit } from "./calendarStore.ts";
import { cpu } from "./cpu.test-util.ts";
import { ghostRows, listRows } from "./data.ts";
import {
  crossCalendar,
  freeSlot,
  inboxCard,
  inboxContext,
  judgeTime,
  recheck,
  recheckOnAccept,
  TIME_AREA,
  timeOnAccept,
} from "./inboxCard.ts";
import { seed } from "./seed.test-util.ts";

/** An invented calendar (never real notes) and mail, as the inbox meets them. */
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
  ],
  mapping: { title: "title", when: { kind: "split", date: "date", startTime: "startTime" } },
};

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
});

function env(): UserStore {
  const store = openUserStore(":memory:");
  seed(store, [{ key: "docencia", name: "Docencia", folder: "agenda/docencia/", calendar: RAW }], {
    "agenda/docencia/2026-10-28 Clase.md":
      '---\ntitle: "Clase de ejemplo"\ndate: "2026-10-28"\nstartTime: "10:00"\n---\n',
    "agenda/docencia/2026-10-29 Tutoría.md":
      '---\ntitle: "Tutoría"\ndate: "2026-10-29"\nstartTime: "09:00"\n---\n',
  });
  cleanups.push(() => store.close());
  return store;
}

/** Another proposal from the same mail (its collection already made), in a run of its own. */
function anotherProposal(store: UserStore, id: string, run: string, sender: string) {
  const l = label("user", "personal", []);
  const mail = store.list("t_correo")[0]?.entity.id as string;
  store.journal.startRun({ id: run, turn: null, origin: "background", device: null, started: 1 });
  store.journal.setPlan(run, { steps: [{ tool: "entities.get", args: { id: { lit: mail } } }] });
  store.journal.addProposal({
    id,
    run,
    tool: "entities.create",
    args: { values: {}, origins: [], why: { t: "v", value: "x", label: l, derived: false } },
    view: {
      tool: "entities.create",
      title: "Crear",
      rows: [
        { arg: "type", role: "type", value: "docencia", detail: "Docencia" },
        { arg: "values.title", value: `Otra tarea ${id}` },
        { arg: "values.date", value: "2026-10-29" },
      ],
    },
    sources: [`mail:${sender}`],
    created: 3,
  });
}

/** A proposal to create a record of Docencia with the given title, day and hours (invented), in a run of its own. */
function proposalAt(
  store: UserStore,
  id: string,
  o: { title: string; day?: string; start?: string; end?: string },
): ProposalRow {
  const l = label("user", "personal", []);
  store.journal.startRun({
    id: `run-${id}`,
    turn: null,
    origin: "background",
    device: null,
    started: 1,
  });
  store.journal.addProposal({
    id,
    run: `run-${id}`,
    tool: "entities.create",
    args: { values: {}, origins: [], why: { t: "v", value: "x", label: l, derived: false } },
    view: {
      tool: "entities.create",
      title: "Crear",
      rows: [
        { arg: "type", role: "type", value: "docencia", detail: "Docencia" },
        { arg: "values.title", value: o.title },
        ...(o.day ? [{ arg: "values.date", value: o.day }] : []),
        ...(o.start ? [{ arg: "values.startTime", value: o.start }] : []),
        ...(o.end ? [{ arg: "values.endTime", value: o.end }] : []),
      ],
    },
    sources: ["mail:alguien@example.com"],
    created: 3,
  });
  return store.journal.proposal(id) as ProposalRow;
}

/** A mail and the proposal its background run made, as mail.ts leaves them. */
function proposalFromMail(
  store: UserStore,
  id: string,
  run: string,
  sender: string,
  why = "antes del jueves revisad las actas de FUP 1",
) {
  const l = label("user", "personal", []);
  store.applySchema(
    {
      op: "create_type",
      type: {
        id: "t_correo",
        key: "correo",
        name: "Correos",
        fields: [
          { id: "f_asunto", key: "asunto", name: "Asunto", type: "text", label: l },
          { id: "f_de", key: "de", name: "De", type: "text", label: l },
          { id: "f_de_nombre", key: "de-nombre", name: "De (nombre)", type: "text", label: l },
        ],
        titleField: "f_asunto",
        sensitivity: "personal",
        schemaVersion: 1,
        label: l,
      },
    },
    { actor: "agent" },
  );
  const mail = store.create(
    "t_correo",
    {
      f_asunto: { value: "Actas de FUP 1", label: l },
      f_de: { value: sender, label: l },
      f_de_nombre: { value: "Coordinación de ejemplo", label: l },
      $body: {
        value: "Hola,\n\nantes del jueves revisad las actas de FUP 1.\n\nGracias.",
        label: l,
      },
    },
    { actor: "agent" },
  );
  store.journal.startRun({ id: run, turn: null, origin: "background", device: null, started: 1 });
  store.journal.setPlan(run, {
    steps: [{ tool: "entities.get", args: { id: { lit: mail.entity.id } } }],
  });
  store.journal.addProposal({
    id,
    run,
    tool: "entities.create",
    args: { values: {}, origins: [], why: { t: "v", value: why, label: l, derived: false } },
    view: {
      tool: "entities.create",
      title: "Crear",
      rows: [
        { arg: "type", role: "type", value: "docencia", detail: "Docencia" },
        { arg: "values.title", value: "Revisar actas de FUP 1" },
        { arg: "values.date", value: "2026-10-29" },
      ],
    },
    sources: [`mail:${sender}`],
    created: 2,
  });
}

describe("the inbox's card for a proposal", () => {
  it("says what it does, where it came from, and what the days around it hold", () => {
    const store = env();
    proposalFromMail(store, "p1", "r1", "coordinacion@example.edu");
    const card = inboxCard(
      store,
      store.journal.proposal("p1") as NonNullable<ReturnType<typeof store.journal.proposal>>,
      {
        mailAccount: "ejemplo@example.edu",
      },
    );
    expect(card).toMatchObject({
      action: "create",
      collection: "Docencia",
      kind: "task",
      title: "Revisar actas de FUP 1",
      day: "2026-10-29",
      source: {
        kind: "mail",
        account: "ejemplo@example.edu",
        from: "Coordinación de ejemplo",
        subject: "Actas de FUP 1",
        excerpt: "Hola, antes del jueves revisad las actas de FUP 1. Gracias.",
        open: { type: "t_correo" },
      },
      // The reader's quote, found as such in the mail by the code.
      why: { text: "antes del jueves revisad las actas de FUP 1", verbatim: true },
      familiar: 0,
      complete: true,
      mode: "detailed",
    });
    expect(card.context.map((d) => [d.day, d.items.map((i) => i.title)])).toEqual([
      ["2026-10-28", ["Clase de ejemplo"]],
      ["2026-10-29", ["Tutoría"]],
      ["2026-10-30", []],
    ]);
  });

  it("says what the calendar already has of a proposal, own or external, and what it overlaps (task 51)", () => {
    const store = env();
    const ucam = {
      title: "Clase IPM",
      start: "17:00",
      end: "18:00",
      external: "ext:ucam:u1",
      calendar: "UCAM",
    };
    const ctx = () =>
      inboxContext(store, {
        external: (day) =>
          day === "2026-10-28"
            ? [ucam]
            : day === "2026-10-30"
              ? [{ ...ucam, title: "Claustro", start: "09:00", end: "10:00" }]
              : [],
      });
    const card = (id: string, o: Parameters<typeof proposalAt>[2]) =>
      inboxCard(store, proposalAt(store, id, o), {}, ctx());
    // The same thing as his own record (a like title, the same moment): said, with nothing to link.
    expect(
      card("a", {
        title: "Clase de ejemplo (con nota)",
        day: "2026-10-28",
        start: "10:30",
        end: "11:30",
      }).calendar,
    ).toEqual({
      already: {
        id: expect.any(String),
        title: "Clase de ejemplo",
        start: "10:00",
        end: null,
        calendar: null,
        external: null,
        done: null,
      },
      same: null,
      overlaps: [],
    });
    // Another title at the same moment: it may be the same, so the card asks (task 58), an overlap no more.
    expect(
      card("b", { title: "Reunión", day: "2026-10-28", start: "10:00", end: "11:00" }).calendar,
    ).toEqual({
      already: null,
      same: {
        id: expect.any(String),
        title: "Clase de ejemplo",
        start: "10:00",
        end: null,
        calendar: null,
        external: null,
        done: null,
      },
      overlaps: [],
    });
    // The same thing as an external calendar's event: its id, so «Enlazar» can make the record linked to it.
    const c = card("c", { title: "Clase IPM 8", day: "2026-10-28", start: "17:00", end: "18:00" });
    expect(c.calendar).toEqual({
      already: {
        id: null,
        title: "Clase IPM",
        start: "17:00",
        end: "18:00",
        calendar: "UCAM",
        external: "ext:ucam:u1",
        done: null,
      },
      same: null,
      overlaps: [],
    });
    // The external events are among the day's items too, as items only.
    expect(c.context.find((d) => d.day === "2026-10-28")?.items).toEqual([
      { id: expect.any(String), title: "Clase de ejemplo", start: "10:00", end: null },
      { title: "Clase IPM", start: "17:00", end: "18:00" },
    ]);
    // A task without a time: the same title that day is enough; and its free hour skips the external event.
    expect(card("d", { title: "Tutoría", day: "2026-10-29" }).calendar?.already?.title).toBe(
      "Tutoría",
    );
    store.applySchema(
      { op: "set_roles", type: "t_docencia", roles: { date: "f_date", time: "f_starttime" } },
      { actor: "user" },
    );
    expect(card("e", { title: "Preparar clase", day: "2026-10-30" }).suggestedTime?.start).toBe(
      "10:00",
    );
    // Without a day there is nothing to cross.
    expect(card("f", { title: "Algo" }).calendar).toBeNull();
  });

  it("a split calendar's day holds each record once, its branch's too, and is kept while nothing changes (task 43)", () => {
    const store = openUserStore(":memory:");
    cleanups.push(() => store.close());
    seed(
      store,
      [
        {
          key: "docencia",
          name: "Docencia",
          folder: "agenda/docencia/",
          fields: { tipo: { type: "select", options: ["clase", "tutoría"] } },
          calendar: RAW,
        },
        { key: "evento", name: "Evento", folder: "agenda/docencia/eventos/", parent: "docencia" },
      ],
      {
        "agenda/docencia/2026-10-28 Clase.md":
          '---\ntitle: "Clase de ejemplo"\ndate: "2026-10-28"\nstartTime: "10:00"\ntipo: clase\n---\n',
        "agenda/docencia/eventos/2026-10-29 Tutoría.md":
          '---\ntitle: "Tutoría"\ndate: "2026-10-29"\nstartTime: "09:00"\ntipo: tutoría\n---\n',
      },
    );
    const type = Object.values(store.schema().types).find((t) => t.key === "docencia")
      ?.id as string;
    const tipo = store.schema().types[type]?.fields.find((f) => f.name === "tipo")?.id as string;
    expect(setSplit(store, "docencia", tipo)).toBe("ok");
    proposalFromMail(store, "p1", "r1", "coordinacion@example.edu");
    const card = () =>
      inboxCard(
        store,
        store.journal.proposal("p1") as NonNullable<ReturnType<typeof store.journal.proposal>>,
        { mailAccount: "ejemplo@example.edu" },
      );
    // Two calendars (one per «tipo»), each record once, the Evento's (a daughter) too.
    expect(card().context.map((d) => [d.day, d.items.map((i) => i.title)])).toEqual([
      ["2026-10-28", ["Clase de ejemplo"]],
      ["2026-10-29", ["Tutoría"]],
      ["2026-10-30", []],
    ]);
    const list = vi.spyOn(store, "list");
    card();
    expect(list.mock.calls.length).toBe(0);
    list.mockRestore();
    // What changes is put in it, nothing read again (task 43): the tutorial moves to the 30th, a new class comes.
    const defType = store.schema().types[type];
    const field = (name: string) =>
      defType?.fields.find((f) => f.name === name || f.key === name)?.id as string;
    const evento = Object.values(store.schema().types).find((t) => t.key === "evento")
      ?.id as string;
    const tutoria = store.list(evento)[0]?.entity.id as string;
    const clase = defType?.fields
      .find((f) => f.id === tipo)
      ?.options?.find((o) => o.name === "clase")?.id;
    const l = label("user", "personal", []);
    store.update(
      tutoria,
      { [field("date")]: { value: "2026-10-30", label: l } },
      { actor: "user" },
    );
    store.create(
      type,
      {
        [defType?.titleField as string]: { value: "Otra clase", label: l },
        [field("date")]: { value: "2026-10-28", label: l },
        [tipo]: { value: clase, label: l },
      },
      { actor: "user" },
    );
    const again = vi.spyOn(store, "list");
    expect(card().context.map((d) => [d.day, d.items.map((i) => i.title)])).toEqual([
      ["2026-10-28", ["Otra clase", "Clase de ejemplo"]],
      ["2026-10-29", []],
      ["2026-10-30", ["Tutoría"]],
    ]);
    expect(again.mock.calls.length).toBe(0);
    again.mockRestore();
  });

  it("a reason the mail does not say in those words is shown, but not as a quote", () => {
    const store = env();
    proposalFromMail(store, "p1", "r1", "coordinacion@example.edu", "Piden revisar actas");
    const card = inboxCard(
      store,
      store.journal.proposal("p1") as NonNullable<ReturnType<typeof store.journal.proposal>>,
    );
    expect(card.why).toEqual({ text: "Piden revisar actas", verbatim: false });
  });

  it("is compact once Juan accepted two like it from the same source", () => {
    const store = env();
    proposalFromMail(store, "p0", "r0", "coordinacion@example.edu");
    for (const id of ["a1", "a2"]) {
      const p = store.journal.proposal("p0") as NonNullable<
        ReturnType<typeof store.journal.proposal>
      >;
      store.journal.addProposal({ ...p, id, created: 1 });
      store.journal.setProposal(id, "accepted", 3);
    }
    expect(
      inboxCard(
        store,
        store.journal.proposal("p0") as NonNullable<ReturnType<typeof store.journal.proposal>>,
      ),
    ).toMatchObject({
      familiar: 2,
      mode: "compact",
    });
  });

  it("says when Boni would have accepted it alone: three like it accepted as they were", () => {
    const store = env();
    proposalFromMail(store, "p0", "r0", "coordinacion@example.edu");
    const p0 = store.journal.proposal("p0") as NonNullable<
      ReturnType<typeof store.journal.proposal>
    >;
    expect(inboxCard(store, p0).wouldAccept).toBe(false);
    for (const [i, id] of ["a1", "a2", "a3"].entries()) {
      store.journal.addProposal({ ...p0, id, created: 1 });
      store.journal.setProposal(id, "accepted", 3 + i);
    }
    expect(inboxCard(store, p0).wouldAccept).toBe(true);
    // A correction of the last one: the reading was wrong, Boni would not.
    store.journal.addProposal({ ...p0, id: "a4", created: 1 });
    store.journal.setProposal("a4", "accepted", 9, {
      type: { from: "docencia", to: "gestiones" },
    });
    expect(inboxCard(store, p0).wouldAccept).toBe(false);
    // No task column in this calendar: "Ya lo hice" is not offered.
    expect(inboxCard(store, p0).canMarkDone).toBe(false);
  });

  it("a pending proposal is a ghost row of its collection, never an entity; decided, it is gone", () => {
    const store = env();
    proposalFromMail(store, "p1", "r1", "coordinacion@example.edu");
    expect(ghostRows(store, "t_docencia")).toEqual([
      {
        id: "ghost:p1",
        proposal: "p1",
        values: { f_title: "Revisar actas de FUP 1", f_date: "2026-10-29" },
        updated: 2,
      },
    ]);
    const listed = listRows(store, "t_docencia");
    expect(listed.ghosts).toHaveLength(1);
    expect(listed.rows.some((r) => r.id.startsWith("ghost:"))).toBe(false);
    expect(store.list("t_docencia")).toHaveLength(2); // the two classes, not the proposal
    store.journal.setProposal("p1", "rejected", 5);
    expect(ghostRows(store, "t_docencia")).toEqual([]);
  });

  it("a task with a day and no time gets the first free hour of its day, as a decision: asked, then alone when earned", () => {
    const store = env();
    store.applySchema(
      {
        op: "set_roles",
        type: "t_docencia",
        roles: { date: "f_date", time: "f_starttime" },
      },
      { actor: "user" },
    );
    proposalFromMail(store, "p1", "r1", "coordinacion@example.edu");
    // The 29th has «Tutoría» at 9:00 (an hour, no end given): the first free hour is 10:00.
    const card = () => inboxCard(store, store.journal.proposal("p1") as ProposalRow);
    expect(card().suggestedTime).toEqual({
      start: "10:00",
      end: "11:00",
      startKey: "starttime",
      endKey: null,
      outcome: "ask",
    });
    expect(card().start).toBeNull();
    // One decision per proposal, however often the card is drawn; nothing is set alone yet.
    const mine = () => store.journal.decisionsOf("r1").filter((d) => d.area === TIME_AREA);
    expect(mine()).toHaveLength(1);
    expect(mine()[0]).toMatchObject({ cost: "A", p: 0, outcome: "ask", result: null });
    const p1 = store.journal.proposal("p1") as ProposalRow;
    expect(timeOnAccept(store, p1, { values: { title: "x" } })).toEqual({ values: { title: "x" } });
    // Taken, it is right; a second one accepted without it, wrong.
    judgeTime(store, p1, { starttime: "10:00" }, 5);
    expect(mine()[0]?.result).toBe("right");
    anotherProposal(store, "p2", "r2", "coordinacion@example.edu");
    inboxCard(store, store.journal.proposal("p2") as ProposalRow);
    judgeTime(store, store.journal.proposal("p2") as ProposalRow, {}, 6);
    expect(store.journal.decisionsOf("r2").find((d) => d.area === TIME_AREA)?.result).toBe("wrong");
    // Once his answers earn it (0.9, cautious), the time is set alone: the card says it and it goes with the acceptance.
    for (let i = 0; i < 60; i++)
      store.journal.addDecision({
        id: `t${i}`,
        run: "r0",
        area: TIME_AREA,
        cost: "A",
        p: 0.5,
        outcome: "ask",
        detail: null,
        at: 10 + i,
      });
    for (let i = 0; i < 60; i++) store.journal.setDecisionResult(`t${i}`, "right", 100);
    anotherProposal(store, "p3", "r3", "coordinacion@example.edu");
    const alone = inboxCard(store, store.journal.proposal("p3") as ProposalRow);
    expect(alone.suggestedTime?.outcome).toBe("do");
    expect([alone.start, alone.end]).toEqual(["10:00", "11:00"]);
    const p3 = store.journal.proposal("p3") as ProposalRow;
    expect(timeOnAccept(store, p3, {})).toEqual({ values: { starttime: "10:00" } });
    // His own time, or none, wins over the one set alone.
    expect(timeOnAccept(store, p3, { values: { starttime: null } })).toEqual({
      values: { starttime: null },
    });
    judgeTime(store, p3, { starttime: "10:00" }, 200);
    expect(store.journal.decisionsOf("r3").find((d) => d.area === TIME_AREA)?.result).toBe("right");
  });

  it("the first free hour: around what the day holds, at a half hour when that is the gap, none when the day is full", () => {
    expect(freeSlot([])).toEqual({ start: "09:00", end: "10:00" });
    expect(freeSlot([{ start: "09:00", end: "09:30" }])).toEqual({ start: "09:30", end: "10:30" });
    expect(
      freeSlot([
        { start: "09:00", end: null },
        { start: "10:00", end: "12:00" },
      ]),
    ).toEqual({
      start: "12:00",
      end: "13:00",
    });
    expect(freeSlot([{ start: null, end: null }])).toEqual({ start: "09:00", end: "10:00" });
    expect(freeSlot([{ start: "09:00", end: "20:00" }])).toBeNull();
  });
});

describe("a proposal crossed with the day's entries (tasks 51 and 58)", () => {
  const p = { title: "Tomar café con Ana", start: "16:00", end: "17:00" };
  const quedada = { id: "e_quedada", title: "Quedada cafe", start: "16:00", end: "17:00" };
  it("a like title is «already»; another title at the same moment is «same», to ask; the rest overlap", () => {
    const clase = { id: "e_clase", title: "Clase de ejemplo", start: "15:00", end: "18:00" };
    const r = crossCalendar(p, [clase, quedada]);
    expect(r.already).toBeNull();
    expect(r.same).toMatchObject({ id: "e_quedada", title: "Quedada cafe", start: "16:00" });
    expect(r.overlaps.map((o) => o.title)).toEqual(["Clase de ejemplo"]);
    // The closest moment when several; half an hour away at most.
    const later = { id: "e_later", title: "Reunión", start: "16:20", end: "17:00" };
    expect(crossCalendar(p, [later, quedada]).same?.id).toBe("e_quedada");
    const far = { id: "e_far", title: "Reunión", start: "16:40", end: "17:30" };
    expect(crossCalendar(p, [far]).same).toBeNull();
    expect(crossCalendar(p, [far]).overlaps.map((o) => o.title)).toEqual(["Reunión"]);
  });
  it("alike by title it is «already», nothing is asked; an external event says which; no moment, nothing by time alone", () => {
    const cafe = { id: "e_cafe", title: "Café con Ana", start: "16:00", end: null };
    const alike = crossCalendar(p, [cafe, quedada]);
    expect(alike.already?.id).toBe("e_cafe");
    expect(alike.same).toBeNull();
    const ext = crossCalendar(p, [
      { title: "Coffee", start: "16:00", end: "16:30", external: "ext:g:u1", calendar: "Google" },
    ]);
    expect(ext.same).toMatchObject({ id: null, external: "ext:g:u1", calendar: "Google" });
    expect(
      crossCalendar({ title: "Tomar café", start: null, end: null }, [quedada]).same,
    ).toBeNull();
  });
});

describe("a card checked again each time it is seen (task 73)", () => {
  const at = (iso: string) => Date.parse(iso);
  const L = label("user", "personal", []);

  it("its day from today and whether its hour passed, by the request's clock and zone", () => {
    const store = env();
    const now = (p: ProposalRow, iso: string, tz = "Europe/Madrid") =>
      inboxCard(store, p, { decide: false }, inboxContext(store, { now: at(iso), tz })).now;
    // «hoy a las 12», read the day before: tomorrow then, today now, past once it ended (Madrid is UTC+1).
    const r = proposalAt(store, "r", {
      title: "Reunión",
      day: "2026-10-29",
      start: "12:00",
      end: "13:00",
    });
    expect(now(r, "2026-10-28T19:00:00Z")).toEqual({ fromToday: 1, state: null });
    expect(now(r, "2026-10-29T10:00:00Z")).toEqual({ fromToday: 0, state: null });
    expect(now(r, "2026-10-29T11:59:00Z")).toEqual({ fromToday: 0, state: null });
    expect(now(r, "2026-10-29T12:00:00Z")).toEqual({ fromToday: 0, state: "past" });
    expect(now(r, "2026-10-30T08:00:00Z")).toEqual({ fromToday: -1, state: "past" });
    // Further than a day either side: no word for the day, its date says it.
    expect(now(r, "2026-11-02T08:00:00Z")).toEqual({ fromToday: null, state: "past" });
    expect(now(r, "2026-10-20T08:00:00Z")).toEqual({ fromToday: null, state: null });
    // The same instant is another day in another zone.
    expect(now(r, "2026-10-28T23:30:00Z").fromToday).toBe(0);
    expect(now(r, "2026-10-28T23:30:00Z", "America/New_York").fromToday).toBe(1);
    // Without an end, an hour after its start.
    const s = proposalAt(store, "s", { title: "Llamada", day: "2026-10-29", start: "12:00" });
    expect(now(s, "2026-10-29T11:59:00Z").state).toBeNull();
    expect(now(s, "2026-10-29T12:00:00Z").state).toBe("past");
    // A task with a day and no hour: once its day is over, in its zone.
    const t = proposalAt(store, "t", { title: "Entregar notas", day: "2026-10-29" });
    expect(now(t, "2026-10-29T22:59:00Z").state).toBeNull();
    expect(now(t, "2026-10-29T23:00:00Z")).toEqual({ fromToday: -1, state: "past" });
    // No day, nothing to say.
    const u = proposalAt(store, "u", { title: "Algo sin día" });
    expect(now(u, "2026-10-29T12:00:00Z")).toEqual({ fromToday: null, state: null });
    // A change to a record, not a new one: its day is said, never «Ya pasó».
    expect(
      recheck(
        { action: "update", day: "2026-10-28", start: "10:00", end: null, calendar: null },
        at("2026-10-29T12:00:00Z"),
        "Europe/Madrid",
      ),
    ).toEqual({ fromToday: -1, state: null });
    // Seen with decide: false, no time decision is recorded for it.
    expect(store.journal.decisions(TIME_AREA)).toEqual([]);
  });

  it("«Ya hecho» when the calendar has it done, «Ya está en el calendario» when it has it; both before «Ya pasó»", () => {
    const store = env();
    const now = (p: ProposalRow, iso: string) =>
      inboxCard(
        store,
        p,
        { decide: false },
        inboxContext(store, { now: at(iso), tz: "Europe/Madrid" }),
      ).now.state;
    const p = proposalAt(store, "a", {
      title: "Clase de ejemplo",
      day: "2026-10-28",
      start: "10:00",
      end: "11:00",
    });
    expect(now(p, "2026-10-27T08:00:00Z")).toBe("calendar");
    expect(now(p, "2026-11-01T08:00:00Z")).toBe("calendar");
    // Its collection gets a done box and the record is ticked: the same task, already done.
    store.applySchema(
      {
        op: "add_field",
        type: "t_docencia",
        field: { id: "f_hecha", key: "hecha", name: "Hecha", type: "checkbox", label: L },
      },
      { actor: "user" },
    );
    store.applySchema(
      {
        op: "set_roles",
        type: "t_docencia",
        roles: { date: "f_date", time: "f_starttime", done: "f_hecha" },
      },
      { actor: "user" },
    );
    expect(now(p, "2026-10-27T08:00:00Z")).toBe("calendar");
    const clase = store
      .list("t_docencia")
      .find((e) => e.entity.values.f_title === "Clase de ejemplo");
    if (!clase) throw new Error("no class");
    store.update(clase.entity.id, { f_hecha: { value: true, label: L } }, { actor: "user" });
    expect(now(p, "2026-10-27T08:00:00Z")).toBe("done");
    expect(now(p, "2026-11-01T08:00:00Z")).toBe("done");
    // Another title at the same moment is only asked about («¿Es el mismo?»), no word.
    const q = proposalAt(store, "b", { title: "Reunión", day: "2026-10-28", start: "10:00" });
    expect(now(q, "2026-10-27T08:00:00Z")).toBeNull();
  });

  it("the mail's source says whether Juan already opened it, from what the connector keeps", () => {
    const store = env();
    proposalFromMail(store, "m", "run-m", "coordinacion@example.com");
    const card = () =>
      inboxCard(
        store,
        store.journal.proposal("m") as ProposalRow,
        { decide: false },
        inboxContext(store, {}),
      ).source;
    // A connector that did not keep it yet: unknown, nothing is said.
    expect(card()?.read).toBeNull();
    store.applySchema(
      {
        op: "add_field",
        type: "t_correo",
        field: { id: "f_leido", key: "leido", name: "Leído", type: "checkbox", label: L },
      },
      { actor: "connector" },
    );
    const mail = store.list("t_correo")[0]?.entity.id as string;
    store.update(mail, { f_leido: { value: false, label: L } }, { actor: "connector" });
    expect(card()?.read).toBe(false);
    store.update(mail, { f_leido: { value: true, label: L } }, { actor: "connector" });
    expect(card()?.read).toBe(true);
  });

  it("accepting checks again: a word Juan did not see stops it, the word he saw lets it through", () => {
    const store = env();
    const p = proposalAt(store, "r", {
      title: "Reunión",
      day: "2026-10-29",
      start: "12:00",
      end: "13:00",
    });
    const ctx = (iso: string) => inboxContext(store, { now: at(iso), tz: "Europe/Madrid" });
    // Seen yesterday with no word; accepted after it passed: stopped, with the word it has now.
    expect(recheckOnAccept(store, p, null, ctx("2026-10-29T13:00:00Z"))).toEqual({
      error: "changed",
      state: "past",
    });
    expect(recheckOnAccept(store, p, undefined, ctx("2026-10-29T13:00:00Z"))).toEqual({
      error: "changed",
      state: "past",
    });
    // Seen as «Ya pasó» and accepted all the same: his decision.
    expect(recheckOnAccept(store, p, "past", ctx("2026-10-29T13:00:00Z"))).toBeNull();
    // Nothing changed: through.
    expect(recheckOnAccept(store, p, null, ctx("2026-10-29T08:00:00Z"))).toBeNull();
    // A word that went away (or one the client made up) is a change too.
    expect(recheckOnAccept(store, p, "past", ctx("2026-10-29T08:00:00Z"))).toEqual({
      error: "changed",
      state: null,
    });
    expect(recheckOnAccept(store, p, "<b>", ctx("2026-10-29T13:00:00Z"))).toEqual({
      error: "changed",
      state: "past",
    });
  });

  it("dozens of cards over thousands of records and mails read the calendar once, in a time the inbox can bear (A-15)", () => {
    const store = env();
    const days = Array.from({ length: 365 }, (_, i) =>
      new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10),
    );
    // Written in one transaction: one per record took most of vitest's 5 s before anything was measured (task 108).
    store.batch(() => {
      for (let i = 0; i < 3000; i++)
        store.create(
          "t_docencia",
          {
            f_title: { value: `Clase ${i}`, label: L },
            f_date: { value: days[i % days.length] as string, label: L },
            f_starttime: { value: `${String(8 + (i % 10)).padStart(2, "0")}:00`, label: L },
          },
          { actor: "user" },
        );
    });
    proposalFromMail(store, "m0", "run-m0", "coordinacion@example.com");
    store.batch(() => {
      for (let i = 1; i < 400; i++)
        store.create(
          "t_correo",
          { f_asunto: { value: `Correo ${i}`, label: L } },
          { actor: "connector" },
        );
    });
    const cards = Array.from({ length: 60 }, (_, i) =>
      proposalAt(store, `p${i}`, {
        title: `Propuesta ${i}`,
        day: days[330 + (i % 30)] as string,
        start: "12:00",
      }),
    );
    const spy = vi.spyOn(store, "list");
    const t0 = cpu();
    const ctx = inboxContext(store, { now: at("2026-10-29T10:00:00Z"), tz: "Europe/Madrid" });
    const served = cards.map((p) => inboxCard(store, p, { decide: false }, ctx));
    const first = cpu() - t0;
    // Served again (the inbox polls): the calendar's day memo holds, nothing is read whole again.
    const t1 = cpu();
    const ctx2 = inboxContext(store, { now: at("2026-10-29T10:01:00Z"), tz: "Europe/Madrid" });
    for (const p of cards) inboxCard(store, p, { decide: false }, ctx2);
    const again = cpu() - t1;
    const docencia = spy.mock.calls.filter((c) => c[0] === "t_docencia").length;
    spy.mockRestore();
    expect(served.every((c) => c.now.state === null && c.now.fromToday === null)).toBe(true);
    expect(docencia).toBeLessThanOrEqual(1);
    expect(first).toBeLessThan(1000);
    expect(again).toBeLessThan(200);
  }, 120_000);
});
