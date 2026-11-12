/**
 * (test) A page's chat on the server (docs/sistema.md §4.6 point 6, D-61), over HTTP with a scripted planner (no model,
 * no network), on a page shaped like Juan's Gastos: a «Categoría» control over the movements' relation to
 * «Categorías», a «Mes» control, the month's total and a chart naming both, and a year of invented movements (A-15:
 * thousands). «¿cuánto gasté en restaurantes en octubre?» sets the page's values, the chart follows, and the answer
 * carries the figure the code computed; a number of the model's own, a collection the page does not show, or a chat
 * whose block was taken off its page are refused.
 */
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { coreTools, fakePlanner, plain, type Val } from "@boni/agent";
import { label, type TypeDef } from "@boni/entities";
import type { UserStore } from "@boni/store";
import type { PageBlock } from "@boni/views";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AgentHost } from "./agent.ts";
import { addUser } from "./auth.ts";
import { computeBlocks } from "./blocks.ts";
import { type Db, openDb } from "./db.ts";
import { Feeds } from "./feeds.ts";
import { checkFlow, createFlow, saveUserFlow } from "./flows.ts";
import { type App, makeApp, serve } from "./http.ts";
import { LoginGuard } from "./limits.ts";
import { chatTurnOf, pageTypes } from "./pageChat.ts";
import { createPage, getPage, updatePage } from "./pages.ts";
import { pageScreen, screenOf } from "./screen.ts";
import { seed } from "./seed.test-util.ts";

const PASSWORD = "una contraseña larga de ejemplo";
const lit = (v: unknown) => ({ lit: v });
const ref = (r: string) => ({ ref: r });
const own = label("user", "personal", [{ kind: "user-edit", id: "ejemplo" }]);
const TODAY = "2026-11-12";
let dir: string;
let db: Db;
let app: App;
let host: AgentHost;
let base: string;
let store: UserStore;
const servers: Server[] = [];
const plans: unknown[] = [];

/** The year of invented movements, as the test made them: what the code must add up. */
const made: { day: string; amount: number; cat: string }[] = [];
let restaurantes = "";
let page = "";
let blocks: PageBlock[] = [];

async function listen(s: Server): Promise<string> {
  servers.push(s);
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", () => r()));
  return `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
}
async function login() {
  const r = await fetch(`${base}/api/login`, {
    method: "POST",
    body: JSON.stringify({ user: "juan", password: PASSWORD, device: "portatil-ejemplo" }),
  });
  return ((await r.json()) as { token: string }).token;
}
async function call(token: string, method: string, path: string, body?: unknown) {
  const r = await fetch(`${base}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: r.status, body: (await r.json()) as Record<string, unknown> };
}
type Turn = {
  run: string;
  status: string;
  error: string | null;
  replies: { component: string; data: Record<string, { value?: unknown }> }[];
};

const typeOf = (key: string) =>
  Object.values(store.schema().types).find((t) => t.key === key) as TypeDef;
const fieldOf = (t: TypeDef, key: string) => t.fields.find((f) => f.key === key)?.id as string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "boni-chat-"));
  db = openDb(join(dir, "system.db"));
  addUser(db, "juan", PASSWORD);
  const planner = fakePlanner([]);
  planner.complete = async () => ({
    json: plans.shift(),
    usage: { input: 1, output: 1 },
    model: "fake",
  });
  host = new AgentHost({ dataDir: dir, providers: { planner, reader: planner } });
  app = makeApp({
    db,
    key: randomBytes(32),
    feeds: new Feeds(async () => ""),
    guard: new LoginGuard({ perUser: 50, perAddress: 100, windowMs: 60_000, perMinute: 100 }),
    agent: host,
  });
  base = await listen(serve(app, "tailnet"));
  store = host.store(1);
  // As Juan's: movements whose category is a record of «Categorías», and a collection the page does not show.
  const cats = ["ocio/restaurantes", "comida/super", "bebida/cafe", "casa/luz", "transporte/tren"];
  const ids = seed(
    store,
    [
      { key: "categoria", name: "Categorías", folder: "registros/finanzas/categorias/" },
      {
        key: "movimiento",
        name: "Movimiento",
        folder: "registros/finanzas/movimientos/",
        sensitivity: "sensitive",
        fields: { date: "date", category: { type: "relation", to: "categoria" } },
      },
      { key: "tarea", name: "Tareas", folder: "tareas/" },
    ],
    {
      ...Object.fromEntries(
        cats.map((c) => [
          `registros/finanzas/categorias/${c.replace("/", "-")}.md`,
          `---\nnombre: ${c}\n---\n\n# ${c}\n`,
        ]),
      ),
      "registros/finanzas/movimientos/2026/10/2026-10-02-ejemplo.md":
        '---\ndate: 2026-10-02\namount: -12.5\ncategory: "[[ocio-restaurantes]]"\nmerchant: "Restaurante Ejemplo"\n---\n',
      "tareas/llamar.md": "---\ntitle: Llamar al taller\n---\n",
    },
  );
  const catId = (c: string) =>
    ids.get(`registros/finanzas/categorias/${c.replace("/", "-")}.md`) as string;
  restaurantes = catId("ocio/restaurantes");
  made.push({ day: "2026-10-02", amount: -12.5, cat: restaurantes });
  const mov = typeOf("movimiento");
  const F = {
    date: fieldOf(mov, "date"),
    amount: fieldOf(mov, "amount"),
    category: fieldOf(mov, "category"),
  };
  // A year of movements (12 Nov 2025 – 11 Nov 2026), about eleven a day.
  const N = 4000;
  for (let i = 0; i < N; i++) {
    const day = new Date(Date.UTC(2025, 10, 12) + (i % 365) * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const amount = -(((i * 37) % 9000) / 100 + 0.5);
    const cat = catId(cats[i % cats.length] as string);
    made.push({ day, amount, cat });
    store.create(
      mov.id,
      {
        [F.date]: { value: day, label: own },
        [F.amount]: { value: amount, label: own },
        [F.category]: { value: cat, label: own },
        [fieldOf(mov, "merchant")]: { value: `Comercio ${i % 300}`, label: own },
      },
      { actor: "user", device: "seed" },
    );
  }
  blocks = [
    {
      id: "b_cat",
      type: "control",
      name: "Categoría",
      kind: "option",
      collection: mov.id,
      field: F.category,
    },
    { id: "b_mes", type: "control", name: "Mes", kind: "month" },
    {
      id: "b_total",
      type: "number",
      collection: mov.id,
      measure: "sum",
      field: F.amount,
      period: "$b_mes",
      filterField: F.category,
      filterValue: "$b_cat",
      title: "Gasto del mes",
    },
    {
      id: "b_chart",
      type: "graph",
      shape: "bar",
      collection: mov.id,
      measure: "sum",
      field: F.amount,
      groupBy: "@month",
      period: "all",
      filterField: F.category,
      filterValue: "$b_cat",
    },
  ] as PageBlock[];
  page = createPage(store, { title: "Gastos", spec: { version: 1, blocks } as never }).id;
}, 120_000);

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

const sumOf = (o: { month?: string; cat?: string }) =>
  made
    .filter((m) => (!o.month || m.day.startsWith(o.month)) && (!o.cat || m.cat === o.cat))
    .reduce((s, m) => s + m.amount, 0);
const saved = () => getPage(store, page)?.spec.blocks ?? [];
const computed = (id: string) => {
  const all = saved();
  const r = computeBlocks(
    store,
    { blocks: all.filter((b) => b.id === id), controls: all.filter((b) => b.type === "control") },
    { today: TODAY, device: "portatil-ejemplo", now: Date.UTC(2026, 10, 12) },
  ).results as Record<string, { data?: { total: number } }>;
  return r[id]?.data?.total;
};
/** The plan a planner writes for «¿cuánto gasté en restaurantes en octubre?»: the values, then the code's figure. */
const answer = () => ({
  version: 1,
  steps: [
    {
      id: "c",
      op: "call",
      tool: "pages.set_value",
      args: { page: lit(page), control: lit("Categoría"), value: lit("ocio/restaurantes") },
    },
    {
      id: "m",
      op: "call",
      tool: "pages.set_value",
      args: { page: lit(page), control: lit("Mes"), value: lit("2026-10") },
    },
    {
      id: "f",
      op: "call",
      tool: "pages.figures",
      args: { page: lit(page), block: lit("b_total") },
    },
    {
      id: "r",
      op: "reply",
      component: "number",
      data: { value: ref("$f.total"), caption: ref("$f.title") },
    },
  ],
});

describe("a page's chat (D-61)", () => {
  let token = "";
  let flow = "";
  let conversation = "";

  it("is made for a page, edited in its block's panel, and answers only while its block is on the page", async () => {
    token = await login();
    const made = await call(token, "POST", "/api/agent/chats", { page });
    expect(made.status).toBe(200);
    const chat = made.body.chat as {
      flow: string;
      version: number;
      page: string;
      actions: string[];
    };
    flow = chat.flow;
    expect(chat).toMatchObject({
      page,
      actions: ["pages.figures", "entities.query", "entities.aggregate", "pages.set_value"],
    });
    expect((await call(token, "POST", "/api/agent/chats", { page: "no-existe" })).status).toBe(404);
    // Its texts: a new version over the one Juan started from; an older base or a shape that is not a chat, refused.
    const edit = {
      base: chat.version,
      welcome: "Pregúntame por tus gastos",
      buttons: [{ label: "Octubre", text: "¿cuánto gasté en octubre?" }],
    };
    const put = await call(token, "PUT", `/api/agent/chats/${flow}`, edit);
    expect(put.status).toBe(200);
    expect(put.body.chat).toMatchObject({
      welcome: "Pregúntame por tus gastos",
      version: chat.version + 1,
    });
    expect((await call(token, "PUT", `/api/agent/chats/${flow}`, edit)).status).toBe(409);
    expect(
      (
        await call(token, "PUT", `/api/agent/chats/${flow}`, {
          base: chat.version + 1,
          actions: ["entities.create"],
        })
      ).status,
    ).toBe(400);
    expect((await call(token, "GET", `/api/agent/chats/${flow}`)).body.chat).toMatchObject({
      welcome: "Pregúntame por tus gastos",
    });
    // A conversation in its mode; before the block is on the page, a message answers nothing.
    const c = await call(token, "POST", "/api/agent/conversations", { flow });
    conversation = (c.body.conversation as { id: string; flow?: string }).id;
    expect(c.body.conversation).toMatchObject({ flow });
    expect(
      (await call(token, "POST", "/api/agent/conversations", { flow: "otro-flujo" })).status,
    ).toBe(400);
    expect(
      (await call(token, "POST", "/api/agent/turn", { text: "hola", conversation })).body,
    ).toEqual({ error: "no-chat" });
    updatePage(store, page, {
      spec: { version: 1, blocks: [...blocks, { id: "b_chat", type: "chat", flow }] },
    });
    expect(chatTurnOf(store, flow)).toMatchObject({ page, scope: { page } });
    // What it may read: the movements the page counts and the categories its control chooses from, nothing else.
    expect(pageTypes(store, saved()).sort()).toEqual(
      [typeOf("categoria").id, typeOf("movimiento").id].sort(),
    );
  });

  it("«¿cuánto gasté en restaurantes en octubre?» sets the page's values, the chart follows, and the figure is the code's", async () => {
    const before = computed("b_chart");
    plans.push(answer());
    const r = await call(token, "POST", "/api/agent/turn", {
      text: "¿cuánto gasté en restaurantes en octubre?",
      conversation,
    });
    const turn = r.body as unknown as Turn;
    expect([turn.status, turn.error]).toEqual(["done", null]);
    // The page's values, set as Juan would on its controls, and written with the model's label.
    const now = saved();
    expect(now.find((b) => b.id === "b_cat")).toMatchObject({ value: restaurantes });
    expect(now.find((b) => b.id === "b_mes")).toMatchObject({ value: "2026-10" });
    const row = store.get(page);
    expect(Object.values(row?.labels ?? {}).some((l) => l.integrity === "model")).toBe(true);
    // The figure: what the code adds up over the year, the same the page's number shows.
    const expected = sumOf({ month: "2026-10", cat: restaurantes });
    expect(expected).toBeLessThan(0);
    expect(turn.replies[0]?.data.value?.value).toBeCloseTo(expected, 6);
    expect(computed("b_total")).toBeCloseTo(expected, 6);
    // The chart now counts only restaurants.
    expect(before).toBeCloseTo(sumOf({}), 4);
    expect(computed("b_chart")).toBeCloseTo(sumOf({ cat: restaurantes }), 4);
    // Its run is the chat's flow's, a turn of Juan's.
    expect(store.journal.run(turn.run)).toMatchObject({ flow, origin: "turn" });
  });

  it("refuses a number of the model's own, and a collection the page does not show", async () => {
    const own = {
      version: 1,
      steps: [{ id: "r", op: "reply", component: "number", data: { value: lit(312.4) } }],
    };
    plans.push(own, own);
    const t1 = (
      await call(token, "POST", "/api/agent/turn", { text: "¿y en total?", conversation })
    ).body as unknown as Turn;
    expect([t1.status, t1.error]).toEqual(["stopped", "plan-invalid"]);
    plans.push({
      version: 1,
      steps: [
        {
          id: "c",
          op: "call",
          tool: "entities.aggregate",
          args: { type: lit("tarea"), op: lit("count") },
        },
        { id: "r", op: "reply", component: "number", data: { value: ref("$c") } },
      ],
    });
    const t2 = (
      await call(token, "POST", "/api/agent/turn", { text: "¿cuántas tareas tengo?", conversation })
    ).body as unknown as Turn;
    expect(t2.status).toBe("stopped");
    expect(t2.error).toContain("P24");
    // Another page is not the chat's either.
    const other = createPage(store, { title: "Otra" }).id;
    plans.push({
      version: 1,
      steps: [
        {
          id: "m",
          op: "call",
          tool: "pages.set_value",
          args: { page: lit(other), control: lit("Mes"), value: lit("2026-09") },
        },
      ],
    });
    const t3 = (
      await call(token, "POST", "/api/agent/turn", { text: "cambia la otra", conversation })
    ).body as unknown as Turn;
    expect(t3.status).toBe("stopped");
    expect(t3.error).toContain("P24");
  });

  it("switched off, or its block taken off the page, it answers nothing more", async () => {
    store.journal.setFlowEnabled(flow, false);
    expect(
      (await call(token, "POST", "/api/agent/turn", { text: "hola", conversation })).body,
    ).toEqual({ error: "chat-off" });
    store.journal.setFlowEnabled(flow, true);
    const kept = saved();
    updatePage(store, page, {
      spec: { version: 1, blocks: kept.filter((b) => b.type !== "chat") },
    });
    expect(
      (await call(token, "POST", "/api/agent/turn", { text: "hola", conversation })).body,
    ).toEqual({ error: "no-chat" });
    updatePage(store, page, { spec: { version: 1, blocks: kept } });
  });

  it("in «Flujos» it stays its page's chat: no other trigger or page, no step but its «Agente», a copy is no chat", () => {
    const f = store.journal.flow(flow);
    if (!f) throw new Error("no flow");
    const o = { modules: [], mailType: null };
    const registry = coreTools();
    expect(checkFlow(store, registry, f, o).problems).toEqual([]);
    const call = { id: "x", op: "call", tool: "entities.query", args: {} };
    expect(
      checkFlow(store, registry, { trigger: f.trigger, plan: { version: 1, steps: [call] } }, o)
        .problems,
    ).toEqual([{ step: null, at: null, code: "bad-chat" }]);
    expect(
      checkFlow(store, registry, { trigger: { manual: true }, plan: f.plan }, o).problems,
    ).toEqual([{ step: null, at: null, code: "bad-chat" }]);
    const save = (trigger: unknown) =>
      saveUserFlow(store, flow, { base: f.version, trigger, plan: f.plan }, [], Date.now());
    expect(save({ manual: true })).toEqual({ error: "trigger" });
    expect(save({ chat: { page: "otra-pagina", welcome: "", buttons: [] } })).toEqual({
      error: "trigger",
    });
    const copy = createFlow(store, { name: "Copia", from: flow }, Date.now());
    expect(copy).toMatchObject({ trigger: { manual: true }, plan: { version: 1, steps: [] } });
  });

  it("A-15: what runs on every message (its chat read again, its page as its screen, a figure) over a year of movements", () => {
    const flowId = flow;
    const once = () => {
      const c = chatTurnOf(store, flowId);
      if ("error" in c) throw new Error(c.error);
      const seen = screenOf(store, pageScreen(store, c.page), { mailAccount: null, today: TODAY });
      const figures = plain(seen as Val);
      if (!figures) throw new Error("no screen");
    };
    once();
    const times: number[] = [];
    for (let k = 0; k < 5; k++) {
      const t0 = performance.now();
      once();
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    const median = times[2] as number;
    console.log(
      `A-15 page chat: its turn's chat and screen over ${made.length} movements, median ${median.toFixed(1)} ms`,
    );
    expect(median).toBeLessThan(1500);
  }, 60_000);
});
