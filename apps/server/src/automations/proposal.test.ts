// What a run saves without asking and what it proposes, over the real store and the real policy
// (docs/automatizaciones.md §6: AU-167, AU-186, AU-193, AU-170, AU-195, the decision 11 of its §10, and what was left
// of AU-185; phase F14d): the rule P28 row by row with a run by hand and a scheduled one, the one proposal of a run in
// the inbox of always, and accepting it with each value's label. The rule's id is kept in each test's name
// (`make check` reads them, T-10). A store per test with data shaped like the user's (seed.test-util.ts), a scheduled
// run started by the test's clock, and no model call; accepting goes through the real agent's `acceptProposal`.
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { fakePlanner } from "@boni/agent";
import { type Cell, newConnection } from "@boni/automations";
import { SYSTEM_TYPES } from "@boni/entities";
import type { UserStore } from "@boni/store";
import { afterAll, describe, expect, it } from "vitest";
import { AgentHost } from "../agent.ts";
import { typeId } from "../seed.test-util.ts";
import { collectionNamed } from "./collections.ts";
import { ACCEPT_RUN, acceptRun, type RunProposalView } from "./proposal.ts";
import {
  answering,
  boxOf,
  CODE,
  CREATE,
  cite,
  folder,
  JUAN,
  made,
  notes,
  OUTSIDE,
  ok,
  PEDIDO,
  ran,
  SCHEDULE,
  START,
  type StepSpec,
  scheduler,
  seeded,
  TRASH,
  ZONE,
} from "./run.test-util.ts";
import { runAsked, runsOf, runView, undoAutomationRun } from "./runs.ts";
import { testAutomation } from "./service.ts";

const files = folder("propuesta");
afterAll(files.done);

const CLIENTE = typeId("cliente");
const at = (h: number, m = 0) => Date.UTC(2026, 10, 17, h, m);
const fieldOf = (s: UserStore, type: string, key: string) =>
  s.schema().types[type]?.fields.find((f) => f.key === key)?.id as string;

/** An order whose note came in a mail: from outside. */
const fromOutside = (s: UserStore, nota = "de un correo") =>
  s.create(
    PEDIDO,
    { [fieldOf(s, PEDIDO, "nota")]: { value: nota, label: OUTSIDE } },
    { actor: "import", device: "seed" },
  ).entity.id;

/** «Buscar» the orders whose note is this one. */
const FIND = (nota: string): StepSpec => [
  "Buscar",
  "collection",
  { collection: "pedido", action: "find", where: [{ field: "nota", op: "is", value: nota }] },
];
/** «Crear» a client named with the row's note. */
const SAVE = (permission: "yes" | "ask", value: unknown = cite("$json.nota")): StepSpec => [
  "Guardar",
  "collection",
  { collection: "cliente", action: "create", fields: [{ field: "nombre", value }], permission },
];
/** A «Código» that asks the box, with a connection to the orders: remove with `remove`. */
const CODE_REMOVE = (remove: "yes" | "ask"): StepSpec => [
  "Código",
  "code",
  { mode: "all", source: "$col('Pedido').remove('x')\nreturn []" },
  { connections: [{ ...newConnection("pedido"), remove: { mode: remove } }] },
];

/** The clients: each name and its field's label's integrity. */
const clients = (s: UserStore) => {
  const f = fieldOf(s, CLIENTE, "nombre");
  return s
    .list(CLIENTE)
    .map((e) => [e.entity.values[f], s.get(e.entity.id)?.labels[f]?.integrity ?? null]);
};
const pending = (s: UserStore) => s.journal.proposals("pending");
/** Runs it at its hour, with the test's box: as the server's scheduler starts it. */
async function atItsHour(
  s: UserStore,
  id: string,
  when = at(10, 5),
  box?: Parameters<typeof scheduler>[2],
) {
  await scheduler(s, ZONE, box).at(when);
  const [r] = ok(runsOf(s, id, {})).runs;
  if (!r) throw new Error("it did not run");
  return r;
}

/** A real server's agent over account 1, its store seeded as his. */
function server() {
  const home = mkdtempSync(join(files.dir, "host-"));
  const planner = fakePlanner([]);
  const host = new AgentHost({ dataDir: home, providers: { planner, reader: planner } });
  const s = host.store(1);
  seeded(s);
  return { host, s, agent: host.agent(1) };
}

describe("what a scheduled run writes alone (F14d)", () => {
  it("AU-167 · a scheduled run of a published version that creates and modifies with values all its own saves them, each operation with the run, and proposes nothing", async () => {
    const s = files.store();
    const a = made(s, [
      SCHEDULE(),
      CREATE("sola"),
      [
        "Modificar",
        "collection",
        {
          collection: "pedido",
          action: "update",
          target: "matching",
          where: [{ field: "nota", op: "is", value: "primero" }],
          fields: [{ field: "nota", value: "cambiado" }],
          permission: "yes",
        },
      ],
    ]);
    ok(a.publish());
    const r = await atItsHour(s, a.id);
    expect(r).toMatchObject({ state: "done", startedBy: "schedule", proposal: null });
    expect(notes(s)).toEqual(expect.arrayContaining(["sola", "cambiado"]));
    expect(
      s
        .runOps(r.id)
        .map((o) => o.kind)
        .sort(),
    ).toEqual(["create", "update"]);
    expect(pending(s)).toEqual([]);
    expect(ok(runView(s, a.id, r.id)).proposal).toBeNull();
  });

  it("AU-167 AU-185 · a scheduled run whose value was computed from something from outside saves it with «Sí», each field kept as from outside in the store, and with «Preguntar» saves nothing and leaves one proposal; the same with a path that depends on something from outside", async () => {
    // A value from outside.
    const yes = files.store();
    fromOutside(yes);
    const a = made(yes, [SCHEDULE(), FIND("de un correo"), SAVE("yes")]);
    ok(a.publish());
    const saved = await atItsHour(yes, a.id);
    expect(saved).toMatchObject({ state: "done", proposal: null });
    expect(clients(yes)).toContainEqual(["de un correo", "external"]);
    expect(saved.line?.outside).toBe(true);

    const ask = files.store();
    fromOutside(ask);
    const b = made(ask, [SCHEDULE(), FIND("de un correo"), SAVE("ask")]);
    ok(b.publish());
    const asked = await atItsHour(ask, b.id);
    expect(asked.state).toBe("done");
    expect(clients(ask).map(([n]) => n)).not.toContain("de un correo");
    expect(ask.runOps(asked.id)).toEqual([]);
    expect(pending(ask).map((p) => p.id)).toEqual([asked.proposal]);

    // A value of its own on a path that depends on something from outside.
    for (const [permission, proposes] of [
      ["yes", false],
      ["ask", true],
    ] as const) {
      const s = files.store();
      fromOutside(s);
      const c = made(
        s,
        [
          SCHEDULE(),
          FIND("de un correo"),
          ["Si", "if", { where: [{ field: "nota", op: "is", value: "de un correo" }] }],
          SAVE(permission, "fijo"),
        ],
        {
          arrows: [
            ["A su hora", "Buscar"],
            ["Buscar", "Si"],
            ["Si", "Guardar", "yes"],
          ],
        },
      );
      ok(c.publish());
      const r = await atItsHour(s, c.id);
      expect(r.state, JSON.stringify(r.error)).toBe("done");
      expect(clients(s).some(([n]) => n === "fijo")).toBe(!proposes);
      expect(pending(s)).toHaveLength(proposes ? 1 : 0);
    }
  });

  it("AU-185 AU-195 · what a «Código» saves from something from outside, by hand and at its hour: with «Sí» both runs save it kept as from outside, with «Preguntar» both leave a proposal and save nothing", async () => {
    // The box answers as the code would: one order created; what it got was from outside, so its write is too.
    const { box } = boxOf(() =>
      answering([], [{ collection: "Pedido", action: "create", fields: { nota: "del código" } }]),
    );
    /** The integrity of the note of the order the code made, or null when there is none. */
    const madeBy = (s: UserStore) => {
      const f = fieldOf(s, PEDIDO, "nota");
      const e = s.list(PEDIDO).find((x) => x.entity.values[f] === "del código");
      return e ? (s.get(e.entity.id)?.labels[f]?.integrity ?? null) : null;
    };
    for (const create of ["yes", "ask"] as const)
      for (const how of ["hand", "schedule"] as const) {
        const s = files.store();
        fromOutside(s);
        const trigger = how === "hand" ? START : SCHEDULE();
        const a = made(s, [trigger, FIND("de un correo"), CODE(create)]);
        ok(a.publish());
        const r =
          how === "hand"
            ? await ran(s, a.id, a.step(trigger[0]), { nota: "" }, { box })
            : await atItsHour(s, a.id, at(10, 5), box);
        expect(r.state, `${how} ${create}: ${JSON.stringify(r.error)}`).toBe("done");
        expect(r.startedBy).toBe(how === "hand" ? "user" : "schedule");
        if (create === "yes") {
          expect(madeBy(s), how).toBe("external");
          expect(r.proposal).toBeNull();
          expect(r.line?.outside).toBe(true);
        } else {
          expect(notes(s), how).not.toContain("del código");
          expect(s.runOps(r.id)).toEqual([]);
          expect(pending(s).map((p) => p.id)).toEqual([r.proposal]);
        }
      }
  });

  it.todo(
    "AU-204 · a scheduled run that would write a value a model wrote: what a step of IA saves is F15's (AU-167's third row points there since F15's design)",
  );

  it("AU-167 · no step of an automation can name a collection of the system, so nothing an automation writes reaches what the app knows of the person, whatever its values carry", async () => {
    const { host, s } = server();
    const named = collectionNamed(s);
    const system = Object.values(s.schema().types).filter(
      (t) => t.system || (SYSTEM_TYPES as readonly string[]).includes(t.id),
    );
    expect(system.length).toBeGreaterThan(0);
    for (const t of system) {
      expect(named(t.name)).toBeUndefined();
      // A «Colección» step on it does not publish: there is no such collection for it.
      const a = made(s, [
        SCHEDULE(),
        [
          "Crear",
          "collection",
          {
            collection: t.key,
            action: "create",
            fields: [{ field: "nombre", value: "x" }],
            permission: "yes",
          },
        ],
      ]);
      expect(a.publish()).toMatchObject({ refused: "blocked" });
    }
    host.close();
  });

  it("AU-186 · a removal with «Sí», of a «Código» and of a «Colección» of a published version, goes to the trash with no proposal in a scheduled run and comes back when the run is undone", async () => {
    // «Colección».
    const s = files.store();
    const a = made(s, [SCHEDULE(), TRASH("primero", "yes")]);
    ok(a.publish());
    const r = await atItsHour(s, a.id);
    expect(r).toMatchObject({ state: "done", proposal: null });
    expect(notes(s)).not.toContain("primero");
    expect(s.runOps(r.id).map((o) => o.kind)).toEqual(["delete"]);
    ok(undoAutomationRun(s, a.id, r.id, JUAN));
    expect(notes(s)).toContain("primero");

    // «Código».
    const t = files.store();
    const row = t
      .list(PEDIDO)
      .find((e) => e.entity.values[fieldOf(t, PEDIDO, "nota")] === "segundo")?.entity.id as string;
    const { box } = boxOf(() =>
      answering([], [{ collection: "Pedido", action: "remove", id: row as Cell }]),
    );
    const b = made(t, [SCHEDULE(), CODE_REMOVE("yes")]);
    ok(b.publish());
    const q = await atItsHour(t, b.id, at(10, 5), box);
    expect(q).toMatchObject({ state: "done", proposal: null });
    expect(notes(t)).not.toContain("segundo");
    expect(t.get(row)?.entity.deleted).toBeTruthy();
    ok(undoAutomationRun(t, b.id, q.id, JUAN));
    expect(notes(t)).toContain("segundo");
  });

  it("AU-186 · the same removal with rows chosen by something from outside goes to the trash with no proposal too and comes back when the run is undone; with «Preguntar» it waits in the run's proposal", async () => {
    const s = files.store();
    fromOutside(s);
    const a = made(s, [SCHEDULE(), TRASH("de un correo", "yes")]);
    ok(a.publish());
    const r = await atItsHour(s, a.id);
    expect(r).toMatchObject({ state: "done", proposal: null });
    expect(notes(s)).not.toContain("de un correo");
    ok(undoAutomationRun(s, a.id, r.id, JUAN));
    expect(notes(s)).toContain("de un correo");

    const t = files.store();
    const outside = fromOutside(t);
    const b = made(t, [SCHEDULE(), TRASH("de un correo", "ask")]);
    ok(b.publish());
    const q = await atItsHour(t, b.id);
    expect(notes(t)).toContain("de un correo");
    const p = t.journal.proposal(q.proposal as string);
    const view = p?.view as RunProposalView;
    expect(view.run.first).toEqual([
      expect.objectContaining({ kind: "confirm", action: "trash", collection: "pedido" }),
    ]);
    expect(view.run.first[0]?.row?.id).toBe(outside);
  });
});

describe("who starts the run (F14d)", () => {
  it("AU-195 · the same step with the same value from outside, by hand and at its hour: with «Sí» both runs save it with its outside label, with «Preguntar» both leave a proposal, and «Probar» writes nothing", async () => {
    for (const permission of ["yes", "ask"] as const) {
      const s = files.store();
      fromOutside(s);
      const a = made(s, [SCHEDULE(), START, FIND("de un correo"), SAVE(permission)], {
        arrows: [
          ["A su hora", "Buscar"],
          ["Inicio", "Buscar"],
          ["Buscar", "Guardar"],
        ],
      });
      ok(a.publish());
      const tested = ok(
        await testAutomation(s, a.id, { trigger: a.step("A su hora"), fields: {} }, JUAN),
      );
      expect(tested.state).toBe("done");
      expect(clients(s).map(([n]) => n)).not.toContain("de un correo");
      expect(pending(s)).toEqual([]);

      const alone = await atItsHour(s, a.id);
      const byHand = await ran(s, a.id, a.step("Inicio"), { nota: "x" });
      expect([alone.startedBy, byHand.startedBy]).toEqual(["schedule", "user"]);
      for (const r of [alone, byHand]) {
        expect(r.state, JSON.stringify(r.error)).toBe("done");
        if (permission === "yes") {
          expect(r.proposal).toBeNull();
          expect(s.runOps(r.id)).toHaveLength(1);
        } else {
          expect(r.proposal).not.toBeNull();
          expect(s.runOps(r.id)).toHaveLength(0);
        }
      }
      if (permission === "yes")
        expect(clients(s).filter(([n]) => n === "de un correo")).toEqual([
          ["de un correo", "external"],
          ["de un correo", "external"],
        ]);
      else expect(pending(s)).toHaveLength(2);
    }
  });

  it("AU-114 AU-115 · «Probar» of a «Programada» gives the hour of now as the trigger's row, and the hour the screen gave when it gave one", async () => {
    const s = files.store();
    const a = made(s, [SCHEDULE(), CREATE("probada")]);
    const trigger = a.step("A su hora");
    /** The row the trigger gave in its kept test. */
    const given = () =>
      (
        s.journal.automationTestRows(a.id, trigger, "main", 0, 1)[0] as {
          json: Record<string, Cell>;
        }
      )?.json;
    ok(await testAutomation(s, a.id, { trigger, fields: {} }, JUAN));
    expect(given()).toEqual({ date: JUAN.now });
    ok(await testAutomation(s, a.id, { trigger, fields: { date: at(8) } }, JUAN));
    expect(given()).toEqual({ date: at(8) });
    // A test writes nothing.
    expect(notes(s)).not.toContain("probada");
  });

  it("AU-195 · a test asks the policy as the run will, with the draft's cells and saving nothing: «Haría esto» of a «Programada» and of a «Disparado por el usuario» say the same of the same step, and there is no route that runs a draft for real", async () => {
    const s = files.store();
    const row = s.list(PEDIDO)[0]?.entity.id as string;
    const { box } = boxOf(() =>
      answering([], [{ collection: "Pedido", action: "remove", id: row as Cell }]),
    );
    const would = async (trigger: StepSpec, remove: "yes" | "ask") => {
      const a = made(s, [trigger, CODE_REMOVE(remove)]);
      const t = ok(
        await testAutomation(s, a.id, { trigger: a.step(trigger[0]), fields: {} }, JUAN, box),
      );
      return t.tests[a.step("Código")]?.would;
    };
    for (const remove of ["yes", "ask"] as const) {
      const alone = await would(SCHEDULE(), remove);
      const byHand = await would(START, remove);
      expect(alone).toEqual(byHand);
      expect(alone?.asks).toBe(remove === "ask");
      expect(alone?.counts).toEqual([{ collection: "pedido", action: "remove", n: 1 }]);
    }
    // Nothing saved, nothing proposed.
    expect(s.get(row)?.entity.deleted).toBeFalsy();
    expect(pending(s)).toEqual([]);
    // The routes that start a run start the published version: none takes a draft (A-39, publish.test.ts).
    const { RUN_ACTIONS } = await import("./routes.ts");
    expect(JSON.stringify(RUN_ACTIONS)).not.toMatch(/draft/i);
  });
});

describe("the proposal of a run (F14d)", () => {
  it("AU-193 · a run with two steps that wait leaves one proposal in the inbox, with each step's whole change, and goes on: a step that waits gives no rows to those after it", async () => {
    const s = files.store();
    const a = made(
      s,
      [
        SCHEDULE(),
        CREATE("propuesta", "ask"),
        TRASH("primero", "ask"),
        ["Después", "collection", { collection: "cliente", action: "find" }],
      ],
      {
        arrows: [
          ["A su hora", "Crear"],
          ["A su hora", "Eliminar"],
          ["Crear", "Después"],
        ],
      },
    );
    ok(a.publish());
    const r = await atItsHour(s, a.id);
    expect(r.state, JSON.stringify(r.error)).toBe("done");
    expect(pending(s)).toHaveLength(1);
    const view = s.journal.proposal(r.proposal as string)?.view as RunProposalView;
    expect(view.tool).toBe(ACCEPT_RUN);
    expect(view.run.count).toBe(2);
    expect(view.run.first.map((x) => [x.step, x.action])).toEqual(
      expect.arrayContaining([
        [a.step("Crear"), "create"],
        [a.step("Eliminar"), "trash"],
      ]),
    );
    const steps = ok(runView(s, a.id, r.id)).steps;
    expect(steps[a.step("Crear")]?.out).toEqual({ main: 0 });
    expect(steps[a.step("Después")]?.in).toEqual({ main: 0 });
    expect(notes(s)).toContain("primero");
  });

  it("AU-193 · the proposal is painted by code: the automation and its version, how many rows it creates, modifies and sends to the trash in each collection, and each row with its before, its after and the mark of what came from outside", async () => {
    const s = files.store();
    fromOutside(s);
    const a = made(
      s,
      [
        SCHEDULE(),
        FIND("de un correo"),
        [
          "Modificar",
          "collection",
          {
            collection: "pedido",
            action: "update",
            target: "matching",
            where: [{ field: "nota", op: "is", value: "primero" }],
            fields: [{ field: "nota", value: "<b>cambiado</b>" }],
            permission: "ask",
          },
        ],
        SAVE("ask"),
      ],
      {
        arrows: [
          ["A su hora", "Buscar"],
          ["A su hora", "Modificar"],
          ["Buscar", "Guardar"],
        ],
      },
    );
    ok(a.publish());
    const r = await atItsHour(s, a.id);
    const view = s.journal.proposal(r.proposal as string)?.view as RunProposalView;
    expect(view.run).toMatchObject({
      automation: a.id,
      name: "Revisar pedidos",
      version: 1,
      run: r.id,
      startedBy: "schedule",
      count: 2,
    });
    expect(view.run.counts).toEqual(
      expect.arrayContaining([
        { collection: "pedido", name: "Pedido", action: "update", n: 1 },
        { collection: "cliente", name: "Cliente", action: "create", n: 1 },
      ]),
    );
    const update = view.run.first.find((x) => x.action === "update");
    // The value as it is, its before, and nothing turned into markup.
    expect(update?.values.nota).toMatchObject({
      value: "<b>cambiado</b>",
      before: "primero",
      outside: false,
    });
    expect(update?.row?.title).toBeTypeOf("string");
    const create = view.run.first.find((x) => x.action === "create");
    expect(create?.values.nombre).toMatchObject({ value: "de un correo", outside: true });
    expect(create?.row).toBeNull();
    // Where it came from, for the inbox's «De dónde».
    expect(s.journal.proposal(r.proposal as string)?.sources).toContain("mail:m_ejemplo");
  });

  it("AU-193 · «Ver todo» of what a run asked reads every row its card paints, 50 at a time, of a run of that automation only", async () => {
    const s = files.store();
    for (let i = 0; i < 60; i++) fromOutside(s, "de un correo");
    const find = FIND("de un correo");
    const a = made(s, [SCHEDULE(), [find[0], find[1], { ...find[2], limit: 100 }], SAVE("ask")]);
    ok(a.publish());
    const r = await atItsHour(s, a.id);
    const view = s.journal.proposal(r.proposal as string)?.view as RunProposalView;
    expect(view.run.count).toBe(60);
    const first = ok(runAsked(s, a.id, r.id, 0));
    expect(first.total).toBe(60);
    expect(first.asked).toHaveLength(50);
    expect(first.asked[0]).toMatchObject({ action: "create", collection: "cliente" });
    expect(first.asked[0]?.values.nombre).toMatchObject({ value: "de un correo", outside: true });
    expect(ok(runAsked(s, a.id, r.id, 50)).asked).toHaveLength(10);
    // Another automation's id, a run that is not there and an offset that is not a row: nothing.
    const b = made(s, [SCHEDULE(), CREATE("otra")]);
    expect(runAsked(s, b.id, r.id, 0)).toEqual({ error: "not-found" });
    expect(runAsked(s, a.id, "r_ninguna", 0)).toEqual({ error: "not-found" });
    expect(runAsked(s, a.id, r.id, -1)).toEqual({ error: "bad-request" });
  });

  it("AU-193 · accepting it passes through the policy again as accepted, from a personal device only, and saves every change in one transaction with the run in the log; with one change that cannot be saved, none is", async () => {
    const { host, s, agent } = server();
    try {
      const a = made(s, [SCHEDULE(), CREATE("uno", "ask", "Uno"), CREATE("dos", "ask", "Dos")], {
        arrows: [
          ["A su hora", "Uno"],
          ["A su hora", "Dos"],
        ],
      });
      ok(a.publish());
      const r = await atItsHour(s, a.id);
      const id = r.proposal as string;
      // Not from a shared device.
      expect((await agent.acceptProposal(id, "shared")).error).toBe("accept-on-a-personal-device");
      expect(notes(s)).not.toContain("uno");
      // Not by a plan: only the acceptance of its proposal calls it (P28).
      const planned = await agent.background({
        version: 1,
        steps: [
          {
            id: "a",
            op: "call",
            tool: ACCEPT_RUN,
            args: { automation: a.id, run: r.id },
          },
        ],
      } as never);
      expect(planned.status).not.toBe("done");
      expect(notes(s)).not.toContain("uno");
      const done = await agent.acceptProposal(id, "personal");
      expect(done.error ?? null).toBeNull();
      expect(notes(s)).toEqual(expect.arrayContaining(["uno", "dos"]));
      expect(s.runOps(r.id).map((o) => o.kind)).toEqual(["create", "create"]);
      expect(s.journal.proposal(id)?.status).toBe("accepted");
      expect(ok(runView(s, a.id, r.id)).proposal).toEqual({ id, status: "accepted" });
      // The inbox's «Deshacer» does not take it back: the run's does.
      expect(agent.restoreProposal(id)).toBe("cannot-undo");

      // One that cannot be saved: the second's row is gone since; none is saved.
      const b = made(
        s,
        [
          SCHEDULE([{ key: "r_dia", every: "day", at: "12:00" }]),
          CREATE("tres", "ask", "Tres"),
          TRASH("segundo", "ask"),
        ],
        {
          arrows: [
            ["A su hora", "Tres"],
            ["A su hora", "Eliminar"],
          ],
        },
      );
      ok(b.publish());
      const q = await atItsHour(s, b.id, at(11, 5));
      const row = s
        .list(PEDIDO)
        .find((e) => e.entity.values[fieldOf(s, PEDIDO, "nota")] === "segundo")?.entity
        .id as string;
      s.update(
        row,
        { [fieldOf(s, PEDIDO, "nota")]: { value: "segundo, cambiado", label: OUTSIDE } },
        {
          actor: "user",
          device: "d_portatil",
        },
      );
      expect((await agent.acceptProposal(q.proposal as string, "personal")).error).toBe("stale");
      expect(notes(s)).not.toContain("tres");
      expect(s.runOps(q.id)).toEqual([]);
    } finally {
      host.close();
    }
  });

  it("AU-193 · accepting is the confirmation of the removals the proposal names: they go to the trash with the run and are not asked again", async () => {
    const { host, s, agent } = server();
    try {
      const a = made(s, [SCHEDULE(), TRASH("primero", "ask")]);
      ok(a.publish());
      const r = await atItsHour(s, a.id);
      const done = await agent.acceptProposal(r.proposal as string, "personal");
      expect(done.error ?? null).toBeNull();
      expect(done.pending).toBeNull();
      expect(notes(s)).not.toContain("primero");
      expect(s.runOps(r.id).map((o) => o.kind)).toEqual(["delete"]);
      expect(pending(s)).toEqual([]);
    } finally {
      host.close();
    }
  });

  it("AU-193 · with a row changed since it was proposed, accepting saves nothing and the proposal is left as no longer valid; rejecting saves nothing and the run says it was rejected", async () => {
    const { host, s, agent } = server();
    try {
      const a = made(s, [
        SCHEDULE(),
        [
          "Modificar",
          "collection",
          {
            collection: "pedido",
            action: "update",
            target: "matching",
            where: [{ field: "nota", op: "is", value: "primero" }],
            fields: [{ field: "nota", value: "de la automatización" }],
            permission: "ask",
          },
        ],
      ]);
      ok(a.publish());
      const r = await atItsHour(s, a.id);
      const row = s
        .list(PEDIDO)
        .find((e) => e.entity.values[fieldOf(s, PEDIDO, "nota")] === "primero")?.entity
        .id as string;
      s.update(
        row,
        { [fieldOf(s, PEDIDO, "importe")]: { value: 99, label: OUTSIDE } },
        {
          actor: "user",
          device: "d_portatil",
        },
      );
      expect((await agent.acceptProposal(r.proposal as string, "personal")).error).toBe("stale");
      expect(notes(s)).not.toContain("de la automatización");
      expect(ok(runView(s, a.id, r.id)).proposal?.status).toBe("stale");

      // Rejected: nothing saved, and the run says so.
      const b = made(s, [
        SCHEDULE([{ key: "r_dia", every: "day", at: "12:00" }]),
        CREATE("no", "ask"),
      ]);
      ok(b.publish());
      const q = await atItsHour(s, b.id, at(11, 5));
      agent.rejectProposal(q.proposal as string);
      expect(notes(s)).not.toContain("no");
      expect(ok(runView(s, b.id, q.id)).proposal?.status).toBe("rejected");
      // Undoing the run makes a proposal still waiting no longer valid.
      const c = made(
        s,
        [
          SCHEDULE([{ key: "r_dia", every: "day", at: "13:00" }]),
          CREATE("sí"),
          CREATE("luego", "ask", "Luego"),
        ],
        {
          arrows: [
            ["A su hora", "Crear"],
            ["A su hora", "Luego"],
          ],
        },
      );
      ok(c.publish());
      const u = await atItsHour(s, c.id, at(12, 5));
      ok(undoAutomationRun(s, c.id, u.id, JUAN));
      expect(ok(runView(s, c.id, u.id)).proposal?.status).toBe("stale");
      await expect(acceptRun(s, c.id, u.id, { device: null, zone: ZONE })).rejects.toThrow();
    } finally {
      host.close();
    }
  });

  it("AU-18 AU-193 · what Juan accepted of a run's proposal was written with the same run and is undone with it: «Deshacer lo que hizo» takes back what it saved alone and what he accepted, in one", async () => {
    const { host, s, agent } = server();
    try {
      const a = made(s, [SCHEDULE(), CREATE("sola"), CREATE("aceptada", "ask", "Luego")], {
        arrows: [
          ["A su hora", "Crear"],
          ["A su hora", "Luego"],
        ],
      });
      ok(a.publish());
      const before = notes(s);
      const r = await atItsHour(s, a.id);
      expect(
        (await agent.acceptProposal(r.proposal as string, "personal")).error ?? null,
      ).toBeNull();
      expect(notes(s)).toEqual(expect.arrayContaining(["sola", "aceptada"]));
      expect(s.runOps(r.id)).toHaveLength(2);
      expect(ok(runView(s, a.id, r.id)).undoable).toBe(true);
      ok(undoAutomationRun(s, a.id, r.id, JUAN));
      expect(notes(s).sort()).toEqual(before.sort());
    } finally {
      host.close();
    }
  });

  it("AU-170 · a value from outside saved with «Sí», or proposed and accepted, and read again by another run is still from outside: what that run writes with it is decided by its cell, and the assistant in a turn proposes it (P4)", async () => {
    const { host, s, agent } = server();
    try {
      fromOutside(s);
      // Saved with «Sí» by one, and proposed and accepted by another.
      const a = made(s, [SCHEDULE(), FIND("de un correo"), SAVE("yes")]);
      ok(a.publish());
      await atItsHour(s, a.id);
      fromOutside(s, "de otro correo");
      const b = made(s, [
        SCHEDULE([{ key: "r_dia", every: "day", at: "12:00" }]),
        FIND("de otro correo"),
        SAVE("ask"),
      ]);
      ok(b.publish());
      const q = await atItsHour(s, b.id, at(11, 5));
      expect(
        (await agent.acceptProposal(q.proposal as string, "personal")).error ?? null,
      ).toBeNull();
      expect(clients(s)).toEqual(
        expect.arrayContaining([
          ["de un correo", "external"],
          ["de otro correo", "external"],
        ]),
      );
      // Read again by a third: what it writes with it is from outside, and its cell decides.
      for (const [permission, saves] of [
        ["yes", true],
        ["ask", false],
      ] as const) {
        const c = made(s, [
          START,
          ["Leer", "collection", { collection: "cliente", action: "find" }],
          CREATE(cite("$json.nombre"), permission, "Copiar"),
        ]);
        ok(c.publish());
        const r = await ran(s, c.id, c.step("Inicio"), { nota: "x" });
        expect(r.state, JSON.stringify(r.error)).toBe("done");
        expect(r.line?.outside ?? false).toBe(saves);
        expect(r.proposal === null).toBe(saves);
        if (!saves) {
          const view = s.journal.proposal(r.proposal as string)?.view as RunProposalView;
          // What it read from outside is still from outside; the seed's own row is not.
          for (const x of view.run.first)
            expect(x.values.nota?.outside, String(x.values.nota?.value)).toBe(
              String(x.values.nota?.value).includes("correo"),
            );
        }
      }
      // The store gives it as from outside to any reader, the assistant's included: P4 proposes what it writes
      // with it (the agent's own tests hold P4 over a label from outside).
      const f = fieldOf(s, CLIENTE, "nombre");
      const kept = s.list(CLIENTE).filter((e) => String(e.entity.values[f]).includes("correo"));
      expect(kept.every((e) => s.get(e.entity.id)?.labels[f]?.integrity === "external")).toBe(true);
    } finally {
      host.close();
    }
  });
});
