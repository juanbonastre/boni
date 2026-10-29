import { label } from "@boni/entities";
import { openUserStore, type RunRow, type UserStore } from "@boni/store";
import { describe, expect, it } from "vitest";
import { proposalsByRun, runInfo } from "./runInfo.ts";

/** Invented mail and tasks (never real ones), as the journal and the log keep them. */
const l = label("user", "personal", []);
function env(): UserStore {
  const store = openUserStore(":memory:");
  const type = (id: string, key: string, name: string, fields: [string, string][]) =>
    store.applySchema(
      {
        op: "create_type",
        type: {
          id,
          key,
          name,
          fields: fields.map(([fid, fname]) => ({
            id: fid,
            key: fid.slice(2),
            name: fname,
            type: "text" as const,
            label: l,
          })),
          titleField: fields[0]?.[0] ?? "",
          sensitivity: "personal",
          schemaVersion: 1,
          label: l,
        },
      },
      { actor: "agent" },
    );
  type("t_correo", "correo", "Correos", [
    ["f_asunto", "Asunto"],
    ["f_de", "De"],
    ["f_de_nombre", "De (nombre)"],
  ]);
  type("t_tarea", "tarea", "Tareas", [["f_titulo", "Título"]]);
  return store;
}
const mailOf = (store: UserStore, subject: string) =>
  store.create(
    "t_correo",
    {
      f_asunto: { value: subject, label: l },
      f_de: { value: "coordinacion@example.edu", label: l },
      f_de_nombre: { value: "Coordinación de ejemplo", label: l },
    },
    { actor: "agent" },
  ).entity.id;
/** A background reading of a mail as mail.ts plans it: read it, then (with collections) create. */
function reading(store: UserStore, run: string, mail: string, creates = true) {
  store.journal.startRun({ id: run, turn: null, origin: "background", device: null, started: 1 });
  const plan = {
    steps: [
      { id: "m", op: "call", tool: "entities.get", args: { id: { lit: mail } } },
      ...(creates ? [{ id: "c", op: "call", tool: "entities.create", args: {} }] : []),
    ],
  };
  store.journal.setPlan(run, plan);
  store.journal.finishRun(run, "done", plan, 2);
}
const runOf = (store: UserStore, id: string) =>
  store.journal.runs(50).find((r) => r.id === id) as RunRow;

describe("what each run of the Registro was, and what came of it", () => {
  it("a mail read in the background: its subject and sender, and its proposals by what Juan decided", () => {
    const store = env();
    reading(store, "r1", mailOf(store, "Actas de FUP 1"));
    for (const [id, status] of [
      ["p1", "pending"],
      ["p2", "rejected"],
    ] as const) {
      store.journal.addProposal({
        id,
        run: "r1",
        tool: "entities.create",
        args: { values: {}, origins: [] },
        view: { tool: "entities.create", title: "Crear", rows: [] },
        sources: [],
        created: 2,
      });
      if (status !== "pending") store.journal.setProposal(id, status, 3);
    }
    expect(
      runInfo(store, runOf(store, "r1"), {
        proposals: proposalsByRun(store),
        mailAccount: "ejemplo@example.edu",
      }),
    ).toEqual({
      what: {
        kind: "mail",
        subject: "Actas de FUP 1",
        from: "Coordinación de ejemplo",
        account: "ejemplo@example.edu",
      },
      proposals: { pending: 1, accepted: 0, rejected: 1, postponed: 0, stale: 0 },
      changes: [],
      changed: 0,
    });
  });

  it("a mail read again to measure a guide, and the reviewer, are told apart from a new mail", () => {
    const store = env();
    reading(store, "r2", mailOf(store, "Horario inventado"), false);
    expect(runInfo(store, runOf(store, "r2")).what).toEqual({
      kind: "measure",
      subject: "Horario inventado",
    });
    store.journal.startRun({
      id: "r3",
      turn: null,
      origin: "background",
      device: null,
      started: 1,
    });
    store.journal.setPlan("r3", { steps: [{ id: "r", op: "read", reader: "review_reading" }] });
    expect(runInfo(store, runOf(store, "r3")).what).toEqual({ kind: "review" });
  });

  it("an accepted proposal and a request: what they changed, by title and collection, undone or not", () => {
    const store = env();
    store.journal.startRun({ id: "r4", turn: null, origin: "accepted", device: null, started: 1 });
    const meta = { actor: "agent" as const, run: "r4" };
    const t = store.create("t_tarea", { f_titulo: { value: "Revisar actas", label: l } }, meta);
    store.update(t.entity.id, { f_titulo: { value: "Revisar actas de FUP", label: l } }, meta);
    expect(runInfo(store, runOf(store, "r4"))).toMatchObject({
      what: { kind: "accepted" },
      changes: [
        { action: "create", title: "Revisar actas de FUP", collection: "Tareas", undone: false },
        { action: "update", title: "Revisar actas de FUP", collection: "Tareas", undone: false },
      ],
      changed: 2,
    });
    store.undoRun("r4", { actor: "user" });
    expect(runInfo(store, runOf(store, "r4")).changes.every((c) => c.undone)).toBe(true);

    store.journal.startRun({
      id: "r5",
      turn: "t5",
      origin: "turn",
      device: "portatil",
      started: 1,
    });
    store.journal.modelCall({
      run: "r5",
      role: "planner",
      provider: "fake",
      model: "fake",
      promptHash: "x",
      request: { input: { request: "Apunta una tarea: llamar al taller" } },
      response: null,
      usage: null,
      at: 1,
    });
    expect(runInfo(store, runOf(store, "r5")).what).toEqual({
      kind: "request",
      text: "Apunta una tarea: llamar al taller",
    });
  });

  it("a hand edit from the retired mirror: no vault path, only its origin (D-17)", () => {
    const store = env();
    store.journal.startRun({ id: "r6", turn: null, origin: "mirror", device: null, started: 1 });
    store.journal.addProposal({
      id: "p6",
      run: "r6",
      tool: "entities.delete",
      args: { values: {}, origins: [] },
      view: {
        tool: "entities.delete",
        title: "Nota borrada en Obsidian",
        rows: [{ arg: "note", value: "proyectos/ejemplo.md" }],
      },
      sources: [],
      created: 2,
    });
    expect(runInfo(store, runOf(store, "r6")).what).toEqual({ kind: "other" });
  });
});
