// The conversion of the saved flows to automations (docs/automatizaciones.md §5.13, phase F16): when it happens,
// what it keeps, how it is undone, what happens to what was under way and to the old runs, and the order in which
// the old engine goes (AU-150, AU-152, AU-225, AU-226, AU-227, AU-228, with AU-230's case of a converted write).
//
// The real store per test, invented flows shaped like a person's (generated ids, several versions, a draft half done,
// one flow per shape the old engine allows: by hand with a form, by hand alone, by the clock, by a mail, Boni's), a
// year of runs for the times (A-15: 50 flows with 60 versions, 20,000 runs with 200,000 steps, their clock from
// `@boni/pace`), and no model. What is still `todo` is S2's, P1's or the removal's (the rule's «Falta»).

import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { type Plan, planToAutomation } from "@boni/agent";
import { BONI_ACTION_TYPE, consentOf, parseAutomation } from "@boni/automations";
import { label, newId } from "@boni/entities";
import { clock, under } from "@boni/pace";
import { AUTOMATION_FAILED_IN_SQL, openUserStore, type UserStore } from "@boni/store";
import { SYS } from "@boni/views";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { jsBox } from "../../../../packages/agent/test/convert.test-util.ts";
import { ROUTE_ACTIONS, ROUTE_RUNS, runAction } from "../actions.ts";
import { AgentHost, trashFlow } from "../agent.ts";
import { DataError } from "../data.ts";
import { lastSlot } from "../flowScheduler.ts";
import { deleteFlowRow, updateFlowRow } from "../flowsCollection.ts";
import { ROUTES } from "../routes.ts";
import { wireBoni } from "./boni.ts";
import { BAND_CLOSED, conversionList } from "./conversion.ts";
import {
  COPY_CHUNK,
  conversionReport,
  convertFlow,
  convertFlows,
  copyBeforeRuns,
  reconvertFlow,
  revertFlow,
  wireDryConversion,
} from "./convert.ts";
import { publish, setEnabled, versionsOf } from "./publish.ts";
import { CONVERSION_ROUTES, SHARED_DEVICE_ROUTES } from "./routes.ts";
import { folder, HOUR, JUAN, NOW, PEDIDO, scheduler, seeded, ZONE } from "./run.test-util.ts";
import { undoAutomationRun } from "./runs.ts";
import { automationView, testAutomation } from "./service.ts";

const DAY = 24 * HOUR;
const lit = (v: unknown) => ({ lit: v });
const ref = (r: string) => ({ ref: r });
const fn = (name: string, ...args: unknown[]) => ({ fn: name, args });
const plan = (...steps: unknown[]) => ({ version: 1, steps });

/** Its plans, as the old editor saved them, over the seeded «Pedido» (run.test-util.ts `seeded`). */
const COUNT = plan({
  id: "n",
  op: "call",
  tool: "entities.aggregate",
  args: { type: lit("pedido"), op: lit("count") },
});
const CREATE = (nota: unknown) =>
  plan({
    id: "c",
    op: "call",
    tool: "entities.create",
    args: { type: lit("pedido"), values: fn("obj", lit("nota"), nota) },
  });
/** An update by the id a query found: no step of the new engine yet (`noCollection`). */
const UPDATE = plan(
  { id: "q", op: "call", tool: "entities.query", args: { type: lit("pedido") } },
  {
    id: "u",
    op: "call",
    tool: "entities.update",
    args: { id: ref("$q[0].id"), values: fn("obj") },
  },
);
/** An action of Boni's with no step of its own: «Acción de Boni». */
const ACTION = plan({
  id: "a",
  op: "call",
  tool: "otra.accion",
  args: { texto: lit("de ejemplo") },
});

/** A `classify` of the reading model: «Clasificar», an AI step (AU-224). */
const CLASSIFY = plan({
  id: "k",
  op: "read",
  reader: "classify",
  input: lit("un texto de ejemplo"),
  params: { options: lit(["urgente", "normal"]) },
});

const MANUAL = { manual: true, inputs: [{ name: "nota" }] };
const ALONE = { manual: true };
const DAILY = { schedule: { every: "day", at: "08:00" } };

const f = folder("conversion");
afterAll(() => f.done());
let store: UserStore;
beforeEach(() => {
  store = f.store();
  // Boni's code reached: «Acción de Boni» validates, as on the server (main.ts). No call reaches it in these tests.
  wireBoni({
    reaches: () => true,
    agentOf: () => {
      throw new Error("no Boni call in these tests");
    },
  });
});
afterEach(() => {
  wireBoni(null);
  store.close();
});

/** A flow of the person's: a generated id, `versions` saves of its plans, each a day after the one before. */
function flow(
  o: {
    name?: string;
    trigger?: unknown;
    plans?: unknown[];
    by?: string;
    enabled?: boolean;
    created?: number;
    id?: string;
  } = {},
  s: UserStore = store,
): string {
  const id =
    o.id ?? `${(o.name ?? "flujo").toLowerCase().replace(/\W+/g, "-")}-${newId("f").slice(-6)}`;
  const plans = o.plans ?? [COUNT];
  plans.forEach((p, i) => {
    s.journal.saveFlow({
      id,
      name: o.name ?? "Flujo de ejemplo",
      trigger: o.trigger ?? ALONE,
      inputs: [],
      plan: p,
      layout: null,
      by: o.by ?? "user",
      enabled: o.enabled ?? true,
      created: (o.created ?? NOW - 400 * DAY) + i * DAY,
    });
  });
  return id;
}

/** A host with no model, its store seeded: what an old run's proposal and question are answered through. */
function hosted(): { host: AgentHost; s: UserStore } {
  const dir = join(f.dir, `host-${randomUUID()}`);
  mkdirSync(join(dir, "users"), { recursive: true });
  const host = new AgentHost({ dataDir: dir, providers: null });
  const s = host.store(1);
  seeded(s);
  return { host, s };
}

/** A finished run of a flow of before, as the old engine kept it. */
function oldRun(s: UserStore, id: string, at: number, status = "done", origin = "turn"): string {
  const run = randomUUID();
  const version = s.journal.flow(id)?.version ?? 1;
  s.journal.startRun({
    id: run,
    turn: null,
    origin,
    device: "d_portatil",
    started: at,
    flow: id,
    flowVersion: version,
  });
  s.journal.finishRun(run, status, null, at + 1_500);
  return run;
}

describe("the saved flows converted to automations (F16)", () => {
  it.todo(
    "AU-150 · every saved flow and Boni's four convert by code with their versions; «Función» and «Aplicar cambios» become two «Acción de Boni» that keep their guarantees; what cannot convert stays off with its notice",
  );
  it.todo(
    "AU-150 · the dry report of a conversion replays each flow's last runs in both engines without writing, and names counts, steps and how many agree, and none of the person's texts",
  );
  it.todo(
    "AU-227 · with a year of runs the conversion, the copy and the list of runs of the mail automation stay within their times",
  );
  it.todo(
    "AU-228 · no id has at once a flow that runs and an automation that is on, and the files already moved import nothing of the old engine",
  );
  it.todo(
    "AU-152 · after the removal nothing imports the old engine or the old editor, and nothing that runs reads the archived flow tables",
  );

  it("AU-150 · S1: the dry report runs on a copy and says, by the flows' order, how many convert, which step types they get, «Lo que cambia», why the rest stay and which can be replayed; no name or text of the person's", () => {
    flow({ name: "Apuntar pedido", trigger: MANUAL, plans: [CREATE(ref("$nota"))] });
    const daily = flow({ name: "Contar pedidos", trigger: DAILY });
    oldRun(store, daily, NOW - DAY, "done", "background");
    flow({ name: "Arreglar pedido", plans: [UPDATE] });
    flow({ name: "Leer correo", id: "leer-correo", trigger: { created: "correo" }, by: "preset" });
    const r = conversionReport(store, NOW);
    expect(r).toMatchObject({ flows: 4, converted: 2, kept: 1, left: 1, runsToCopy: 1 });
    expect(r.replay).toEqual({ byClock: 1, byHand: 0, inputsNotKept: 0, neverRan: 1 });
    expect(r.reasons).toEqual({ "tool:entities.update:noCollection": 1, notTheUsers: 1 });
    expect(Object.keys(r.stepTypes).sort()).toEqual(["collection", "manual", "schedule"]);
    expect(r.changes.asksNow).toBe(1);
    const text = JSON.stringify(r);
    for (const words of ["Apuntar", "Contar", "Arreglar", "Leer correo", "pedido"])
      expect(text).not.toContain(words);
  });

  it("AU-225 · S1: at the store's opening each flow of the person's started by hand or by the clock is an automation with its id, name, switch and hours, and a second opening changes nothing", () => {
    const dir = join(f.dir, `host-${randomUUID()}`);
    mkdirSync(join(dir, "users"), { recursive: true });
    const s = openUserStore(join(dir, "users", "1.db"), { now: () => NOW });
    seeded(s);
    const byHand = flow(
      { name: "Apuntar pedido", trigger: MANUAL, plans: [CREATE(ref("$nota"))] },
      s,
    );
    const daily = flow({ name: "Contar pedidos", trigger: DAILY, enabled: false }, s);
    const mail = flow({ name: "Leer correo", trigger: { created: "correo" }, by: "preset" }, s);
    s.close();
    const host = new AgentHost({ dataDir: dir, providers: null });
    try {
      const opened = host.store(1);
      const j = opened.journal;
      expect(j.automation(byHand)).toMatchObject({ enabled: true, published: 1 });
      expect(j.automation(daily)).toMatchObject({ enabled: false, published: 1 });
      expect(j.automationDraft(byHand)?.name).toBe("Apuntar pedido");
      // Its hours: the «Programada» of the flow's schedule.
      const sched = parseAutomation(JSON.parse(j.automationDraft(daily)?.doc ?? "{}"));
      expect(sched.steps.find((x) => x.type === "schedule")).toBeTruthy();
      // Boni's own and a preset's stay flows (S2); only the person's leave `flows()`.
      expect(j.automation(mail)).toBeNull();
      const listed = j.flows().map((x) => x.id);
      expect(listed).toContain(mail);
      expect(listed).not.toContain(byHand);
      expect(listed).not.toContain(daily);
      // Again: nothing new is written.
      const before = j.flowConversions();
      const again = convertFlows(opened, NOW + HOUR);
      expect(again.every((o) => o.state === "already" || o.state === "left")).toBe(true);
      expect(j.flowConversions()).toEqual(before);
    } finally {
      host.close();
    }
  });

  it("AU-225 · S1: each version of a flow that converts whole is a version of its automation, in order, with its date and author and «Convertida» naming the flow version; the rest are counted", () => {
    const id = flow({
      trigger: MANUAL,
      plans: [CREATE(lit("una")), UPDATE, CREATE(lit("dos")), CREATE(ref("$nota"))],
    });
    expect(convertFlow(store, id, NOW)).toMatchObject({
      state: "converted",
      versions: 3,
      skipped: 1,
    });
    const v = versionsOf(store, id);
    if ("error" in v) throw new Error(v.error);
    expect(v.running).toBe(3);
    expect(v.versions.map((x) => [x.n, x.flow, x.by, x.at])).toEqual([
      [3, 4, "user", NOW - 397 * DAY],
      [2, 3, "user", NOW - 398 * DAY],
      [1, 1, "user", NOW - 400 * DAY],
    ]);
    // The draft is the running version's document; «Lo que cambia» and the skipped count are the view's.
    const view = automationView(store, id);
    if ("error" in view) throw new Error(view.error);
    expect(view.conversion).toMatchObject({ state: "converted", skipped: 1 });
    expect(view.conversion?.changes).toContain("asksNow");
  });

  it("AU-225 · S1: «Volver al flujo de antes» leaves the flow running as it was and the automation off; «Convertir otra vez» comes back only while the flow has no version the automation lacks; nothing is deleted from the old tables", () => {
    const id = flow({ trigger: DAILY, plans: [COUNT, COUNT] });
    const run = oldRun(store, id, NOW - DAY, "done", "background");
    const plain = () => ({ flows: store.journal.flowVersions(id), run: store.journal.run(run) });
    const was = plain();
    convertFlow(store, id, NOW);
    expect(store.journal.flows().map((x) => x.id)).not.toContain(id);
    expect(revertFlow(store, id, NOW + HOUR)).toBe(true);
    expect(store.journal.automation(id)?.enabled).toBe(false);
    expect(store.journal.flows().map((x) => x.id)).toContain(id);
    expect(plain()).toEqual(was);
    // Again, and back: the automation on from now.
    expect(reconvertFlow(store, id, NOW + 2 * HOUR)).toBe("ok");
    expect(store.journal.automation(id)?.enabled).toBe(true);
    expect(store.journal.flows().map((x) => x.id)).not.toContain(id);
    // Changed while it ran as before: not converted again by this.
    revertFlow(store, id, NOW + 3 * HOUR);
    flow({ id, trigger: DAILY, plans: [CREATE(lit("tres"))], created: NOW + 3 * HOUR });
    expect(reconvertFlow(store, id, NOW + 4 * HOUR)).toBe("changed");
    expect(store.journal.automation(id)?.enabled).toBe(false);
  });

  it("AU-228 · S1: a flow whose running version does not convert whole stays on the engine of before, saying why step by step, and is tried again at the next opening; one id never runs on both", () => {
    const kept = flow({ plans: [COUNT, UPDATE] });
    const done = flow({ plans: [UPDATE, COUNT] });
    convertFlows(store, NOW);
    expect(store.journal.flowConversion(kept)).toMatchObject({
      state: "kept",
      reasons: [{ step: "u", what: "tool:entities.update", reason: "noCollection" }],
    });
    expect(store.journal.automation(kept)).toBeNull();
    expect(store.journal.automation(done)?.enabled).toBe(true);
    // One engine per id: what `flows()` lists (the old scheduler's and the planner's) has no automation on.
    for (const x of store.journal.flows())
      expect(store.journal.automation(x.id)?.enabled ?? false).toBe(false);
    // The next opening asks again and, with the same answer, writes nothing.
    expect(convertFlow(store, kept, NOW + DAY)).toEqual({ id: kept, state: "already" });
  });

  it("AU-228 · S1: one id, one engine across the switches: a reverted flow's automation is neither published nor turned on, and the old engine's switch, «Borrar» and the «Flujos» row refuse a converted flow", () => {
    const id = flow({ trigger: ALONE, plans: [COUNT] });
    convertFlow(store, id, NOW);
    // Converted: the old engine's writes are refused, the flow as it was.
    expect(trashFlow(store, id)).toEqual({ error: "converted" });
    const row = `${SYS.flows.row}${id}`;
    const code = (f: () => void) => {
      try {
        f();
        return null;
      } catch (e) {
        return e instanceof DataError ? e.code : String(e);
      }
    };
    expect(code(() => deleteFlowRow(store, row))).toBe("flow-converted");
    expect(code(() => updateFlowRow(store, row, { state: "off" }, () => [], NOW))).toBe(
      "flow-converted",
    );
    // Back to before: the flow runs, so its automation stays off and unpublished from here.
    revertFlow(store, id, NOW + HOUR);
    // Not deleted by the refused «Borrar»: back to before, it is listed again.
    expect(store.journal.flows().map((x) => x.id)).toContain(id);
    const hand = { ...JUAN, now: NOW + 2 * HOUR };
    expect(setEnabled(store, id, true, hand)).toEqual({ refused: "reverted" });
    expect(publish(store, id, { version: 1 }, hand)).toEqual({ refused: "reverted" });
    expect(setEnabled(store, id, false, hand)).toEqual({ enabled: false });
    expect(store.journal.automation(id)?.enabled).toBe(false);
    // «Convertir otra vez» is the way back, and then the switch is the automation's again.
    expect(reconvertFlow(store, id, NOW + 3 * HOUR)).toBe("ok");
    expect(setEnabled(store, id, false, { ...hand, now: NOW + 4 * HOUR })).toEqual({
      enabled: false,
    });
  });

  it("AU-150 · S1: the dry report sees Boni's code and «Modelos» as the server does, with no agent and no key: a flow with a reader converts in it", () => {
    const id = flow({ trigger: ALONE, plans: [CLASSIFY] });
    // With no «Modelos» wired, an AI step would block publishing: the report would say kept where the server converts.
    const copy = f.store();
    flow({ id, trigger: ALONE, plans: [CLASSIFY] }, copy);
    expect(convertFlow(copy, id, NOW)).toMatchObject({ state: "kept" });
    copy.close();
    const unwire = wireDryConversion(1);
    try {
      const r = conversionReport(store, NOW);
      expect(r).toMatchObject({ converted: 1, kept: 0 });
      expect(r.changes).toHaveProperty("readerClassifies", 1);
    } finally {
      unwire();
    }
  });

  it("AU-226 · S1: a flow by the clock runs once in each slot across the conversion: the hour it ran before is not run again, and the next one runs on the new engine", async () => {
    const id = flow({ trigger: DAILY, created: NOW - 30 * DAY });
    // The old scheduler ran today's 08:00 (Madrid); then the conversion.
    const today = lastSlot({ every: "day", at: "08:00" }, NOW, ZONE) as number;
    oldRun(store, id, today + 2_000, "done", "background");
    convertFlow(store, id, NOW);
    const t = scheduler(store);
    await t.at(NOW + 10 * 60_000);
    expect(
      store.journal.automationRuns(id, { filter: "all", limit: 10 }).filter((r) => !r.before),
    ).toEqual([]);
    await t.at(today + DAY + 60_000);
    const runs = store.journal
      .automationRuns(id, { filter: "all", limit: 10 })
      .filter((r) => !r.before);
    expect(runs.map((r) => r.slot)).toEqual([today + DAY]);
  });

  it("AU-226 · S2: a proposal an old run left waiting in the Bandeja is accepted as before once its flow is converted, and accepting it starts no run of the automation", async () => {
    const { host, s } = hosted();
    try {
      const id = flow({ trigger: ALONE, plans: [CREATE(lit("de antes"))] }, s);
      const agent = host.agent(1, true);
      const old = await agent.background(CREATE(lit("de antes")), {}, [], undefined, {
        id,
        version: 1,
        by: "user",
      });
      expect(old.proposals).toHaveLength(1);
      const proposal = old.proposals[0] as string;
      expect(convertFlow(s, id, NOW)).toMatchObject({ state: "converted" });
      const accepted = await agent.acceptProposal(proposal, "personal");
      expect(accepted.error).toBeNull();
      expect(s.journal.proposal(proposal)?.status).toBe("accepted");
      const notes = s.list(PEDIDO).map((e) => JSON.stringify(e.entity.values));
      expect(notes.filter((v) => v.includes("de antes"))).toHaveLength(1);
      // The acceptance is the proposal's, as before: no run of the new engine.
      expect(
        s.journal.automationRuns(id, { filter: "all", limit: 10 }).filter((r) => !r.before),
      ).toEqual([]);
    } finally {
      host.close();
    }
  });

  it("AU-226 · S2: an old run waiting on a question at the conversion is resumed only by the engine that started it, and its row is copied once it has ended", async () => {
    const { host, s } = hosted();
    try {
      const asking = plan(
        { id: "q", op: "ask", control: "text", prompt: lit("¿Qué nota?") },
        {
          id: "c",
          op: "call",
          tool: "entities.create",
          args: { type: lit("pedido"), values: fn("obj", lit("nota"), ref("$q")) },
        },
      );
      const id = flow({ trigger: ALONE, plans: [asking] }, s);
      const agent = host.agent(1, true);
      const asked = await agent.background(asking, {}, [], undefined, {
        id,
        version: 1,
        by: "user",
      });
      if (asked.pending?.kind !== "ask") throw new Error("expected a question");
      expect(convertFlow(s, id, NOW)).toMatchObject({ state: "converted" });
      // While it waits, the copy takes nothing of it and is not marked done.
      expect(await copyBeforeRuns(s, NOW)).toBe(0);
      expect(s.journal.automationRun(asked.run)).toBeNull();
      expect(s.journal.flowConversion(id)?.copied).toBeNull();
      // Answered: the old engine goes on with it, and what it creates is proposed, as before.
      const done = await agent.answer(
        asked.run,
        asked.pending.id,
        { text: "una nota de ejemplo" },
        { trust: "personal" },
      );
      expect(done.error).toBeNull();
      expect(done.proposals).toHaveLength(1);
      expect(
        s.journal.automationRuns(id, { filter: "all", limit: 10 }).filter((r) => !r.before),
      ).toEqual([]);
      // Ended, it is copied as a run «De antes» of the automation, and the copy is done.
      expect(await copyBeforeRuns(s, NOW + HOUR)).toBe(1);
      expect(s.journal.automationRun(asked.run)).toMatchObject({ before: true, version: 1 });
      expect(s.journal.flowConversion(id)?.copied).toBe(NOW + HOUR);
    } finally {
      host.close();
    }
  });

  it("AU-224 · S2: the same flows shaped like a person's, dry on the engine of before and in «Probar» converted, ask for the same writes: one by the clock, a search with no rows, a list of 50, a «Solo si» false and a count", async () => {
    const { host, s } = hosted();
    try {
      // A list of 50 «Pedido», as a person's grows: the two seeded and 48 more.
      const nota = s.schema().types[PEDIDO]?.fields.find((x) => x.key === "nota")?.id as string;
      for (let i = 0; i < 48; i++)
        s.create(
          PEDIDO,
          { [nota]: { value: `pedido ${i}`, label: label("user", "personal", []) } },
          { actor: "user", device: JUAN.device },
        );
      const none = {
        id: "q",
        op: "call",
        tool: "entities.query",
        args: { type: lit("pedido"), field: lit("nota"), equals: lit("ninguna") },
      };
      const all = { id: "q", op: "call", tool: "entities.query", args: { type: lit("pedido") } };
      const perRow = (extra: Record<string, unknown>) => ({
        id: "c",
        op: "call",
        tool: "entities.create",
        ...extra,
        args: { type: lit("pedido"), values: fn("obj", lit("nota"), lit("de cada uno")) },
      });
      const cases: { name: string; trigger: unknown; plan: unknown; writes: number }[] = [
        { name: "Uno cada día", trigger: DAILY, plan: CREATE(lit("cada día")), writes: 1 },
        {
          name: "Ninguno encontrado",
          trigger: ALONE,
          plan: plan(none, perRow({ each: ref("$q") })),
          writes: 0,
        },
        {
          name: "Cincuenta",
          trigger: ALONE,
          plan: plan(all, perRow({ each: ref("$q") })),
          writes: 50,
        },
        {
          name: "Solo si no hay",
          trigger: ALONE,
          plan: plan(none, perRow({ when: ref("$q") })),
          writes: 0,
        },
        { name: "Contar", trigger: DAILY, plan: COUNT, writes: 0 },
      ];
      const agent = host.agent(1, true);
      const log = s.logPage(0, 1_000_000).length;
      for (const c of cases) {
        const id = flow({ name: c.name, trigger: c.trigger, plans: [c.plan] }, s);
        const old = await agent.dryRun(
          c.plan,
          {},
          {
            origin: { kind: "background", trust: "personal" },
            flow: { id, version: 1, by: "user" },
          },
        );
        expect(old.status, `${c.name}: ${old.error}`).toBe("done");
        const before = Object.values(old.would)
          .flat()
          .filter((w) => w.tool === "entities.create");
        expect(convertFlow(s, id, NOW), c.name).toMatchObject({ state: "converted" });
        // The sandbox runs in its own process on the server; here, the translator's tests' box evaluates the same.
        const t = await testAutomation(s, id, { trigger: "trigger", fields: {} }, JUAN, jsBox());
        if ("error" in t) throw new Error(`${c.name}: ${t.error}`);
        expect(
          t.state,
          `${c.name}: ${t.failedAt} ${JSON.stringify(t.failedAt ? t.tests[t.failedAt]?.error : t.problems)}`,
        ).toBe("done");
        // Born «Preguntar» (decision 13): each write is asked about, none done, as the engine of before proposed it.
        const views = Object.values(t.tests);
        const asks = views.reduce((n, x) => n + x.wouldAsk, 0);
        expect([before.length, asks], c.name).toEqual([c.writes, c.writes]);
        expect(
          views.reduce((n, x) => n + x.wouldWrite, 0),
          c.name,
        ).toBe(0);
        expect(
          before.every((w) => w.decision === "propose"),
          c.name,
        ).toBe(true);
      }
      // Both dry: neither wrote anything.
      expect(s.logPage(0, 1_000_000).length).toBe(log);
    } finally {
      host.close();
    }
  });

  it("AU-227 · S1: the old runs are «De antes» rows of their automation with their ids, copied in chunks with the server free between them, and «Deshacer lo que hizo» still undoes what one wrote", async () => {
    const id = flow({ trigger: ALONE, plans: [CREATE(lit("de antes"))] });
    for (let i = 0; i < COPY_CHUNK + 5; i++) oldRun(store, id, NOW - (300 - i) * HOUR);
    const failed = oldRun(store, id, NOW - 2 * HOUR, "stopped:R3-kept-from-models");
    // One that wrote: its operation carries its run, as the old engine saved it.
    const wrote = oldRun(store, id, NOW - HOUR);
    const row = store.create(
      PEDIDO,
      {},
      { actor: "agent", device: "d_portatil", run: wrote },
    ).entity;
    convertFlow(store, id, NOW);
    const copiedSoFar = () =>
      store.journal.automationRuns(id, { filter: "all", limit: 1_000 }).length;
    const copying = copyBeforeRuns(store, NOW);
    // The first chunk is written before the copy lets the server go; the rest after.
    expect(copiedSoFar()).toBe(COPY_CHUNK);
    expect(await copying).toBe(COPY_CHUNK + 7);
    expect(copiedSoFar()).toBe(COPY_CHUNK + 7);
    expect(store.journal.flowConversion(id)?.copied).toBe(NOW);
    expect(store.journal.automationRun(failed)).toMatchObject({
      state: "failed",
      before: true,
      version: 1,
    });
    expect(store.journal.automationRun(wrote)).toMatchObject({
      state: "done",
      before: true,
      version: 1,
    });
    // Copying again adds nothing.
    expect(await copyBeforeRuns(store, NOW + HOUR)).toBe(0);
    expect(undoAutomationRun(store, id, wrote, JUAN)).not.toHaveProperty("refused");
    expect(store.get(row.id)?.entity.deleted).toBe(NOW);
    expect(store.journal.automationRun(wrote)?.undone).toBe(NOW);
  });

  // Quarantined under task 159 (2026-11-19): the copy's time bound tripped in main's `ci` on #536's merge (141.0 ms
  // of CPU against 100 ms × 1.03 at a load of 0.47 per core) while #536's own check passed. Alone the slowest chunk
  // takes 22–29 ms (three runs on main, 28.0, 29.1 and 29.2 ms; three on F16 S2b PR 2b, 22.1, 29.1 and 22.5 ms), so it
  // trips only inside the whole suite. That old runs are copied in chunks, with their ids, is still checked in the
  // test above.
  it.skip("AU-227 · task 159 · S1: with 50 flows of 60 versions and a year of 20,000 runs with 200,000 steps, the conversion and each chunk of the copy stay within their times", async () => {
    const path = join(f.dir, `volumen-${randomUUID()}.db`);
    store.close();
    store = openUserStore(path, { now: () => NOW });
    seeded(store);
    const ids: string[] = [];
    for (let i = 0; i < 50; i++)
      ids.push(
        flow({
          name: `Flujo ${i}`,
          trigger: i % 2 ? DAILY : ALONE,
          // One version in seven updates by id: no step yet, so it is skipped; the running one converts.
          plans: Array.from({ length: 60 }, (_, k) =>
            k % 7 === 2 ? UPDATE : CREATE(lit(`v${k}`)),
          ),
        }),
      );
    // A year of runs, 400 per flow with ten steps each, written straight as the old engine's rows.
    const raw = new DatabaseSync(path);
    raw.exec("BEGIN");
    const run = raw.prepare(
      "INSERT INTO runs (id, turn, origin, device, status, plan, started, finished, flow, flow_version) VALUES (?, NULL, ?, 'd_portatil', 'done', NULL, ?, ?, ?, 60)",
    );
    const step = raw.prepare(
      "INSERT INTO run_steps (run, seq, step, kind, decision, rule, detail, at) VALUES (?, ?, 'c', 'call', 'allow', NULL, NULL, ?)",
    );
    for (let i = 0; i < 20_000; i++) {
      const at = NOW - 365 * DAY + i * 1_500_000;
      const r = `r_${i.toString(36).padStart(6, "0")}`;
      run.run(r, i % 2 ? "background" : "turn", at, at + 900, ids[i % 50] as string);
      for (let k = 0; k < 10; k++) step.run(r, k, at + k);
    }
    raw.exec("COMMIT");
    raw.close();
    let start = clock();
    const out = convertFlows(store, NOW);
    under(clock() - start, 5_000, "cpu", "the conversion of 50 flows with 60 versions each");
    expect(out.filter((o) => o.state === "converted")).toHaveLength(50);
    // Each chunk of the copy: the slowest of them all.
    let slowest = 0;
    let total = 0;
    for (const id of ids)
      for (;;) {
        start = clock();
        const n = store.journal.copyBeforeRuns(id, COPY_CHUNK, NOW);
        slowest = Math.max(slowest, clock() - start);
        total += n;
        if (!n) break;
      }
    under(slowest, 100, "cpu", "a chunk of 200 runs of before copied over a year of runs");
    expect(total).toBe(20_000);
  });

  it("AU-137 · F16 S2c B2: every page's chat stays on the engine of before, even one whose «Agente» now translates whole with «Esta página»: left, with no automation, still in the flows, and the report says «chat»", () => {
    const chat = {
      chat: {
        page: "e_pagina_ejemplo",
        welcome: "Hola",
        buttons: [{ label: "Resumen", text: "¿Cómo va el mes?" }],
      },
    };
    const agent = plan({
      id: "chat",
      op: "agent",
      instructions: "Contesta sobre la página",
      actions: ["entities.query", "pages.figures", "pages.set_value", "pages.add_block"],
    });
    // Its own plan converts whole with the page's collections given: the translator does not keep it.
    expect(
      planToAutomation({
        id: "e_chat",
        name: "Chat",
        plan: agent as unknown as Plan,
        trigger: chat,
        from: "flow",
        chat: { collections: ["pedido"] },
      }).complete,
    ).toBe(true);
    const id = flow({ name: "Chat de ejemplo", trigger: chat, plans: [agent, agent] });
    const asked = flow({ name: "Chat de Boni", trigger: chat, plans: [agent], by: "boni" });
    expect(convertFlow(store, id, NOW)).toEqual({ id, state: "left", why: "chat" });
    expect(convertFlow(store, asked, NOW)).toEqual({ id: asked, state: "left", why: "chat" });
    expect(store.journal.automation(id)).toBeNull();
    expect(store.journal.flowConversion(id)).toBeNull();
    expect(store.journal.flows().map((x) => x.id)).toContain(id);
    const r = conversionReport(store, NOW);
    expect(r.reasons.chat).toBe(2);
    expect(
      convertFlows(store, NOW)
        .filter((o) => o.id === id || o.id === asked)
        .sort((a, b) => (a.id === id ? -1 : b.id === id ? 1 : 0)),
    ).toEqual([
      { id, state: "left", why: "chat" },
      { id: asked, state: "left", why: "chat" },
    ]);
  });

  it("AU-230 · a flow that created a row, converted: none of its versions carries a «Sí», whoever starts it", () => {
    const id = flow({ trigger: MANUAL, plans: [CREATE(lit("una")), CREATE(ref("$nota"))] });
    const daily = flow({ trigger: DAILY, plans: [CREATE(lit("cada día"))] });
    const action = flow({ trigger: ALONE, plans: [ACTION] });
    convertFlows(store, NOW);
    for (const x of [id, daily]) {
      const v = versionsOf(store, x);
      if ("error" in v) throw new Error(v.error);
      for (const n of v.versions) {
        const doc = parseAutomation(
          JSON.parse(store.journal.automationVersion(x, n.n)?.doc ?? "{}"),
        );
        // Born «Preguntar» (decision 13): the step that creates asks, and none says «Sí».
        const said = doc.steps.map((step) => consentOf(step, "pedido", "create"));
        expect(said).toContain("ask");
        expect(said).not.toContain("yes");
      }
    }
    // An action of Boni's converts as «Acción de Boni», which has no «Sí»: its acts are decided behind the port.
    const doc = parseAutomation(JSON.parse(store.journal.automationDraft(action)?.doc ?? "{}"));
    expect(doc.steps.map((s) => s.type)).toContain(BONI_ACTION_TYPE);
  });

  /** A real run of an automation, as its engine keeps it once ended. */
  function ranAt(s: UserStore, automation: string, at: number, state = "done", test = false) {
    const id = `ar_${randomUUID()}`;
    s.journal.createAutomationRun({
      id,
      automation,
      version: test ? null : 1,
      test,
      state: "running",
      trigger: "t",
      fields: "{}",
      startedBy: "user",
      device: "d_portatil",
      retryOf: null,
      at,
      started: at,
      doc: test ? "{}" : null,
    });
    s.journal.endAutomationRun(id, {
      state: state as "done",
      ended: at + 40,
      ms: 40,
      step: null,
      error: state === "failed" ? "x" : null,
      line: JSON.stringify({ writes: [], asked: [], outside: false }),
    });
  }

  it("AU-225 · the conversion's list says for each automation «Hace lo mismo» or «Lo que cambia», and how many runs it has had since and how many failed", () => {
    const same = flow({ name: "Contar pedidos", trigger: DAILY, plans: [COUNT] });
    const changes = flow({
      name: "Apuntar pedido",
      trigger: MANUAL,
      plans: [CREATE(ref("$nota"))],
    });
    const kept = flow({ name: "Arreglar pedido", plans: [UPDATE] });
    const old = flow({ name: "Viejo", plans: [COUNT, UPDATE, COUNT] });
    convertFlows(store, NOW);
    // Since the conversion: three real runs, one failed; a test and a run of before do not count.
    for (const h of [1, 2, 3]) ranAt(store, same, NOW + h * HOUR, h === 2 ? "failed" : "done");
    ranAt(store, same, NOW + 4 * HOUR, "done", true);
    ranAt(store, same, NOW - HOUR);
    const list = conversionList(store);
    expect(list.closed).toBeNull();
    const by = new Map(list.items.map((x) => [x.id, x]));
    // A count only changes its limits («Sus límites son los de una automatización»); a write by hand asks now.
    expect(by.get(same)).toMatchObject({
      state: "converted",
      changes: ["automationLimits"],
      runs: 3,
      failed: 1,
    });
    expect(by.get(same)?.boni).toBe(false);
    expect(by.get(changes)?.changes).toContain("asksNow");
    expect(by.get(changes)).toMatchObject({ runs: 0, failed: 0, name: "Apuntar pedido" });
    // Kept as it was: its name from the flow, no runs of an automation.
    expect(by.get(kept)).toMatchObject({ state: "kept", name: "Arreglar pedido", runs: 0 });
    // «N versiones de antes no se pudieron convertir».
    expect(by.get(old)?.skipped).toBe(1);
    // By name, for the band.
    expect(list.items.map((x) => x.name)).toEqual([
      "Apuntar pedido",
      "Arreglar pedido",
      "Contar pedidos",
      "Viejo",
    ]);
  });

  it("AU-225 · P1: «Volver al flujo de antes», «Convertir otra vez» and «Cerrar» go through their action from a personal device only; a round trip loses nothing and sets no «Sí»", async () => {
    const id = flow({ trigger: MANUAL, plans: [CREATE(lit("una")), CREATE(ref("$nota"))] });
    convertFlows(store, NOW);
    const was = {
      versions: versionsOf(store, id),
      draft: store.journal.automationDraft(id)?.doc,
      published: store.journal.automation(id)?.published,
    };
    const personal = { store, trust: "personal" as const, device: "d_portatil" };
    const shared = { store, trust: "shared" as const, device: "d_salon" };
    // A shared device sees the state and cannot switch it.
    const refused = await runAction("automations.convert", { id, do: "back" }, shared);
    expect(JSON.stringify(refused)).toMatch(/not-personal|refused/);
    expect(store.journal.flowConversion(id)?.state).toBe("converted");
    const closed = await runAction("automations.convert", { do: "close" }, shared);
    expect(JSON.stringify(closed)).toMatch(/not-personal|refused/);
    expect(store.setting(BAND_CLOSED)).toBeNull();
    // His own: back, and again.
    expect(await runAction("automations.convert", { id, do: "back" }, personal)).toEqual({
      out: { state: "reverted" },
    });
    expect(store.journal.automation(id)?.enabled).toBe(false);
    expect(conversionList(store).items[0]?.state).toBe("reverted");
    expect(await runAction("automations.convert", { id, do: "again" }, personal)).toEqual({
      out: { state: "converted" },
    });
    expect(store.journal.automation(id)?.enabled).toBe(true);
    // Nothing lost, nothing more: the same versions, draft and running version, and no step says «Sí».
    expect(versionsOf(store, id)).toEqual(was.versions);
    expect(store.journal.automationDraft(id)?.doc).toBe(was.draft);
    expect(store.journal.automation(id)?.published).toBe(was.published);
    for (const n of [1, 2]) {
      const doc = parseAutomation(JSON.parse(store.journal.automationVersion(id, n)?.doc ?? "{}"));
      expect(doc.steps.map((x) => consentOf(x, "pedido", "create"))).not.toContain("yes");
    }
    // «Cerrar»: kept for the account; the list stays.
    expect(await runAction("automations.convert", { do: "close" }, personal)).toMatchObject({
      out: { closed: expect.any(Number) },
    });
    expect(conversionList(store).closed).not.toBeNull();
    expect(conversionList(store).items).toHaveLength(1);
    // Every route is listed, on the tailnet, run by its action, and none is a shared device's (decision 13).
    for (const [route, { action }] of Object.entries(CONVERSION_ROUTES)) {
      expect(ROUTES[route], route).toBe("tailnet");
      expect(SHARED_DEVICE_ROUTES.has(route), route).toBe(false);
      if (route.startsWith("GET ")) continue;
      expect(ROUTE_RUNS[route], route).toBe(action);
      expect(ROUTE_ACTIONS[route], route).toEqual([action]);
    }
  });

  it("AU-225 · P1 A-15: with 200 automations and a year of 40,000 runs, the band's list and «Versiones» answer within their times, by the runs' index", () => {
    const path = join(f.dir, `banda-${randomUUID()}.db`);
    store.close();
    store = openUserStore(path, { now: () => NOW });
    seeded(store);
    const ids: string[] = [];
    for (let i = 0; i < 200; i++)
      ids.push(
        flow({
          name: `Flujo ${i}`,
          trigger: i % 2 ? DAILY : ALONE,
          plans: Array.from({ length: 6 }, (_, k) => (k === 2 ? UPDATE : CREATE(lit(`v${k}`)))),
        }),
      );
    convertFlows(store, NOW);
    // A year of runs, half before the conversion and half after, one in twenty failed.
    store.close();
    const raw = new DatabaseSync(path);
    raw.exec("BEGIN");
    const run = raw.prepare(
      `INSERT INTO automation_runs (id, automation, version, test, state, trigger, fields, started_by, device, at, started, ended, ms)
       VALUES (?, ?, 1, 0, ?, 't', '{}', 'user', 'd_portatil', ?, ?, ?, 40)`,
    );
    for (let i = 0; i < 40_000; i++) {
      const at = NOW - 182 * DAY + i * 790_000;
      run.run(`ar_${i}`, ids[i % 200] as string, i % 20 ? "done" : "failed", at, at, at + 40);
    }
    raw.exec("COMMIT");
    raw.close();
    store = openUserStore(path, { now: () => NOW });
    let start = clock();
    const list = conversionList(store);
    under(
      clock() - start,
      150,
      "cpu",
      "the conversion's band with 200 automations and 40,000 runs",
    );
    expect(list.items).toHaveLength(200);
    const runs = list.items.reduce((n, x) => n + x.runs, 0);
    expect(runs).toBeGreaterThan(19_000);
    expect(runs).toBeLessThan(21_000);
    // «Versiones» of one of them, with «Convertida» on each.
    start = clock();
    const v = versionsOf(store, ids[7] as string);
    under(clock() - start, 30, "cpu", "«Versiones» of a converted automation");
    if ("error" in v) throw new Error(v.error);
    expect(v.versions.every((x) => x.flow !== null)).toBe(true);
    // The count is the covering index's: no run is read.
    const sql = new DatabaseSync(path);
    const plan = sql
      .prepare(`EXPLAIN QUERY PLAN ${AUTOMATION_FAILED_IN_SQL}`)
      .all(ids[0] as string, 0, NOW) as { detail: string }[];
    sql.close();
    expect(plan.map((p) => p.detail).join(" | ")).toMatch(
      /USING COVERING INDEX automation_runs_count/,
    );
  });
});
