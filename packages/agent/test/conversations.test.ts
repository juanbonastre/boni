import { afterEach, describe, expect, it } from "vitest";
import type { LiveEvent } from "../src/agent.ts";
import {
  createConversation,
  deleteConversation,
  listConversations,
  turnViews,
} from "../src/conversations.ts";
import { fakePlanner, type ModelProvider } from "../src/providers.ts";
import { type Env, makeEnv, PERSONAL } from "./fixture.ts";

/**
 * Juan's conversations with Boni (docs/conversacion.md 3.1 and 3.5): every turn kept in its conversation, the history
 * read back by a new agent as after a restart, each turn live while it runs, «Parar» at any point, and the planner
 * chosen for a conversation. Invented data only.
 */
let env: Env;
afterEach(() => env?.close());

const lit = (v: string | number | boolean | null) => ({ lit: v });
const ref = (r: string) => ({ ref: r });
const COUNT = {
  version: 1,
  steps: [
    {
      id: "n",
      op: "call",
      tool: "entities.aggregate",
      args: { type: lit("tarea"), op: lit("count") },
    },
    {
      id: "r",
      op: "reply",
      component: "number",
      data: { value: ref("$n"), caption: lit("tareas") },
    },
  ],
};
const ASK = {
  version: 1,
  steps: [
    { id: "q", op: "ask", control: "text", prompt: lit("¿Título?") },
    {
      id: "c",
      op: "call",
      tool: "entities.create",
      args: { type: lit("tarea"), values: { fn: "obj", args: [lit("titulo"), ref("$q")] } },
    },
  ],
};
const now = () => Date.UTC(2026, 9, 31, 10);

describe("a conversation with Boni", () => {
  it("keeps every turn, gets its title from the first one, and a new agent reads its history (a restart)", async () => {
    env = makeEnv();
    const c = createConversation(env.store, { now: now() });
    const first = await env
      .agent(fakePlanner([COUNT]))
      .turn({ text: "¿cuántas tareas tengo?", origin: PERSONAL, conversation: c });
    expect(first.status).toBe("done");
    expect(listConversations(env.store)).toMatchObject([
      { id: c, title: "¿cuántas tareas tengo?" },
    ]);

    const later = fakePlanner([COUNT]);
    await env.agent(later).turn({ text: "¿y ahora?", origin: PERSONAL, conversation: c });
    const input = later.requests[0]?.input as {
      history: { request: string; replies: unknown[] }[];
    };
    expect(input.history.map((h) => h.request)).toEqual(["¿cuántas tareas tengo?"]);
    expect(input.history[0]?.replies).toHaveLength(1);

    const turns = turnViews(env.store, c);
    expect(turns.map((t) => [t.request, t.status])).toEqual([
      ["¿cuántas tareas tengo?", "done"],
      ["¿y ahora?", "done"],
    ]);
    expect(turns[0]?.replies[0]?.data.value).toMatchObject({ t: "v", value: 1 });
  });

  it("shows itself live: its run, the planner thinking, each step, each reply and how it ended", async () => {
    env = makeEnv();
    const c = createConversation(env.store, { now: now() });
    const seen: LiveEvent[] = [];
    const r = await env.agent(fakePlanner([COUNT])).turn({
      text: "¿cuántas tareas tengo?",
      origin: PERSONAL,
      conversation: c,
      live: (e) => seen.push(e),
    });
    expect(seen.map((e) => (e.type === "step" ? `step:${e.state}` : e.type))).toEqual([
      "start",
      "planning",
      "planned",
      "step:start",
      "step:done",
      "reply",
      "end",
    ]);
    expect(seen[0]).toEqual({ type: "start", run: r.run });
    expect(seen[3]).toMatchObject({ op: "call", what: expect.any(String) });
  });

  it("stops when Juan says: while it plans (the call is cut), between steps, or while it waits", async () => {
    env = makeEnv();
    const c = createConversation(env.store, { now: now() });
    // A planner that only answers when it is cut.
    const slow: ModelProvider = {
      id: "lento",
      privacy: "local",
      complete: (_req, o) =>
        new Promise((_ok, fail) =>
          o?.signal?.addEventListener("abort", () =>
            fail(Object.assign(new Error("aborted"), { code: "aborted" })),
          ),
        ),
    };
    const a = env.agent(slow);
    let run = "";
    const going = a.turn({
      text: "algo largo",
      origin: PERSONAL,
      conversation: c,
      live: (e) => {
        if (e.type === "start") run = e.run;
        if (e.type === "planning") queueMicrotask(() => a.stop(run));
      },
    });
    expect(await going).toMatchObject({ status: "stopped", error: "stopped-by-juan" });

    // Between steps: the first ends, then «Parar».
    const b = env.agent(fakePlanner([COUNT]));
    let run2 = "";
    const r = await b.turn({
      text: "¿cuántas tareas tengo?",
      origin: PERSONAL,
      conversation: c,
      live: (e) => {
        if (e.type === "step" && e.state === "done") b.stop(run2);
        if (e.type === "start") run2 = e.run;
      },
    });
    expect(r).toMatchObject({ status: "stopped", error: "stopped-by-juan", replies: [] });

    // Waiting on a question: it ends there, and its turn says so.
    const w = env.agent(fakePlanner([ASK]));
    const asked = await w.turn({ text: "apunta algo", origin: PERSONAL, conversation: c });
    expect(asked.status).toBe("waiting");
    expect(turnViews(env.store, c).at(-1)).toMatchObject({
      status: "waiting",
      pending: { kind: "ask" },
    });
    expect(w.stop(asked.run)).toMatchObject({ status: "stopped", error: "stopped-by-juan" });
    expect(turnViews(env.store, c).at(-1)).toMatchObject({ status: "stopped", pending: null });
  });

  it("plans with the model chosen for it, and goes to the trash whole", async () => {
    env = makeEnv();
    const c = createConversation(env.store, { now: now() });
    const account = fakePlanner([COUNT]);
    const chosen = fakePlanner([COUNT]);
    await env
      .agent(account)
      .turn({ text: "¿cuántas tareas tengo?", origin: PERSONAL, conversation: c, planner: chosen });
    expect([account.requests.length, chosen.requests.length]).toEqual([0, 1]);
    expect(deleteConversation(env.store, c)).toBe(true);
    expect(listConversations(env.store)).toEqual([]);
    expect(turnViews(env.store, c)).toEqual([]);
  });
});
