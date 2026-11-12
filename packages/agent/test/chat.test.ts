/**
 * A page's chat (D-61, docs/sistema.md §4.6 point 6): its «Chat» trigger and «Agente» step as data, the policy's P24
 * (only the step's actions, only its page, only the collections the page shows), and a turn written in it: the
 * planner gets only those actions, and a number of the model's own in what it says is refused.
 */
import { label } from "@boni/entities";
import { afterEach, describe, expect, it } from "vitest";
import {
  agentStepOf,
  CHAT_ACTIONS,
  CHAT_INSTRUCTIONS,
  chatFlowOk,
  chatPlan,
  chatPlanErrors,
  chatTrigger,
} from "../src/chat.ts";
import type { Plan } from "../src/plan.ts";
import { type Call, decide } from "../src/policy.ts";
import { fakePlanner } from "../src/providers.ts";
import { coreTools } from "../src/tools.ts";
import { originOf, runnableNames, triggerOk } from "../src/trigger.ts";
import { leaf } from "../src/values.ts";
import { type Env, makeEnv, PERSONAL } from "./fixture.ts";

let env: Env | null = null;
afterEach(() => {
  env?.close();
  env = null;
});
const lit = (v: string | number | boolean | null) => ({ lit: v });
const ref = (r: string) => ({ ref: r });

describe("the «Chat» trigger and the «Agente» step", () => {
  it("reads a well-formed chat and refuses anything else", () => {
    const ok = { chat: { page: "p_gastos", welcome: "Pregúntame", buttons: [] } };
    expect(chatTrigger(ok)).toEqual({ page: "p_gastos", welcome: "Pregúntame", buttons: [] });
    expect(chatTrigger({ chat: { page: "p_gastos" } })).toEqual({
      page: "p_gastos",
      welcome: "",
      buttons: [],
    });
    const button = { label: "Octubre", text: "¿cuánto gasté en octubre?" };
    expect(chatTrigger({ chat: { page: "p", buttons: [button] } })?.buttons).toEqual([button]);
    for (const bad of [
      null,
      { chat: true },
      { chat: { page: "p", extra: 1 } },
      { chat: { page: "p" }, manual: true },
      { chat: { page: "../x" } },
      { chat: { page: "p", welcome: "x".repeat(401) } },
      { chat: { page: "p", buttons: Array(7).fill(button) } },
      { chat: { page: "p", buttons: [{ label: "", text: "x" }] } },
      { chat: { page: "p", buttons: [{ label: "x", text: "y", url: "https://example.com" }] } },
    ])
      expect(chatTrigger(bad)).toBeNull();
  });

  it("is a trigger Boni knows, run only as Juan's turns", () => {
    const t = { chat: { page: "p_gastos", welcome: "", buttons: [] } };
    expect(triggerOk(t)).toBe(true);
    expect(triggerOk({ chat: { page: "" } })).toBe(false);
    expect(runnableNames(t)).toBeNull();
    expect(originOf(t, "portatil")).toEqual({
      kind: "turn",
      trust: "personal",
      device: "portatil",
    });
  });

  it("has one «Agente» step, with instructions and actions of the fixed list", () => {
    const plan = chatPlan();
    expect(agentStepOf(plan)).toEqual({
      id: "agente",
      op: "agent",
      instructions: CHAT_INSTRUCTIONS,
      actions: [...CHAT_ACTIONS],
    });
    expect(agentStepOf(chatPlan("Solo cifras", ["pages.figures"]))?.actions).toEqual([
      "pages.figures",
    ]);
    const step = plan.steps[0];
    for (const bad of [
      { version: 1, steps: [] },
      { version: 1, steps: [step, { ...step, id: "otro" }] },
      { version: 1, steps: [{ ...step, actions: [] }] },
      { version: 1, steps: [{ ...step, actions: ["entities.create"] }] },
      { version: 1, steps: [{ ...step, actions: ["pages.figures", "pages.figures"] }] },
      { version: 1, steps: [{ ...step, instructions: "x".repeat(2001) }] },
      { version: 1, steps: [{ ...step, tool: "web.fetch" }] },
    ])
      expect(agentStepOf(bad)).toBeNull();
    expect(chatFlowOk({ chat: { page: "p" } }, plan)).toBe(true);
    expect(chatFlowOk({ manual: true }, plan)).toBe(false);
  });

  it("refuses a reader and a number of the model's own in what it says", () => {
    const plan = (steps: unknown[]) => ({ version: 1, steps }) as Plan;
    expect(
      chatPlanErrors(
        plan([
          { id: "a", op: "call", tool: "pages.figures", args: {} },
          { id: "r", op: "reply", component: "number", data: { value: ref("$a") } },
        ]),
      ),
    ).toEqual([]);
    expect(
      chatPlanErrors(
        plan([{ id: "r", op: "reply", component: "number", data: { value: lit(312.4) } }]),
      ),
    ).toEqual(["steps[0].data.value: number-not-computed"]);
    expect(
      chatPlanErrors(
        plan([
          {
            id: "r",
            op: "reply",
            component: "text",
            data: { text: { fn: "concat", args: [lit("Gastaste 312 €"), ref("$a")] } },
          },
        ]),
      ),
    ).toEqual(["steps[0].data.text: number-not-computed"]);
    expect(
      chatPlanErrors(plan([{ id: "q", op: "ask", control: "text", prompt: lit("¿En 2026?") }])),
    ).toEqual(["steps[0]: number-not-computed"]);
    expect(chatPlanErrors(plan([{ id: "x", op: "read", reader: "summary", input: {} }]))).toEqual([
      "steps[0]: no-reader-in-chat",
    ]);
  });
});

describe("P24: a chat acts only within its step, its page and the page's collections", () => {
  const tools = coreTools();
  const OWN = label("user", "personal", []);
  const v = (x: string) => leaf(x, OWN);
  const scope = {
    actions: ["entities.aggregate", "pages.set_value"],
    page: "p_gastos",
    types: ["t_mov"],
  };
  const call = (name: string, args: Call["args"], typeIds?: Call["typeIds"]): Call => ({
    tool: tools.get(name) ?? null,
    args,
    control: null,
    scope,
    ...(typeIds ? { typeIds } : {}),
  });
  const counters = { writes: 0, sensitiveReads: 0 };

  it("allows the step's actions over the page's collections", () => {
    expect(
      decide(
        call("entities.aggregate", { type: v("movimiento"), op: v("sum") }, { type: "t_mov" }),
        PERSONAL,
        counters,
      ),
    ).toMatchObject({ kind: "allow" });
  });

  it("denies another collection, an unresolved one, and an action the step does not give", () => {
    expect(
      decide(
        call("entities.aggregate", { type: v("tarea"), op: v("count") }, { type: "t_tarea" }),
        PERSONAL,
        counters,
      ),
    ).toEqual({ kind: "deny", rule: "P24", reason: "not-the-pages-collection" });
    expect(
      decide(
        call("entities.aggregate", { type: v("x"), op: v("count") }, { type: null }),
        PERSONAL,
        counters,
      ),
    ).toEqual({ kind: "deny", rule: "P24", reason: "not-the-pages-collection" });
    expect(
      decide(
        call("entities.query", { type: v("movimiento") }, { type: "t_mov" }),
        PERSONAL,
        counters,
      ),
    ).toEqual({ kind: "deny", rule: "P24", reason: "not-the-chats-action" });
    expect(
      decide(
        call("entities.create", { type: v("movimiento") }, { type: "t_mov" }),
        PERSONAL,
        counters,
      ),
    ).toEqual({ kind: "deny", rule: "P24", reason: "not-the-chats-action" });
  });

  it("leaves a call with no chat as it was", () => {
    const c = call("entities.query", { type: v("tarea") }, { type: "t_tarea" });
    delete c.scope;
    expect(decide(c, PERSONAL, counters)).toMatchObject({ kind: "allow" });
  });
});

describe("a turn written in a page's chat", () => {
  const chat = (types: string[] = ["t_mov"], actions = ["entities.aggregate"]) => ({
    flow: { id: "chat-gastos-0a1b2c", version: 3 },
    instructions: "Responde con las cifras de la página.",
    scope: { actions, page: "p_gastos", types },
  });
  const sum = {
    id: "s",
    op: "call",
    tool: "entities.aggregate",
    args: { type: lit("movimiento"), op: lit("sum"), of: lit("importe") },
  };

  it("gives the planner only the chat's actions and its instructions, and keeps the chat's flow with the run", async () => {
    env = makeEnv();
    const planner = fakePlanner([
      {
        version: 1,
        steps: [sum, { id: "r", op: "reply", component: "number", data: { value: ref("$s") } }],
      },
    ]);
    const res = await env
      .agent(planner)
      .turn({ text: "¿cuánto gasté?", origin: PERSONAL, chat: chat() });
    expect([res.status, res.error]).toEqual(["done", null]);
    // The figure is the code's sum (the fixture's one invented movement).
    expect(res.replies[0]?.data.value).toMatchObject({ t: "v", value: 42.5 });
    const input = planner.requests[0]?.input as { tools: { name: string }[]; chat?: unknown };
    expect(input.tools.map((t) => t.name)).toEqual(["entities.aggregate"]);
    expect(input.chat).toEqual({
      page: "p_gastos",
      instructions: "Responde con las cifras de la página.",
    });
    expect(env.store.journal.run(res.run)).toMatchObject({
      flow: "chat-gastos-0a1b2c",
      flowVersion: 3,
      origin: "turn",
    });
  });

  it("refuses a figure the model wrote, asks again, and stops when it insists", async () => {
    env = makeEnv();
    const own = {
      version: 1,
      steps: [{ id: "r", op: "reply", component: "number", data: { value: lit(312) } }],
    };
    const good = {
      version: 1,
      steps: [sum, { id: "r", op: "reply", component: "number", data: { value: ref("$s") } }],
    };
    const again = fakePlanner([own, good]);
    const res = await env.agent(again).turn({ text: "¿cuánto?", origin: PERSONAL, chat: chat() });
    expect(res.status).toBe("done");
    expect(JSON.stringify(again.requests[1]?.input)).toContain("number-not-computed");
    const insists = await env
      .agent(fakePlanner([own, own]))
      .turn({ text: "¿cuánto?", origin: PERSONAL, chat: chat() });
    expect([insists.status, insists.error]).toEqual(["stopped", "plan-invalid"]);
    // Out of a chat the same plan is a reply like any other.
    const plain = await env.agent(fakePlanner([own])).turn({ text: "¿cuánto?", origin: PERSONAL });
    expect(plain.status).toBe("done");
  });

  it("stops a call over a collection the page does not show (P24)", async () => {
    env = makeEnv();
    const count = {
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
    };
    const res = await env
      .agent(fakePlanner([count]))
      .turn({ text: "¿cuántas tareas?", origin: PERSONAL, chat: chat() });
    expect(res.status).toBe("stopped");
    expect(res.error).toContain("P24");
  });
});
