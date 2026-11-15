/**
 * A plan that does not arrive as JSON (task 132): an OpenAI-compatible planner (a model on OpenRouter) that answers
 * prose, a JSON object cut short or nothing, or a provider whose HTTP body is not JSON. The turn asks once more, never
 * twice, and every call that came back is in the journal with what it cost. Fakes only: no network, no key.
 */
import { afterEach, describe, expect, it } from "vitest";
import { PLANNER_RETRIES } from "../src/agent.ts";
import { OpenAIProvider } from "../src/openai.ts";
import { type Env, makeEnv, PERSONAL } from "./fixture.ts";

let env: Env;
afterEach(() => env?.close());

const OR = "https://openrouter.ai/api/v1";
const KEY = "clave-de-prueba-inventada";
const PLAN = {
  version: 1,
  steps: [{ id: "r", op: "reply", component: "text", data: { template: { lit: "Hecho" } } }],
};
const answer = (content: string, cost = 0.002) =>
  new Response(
    JSON.stringify({
      choices: [{ message: { content }, finish_reason: "stop" }],
      usage: { prompt_tokens: 100, completion_tokens: 20, cost },
      model: "ejemplo/modelo",
    }),
    { status: 200 },
  );
const PROSE = "Claro, te pongo al día: tienes dos correos nuevos.";
const CUT = '{"version": 1, "steps": [{"id": "r", "op": "reply"';
const EMPTY = "";
const HTML = () => new Response("<html><body>Bad gateway</body></html>", { status: 200 });

/** A planner on OpenRouter whose API answers these in turn (the last again when they run out). */
function routed(answers: (() => Response)[], o: { zdr?: boolean } = {}) {
  const bodies: Record<string, unknown>[] = [];
  const f = (async (_url: string, init: RequestInit) => {
    bodies.push(JSON.parse(String(init.body)));
    return (answers[Math.min(bodies.length - 1, answers.length - 1)] as () => Response)();
  }) as unknown as typeof fetch;
  const p = new OpenAIProvider({
    apiKey: KEY,
    model: "ejemplo/modelo",
    baseURL: OR,
    fetch: f,
    ...o,
  });
  return { p, bodies };
}

describe("a planner answer that is not JSON (task 132)", () => {
  for (const [what, bad] of [
    ["prose", PROSE],
    ["a JSON object cut short", CUT],
    ["empty", EMPTY],
  ] as const)
    it(`${what}: asked once more, and the turn goes on`, async () => {
      env = makeEnv();
      const { p, bodies } = routed([() => answer(bad), () => answer(JSON.stringify(PLAN))]);
      const res = await env.agent(p).turn({ text: "Ponme al día", origin: PERSONAL });
      expect([res.status, res.error]).toEqual(["done", null]);
      expect(bodies.length).toBe(2);
      // The second ask says why, by a fixed code: never the model's own text.
      const second = JSON.parse(
        String((bodies[1]?.messages as { content: string }[] | undefined)?.[1]?.content),
      );
      expect(second.previous_errors).toEqual(["not-json"]);
      expect(JSON.stringify(bodies[1])).not.toContain(PROSE);
      // Both calls came back and were charged: both are in the journal with their cost (the month's spending).
      const calls = env.store.journal.modelCalls(res.run).filter((c) => c.role === "planner");
      expect(calls.map((c) => (c.usage as { cost?: number }).cost)).toEqual([0.002, 0.002]);
      expect(calls[0]?.response).toEqual({ error: "model-not-json" });
    });

  it("not JSON twice: one extra call at most, and the turn says the planner gave no plan", async () => {
    env = makeEnv();
    const { p, bodies } = routed([() => answer(PROSE), () => answer(PROSE), () => answer("{}")]);
    const res = await env.agent(p).turn({ text: "Ponme al día", origin: PERSONAL });
    expect([res.status, res.error]).toEqual(["stopped", "model-not-json"]);
    expect(PLANNER_RETRIES).toBe(1);
    expect(bodies.length).toBe(1 + PLANNER_RETRIES);
    expect(env.store.journal.modelCalls(res.run).length).toBe(2);
  });

  it("prose, then a plan that is not valid: the one extra call is spent, no third", async () => {
    env = makeEnv();
    const { p, bodies } = routed([
      () => answer(PROSE),
      () => answer(JSON.stringify({ version: 1, steps: [{ id: "x", op: "nada" }] })),
      () => answer(JSON.stringify(PLAN)),
    ]);
    const res = await env.agent(p).turn({ text: "Ponme al día", origin: PERSONAL });
    expect([res.status, res.error]).toEqual(["stopped", "plan-invalid"]);
    expect(bodies.length).toBe(2);
  });

  it("an HTTP body that is not JSON is the provider's (`bad-body`), asked once more too", async () => {
    env = makeEnv();
    const once = routed([HTML, () => answer(JSON.stringify(PLAN))]);
    const ok = await env.agent(once.p).turn({ text: "Ponme al día", origin: PERSONAL });
    expect([ok.status, ok.error]).toEqual(["done", null]);
    expect(once.bodies.length).toBe(2);
    env.close();
    env = makeEnv();
    const twice = routed([HTML]);
    const res = await env.agent(twice.p).turn({ text: "Ponme al día", origin: PERSONAL });
    expect([res.status, res.error]).toEqual(["stopped", "model-bad-body"]);
    expect(twice.bodies.length).toBe(2);
  });

  it("the run's own limit on model calls still holds over the second ask", async () => {
    env = makeEnv();
    const { p, bodies } = routed([() => answer(PROSE), () => answer(JSON.stringify(PLAN))]);
    const res = await env
      .agent(p, undefined, { limits: { maxModelCalls: 1 } })
      .turn({ text: "Ponme al día", origin: PERSONAL });
    expect([res.status, res.error]).toEqual(["stopped", "P12-model-calls"]);
    expect(bodies.length).toBe(1);
  });

  it("asks an OpenRouter planner for a JSON object, as a preference: a route without it is still taken", async () => {
    env = makeEnv();
    const { p, bodies } = routed([() => answer(JSON.stringify(PLAN))], { zdr: true });
    await env.agent(p).turn({ text: "Ponme al día", origin: PERSONAL });
    expect(bodies[0]?.response_format).toEqual({ type: "json_object" });
    // No `require_parameters` for it: a provider that takes no format answers as before, and the code reads the
    // JSON from the text (OpenRouter drops a parameter a provider does not take unless it is required).
    expect(bodies[0]?.provider).toEqual({ zdr: true, data_collection: "deny" });
    // The planner's prompt is its own: the schema is not appended to it as a reader's is.
    const system = (bodies[0]?.messages as { content: string }[] | undefined)?.[0]?.content;
    expect(system).not.toContain("follows this JSON Schema");
  });
});
