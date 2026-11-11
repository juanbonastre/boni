import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { fakePlanner, type ModelProvider, ScriptedProvider } from "@boni/agent";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { AgentHost, serveAgent } from "./agent.ts";
import { addUser } from "./auth.ts";
import { type Db, openDb } from "./db.ts";
import { Feeds } from "./feeds.ts";
import { BUDGET_FLOW, checkFlow, saveUserFlow } from "./flows.ts";
import { type App, makeApp, serve } from "./http.ts";
import { LoginGuard } from "./limits.ts";
import { AccountModels, BUDGET_PLAN, catalogueOf, serveModels } from "./models.ts";

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
  host.overBudget = (a) => models.overBudget(a);
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

  function serverOf(o: { models?: boolean } = {}) {
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
    // As main.ts wires them.
    h.models = m;
    h.providersFor = (a) => m.providers(a);
    h.overBudget = (a) => m.overBudget(a);
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

  it("passing the warning runs it once a month: one run with no model call, its «Avisar» telling the devices", async () => {
    const s = serverOf();
    s.spend(5); // 4.50 € of 10 €: under the warning (80 %)
    expect(await s.check()).toBe(false);
    expect([s.told, s.runs()]).toEqual([[], []]);
    s.spend(4); // 8.10 €: past it
    expect(await s.check()).toBe(false);
    expect(s.told.map((n) => n.text)).toEqual(["Los modelos llevan 8.10 € de 10 € este mes."]);
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

  it("no recursion: the month is marked before the run starts, so a model step Juan added to it asks the budget again and starts no other; a run that stops is not tried again", async () => {
    const withReader = {
      version: 1,
      steps: [
        { id: "r", op: "read", reader: "summarize", input: { ref: "$spent" } },
        ...BUDGET_PLAN.steps,
      ],
    };
    // Under the cap: his reader is asked (its call asks the budget inside the run), then «Avisar».
    const s = serverOf();
    expect(
      "flow" in saveUserFlow(s.store(), BUDGET_FLOW, { base: 1, plan: withReader }, [], 1000),
    ).toBe(true);
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
    // floor), the run stops before «Avisar», and no other run is made that month.
    const t = serverOf();
    vi.spyOn(console, "log").mockImplementation(() => {});
    expect(
      "flow" in saveUserFlow(t.store(), BUDGET_FLOW, { base: 1, plan: withReader }, [], 1000),
    ).toBe(true);
    t.spend(12); // 10.80 €: past the warning and the budget at once
    expect(await t.check()).toBe(true);
    expect(t.model.requests).toHaveLength(0);
    expect(t.runs().map((r) => r.status)).toEqual(["stopped:P13-month-budget"]);
    expect(await t.check()).toBe(true);
    expect(await t.check()).toBe(true);
    expect([t.runs().length, t.told.length]).toEqual([1, 0]);
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
    // The app's requests from a personal device, as the server answers them.
    const ask = async (route: string, body = "{}") => {
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
      await serveAgent(
        s.host,
        Readable.from([Buffer.from(body)]) as unknown as IncomingMessage,
        out,
        route,
        { id: BUDGET_FLOW },
        { account: 1, device: "portatil-ejemplo", trust: "personal" },
      );
      return { status: res.status, json: JSON.parse(res.body || "null") as unknown };
    };
    // The editor's «Probar»: the saved flow, dry.
    const tried = await ask("POST /api/agent/flows/:id/test");
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
    const forged = await ask(
      "POST /api/agent/flows/:id/test",
      JSON.stringify({ inputs: { spent: "0.01", budget: "999" } }),
    );
    expect((forged.json as typeof view).steps.notify?.would.map((w) => w.text)).toEqual([
      "Los modelos llevan 2.70 € de 10 € este mes.",
    ]);
    // Its spending starts it, never a hand: «Ejecutar» is refused.
    expect(await ask("POST /api/agent/flows/:id/run")).toEqual({
      status: 409,
      json: { error: "not-manual" },
    });
    // Nothing reached a device, the month is not marked and the flow has no run.
    expect(s.told).toEqual([]);
    expect(s.store().setting("models/warned")).toBeNull();
    expect(s.runs()).toEqual([]);
    expect(s.store().journal.flowRuns(BUDGET_FLOW).runs).toBe(0);
  });
});
