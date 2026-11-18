import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { createConversation, fakePlanner, type ModelProvider, ScriptedProvider } from "@boni/agent";
import { type Cell, NOTIFY_TYPE } from "@boni/automations";
import { clock, under } from "@boni/pace";
import { SYS } from "@boni/views";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { jsBox } from "../../../packages/agent/test/convert.test-util.ts";
import { AgentHost, serveAgent } from "./agent.ts";
import { addUser } from "./auth.ts";
import { wireBoni } from "./automations/boni.ts";
import { keepBoniFlows, revertFlow } from "./automations/convert.ts";
import { publish, setEnabled } from "./automations/publish.ts";
import { cite, JUAN, made as madeAutomation, START } from "./automations/run.test-util.ts";
import { startRun } from "./automations/runs.ts";
import { publishedOf, setDeleted, testAutomation } from "./automations/service.ts";
import { type Db, openDb } from "./db.ts";
import { Feeds } from "./feeds.ts";
import { flowMap } from "./flowMap.ts";
import { BUDGET_FLOW, checkFlow, ensureFlow, saveUserFlow } from "./flows.ts";
import { deleteAutomationRow, flowsCollection } from "./flowsCollection.ts";
import { type App, makeApp, serve } from "./http.ts";
import { LoginGuard } from "./limits.ts";
import { AccountModels, BUDGET_PLAN, BUDGET_TRIGGER, catalogueOf, serveModels } from "./models.ts";

/** «Modelos» over HTTP with invented keys (never real ones) and no model calls. */
const PASSWORD = "una contraseña larga de ejemplo";
const SERVER_KEY = "clave-del-servidor-inventada-0001";
const MY_KEY = "clave-de-openrouter-inventada-0002";
let dir: string;
let db: Db;
let app: App;
let host: AgentHost;
let models: AccountModels;
let base: string;
let token: string;
let now = Date.UTC(2026, 9, 24, 12);
const servers: Server[] = [];
const notes: unknown[] = [];

const get = async (path: string) =>
  (await (
    await fetch(`${base}${path}`, { headers: { authorization: `Bearer ${token}` } })
  ).json()) as Record<string, unknown>;
const put = (path: string, body: unknown) =>
  fetch(`${base}${path}`, {
    method: "PUT",
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "boni-models-"));
  db = openDb(join(dir, "system.db"));
  addUser(db, "juan", PASSWORD);
  const planner = fakePlanner([]);
  host = new AgentHost({ dataDir: dir, providers: { planner, reader: planner }, now: () => now });
  const key = randomBytes(32);
  models = new AccountModels({
    db,
    key,
    host,
    defaults: {
      planner: { connection: "anthropic", model: "claude-opus-5-5" },
      reader: { connection: "anthropic", model: "claude-haiku-4-5" },
      reviewer: { connection: "anthropic", model: "claude-haiku-4-5" },
    },
    serverKeys: { anthropic: SERVER_KEY },
    now: () => now,
    // No network: every provider reads like a model that keeps nothing, and says what it cost.
    makeProvider: (v): ModelProvider => ({
      id: v.connection,
      privacy: "external-api",
      complete: async () => {
        await new Promise((r) => setTimeout(r, 15));
        return {
          json: { items: [] },
          usage: { input: 100, output: 10, cost: 0.001 },
          model: v.model,
        };
      },
    }),
  });
  host.models = models;
  host.providersFor = (a) => models.providers(a);
  host.overBudget = (a, asking) => models.overBudget(a, asking);
  host.subscribe(1, (event, data) => event === "notify" && notes.push(data));
  app = makeApp({
    db,
    key,
    feeds: new Feeds(async () => ""),
    guard: new LoginGuard({ perUser: 50, perAddress: 100, windowMs: 60_000, perMinute: 100 }),
    agent: host,
  });
  const s = serve(app, "tailnet");
  servers.push(s);
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", () => r()));
  base = `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
  const r = await fetch(`${base}/api/login`, {
    method: "POST",
    body: JSON.stringify({ user: "juan", password: PASSWORD, device: "portatil-ejemplo" }),
  });
  token = ((await r.json()) as { token: string }).token;
});

afterAll(async () => {
  for (const s of servers) {
    s.closeAllConnections();
    await new Promise((r) => s.close(r));
  }
  app.close();
  host.close();
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("«Modelos»", () => {
  it("shows each role as the server runs it, and says what each route does with the data", async () => {
    const v = await get("/api/agent/models");
    expect(v.roles).toEqual([
      expect.objectContaining({
        role: "planner",
        connection: "anthropic",
        privacy: "deletes-in-30-days",
        chosen: false,
      }),
      expect.objectContaining({ role: "reader", model: "claude-haiku-4-5", chosen: false }),
      expect.objectContaining({ role: "reviewer", chosen: false }),
    ]);
    expect(v.connections).toContainEqual({ connection: "anthropic", mine: false, server: true });
    expect(v.budget).toEqual({ monthlyEur: 10, warnAt: 0.8 });
    // Nothing of its own: the server's providers, as before.
    expect(models.providers(1)).toBeNull();
  });

  it("a role through OpenRouter keeping nothing, after its evaluation, with Juan's key; the key never comes back", async () => {
    const deepseek = { connection: "openrouter", model: "deepseek/deepseek-v4.1-flash", zdr: true };
    const evaluate = (body: unknown) =>
      fetch(`${base}/api/agent/models/evaluate`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
    // Not before its evaluation; and no evaluation without a key for its connection.
    expect((await put("/api/agent/models/roles/reader", deepseek)).status).toBe(409);
    expect(await (await evaluate({ role: "reader", ...deepseek })).json()).toEqual({
      error: "no-key",
    });
    let r = await put("/api/agent/models/keys/openrouter", { key: MY_KEY });
    expect(r.status).toBe(200);
    const text = await r.text();
    expect(text).not.toContain(MY_KEY);
    expect((await evaluate({ role: "reader", ...deepseek })).status).toBe(202);
    expect((await evaluate({ role: "reader", ...deepseek })).status).toBe(409); // one at a time
    await models.idle();
    const evals = (await get("/api/agent/models")).evaluations as {
      model: string;
      total: number;
    }[];
    // The candidate and the role's current model, to compare them.
    expect(evals.map((e) => e.model).sort()).toEqual([
      "claude-haiku-4-5",
      "deepseek/deepseek-v4.1-flash",
    ]);
    expect(evals[0]?.total).toBeGreaterThan(5);
    // What it cost counts in the month.
    expect(
      host
        .store(1)
        .journal.spending(0, now + 1)
        .some((x) => x.role === "eval-reader"),
    ).toBe(true);
    r = await put("/api/agent/models/roles/reader", deepseek);
    expect(r.status).toBe(200);
    const v = (await r.json()) as {
      roles: { role: string; chosen: boolean; missingKey: boolean }[];
    };
    expect(v.roles.find((x) => x.role === "reader")).toMatchObject({
      chosen: true,
      missingKey: false,
      privacy: "keeps-nothing",
    });
    expect(JSON.stringify(await get("/api/agent/models"))).not.toContain(MY_KEY);
    // Kept sealed in the store, not as text.
    expect(host.store(1).setting("models/keys")).not.toContain(MY_KEY);
    const p = models.providers(1);
    expect(p?.reader.id).toBe("openrouter");
    expect(p?.planner.id).toBe("anthropic");
    // The account's agent takes them, and keeps them while nothing changes.
    expect(models.providers(1)).toBe(p);
    // Back to the server's default.
    expect((await put("/api/agent/models/roles/reader", {})).status).toBe(200);
    expect(models.config(1).roles.reader).toBeUndefined();
    expect((await put("/api/agent/models/keys/openrouter", { key: null })).status).toBe(200);
  });

  it("refuses what is not a configuration, and changes only from a personal device", async () => {
    expect(
      (await put("/api/agent/models/roles/decider", { connection: "anthropic", model: "x" }))
        .status,
    ).toBe(400);
    expect(
      (await put("/api/agent/models/roles/writer", { connection: "openrouter", model: "x" }))
        .status,
    ).toBe(404);
    expect((await put("/api/agent/models/keys/openrouter", { key: "corta" })).status).toBe(400);
    expect((await put("/api/agent/models/budget", { monthlyEur: -3 })).status).toBe(400);
    let status = 0;
    const res = {
      writeHead: (s: number) => {
        status = s;
        return res;
      },
      end: () => res,
      setHeader: () => res,
    } as unknown as ServerResponse;
    const req = Readable.from([JSON.stringify({ monthlyEur: 50 })]) as unknown as IncomingMessage;
    await serveModels(
      models,
      req,
      res,
      "PUT /api/agent/models/budget",
      {},
      { account: 1, trust: "shared" },
    );
    expect(status).toBe(403);
    expect(models.config(1).budget.monthlyEur).toBe(10);
  });

  it("adds up the month's spending; warns once at 80 %, and at the budget stops background work", async () => {
    const j = host.store(1).journal;
    const call = (cost: number | undefined, at: number) =>
      j.modelCall({
        run: "r",
        role: "reader",
        provider: "anthropic",
        model: "claude-haiku-4-5",
        promptHash: "h",
        request: {},
        response: {},
        usage: { input: 1000, output: 100, ...(cost === undefined ? {} : { cost }) },
        at,
      });
    // What the evaluations above cost is in the month already.
    const before = models.spending(1).eur;
    call(5, now - 1000);
    call(undefined, now - 900);
    call(50, Date.UTC(2026, 8, 30)); // last month: not counted
    expect(models.overBudget(1)).toBe(false);
    expect(notes).toEqual([]);
    const v = await get("/api/agent/models");
    expect(v.spending).toMatchObject({ month: "2026-10" });
    expect((v.spending as { eur: number }).eur).toBeCloseTo(before + 4.5, 6);
    expect((v.spending as { rows: { calls: number; unpriced: number }[] }).rows[0]).toMatchObject({
      calls: 2,
      unpriced: 1,
    });
    call(4.5, now - 800); // 9.5 $ = 8.55 €: past 80 % of 10 €
    now += 31_000;
    expect(models.overBudget(1)).toBe(false);
    // The notice is Boni's «Aviso del presupuesto» (D-53): its run tells, a moment after the check has answered.
    await models.idle();
    expect(notes).toHaveLength(1);
    now += 31_000;
    models.overBudget(1);
    await models.idle();
    expect(notes).toHaveLength(1); // once a month
    call(2, now - 10);
    now += 31_000;
    expect(models.overBudget(1)).toBe(true);
    expect((await get("/api/agent/models")).over).toBe(true);
    // Background work stops; the agent says why.
    const r = await host.agent(1).background({
      version: 1,
      steps: [{ id: "x", op: "read", reader: "summarize", input: { lit: "texto inventado" } }],
    });
    expect([r.status, r.error]).toEqual(["stopped", "P13-month-budget"]);
  });

  it("reads OpenRouter's lists as the catalogue: only models some provider serves keeping nothing", () => {
    const list = catalogueOf(
      {
        data: [
          { id: "deepseek/ejemplo", name: "DeepSeek: Ejemplo" },
          { id: "otro/x", name: "Otro" },
        ],
      },
      {
        data: [
          {
            model_id: "deepseek/ejemplo",
            provider_name: "A",
            pricing: { prompt: "0.0000002", completion: "0.000001" },
            context_length: 1000,
            supported_parameters: ["max_tokens"],
          },
          {
            model_id: "deepseek/ejemplo",
            provider_name: "B",
            pricing: { prompt: "0.0000001", completion: "0.000001" },
            supported_parameters: ["response_format"],
          },
          { model_id: "roto", pricing: { prompt: "x" } },
        ],
      },
    );
    expect(list).toEqual([
      {
        id: "deepseek/ejemplo",
        name: "DeepSeek: Ejemplo",
        input: 0.1,
        output: 1,
        context: 1000,
        providers: ["A", "B"],
        structured: true,
      },
    ]);
  });
});

/**
 * «Aviso del presupuesto» (docs/sistema.md §4.2, D-53): the notice of the month's spending as a flow of Boni. Each test
 * has a server of its own, wired as main.ts wires «Modelos», with models that are counted and cost nothing: what is
 * spent is written in the journal as a call's cost.
 */
describe("«Aviso del presupuesto», Boni's flow (D-53)", () => {
  const made: (() => void)[] = [];
  afterEach(() => {
    for (const close of made.splice(0)) close();
    vi.restoreAllMocks();
  });

  /** His version with a step more: a reader that asks a model before it tells. */
  const WITH_READER = {
    version: 1,
    steps: [
      { id: "r", op: "read", reader: "summarize", input: { ref: "$spent" } },
      ...BUDGET_PLAN.steps,
    ],
  };

  function serverOf(o: { models?: boolean; storeFirst?: boolean } = {}) {
    const dir = mkdtempSync(join(tmpdir(), "boni-budget-"));
    const sys = openDb(join(dir, "system.db"));
    addUser(sys, "juan", PASSWORD);
    const clock = { now: Date.UTC(2026, 9, 24, 12) };
    // Every reader answers a summary; the requests it got are counted.
    const model = new ScriptedProvider("inventado", () => ({ text: "Un resumen inventado" }));
    const h = new AgentHost({
      dataDir: dir,
      providers: o.models === false ? null : { planner: model, reader: model },
      now: () => clock.now,
    });
    const m = new AccountModels({
      db: sys,
      key: randomBytes(32),
      host: h,
      defaults: {},
      serverKeys: {},
      now: () => clock.now,
    });
    // A store asked for before «Modelos» is there (the day's copy at the server's start does that).
    if (o.storeFirst) h.store(1);
    // As main.ts wires them.
    h.models = m;
    h.providersFor = (a) => m.providers(a);
    h.overBudget = (a, asking) => m.overBudget(a, asking);
    const told: { text: string; integrity: string }[] = [];
    h.subscribe(1, (event, data) => {
      if (event === "notify") told.push(data as { text: string; integrity: string });
    });
    made.push(() => {
      h.close();
      sys.close();
      rmSync(dir, { recursive: true, force: true });
    });
    const store = () => h.store(1);
    return {
      host: h,
      models: m,
      model,
      told,
      clock,
      store,
      /** A model call of this month that cost so many dollars (0.9 € each), written as the agent writes them. */
      spend(usd: number) {
        store().journal.modelCall({
          run: "r",
          role: "reader",
          provider: "anthropic",
          model: "claude-haiku-4-5",
          promptHash: "h",
          request: {},
          response: {},
          usage: { input: 1000, output: 100, cost: usd },
          at: clock.now - 1000,
        });
      },
      /** The budget asked as the agent asks it before a background call, later than the 30 s the spending is kept. */
      async check() {
        clock.now += 31_000;
        const over = m.overBudget(1);
        await m.idle();
        return over;
      },
      runs: () =>
        store()
          .journal.runsIn(0, clock.now + 1)
          .filter((r) => r.flow === BUDGET_FLOW && r.origin !== "test"),
      /** A request of the app from a personal device, as the server answers it (the flow's own by default). */
      async ask(route: string, q: { body?: unknown; id?: string; url?: string } = {}) {
        const res = { status: 0, body: "" };
        const out = {
          writeHead: (st: number) => {
            res.status = st;
            return out;
          },
          end: (b?: string) => {
            res.body = b ?? "";
            return out;
          },
          setHeader: () => out,
        } as unknown as ServerResponse;
        const req = Object.assign(Readable.from([Buffer.from(JSON.stringify(q.body ?? {}))]), {
          url: q.url ?? "/",
        }) as unknown as IncomingMessage;
        await serveAgent(
          h,
          req,
          out,
          route,
          { id: q.id ?? BUDGET_FLOW },
          { account: 1, device: "portatil-ejemplo", trust: "personal" },
        );
        return { status: res.status, json: JSON.parse(res.body || "null") as unknown };
      },
    };
  }

  it("is among the account's flows from the start: started by the month's spending, one step «Avisar», on", () => {
    const s = serverOf();
    const f = s.store().journal.flow(BUDGET_FLOW);
    expect(f).toMatchObject({
      name: "Aviso del presupuesto",
      by: "preset",
      enabled: true,
      version: 1,
      trigger: { spending: "warn" },
      // The month's spending and the budget, each a text, are what its trigger gives.
      inputs: [
        { id: "spent", what: "text" },
        { id: "budget", what: "text" },
      ],
    });
    expect(f?.plan).toEqual(BUDGET_PLAN);
    expect(checkFlow(s.store(), s.host.tools, f as never, { modules: [], mailType: null })).toEqual(
      expect.objectContaining({ problems: [] }),
    );
    // Asked for again (the map, «Flujos», another check): the same version, never another.
    s.models.keepFlowCurrent(1);
    s.host.boniFlowsCurrent(1);
    expect(s.store().journal.flowVersions(BUDGET_FLOW)).toHaveLength(1);
  });

  it("an account whose store was asked for before «Modelos» was there has it all the same, the next time it is asked for", () => {
    const s = serverOf({ storeFirst: true });
    expect(s.store().journal.flow(BUDGET_FLOW)).toMatchObject({ by: "preset", enabled: true });
    expect(s.store().journal.flowVersions(BUDGET_FLOW)).toHaveLength(1);
  });

  /** What the map says the flow told the devices in the last week (flowMap.ts): its arrow's number and theirs. */
  const onMap = (s: ReturnType<typeof serverOf>) => {
    const m = flowMap(s.store(), {
      now: s.clock.now + 1,
      days: 7,
      tz: "Europe/Madrid",
      mailType: null,
      mailAccount: null,
    });
    return [
      m.edges.find((e) => e.from === `flow:${BUDGET_FLOW}` && e.kind === "tells")?.n,
      m.nodes.find((n) => n.kind === "device")?.notices,
    ];
  };

  it("passing the warning runs it once a month: one run with no model call, its «Avisar» telling the devices", async () => {
    const s = serverOf();
    s.spend(5); // 4.50 € of 10 €: under the warning (80 %)
    expect(await s.check()).toBe(false);
    expect([s.told, s.runs()]).toEqual([[], []]);
    s.spend(4); // 8.10 €: past it
    expect(await s.check()).toBe(false);
    // The text as before; told by the flow's step, it carries what any literal of a plan Boni wrote carries (the
    // model's label: `Agent` gives it to a preset flow's literals), where the code's own notice said «own».
    expect(s.told).toEqual([
      { text: "Los modelos llevan 8.10 € de 10 € este mes.", integrity: "model" },
    ]);
    const [run] = s.runs();
    expect(run).toMatchObject({
      origin: "background",
      status: "done",
      flow: BUDGET_FLOW,
      flowVersion: 1,
      turn: null,
    });
    // No model was asked anything: the run is its «Avisar» alone, allowed by the policy.
    expect(s.model.requests).toHaveLength(0);
    expect(s.store().journal.modelCalls(run?.id ?? "")).toEqual([]);
    expect(
      s
        .store()
        .journal.steps(run?.id ?? "")
        .map((x) => [x.step, x.decision]),
    ).toEqual([["notify", "allow"]]);
    // On the map, that notice is the flow's: its arrow to the devices, and their number.
    expect(onMap(s)).toEqual([1, 1]);
    // Asked again and again in the month, with more spent: no other run, no other notice.
    s.spend(0.5);
    expect(await s.check()).toBe(false);
    expect(await s.check()).toBe(false);
    expect([s.told.length, s.runs().length]).toEqual([1, 1]);
    // The next month starts unmarked: under the warning nothing, past it one run more.
    s.clock.now = Date.UTC(2026, 10, 3, 9);
    expect(await s.check()).toBe(false);
    expect(s.runs()).toHaveLength(1);
    s.spend(9.5); // 8.55 € of November
    expect(await s.check()).toBe(false);
    expect(s.told.map((n) => n.text)).toEqual([
      "Los modelos llevan 8.10 € de 10 € este mes.",
      "Los modelos llevan 8.55 € de 10 € este mes.",
    ]);
    expect(s.runs()).toHaveLength(2);
    expect(s.store().journal.flowRuns(BUDGET_FLOW).runs).toBe(2);
  });

  it("the month's run is the flow's where the app asks: the Registro's list and its Recorrido, «Flujos» and the flow's page", async () => {
    const s = serverOf();
    s.spend(9);
    expect(await s.check()).toBe(false);
    const [run] = s.runs();
    const id = run?.id ?? "";
    // The Registro names it by its flow, a run of its own.
    const log = await s.ask("GET /api/agent/runs", { url: "/api/agent/runs" });
    expect((log.json as { runs: unknown[] }).runs).toEqual([
      expect.objectContaining({
        id,
        origin: "background",
        status: "done",
        what: { kind: "flow", flow: "Aviso del presupuesto" },
        changed: 0,
      }),
    ]);
    // Its Recorrido: the flow and its version, what its trigger gave, its one step, no model.
    const way = await s.ask("GET /api/agent/runs/:id", { id, url: `/api/agent/runs/${id}` });
    expect(way.json).toMatchObject({
      status: "done",
      flow: BUDGET_FLOW,
      flowVersion: 1,
      owner: `flow:${BUDGET_FLOW}`,
      inputs: ["spent", "budget"],
      steps: [{ id: "notify", title: "Avisar", decision: "allow", uses: ["spent", "budget"] }],
      models: [],
      proposals: [],
      changes: [],
    });
    // «Flujos» and the flow's page count it.
    const list = await s.ask("GET /api/agent/flows", { url: "/api/agent/flows" });
    expect((list.json as { flows: unknown[] }).flows).toEqual([
      expect.objectContaining({ id: BUDGET_FLOW, by: "preset", enabled: true, steps: 1, runs: 1 }),
    ]);
    const page = await s.ask("GET /api/agent/flows/:id", {
      url: `/api/agent/flows/${BUDGET_FLOW}`,
    });
    expect(page.json).toMatchObject({
      name: "Aviso del presupuesto",
      trigger: { spending: "warn" },
      runs: 1,
      preset: 1,
      inputs: [
        { id: "spent", what: "text" },
        { id: "budget", what: "text" },
      ],
      nodes: [{ id: "notify", what: "notify", title: "Avisar", deps: ["spent", "budget"] }],
    });
  });

  it("off, nothing is told and nothing runs, and the cap stops background work all the same; turned on, it tells then", async () => {
    const s = serverOf();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    // Ajustes → Modelos is told whether passing the warning tells.
    expect(s.models.view(1).notice).toBe(true);
    s.store().journal.setFlowEnabled(BUDGET_FLOW, false);
    expect(s.models.view(1).notice).toBe(false);
    s.spend(9); // 8.10 €: past the warning
    expect(await s.check()).toBe(false);
    expect(await s.check()).toBe(false);
    expect([s.told, s.runs()]).toEqual([[], []]);
    // The month is not marked, and the log says once why nothing was told.
    expect(s.store().setting("models/warned")).toBeNull();
    expect(log.mock.calls.filter((c) => String(c[0]).includes("is off"))).toHaveLength(1);
    // The cap is not a step of the flow: at the budget, background work calls no model, the flow off.
    s.spend(3); // 10.80 €
    expect(await s.check()).toBe(true);
    const stopped = await s.host.agent(1).background({
      version: 1,
      steps: [{ id: "x", op: "read", reader: "summarize", input: { lit: "texto inventado" } }],
    });
    expect([stopped.status, stopped.error]).toEqual(["stopped", "P13-month-budget"]);
    expect(s.model.requests).toHaveLength(0);
    expect([s.told, s.runs()]).toEqual([[], []]);
    // Turned on later in the month: the next check tells, once; the cap answers the same.
    s.store().journal.setFlowEnabled(BUDGET_FLOW, true);
    expect(await s.check()).toBe(true);
    expect(await s.check()).toBe(true);
    expect(s.told.map((n) => n.text)).toEqual(["Los modelos llevan 10.80 € de 10 € este mes."]);
    expect(s.runs()).toHaveLength(1);
  });

  it("the cap is the same with the flow on, off or changed by Juan, whose version is what runs", async () => {
    const answers = async (prepare: (s: ReturnType<typeof serverOf>) => void) => {
      const s = serverOf();
      prepare(s);
      const out: boolean[] = [];
      for (const usd of [5, 4, 2, 1]) {
        s.spend(usd); // 4.50 €, 8.10 €, 9.90 €, 10.80 €
        out.push(await s.check());
      }
      return { out, told: s.told.map((n) => n.text) };
    };
    const mine = {
      version: 1,
      steps: [
        {
          id: "notify",
          op: "call",
          tool: "notify",
          args: { text: { fn: "concat", args: [{ lit: "Gasto en IA: " }, { ref: "$spent" }] } },
        },
      ],
    };
    const on = await answers(() => {});
    const off = await answers((s) => s.store().journal.setFlowEnabled(BUDGET_FLOW, false));
    const changed = await answers((s) => {
      const saved = saveUserFlow(s.store(), BUDGET_FLOW, { base: 1, plan: mine }, [], 1000);
      expect("flow" in saved && saved.flow.by).toBe("user");
    });
    const cap = [false, false, false, true];
    expect([on.out, off.out, changed.out]).toEqual([cap, cap, cap]);
    expect(on.told).toEqual(["Los modelos llevan 8.10 € de 10 € este mes."]);
    expect(off.told).toEqual([]);
    // His text, with the figure the trigger gives.
    expect(changed.told).toEqual(["Gasto en IA: 8.10"]);
  });

  it("no recursion: the month is marked before the run starts, so a model step Juan added to it asks the budget again and starts no other; a run that stops is not tried again, and the code tells in its place", async () => {
    const mine = (s: ReturnType<typeof serverOf>, plan: unknown) =>
      expect("flow" in saveUserFlow(s.store(), BUDGET_FLOW, { base: 1, plan }, [], 1000)).toBe(
        true,
      );
    // Under the cap: his reader is asked (its call asks the budget inside the run), then «Avisar».
    const s = serverOf();
    mine(s, WITH_READER);
    const asked = vi.spyOn(s.models, "overBudget");
    s.spend(9);
    expect(await s.check()).toBe(false);
    // The check itself, and the run's own before its reader.
    expect(asked).toHaveBeenCalledTimes(2);
    expect(s.model.requests).toHaveLength(1);
    expect(s.runs().map((r) => r.status)).toEqual(["done"]);
    expect(s.told).toHaveLength(1);
    expect(await s.check()).toBe(false);
    expect([s.runs().length, s.told.length]).toEqual([1, 1]);

    // At the cap when it fires: the run's reader is stopped by the cap like any background work (the cap is the
    // floor) and the run stops before «Avisar». The month's notice is not lost with it: the code tells, as before
    // the flow. No other run is made that month, and nothing is told twice.
    const t = serverOf();
    vi.spyOn(console, "log").mockImplementation(() => {});
    mine(t, WITH_READER);
    t.spend(12); // 10.80 €: past the warning and the budget at once
    expect(await t.check()).toBe(true);
    expect(t.model.requests).toHaveLength(0);
    expect(t.runs().map((r) => r.status)).toEqual(["stopped:P13-month-budget"]);
    expect(t.told).toEqual([
      { text: "Los modelos llevan 10.80 € de 10 € este mes.", integrity: "own" },
    ]);
    expect(await t.check()).toBe(true);
    expect(await t.check()).toBe(true);
    expect([t.runs().length, t.told.length]).toEqual([1, 1]);
    // What the code told is no run's: the map counts no notice of the flow's (its arrow stays, with no number).
    expect(onMap(t)).toEqual([0, 0]);

    // A run that stops after its «Avisar» has told already (his text): the code adds nothing.
    const u = serverOf();
    const [tell] = BUDGET_PLAN.steps;
    const his = { fn: "concat", args: [{ lit: "Gasto en IA: " }, { ref: "$spent" }] };
    mine(u, { version: 1, steps: [{ ...tell, args: { text: his } }, WITH_READER.steps[0]] });
    u.spend(12);
    expect(await u.check()).toBe(true);
    expect(u.runs().map((r) => r.status)).toEqual(["stopped:P13-month-budget"]);
    expect(u.told.map((n) => n.text)).toEqual(["Gasto en IA: 10.80"]);
    // That one is the run's, though it stopped afterwards.
    expect(onMap(u)).toEqual([1, 1]);
  });

  it("a «Probar» that asks a model gets the cap's answer and starts nothing: the notice waits for the next call that is no test", async () => {
    const s = serverOf();
    vi.spyOn(console, "log").mockImplementation(() => {});
    expect(
      "flow" in saveUserFlow(s.store(), BUDGET_FLOW, { base: 1, plan: WITH_READER }, [], 1000),
    ).toBe(true);
    // Past the warning, and nothing has asked the budget yet this month: it is not marked.
    s.spend(9);
    const tried = await s.ask("POST /api/agent/flows/:id/test");
    await s.models.idle();
    expect(tried).toMatchObject({
      status: 200,
      json: {
        status: "done",
        steps: {
          r: { decision: "allow" },
          notify: {
            would: [{ tool: "notify", text: "Los modelos llevan 8.10 € de 10 € este mes." }],
          },
        },
      },
    });
    // The test's reader did ask a model (a «Probar» reads for real), and that started nothing.
    expect(s.model.requests).toHaveLength(1);
    expect([s.told, s.runs()]).toEqual([[], []]);
    expect(s.store().setting("models/warned")).toBeNull();
    // At the budget a «Probar» is stopped like any background work, and still starts nothing.
    s.spend(3); // 10.80 €
    s.clock.now += 31_000;
    const capped = await s.ask("POST /api/agent/flows/:id/test");
    await s.models.idle();
    expect(capped).toMatchObject({
      status: 200,
      json: { status: "stopped", error: "P13-month-budget" },
    });
    expect(s.model.requests).toHaveLength(1);
    expect([s.told, s.runs()]).toEqual([[], []]);
    // The next call that is no test starts the month's run, once.
    expect(await s.check()).toBe(true);
    expect(s.runs()).toHaveLength(1);
    expect(s.told).toHaveLength(1);
  });

  it("a part of it may be tried («Probar hasta aquí» on a step before «Avisar»), though it is not saved without its «Avisar»", async () => {
    const s = serverOf();
    const part = { version: 1, steps: [WITH_READER.steps[0]] };
    // As the flow, the checklist refuses it, and so does «Guardar»…
    expect(
      checkFlow(
        s.store(),
        s.host.tools,
        { trigger: BUDGET_TRIGGER, plan: part },
        { modules: [], mailType: null },
      ).problems,
    ).toEqual([{ step: null, at: "trigger", code: "budget-needs-notice" }]);
    expect(
      await s.ask("PUT /api/agent/flows/:id", { body: { base: 1, plan: part } }),
    ).toMatchObject({
      status: 400,
      json: { error: "invalid" },
    });
    // …and as a part of it, it is tried: the reader reads, nothing is told.
    const tried = await s.ask("POST /api/agent/flows/:id/test", {
      body: { plan: part, trigger: BUDGET_TRIGGER },
    });
    expect(tried).toMatchObject({
      status: 200,
      json: { status: "done", steps: { r: { decision: "allow" } } },
    });
    expect(s.model.requests).toHaveLength(1);
    expect(s.told).toEqual([]);
    // What the run itself would refuse is refused in a test too.
    const broken = {
      version: 1,
      steps: [{ id: "a", op: "call", tool: "notify", args: { text: { ref: "$nadie" } } }],
    };
    expect(
      await s.ask("POST /api/agent/flows/:id/test", {
        body: { plan: broken, trigger: BUDGET_TRIGGER },
      }),
    ).toMatchObject({ status: 400, json: { error: "invalid" } });
  });

  it("in a burst of calls the spending is read again every 30 s, so the warning and the cap are not looked at with an old figure", async () => {
    const s = serverOf();
    s.spend(5); // 4.50 €
    expect(await s.check()).toBe(false);
    const read = vi.spyOn(s.models, "spending");
    // Seventy seconds of background calls five seconds apart, each costing a dollar: 5 $ more every 25 s.
    const answers: boolean[] = [];
    for (let i = 0; i < 14; i++) {
      s.clock.now += 5_000;
      s.spend(1);
      answers.push(s.models.overBudget(1));
      await s.models.idle();
    }
    // Read again at 30 s (11 $: 9.90 €, past the warning) and at 60 s (17 $: 15.30 €, past the budget): twice, not
    // on every call and not never.
    expect(read).toHaveBeenCalledTimes(2);
    expect(s.told.map((n) => n.text)).toEqual(["Los modelos llevan 9.90 € de 10 € este mes."]);
    expect(answers.indexOf(true)).toBe(11);
    expect(answers.slice(11)).toEqual([true, true, true]);
  });

  it("without models for the account there is nothing to run it: the notice is told by code as before, with no run; off, nothing", async () => {
    const s = serverOf({ models: false });
    vi.spyOn(console, "log").mockImplementation(() => {});
    expect(s.host.onFor(1)).toBe(false);
    // The flow is the account's all the same (it is data: seen and switched with the agent off).
    expect(s.store().journal.flow(BUDGET_FLOW)?.enabled).toBe(true);
    s.spend(9);
    expect(await s.check()).toBe(false);
    expect(s.told).toEqual([
      { text: "Los modelos llevan 8.10 € de 10 € este mes.", integrity: "own" },
    ]);
    expect(s.runs()).toEqual([]);
    // Told by code, with no run: it is not on the map (docs/sistema.md §4.4), whose notices are the runs' own.
    expect(onMap(s)).toEqual([0, 0]);
    expect(await s.check()).toBe(false);
    expect(s.told).toHaveLength(1);
    // Off: no notice there either.
    const off = serverOf({ models: false });
    off.store().journal.setFlowEnabled(BUDGET_FLOW, false);
    off.spend(9);
    expect(await off.check()).toBe(false);
    expect(off.told).toEqual([]);
  });

  it("a flow that cannot be kept never silences the notice: it is told by code, once, with no run", async () => {
    const s = serverOf();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    const broken = vi.spyOn(s.store().journal, "flow").mockImplementation(() => {
      throw new Error("journal de ejemplo roto");
    });
    s.spend(9);
    expect(await s.check()).toBe(false);
    expect(await s.check()).toBe(false);
    broken.mockRestore();
    expect(s.told).toEqual([
      { text: "Los modelos llevan 8.10 € de 10 € este mes.", integrity: "own" },
    ]);
    expect(s.runs()).toEqual([]);
    expect(warn.mock.calls.some((c) => String(c[0]).includes("not kept"))).toBe(true);
  });

  it("without a budget there is no warning to pass", async () => {
    const s = serverOf();
    expect(
      s.models.saveConfig(1, { ...s.models.config(1), budget: { monthlyEur: 0, warnAt: 0.8 } }),
    ).toEqual([]);
    s.spend(50);
    expect(await s.check()).toBe(false);
    expect([s.told, s.runs()]).toEqual([[], []]);
  });

  it("«Probar» tells nothing: it says what it would tell, with the month's figures, and is no run of the flow; nor is it run by hand", async () => {
    const s = serverOf();
    s.spend(3); // 2.70 €
    // The editor's «Probar»: the saved flow, dry.
    const tried = await s.ask("POST /api/agent/flows/:id/test");
    expect(tried.status).toBe(200);
    const view = tried.json as {
      status: string;
      steps: Record<string, { would: { tool: string | null; text: string | null }[] }>;
    };
    expect(view.status).toBe("done");
    expect(view.steps.notify?.would).toEqual([
      expect.objectContaining({
        tool: "notify",
        text: "Los modelos llevan 2.70 € de 10 € este mes.",
      }),
    ]);
    // Figures a request brings are not the trigger's: the month's own are what it would tell.
    const forged = await s.ask("POST /api/agent/flows/:id/test", {
      body: { inputs: { spent: "0.01", budget: "999" } },
    });
    expect((forged.json as typeof view).steps.notify?.would.map((w) => w.text)).toEqual([
      "Los modelos llevan 2.70 € de 10 € este mes.",
    ]);
    // Its spending starts it, never a hand: «Ejecutar» is refused.
    expect(await s.ask("POST /api/agent/flows/:id/run")).toEqual({
      status: 409,
      json: { error: "not-manual" },
    });
    // Nothing reached a device, the month is not marked and the flow has no run.
    expect(s.told).toEqual([]);
    expect(s.store().setting("models/warned")).toBeNull();
    expect(s.runs()).toEqual([]);
    expect(s.store().journal.flowRuns(BUDGET_FLOW).runs).toBe(0);
  });

  // ------------------------------------------------ as one of Boni's automations (F16 S2c, AU-220, AU-221, AU-224)

  /** Boni's steps wired as main.ts wires them, for this server's account: its agent, and «Probar»'s row. */
  const wire = (s: ReturnType<typeof serverOf>) =>
    wireBoni({
      reaches: (st) => st === s.store(),
      agentOf: () => s.host.agent(1, true),
      triggerRow: (_st, automation) =>
        automation === "budgetNotice" ? s.models.noticeRow(1) : null,
    });
  /** The automation's runs (not its tests), the newest first. */
  const autoRuns = (s: ReturnType<typeof serverOf>) =>
    s
      .store()
      .journal.automationRuns(BUDGET_FLOW, { filter: "all", limit: 50 })
      .filter((r) => !r.test);
  /** What each run's «Avisar» told. */
  const toldBy = (s: ReturnType<typeof serverOf>, run: string) =>
    s
      .store()
      .journal.automationRunSteps(run)
      .flatMap(
        (x) =>
          (JSON.parse(x.record) as { notices?: { notices: { text: string }[] } }).notices
            ?.notices ?? [],
      )
      .map((n) => n.text);

  describe("as one of Boni's automations", () => {
    afterEach(() => wireBoni(null));

    it("AU-221 · S2c: converted the first time it is asked for: Boni's, started by the month's spending, its «Avisar», on; asked again, nothing more", () => {
      const s = serverOf();
      // Unwired (as the server is before main.ts wires Boni's steps), it stays the flow, kept to try again.
      expect(s.store().journal.flowConversion(BUDGET_FLOW)?.state ?? "kept").toBe("kept");
      wire(s);
      s.models.keepFlowCurrent(1);
      expect(s.store().journal.flowConversion(BUDGET_FLOW)?.state).toBe("converted");
      const row = s.store().journal.automation(BUDGET_FLOW);
      expect(row).toMatchObject({ by: "preset", enabled: true, published: 1 });
      const steps = publishedOf(s.store(), BUDGET_FLOW)?.automation.steps ?? [];
      expect(steps.map((x) => x.type)).toEqual(["boni.spending", NOTIFY_TYPE]);
      // The flow of before is untouched and asleep, reachable again by «Volver al flujo de antes» (decision 21).
      expect(s.store().journal.flowVersions(BUDGET_FLOW)).toHaveLength(1);
      expect(s.store().journal.flow(BUDGET_FLOW)).toMatchObject({ by: "preset", version: 1 });
      s.models.keepFlowCurrent(1);
      s.host.boniFlowsCurrent(1);
      expect(s.store().journal.automationVersions(BUDGET_FLOW)).toHaveLength(1);
      expect(s.models.view(1).notice).toBe(true);
    });

    it("AU-221 · S2c: in «Automatizaciones» it is Boni's, started by «El gasto llega al aviso», on, on the map telling the devices, and never deleted", () => {
      const s = serverOf();
      wire(s);
      s.models.keepFlowCurrent(1);
      const list = flowsCollection(s.store());
      const row = list.rows.find((r) => r.id === SYS.flows.automation + BUDGET_FLOW);
      const words = list.type.fields
        .find((f) => f.id === SYS.flows.trigger)
        ?.options?.find((o) => o.id === row?.values[SYS.flows.trigger])?.name;
      expect([row?.values[SYS.flows.title], words, row?.values[SYS.flows.state]]).toEqual([
        "Aviso del presupuesto",
        "El gasto llega al aviso",
        SYS.flows.on,
      ]);
      expect(row?.values[SYS.flows.by]).toBe(SYS.flows.boni);
      const m = flowMap(s.store(), {
        now: s.clock.now,
        days: 7,
        tz: "Europe/Madrid",
        mailType: null,
        mailAccount: null,
      });
      expect(m.nodes.filter((n) => n.name === "Aviso del presupuesto")).toHaveLength(1);
      expect(m.nodes.some((n) => n.kind === "device")).toBe(true);
      // Turned off, never deleted: by the list and by its own «Eliminar».
      expect(() =>
        deleteAutomationRow(s.store(), SYS.flows.automation + BUDGET_FLOW, true),
      ).toThrow("flow-boni-delete");
      expect(setDeleted(s.store(), BUDGET_FLOW, true)).toEqual({ error: "bad-request" });
      expect(s.store().journal.automation(BUDGET_FLOW)).toMatchObject({ by: "preset" });
      expect(flowsCollection(s.store()).rows.some((r) => r.id === row?.id)).toBe(true);
    });

    it("AU-220 · S2c: passing the warning runs its published version once a month, by the clock, telling what the flow told; no run of before", async () => {
      const s = serverOf();
      wire(s);
      s.models.keepFlowCurrent(1);
      s.spend(5); // 4.50 €: under the warning
      expect(await s.check()).toBe(false);
      expect([s.told, autoRuns(s)]).toEqual([[], []]);
      s.spend(4); // 8.10 €
      expect(await s.check()).toBe(false);
      // The text as the flow told it. Its integrity is the code's row's («own», as the code's own notice), where the
      // flow's step said «model».
      const [run] = autoRuns(s);
      // It says which run told it, so the app opens that run from the notice.
      expect(s.told).toEqual([
        {
          text: "Los modelos llevan 8.10 € de 10 € este mes.",
          integrity: "own",
          about: { automation: BUDGET_FLOW, run: run?.id },
        },
      ]);
      expect(run).toMatchObject({ state: "done", version: 1, startedBy: "schedule", device: null });
      expect(toldBy(s, run?.id ?? "")).toEqual(["Los modelos llevan 8.10 € de 10 € este mes."]);
      // Its trigger's row is the code's figures, nothing else.
      expect(JSON.parse(run?.fields ?? "{}")).toEqual({ spent: "8.10", budget: "10" });
      // The engine of before ran nothing, and no model was asked anything.
      expect(s.runs()).toEqual([]);
      expect(s.model.requests).toHaveLength(0);
      // Once a month: more spent, asked again, nothing more.
      s.spend(0.5);
      expect(await s.check()).toBe(false);
      expect(await s.check()).toBe(false);
      expect([s.told.length, autoRuns(s).length]).toEqual([1, 1]);
      // The next month, past the warning again: one run more.
      s.clock.now = Date.UTC(2026, 10, 3, 9);
      s.spend(9.5);
      expect(await s.check()).toBe(false);
      expect(s.told.map((n) => n.text)).toEqual([
        "Los modelos llevan 8.10 € de 10 € este mes.",
        "Los modelos llevan 8.55 € de 10 € este mes.",
      ]);
      expect(autoRuns(s)).toHaveLength(2);
      expect(s.runs()).toEqual([]);
    });

    it("AU-220 · S2c: off by its switch, nothing is told and the month stays unmarked; on again, the next check tells", async () => {
      const s = serverOf();
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      wire(s);
      s.models.keepFlowCurrent(1);
      expect(setEnabled(s.store(), BUDGET_FLOW, false, JUAN)).toEqual({ enabled: false });
      expect(s.models.view(1).notice).toBe(false);
      s.spend(9);
      expect(await s.check()).toBe(false);
      expect(await s.check()).toBe(false);
      expect([s.told, autoRuns(s), s.runs()]).toEqual([[], [], []]);
      expect(s.store().setting("models/warned")).toBeNull();
      expect(log.mock.calls.filter((c) => String(c[0]).includes("is off"))).toHaveLength(1);
      expect(setEnabled(s.store(), BUDGET_FLOW, true, JUAN)).toEqual({ enabled: true });
      expect(await s.check()).toBe(false);
      expect(s.told.map((n) => n.text)).toEqual(["Los modelos llevan 8.10 € de 10 € este mes."]);
      expect(autoRuns(s)).toHaveLength(1);
    });

    it("AU-221 · S2c: sent back to the flow («Volver al flujo de antes»), the flow runs as before and stays so", async () => {
      const s = serverOf();
      wire(s);
      s.models.keepFlowCurrent(1);
      expect(revertFlow(s.store(), BUDGET_FLOW, s.clock.now)).toBe(true);
      s.models.keepFlowCurrent(1);
      expect(s.store().journal.flowConversion(BUDGET_FLOW)?.state).toBe("reverted");
      s.spend(9);
      expect(await s.check()).toBe(false);
      expect(s.told.map((n) => n.text)).toEqual(["Los modelos llevan 8.10 € de 10 € este mes."]);
      expect(s.runs()).toHaveLength(1);
      expect(autoRuns(s)).toEqual([]);
    });

    it("AU-221 · S2c: a new version of Boni's runs when the one that runs is Boni's, its draft following; one Juan published stays, Boni's waiting", async () => {
      const s = serverOf();
      wire(s);
      s.models.keepFlowCurrent(1);
      /** What a deploy brings: Boni's code with another text, saved as flows.ts saves it, then kept as models.ts does. */
      const deploy = (lit: string) => {
        const plan = structuredClone(BUDGET_PLAN) as {
          steps: { args: { text: { args: { lit?: string }[] } } }[];
        };
        const first = plan.steps[0]?.args.text.args[0];
        if (first) first.lit = lit;
        const f = { id: BUDGET_FLOW, name: "Aviso del presupuesto", trigger: BUDGET_TRIGGER, plan };
        ensureFlow(s.store(), { ...f, by: "preset" }, s.clock.now);
        keepBoniFlows(s.store(), [{ id: BUDGET_FLOW, boni: "budgetNotice" }], s.clock.now);
      };
      const versions = () =>
        s
          .store()
          .journal.automationVersions(BUDGET_FLOW)
          .map((v) => [v.n, v.by]);
      const wouldTell = async () => {
        const t = await testAutomation(
          s.store(),
          BUDGET_FLOW,
          { trigger: "trigger", fields: {} },
          JUAN,
          jsBox(),
        );
        if ("error" in t || "refused" in t) throw new Error(JSON.stringify(t));
        return Object.values(t.tests).flatMap((x) => x.notices?.notices.map((n) => n.text) ?? []);
      };
      s.spend(3); // 2.70 €, under the warning: nothing runs, «Probar» says
      deploy("Este mes los modelos llevan ");
      expect(versions()).toEqual([
        [2, "preset"],
        [1, "preset"],
      ]);
      expect(s.store().journal.automation(BUDGET_FLOW)?.published).toBe(2);
      // The draft was the running document, so it follows: «Probar» tries the new text.
      expect(await wouldTell()).toEqual(["Este mes los modelos llevan 2.70 € de 10 € este mes."]);
      // Kept again with the same code: nothing more.
      keepBoniFlows(s.store(), [{ id: BUDGET_FLOW, boni: "budgetNotice" }], s.clock.now);
      expect(versions()).toHaveLength(2);
      // Juan publishes his own («Volver a esta» on the first): it runs, and a later version of Boni's waits.
      expect(publish(s.store(), BUDGET_FLOW, { version: 1 }, JUAN)).toMatchObject({ version: 3 });
      deploy("Llevas en modelos ");
      expect(versions()[0]).toEqual([3, "user"]);
      expect(s.store().journal.automation(BUDGET_FLOW)?.published).toBe(3);
      expect(s.told).toEqual([]);
    });

    it("AU-224 · S2c: «Probar» converted says what the flow's «Probar» said, with the month's figures whatever is typed, and tells nothing; it is never started by hand", async () => {
      const s = serverOf();
      s.spend(3); // 2.70 €
      // The engine of before, dry: its «Probar».
      const before = (await s.ask("POST /api/agent/flows/:id/test")).json as {
        steps: Record<string, { would: { text: string | null }[] }>;
      };
      const was = before.steps.notify?.would.map((w) => w.text);
      expect(was).toEqual(["Los modelos llevan 2.70 € de 10 € este mes."]);
      wire(s);
      s.models.keepFlowCurrent(1);
      const tried = async (fields: Record<string, string>) => {
        const t = await testAutomation(
          s.store(),
          BUDGET_FLOW,
          { trigger: "trigger", fields },
          JUAN,
          jsBox(),
        );
        if ("error" in t || "refused" in t) throw new Error(JSON.stringify(t));
        expect(t.state).toBe("done");
        return Object.values(t.tests).flatMap((x) => x.notices?.notices.map((n) => n.text) ?? []);
      };
      expect(await tried({})).toEqual(was);
      // Figures a request brings are not the trigger's: the month's own are what it would tell.
      expect(await tried({ spent: "0.01", budget: "999" })).toEqual(was);
      // Its spending starts it, never a hand: «Ejecutar» is refused, with the request's figures or without.
      for (const fields of [{}, { spent: "0.01", budget: "999" }] as Record<string, Cell>[])
        expect(
          await startRun(s.store(), BUDGET_FLOW, { trigger: "trigger", fields }, JUAN),
        ).toEqual({
          refused: "invalid",
          problems: [],
        });
      expect(await s.ask("POST /api/agent/flows/:id/run")).toEqual({
        status: 409,
        json: { error: "not-manual" },
      });
      expect(s.told).toEqual([]);
      expect(s.store().setting("models/warned")).toBeNull();
      expect(autoRuns(s)).toEqual([]);
    });

    it("AU-220 · S2c: a version that cannot start (Boni's steps unwired at its hour) never silences the notice: the code tells, once", async () => {
      const s = serverOf();
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      wire(s);
      s.models.keepFlowCurrent(1);
      wireBoni(null);
      s.spend(9);
      expect(await s.check()).toBe(false);
      expect(await s.check()).toBe(false);
      expect(s.told).toEqual([
        { text: "Los modelos llevan 8.10 € de 10 € este mes.", integrity: "own" },
      ]);
      expect(log.mock.calls.some((c) => String(c[0]).includes("told by code"))).toBe(true);
      expect(s.runs()).toEqual([]);
    });
  });
});

// ---------------------------------------------------------------- «Modelos» without uses (docs/automatizaciones.md §5.16)

describe("«Modelos» without uses (§5.16)", () => {
  const made: (() => void)[] = [];
  afterEach(() => {
    for (const close of made.splice(0)) close();
    vi.restoreAllMocks();
  });
  const DAY = 86_400_000;
  /** Invented models of his own key, through OpenRouter, and a decision model. */
  const A = "openrouter:ejemplo/modelo-a";
  const B = "openrouter:ejemplo/modelo-b";
  const C = "openrouter:ejemplo/modelo-c:zdr";
  const JEV = "openrouter:typesafe/jev-1.14";
  const SERVER_AGENT = "anthropic:claude-opus-5-5";
  const SERVER_READING = "anthropic:claude-haiku-4-5";

  /** A fresh account with the server's two models and Juan's OpenRouter key; requests answered as a personal device. */
  function fresh(o: { key?: boolean } = {}) {
    const dir = mkdtempSync(join(tmpdir(), "boni-list-"));
    const sys = openDb(join(dir, "system.db"));
    addUser(sys, "juan", PASSWORD);
    const clock = { now: Date.UTC(2026, 10, 18, 9) };
    const planner = fakePlanner([]);
    const h = new AgentHost({
      dataDir: dir,
      providers: { planner, reader: planner },
      now: () => clock.now,
    });
    const asked: string[] = [];
    const m = new AccountModels({
      db: sys,
      key: randomBytes(32),
      host: h,
      defaults: {
        planner: { connection: "anthropic", model: "claude-opus-5-5" },
        reader: { connection: "anthropic", model: "claude-haiku-4-5" },
      },
      serverKeys: { anthropic: SERVER_KEY },
      now: () => clock.now,
      // A scripted model: no network, an answer that reads, and what it cost.
      makeProvider: (v): ModelProvider => ({
        id: v.connection,
        privacy: "external-api",
        complete: async () => {
          asked.push(`${v.role}:${v.model}`);
          return {
            json: { items: [] },
            usage: { input: 100, output: 10, cost: 0.002 },
            model: v.model,
          };
        },
      }),
    });
    h.models = m;
    h.providersFor = (a) => m.providers(a);
    if (o.key !== false) m.setKey(1, "openrouter", MY_KEY);
    made.push(() => {
      h.close();
      sys.close();
      rmSync(dir, { recursive: true, force: true });
    });
    const store = () => h.store(1);
    /** `id` evaluated for these kinds `daysAgo` days ago, 8 right of 10 each. */
    const evaluated = (id: string, kinds: ("agent" | "reading" | "decision")[], daysAgo = 1) => {
      const marks = m.marks(1);
      const parts = { ...(marks[id]?.parts ?? {}) };
      for (const k of kinds)
        parts[k] = {
          right: 8,
          total: 10,
          wrong: 2,
          tokens: 900,
          cost: 0.01,
          cases: [],
          at: clock.now - daysAgo * DAY,
        };
      store().setSetting("models/evaluation", JSON.stringify({ ...marks, [id]: { parts } }));
    };
    const route = (id: string) => {
      const [connection, ...rest] = id.split(":");
      const zdr = rest[rest.length - 1] === "zdr";
      return {
        connection: connection as "openrouter",
        model: (zdr ? rest.slice(0, -1) : rest).join(":"),
        zdr,
      };
    };
    /** A request of the app, as `serveModels` answers it. */
    async function ask(
      r: string,
      q: {
        body?: unknown;
        url?: string;
        params?: Record<string, string>;
        trust?: "personal" | "shared";
      } = {},
    ) {
      const res = { status: 0, body: "" };
      const out = {
        writeHead: (st: number) => {
          res.status = st;
          return out;
        },
        end: (b?: string) => {
          res.body = b ?? "";
          return out;
        },
        setHeader: () => out,
      } as unknown as ServerResponse;
      const req = Object.assign(Readable.from([Buffer.from(JSON.stringify(q.body ?? {}))]), {
        url: q.url ?? "/",
      }) as unknown as IncomingMessage;
      await serveModels(m, req, out, r, q.params ?? {}, {
        account: 1,
        trust: q.trust ?? "personal",
      });
      return {
        status: res.status,
        json: JSON.parse(res.body || "null") as Record<string, unknown>,
      };
    }
    const load = (...ids: string[]) => {
      for (const id of ids) expect(m.addModel(1, route(id))).toBe("added");
    };
    return { host: h, models: m, clock, store, evaluated, ask, load, asked, route };
  }

  it("AU-232 · the list gives every loaded model once, in the person's order, with its tags, its evaluation and the month's cost; with 30 models and a year of calls it answers in its time", async () => {
    const t = fresh();
    t.load(A, B);
    t.evaluated(A, ["agent", "reading"]);
    t.evaluated(B, ["reading"], 40);
    const tag = t.models.addTag(1, "Barato") as { id: string };
    expect(t.models.tagModel(1, B, [tag.id], false)).toEqual({ done: true });
    expect(t.models.orderModels(1, [B, A])).toBe(true);
    t.store().journal.modelCall({
      run: "r",
      role: "reader",
      provider: "openrouter",
      model: "ejemplo/modelo-b",
      promptHash: "h",
      request: {},
      response: {},
      usage: { input: 10, output: 1, cost: 1 },
      at: t.clock.now - 1000,
    });
    const v = (await t.ask("GET /api/agent/models/list")).json as ReturnType<
      AccountModels["listView"]
    >;
    // His two, in his order, then the server's he has not placed («Del servidor»); each once.
    expect(v.models.map((x) => [x.id, x.server])).toEqual([
      [B, false],
      [A, false],
      [SERVER_AGENT, true],
      [SERVER_READING, true],
    ]);
    expect(v.models[0]?.tags).toEqual([{ id: tag.id, name: "Barato" }]);
    // One evaluation per model: its parts summed, «Caducada» when one is old; no use is named.
    expect(v.models[1]?.evaluation).toMatchObject({
      right: 16,
      total: 20,
      partial: false,
      expired: false,
    });
    expect(v.models[0]?.evaluation).toMatchObject({
      right: 8,
      total: 10,
      partial: true,
      expired: true,
    });
    expect(v.models[0]?.eur).toBeCloseTo(t.models.config(1).usdToEur, 5);
    expect(JSON.stringify(v)).not.toMatch(/planner|reviewer|decider/);
    expect(v.tags).toEqual([
      { id: tag.id, name: "Barato", uses: { automations: 0, conversations: 0, rows: [] } },
    ]);

    // His volume: 30 models and a year of model calls, twenty a day.
    const many = Array.from(
      { length: 28 },
      (_, i) => `openrouter:ejemplo/modelo-${String(i).padStart(2, "0")}`,
    );
    t.load(...many);
    for (const id of many) t.evaluated(id, ["agent", "reading"]);
    const s = t.store();
    s.batch(() => {
      for (let d = 0; d < 365; d++)
        for (let k = 0; k < 20; k++)
          s.journal.modelCall({
            run: `r${d}-${k}`,
            role: "reader",
            provider: "openrouter",
            model: `ejemplo/modelo-${String(k).padStart(2, "0")}`,
            promptHash: "h",
            request: {},
            response: {},
            usage: { input: 1000, output: 100, cost: 0.001 },
            at: t.clock.now - d * DAY - k * 1000,
          });
    });
    const at = clock();
    const big = t.models.listView(1);
    under(clock() - at, 300, "clock", "«Modelos» with 30 models and a year of calls");
    expect(big.models.filter((x) => !x.server)).toHaveLength(30);
  });

  it("AU-233 · removing a model in use says where it is used, keeps its evaluation and leaves every reference answering «no-model»; one added is «Sin evaluar» and offered nowhere", async () => {
    const t = fresh();
    expect((await t.ask("POST /api/agent/models/list", { body: t.route(A) })).status).toBe(200);
    expect((await t.ask("POST /api/agent/models/list", { body: t.route(A) })).status).toBe(409);
    expect(
      (await t.ask("POST /api/agent/models/list", { body: { connection: "openrouter" } })).status,
    ).toBe(400);
    const listed = t.models.listView(1).models.find((x) => x.id === A);
    expect(listed?.evaluation).toBeNull();
    for (const k of ["agent", "reading", "decision"] as const)
      expect(t.models.choices(1, k).models.map((x) => x.id)).not.toContain(A);
    t.evaluated(A, ["reading"]);
    // Used by a row and a conversation: removing it asks first, saying where.
    expect(t.models.setAccountRow(1, "reading", A)).toBe("done");
    createConversation(t.store(), { model: A, now: t.clock.now });
    const asked = await t.ask("POST /api/agent/models/list/remove", { body: { id: A } });
    expect(asked.status).toBe(409);
    expect(asked.json).toMatchObject({
      error: "in-use",
      where: { rows: ["reading"], conversations: 1 },
    });
    expect(
      (await t.ask("POST /api/agent/models/list/remove", { body: { id: A, confirm: true } }))
        .status,
    ).toBe(200);
    // The row goes back to the server's; the conversation's id answers no model; the evaluation stays.
    expect(t.models.listView(1).account.find((r) => r.kind === "reading")).toMatchObject({
      value: null,
      answers: SERVER_READING,
    });
    expect(t.models.resolveModel(1, "reading", A)).toEqual({ refused: "no-model" });
    expect(t.models.evaluationOf(1, A)?.parts.reading).toBeTruthy();
    t.load(A);
    expect(t.models.choices(1, "reading").models.map((x) => x.id)).toContain(A);
    // A server's model is not removed; one not there is not found.
    expect(
      (await t.ask("POST /api/agent/models/list/remove", { body: { id: SERVER_AGENT } })).status,
    ).toBe(409);
    expect((await t.ask("POST /api/agent/models/list/remove", { body: { id: B } })).status).toBe(
      404,
    );
    // Removing a key asks first where its models are used, and `dry` changes nothing.
    t.models.setAccountRow(1, "reading", A);
    const dry = await t.ask("PUT /api/agent/models/keys/:connection", {
      params: { connection: "openrouter" },
      body: { key: null, dry: true },
    });
    expect(dry.json).toMatchObject({ where: [{ id: A, rows: ["reading"] }] });
    expect(t.models.view(1).connections).toContainEqual({
      connection: "openrouter",
      mine: true,
      server: false,
    });
  });

  it("AU-234 · one evaluation of a model runs every case it can answer once and keeps one result with its parts, and one older than its days is marked expired", async () => {
    const t = fresh();
    t.load(A, JEV);
    expect((await t.ask("POST /api/agent/models/list/evaluate", { body: { id: A } })).status).toBe(
      202,
    );
    expect((await t.ask("POST /api/agent/models/list/evaluate", { body: { id: B } })).status).toBe(
      404,
    );
    await t.models.idle();
    const e = t.models.evaluationOf(1, A);
    expect(Object.keys(e?.parts ?? {}).sort()).toEqual(["agent", "reading"]);
    expect(e?.parts.agent?.at).toBe(t.clock.now);
    expect(e?.parts.reading?.at).toBe(t.clock.now);
    // No real model was called: only the scripted one, as the planner and the reader.
    expect(new Set(t.asked.map((x) => x.split(":")[0]))).toEqual(new Set(["planner", "reader"]));
    // Its cost went in the journal like any call; its result, whatever it is, opens the gate.
    expect(t.models.spending(1).rows.some((r) => r.model === "ejemplo/modelo-a")).toBe(true);
    expect(t.models.choices(1, "agent").models.map((x) => x.id)).toContain(A);
    // A decision model is evaluated with the decision's cases only.
    t.asked.length = 0;
    expect(t.models.evaluateModel(1, JEV)).toBe("started");
    await t.models.idle();
    expect(Object.keys(t.models.evaluationOf(1, JEV)?.parts ?? {})).toEqual(["decision"]);
    expect(new Set(t.asked.map((x) => x.split(":")[0]))).toEqual(new Set(["decider"]));
    // Older than its days, «Caducada»; the next one replaces it whole, with one date.
    t.clock.now += 31 * DAY;
    expect(t.models.listView(1).models.find((x) => x.id === A)?.evaluation).toMatchObject({
      partial: false,
      expired: true,
    });
    // From a device that is not his, nothing.
    expect(
      (await t.ask("POST /api/agent/models/list/evaluate", { body: { id: A }, trust: "shared" }))
        .status,
    ).toBe(403);
  });

  it("AU-235 · a model is offered only with its key and a current evaluation, for the kinds of call its evaluation has cases of, whatever its result", () => {
    const t = fresh();
    t.load(A, B, C);
    t.evaluated(A, ["agent", "reading"]);
    t.evaluated(B, ["reading"], 31);
    t.evaluated(C, ["reading"]);
    const ids = (k: "agent" | "reading") => t.models.choices(1, k).models.map((x) => x.id);
    expect(ids("agent")).toEqual([A, SERVER_AGENT]);
    expect(ids("reading")).toEqual([A, C, SERVER_READING]);
    // Each part with its own date: «Lectura» of C expires while A's «Agente» stays.
    t.clock.now += 29.5 * DAY;
    expect(ids("reading")).toEqual([SERVER_READING]);
    expect(ids("agent")).toEqual([SERVER_AGENT]);
    t.evaluated(A, ["agent"], 0);
    expect(ids("agent")).toEqual([A, SERVER_AGENT]);
    // Chosen for the account's row, it keeps its place there when its evaluation expires; another kind it does not.
    expect(t.models.setAccountRow(1, "agent", A)).toBe("done");
    t.clock.now += 31 * DAY;
    expect(ids("agent")).toEqual([A, SERVER_AGENT]);
    expect(ids("reading")).toEqual([SERVER_READING]);
    expect(t.models.setAccountRow(1, "reading", A)).toBe("not-offered");
    // Without its key, nowhere; the chat's list is the same gate.
    t.models.setKey(1, "openrouter", null);
    expect(ids("agent")).toEqual([SERVER_AGENT]);
    expect(t.models.plannerChoices(1).map((c) => c.id)).toEqual([SERVER_AGENT]);
  });

  it("AU-236 · a step and a conversation that chose nothing use the account's row of their kind, read at each run; «Decisión» shows only with a decision model", async () => {
    const t = fresh();
    t.load(A, JEV);
    let v = t.models.listView(1);
    expect(v.account.map((r) => [r.kind, r.value, r.answers])).toEqual([
      ["agent", null, SERVER_AGENT],
      ["reading", null, SERVER_READING],
    ]);
    // Not evaluated: not offered for the row.
    const refused = await t.ask("PUT /api/agent/models/account/:kind", {
      params: { kind: "agent" },
      body: { value: A },
    });
    expect(refused.status).toBe(409);
    t.evaluated(A, ["agent", "reading"]);
    t.evaluated(JEV, ["decision"]);
    expect(
      (
        await t.ask("PUT /api/agent/models/account/:kind", {
          params: { kind: "agent" },
          body: { value: A },
        })
      ).status,
    ).toBe(200);
    // A decision model answers decisions only.
    expect(t.models.setAccountRow(1, "reading", JEV)).toBe("not-offered");
    expect(t.models.setAccountRow(1, "decision", JEV)).toBe("done");
    v = t.models.listView(1);
    expect(v.account.map((r) => [r.kind, r.answers])).toEqual([
      ["agent", A],
      ["reading", SERVER_READING],
      ["decision", JEV],
    ]);
    // What chose nothing reads the row each time it is asked: the chat's «El de la cuenta», a step's.
    expect(t.models.plannerChoices(1)[0]).toMatchObject({ id: A, current: true });
    expect(t.models.stepProvider(1, "agent", null)).toMatchObject({ model: "ejemplo/modelo-a" });
    expect(t.models.setAccountRow(1, "agent", null)).toBe("done");
    expect(t.models.stepProvider(1, "agent", null)).toMatchObject({ model: "claude-opus-5-5" });
    // The engine of before plans with the row's model.
    t.models.setAccountRow(1, "agent", A);
    expect(t.models.providers(1)).not.toBeNull();
    expect(
      (
        await t.ask("PUT /api/agent/models/account/:kind", {
          params: { kind: "writer" },
          body: { value: A },
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await t.ask("PUT /api/agent/models/account/:kind", {
          params: { kind: "agent" },
          body: { value: null },
          trust: "shared",
        })
      ).status,
    ).toBe(403);
  });

  it("AU-237 · a tag renamed keeps every step that names it, and no tag exists that the person did not write", async () => {
    const t = fresh();
    // None comes with Boni nor with the change from the uses.
    expect(t.models.list(1).tags).toEqual([]);
    t.load(A, B);
    t.evaluated(A, ["reading"]);
    t.evaluated(B, ["reading"]);
    const created = await t.ask("POST /api/agent/models/tags", { body: { name: "Barato" } });
    const tag = created.json.id as string;
    expect(tag).toMatch(/^tag:[a-z0-9]{16}$/);
    expect((await t.ask("POST /api/agent/models/tags", { body: { name: "barato" } })).status).toBe(
      400,
    );
    expect(
      (await t.ask("POST /api/agent/models/tags", { body: { name: "x".repeat(25) } })).status,
    ).toBe(400);
    expect(
      (await t.ask("PUT /api/agent/models/tagged", { body: { id: A, tags: [tag] } })).status,
    ).toBe(200);
    expect(t.models.setAccountRow(1, "reading", tag)).toBe("done");
    expect(
      (
        await t.ask("PUT /api/agent/models/tags/:tag", {
          params: { tag: tag.slice(4) },
          body: { name: "Económico" },
        })
      ).status,
    ).toBe(200);
    const v = t.models.listView(1);
    expect(v.tags.map((x) => [x.id, x.name])).toEqual([[tag, "Económico"]]);
    expect(v.account.find((r) => r.kind === "reading")).toMatchObject({ value: tag, answers: A });
    // A tag nobody uses and no model has goes away with the next change.
    const other = t.models.addTag(1, "Sin uso") as { id: string };
    t.models.orderModels(1, [B, A]);
    expect(t.models.listView(1).tags.map((x) => x.id)).not.toContain(other.id);
  });

  it("AU-241 · what would leave a tag in use without a model says where it is used before it is done", async () => {
    const t = fresh();
    t.load(A);
    t.evaluated(A, ["reading"]);
    const tag = (t.models.addTag(1, "Barato") as { id: string }).id;
    t.models.tagModel(1, A, [tag], false);
    t.models.setAccountRow(1, "reading", tag);
    const asked = await t.ask("PUT /api/agent/models/tagged", { body: { id: A, tags: [] } });
    expect(asked.status).toBe(409);
    expect(asked.json).toMatchObject({ error: "in-use", where: { tagsLeft: ["Barato"] } });
    const removing = t.models.removeModel(1, A, false);
    expect(removing).toMatchObject({ error: "in-use", where: { tagsLeft: ["Barato"] } });
    expect(
      (await t.ask("PUT /api/agent/models/tagged", { body: { id: A, tags: [], confirm: true } }))
        .status,
    ).toBe(200);
    expect(t.models.choices(1, "reading").tags).toEqual([
      { id: tag, name: "Barato", answers: null, state: "no-model" },
    ]);
  });

  it("AU-242 · a conversation is offered the account's and the evaluated models that answer as an agent, and one whose model is gone answers with the account's", () => {
    const t = fresh();
    t.load(A, B);
    t.evaluated(A, ["agent", "reading"]);
    t.evaluated(B, ["reading"]);
    expect(t.models.plannerChoices(1).map((c) => [c.id, c.current])).toEqual([
      [SERVER_AGENT, true],
      [A, false],
    ]);
    expect(t.models.plannerProvider(1, A)).not.toBeNull();
    expect(t.models.plannerProvider(1, B)).toBeNull();
    // With a tag in the row, «El de la cuenta» is the model it answers with now.
    const tag = (t.models.addTag(1, "Agente") as { id: string }).id;
    t.models.tagModel(1, A, [tag], false);
    t.models.setAccountRow(1, "agent", tag);
    expect(t.models.plannerChoices(1)[0]).toMatchObject({ id: A, current: true });
    // A model removed is no choice: the conversation that named it plans with the account's (agent.ts).
    t.models.setAccountRow(1, "agent", null);
    t.models.removeModel(1, A, true);
    expect(t.models.plannerProvider(1, A)).toBeNull();
    expect(t.models.plannerChoices(1).map((c) => c.id)).toEqual([SERVER_AGENT]);
  });

  it("AU-239 · a tag with two models answers with the first in the list's order, an expired evaluation changes nothing and a model never evaluated is never taken", () => {
    const t = fresh();
    t.load(A, B, C);
    t.evaluated(B, ["reading"]);
    t.evaluated(C, ["reading"]);
    const tag = (t.models.addTag(1, "Barato") as { id: string }).id;
    for (const id of [A, B, C]) t.models.tagModel(1, id, [tag], false);
    // A is first but never evaluated: never taken.
    expect(t.models.resolveModel(1, "reading", tag)).toMatchObject({
      id: B,
      tag: { name: "Barato" },
    });
    // The clock changes nothing: B's evaluation old, B still.
    t.clock.now += 60 * DAY;
    expect(t.models.resolveModel(1, "reading", tag)).toMatchObject({ id: B });
    // His acts do: the order, a tag taken off, a key.
    t.models.orderModels(1, [C, A, B]);
    expect(t.models.resolveModel(1, "reading", tag)).toMatchObject({ id: C });
    t.models.tagModel(1, C, [], true);
    expect(t.models.resolveModel(1, "reading", tag)).toMatchObject({ id: B });
    // No kind it cannot answer: it has no agent's cases.
    expect(t.models.resolveModel(1, "agent", tag)).toEqual({ refused: "no-model" });
    t.models.setKey(1, "openrouter", null);
    expect(t.models.resolveModel(1, "reading", tag)).toEqual({ refused: "no-model" });
  });

  it("AU-244 · with settings shaped like a person's, every use, conversation and step answers with the same connection and model before and after, every model is offered where it was and nowhere else, twice run changes nothing, and the keys are not read", () => {
    // His key is there: the migration does not read it, and nothing it writes depends on it.
    const t = fresh();
    const s = t.store();
    const at = t.clock.now;
    // His uses of before: his own planner and reader, a reviewer that is another model, the server's decider.
    s.setSetting(
      "models/config",
      JSON.stringify({
        roles: {
          planner: { ...t.route(A) },
          reader: { ...t.route(B) },
          reviewer: { ...t.route(C) },
        },
        budget: { monthlyEur: 10, warnAt: 0.8 },
        usdToEur: 0.92,
      }),
    );
    // Several evaluations per use: new and old, one too old to offer, and the reviewer's.
    const ev = (role: string, id: string, daysAgo: number, right: number) => ({
      role,
      ...t.route(id),
      right,
      total: 10,
      wrong: 10 - right,
      tokens: 500,
      cost: 0.01,
      at: at - daysAgo * DAY,
    });
    const D = "openrouter:ejemplo/modelo-d";
    const E = "openrouter:ejemplo/modelo-e";
    const OLD = "openrouter:ejemplo/modelo-viejo";
    s.setSetting(
      "models/evals",
      JSON.stringify([
        ev("planner", A, 2, 9),
        ev("planner", A, 20, 6),
        ev("reader", B, 3, 8),
        ev("reader", D, 5, 7),
        ev("planner", E, 10, 7),
        ev("reader", OLD, 45, 9),
        ev("reviewer", C, 4, 10),
      ]),
    );
    // A conversation and two steps naming models.
    const STEP = "openrouter:ejemplo/modelo-del-paso";
    createConversation(s, { model: E, now: at });
    const auto = madeAutomation(s, [
      START,
      ["Redactar", "write", { instructions: "Resume", text: cite("$json.nota"), model: STEP }],
    ]);
    expect(auto.id).toBeTruthy();
    // Before: what each use ran on.
    const before = Object.fromEntries(
      t.models.roles(1).map((r) => [r.role, `${r.connection}:${r.model}${r.zdr ? ":zdr" : ""}`]),
    );
    const keys = vi.spyOn(t.models as unknown as { keys: () => unknown }, "keys");
    const keyFor = vi.spyOn(t.models as unknown as { keyFor: () => unknown }, "keyFor");
    (t.models as unknown as { migrate: (a: number) => void }).migrate(1);
    expect(keys).not.toHaveBeenCalled();
    expect(keyFor).not.toHaveBeenCalled();
    const list1 = s.setting("models/list");
    const marks1 = s.setting("models/evaluation");
    // Twice: nothing changes.
    (t.models as unknown as { migrate: (a: number) => void }).migrate(1);
    expect(s.setting("models/list")).toBe(list1);
    expect(s.setting("models/evaluation")).toBe(marks1);
    // The old settings stay as they were.
    expect(JSON.parse(s.setting("models/evals") ?? "[]")).toHaveLength(7);
    // The list: the account's first, then the rest by their last evaluation; the one too old stays out.
    const l = t.models.list(1);
    expect(l.models.map((x) => x.id)).toEqual([A, B, C, D, E, STEP]);
    expect(l.account).toEqual({ agent: A, reading: B, decision: null });
    // Each use's newest result is its part, with its date; the reviewer's counts as the reading.
    const marks = t.models.marks(1);
    expect(marks[A]?.parts.agent).toMatchObject({ right: 9, at: at - 2 * DAY });
    expect(marks[C]?.parts.reading).toMatchObject({ right: 10, at: at - 4 * DAY });
    expect(marks[OLD]?.parts.reading).toMatchObject({ right: 9 });
    // The same answers as before.
    expect(t.models.resolveModel(1, "agent", null)).toMatchObject({ id: before.planner });
    expect(t.models.resolveModel(1, "reading", null)).toMatchObject({ id: before.reader });
    expect(t.models.modelRefOf(1, "reviewer")).toBe(before.reviewer);
    expect(t.models.resolveModel(1, "agent", E)).toMatchObject({ id: E });
    expect(t.models.plannerChoices(1).map((c) => c.id)).toContain(E);
    expect(t.models.resolveModel(1, "reading", STEP)).toMatchObject({ id: STEP });
    // Offered where it was (an evaluation in date of its use) and nowhere else; the reviewer's model is offered for
    // «Lectura», since its cases are the reading's (§5.16, the table of the uses).
    expect(t.models.choices(1, "agent").models.map((x) => x.id)).toEqual([A, E, SERVER_AGENT]);
    expect(t.models.choices(1, "reading").models.map((x) => x.id)).toEqual([
      B,
      C,
      D,
      SERVER_READING,
    ]);
  });

  it("AU-244 · past thirty models, the migration leaves out only one there for its evaluation alone, the oldest evaluated, never one a step names", () => {
    const t = fresh();
    const s = t.store();
    const at = t.clock.now;
    const id = (i: number) => `openrouter:ejemplo/modelo-${String(i).padStart(2, "0")}`;
    // 32 models evaluated lately as readers, model-00 the newest; a step names the oldest one.
    s.setSetting(
      "models/evals",
      JSON.stringify(
        Array.from({ length: 32 }, (_, i) => ({
          role: "reader",
          ...t.route(id(i)),
          right: 8,
          total: 9,
          wrong: 1,
          tokens: 500,
          cost: 0.01,
          at: at - (i + 1) * 3_600_000,
        })),
      ),
    );
    madeAutomation(s, [
      START,
      ["Redactar", "write", { instructions: "Resume", text: cite("$json.nota"), model: id(31) }],
    ]);
    const got = t.models.list(1).models.map((m) => m.id);
    expect(got).toHaveLength(30);
    expect(got).toContain(id(31));
    // Out: the two oldest of those that nothing names.
    expect(got).not.toContain(id(30));
    expect(got).not.toContain(id(29));
    expect(got).toContain(id(28));
  });

  it("AU-245 · the model a converted step carries: none for the agent, the reader and the decider, and the reviewer's own only when it differs from the reader's", () => {
    const t = fresh();
    expect(
      ["planner", "reader", "decider", "reviewer"].map((r) =>
        t.models.modelRefOf(1, r as "planner"),
      ),
    ).toEqual([null, null, null, null]);
    t.models.saveConfig(1, {
      ...t.models.config(1),
      roles: { reader: t.route(A), reviewer: t.route(A) },
    });
    expect(t.models.modelRefOf(1, "reviewer")).toBeNull();
    t.models.saveConfig(1, {
      ...t.models.config(1),
      roles: { reader: t.route(A), reviewer: t.route(C) },
    });
    expect(t.models.modelRefOf(1, "reviewer")).toBe(C);
    // The map names the model that would answer each use's node, not the use.
    expect(t.models.answerOf(1, "reviewer")).toBe(C);
    const m = flowMap(t.store(), {
      now: t.clock.now,
      days: 7,
      tz: "Europe/Madrid",
      mailType: null,
      mailAccount: null,
      answerOf: (r) => t.models.answerOf(1, r as "planner"),
    });
    // The list was made from the uses (the reader's is A), so the chat's node names the server's planner and A.
    expect(m.nodes.find((n) => n.id === "boni:chat")?.answers).toEqual([SERVER_AGENT, A]);
  });

  it("AU-244 · the desktop of before still answers: choosing a use's model moves the row of its kind, and evaluating a use writes its model's part", async () => {
    const t = fresh();
    // Evaluated by use, as the desktop of before does: its model's part is written too.
    expect(t.models.evaluate(1, "reader", t.route(A))).toBe("started");
    await t.models.idle();
    expect(t.models.evaluationOf(1, A)?.parts.reading?.at).toBe(t.clock.now);
    expect(
      (await put2(t, "PUT /api/agent/models/roles/:role", { role: "reader" }, t.route(A))).status,
    ).toBe(200);
    expect(t.models.list(1).account.reading).toBe(A);
    expect(t.models.resolveModel(1, "reading", null)).toMatchObject({ id: A });
    expect(
      (await put2(t, "PUT /api/agent/models/roles/:role", { role: "reader" }, {})).status,
    ).toBe(200);
    expect(t.models.list(1).account.reading).toBeNull();
    expect(t.models.evaluate(1, "planner", t.route(B))).toBe("started");
    await t.models.idle();
    expect(t.models.evaluationOf(1, B)?.parts.agent?.at).toBe(t.clock.now);
  });

  const put2 = (
    t: ReturnType<typeof fresh>,
    r: string,
    params: Record<string, string>,
    body: unknown,
  ) => t.ask(r, { params, body });
});
