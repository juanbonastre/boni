import { label } from "@boni/entities";
import { openUserStore, type ProposalRow, type UserStore } from "@boni/store";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setSplit } from "./calendarStore.ts";
import { ghostRows, listRows } from "./data.ts";
import { freeSlot, inboxCard, judgeTime, TIME_AREA, timeOnAccept } from "./inboxCard.ts";
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
