import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { fakePlanner, type ModelProvider } from "@boni/agent";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AgentHost } from "./agent.ts";
import { addUser } from "./auth.ts";
import { type Db, openDb } from "./db.ts";
import { Feeds } from "./feeds.ts";
import { type App, makeApp, serve } from "./http.ts";
import { LoginGuard } from "./limits.ts";
import { AccountModels, catalogueOf, serveModels } from "./models.ts";

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
    expect(notes).toHaveLength(1);
    now += 31_000;
    models.overBudget(1);
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
