import { describe, expect, it } from "vitest";
import { ProviderError } from "../src/anthropic.ts";
import { OpenAIProvider } from "../src/openai.ts";

/** The OpenAI-compatible provider against a stand-in for the API (no network, no key). */
const KEY = "clave-de-prueba-inventada";
function stub(answer: () => Response | Error) {
  const calls: { url: string; body: Record<string, unknown>; headers: Record<string, string> }[] =
    [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push({
      url,
      body: JSON.parse(String(init.body)),
      headers: init.headers as Record<string, string>,
    });
    const a = answer();
    if (a instanceof Error) throw a;
    return a;
  }) as unknown as typeof fetch;
  return { calls, f };
}
const ok = (content: string, extra: Record<string, unknown> = {}) =>
  new Response(
    JSON.stringify({
      choices: [{ message: { content }, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
      model: "deepseek/ejemplo",
      ...extra,
    }),
    { status: 200 },
  );
const reader = {
  role: "reader" as const,
  system: "s",
  input: { text: "hola" },
  schema: { type: "object", properties: { a: { type: ["string", "null"], maxLength: 3 } } },
  maxTokens: 100,
};
const OR = "https://openrouter.ai/api/v1";

describe("the OpenAI-compatible provider", () => {
  it("asks a reader for its schema, only from a provider that honours it, and reads the answer", async () => {
    const s = stub(() => ok('{"a":"x"}'));
    const p = new OpenAIProvider({ apiKey: KEY, model: "m", baseURL: `${OR}/`, fetch: s.f });
    expect([p.id, p.privacy]).toEqual(["openrouter", "external-api"]);
    const r = await p.complete(reader);
    expect(r).toEqual({
      json: { a: "x" },
      usage: { input: 10, output: 5 },
      model: "deepseek/ejemplo",
    });
    const c = s.calls[0];
    expect(c?.url).toBe(`${OR}/chat/completions`);
    expect(c?.headers.authorization).toBe(`Bearer ${KEY}`);
    expect(c?.body).toMatchObject({
      model: "m",
      max_tokens: 100,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "reader",
          strict: true,
          schema: {
            additionalProperties: false,
            properties: { a: { anyOf: [{ type: "string" }, { type: "null" }] } },
          },
        },
      },
      provider: { require_parameters: true },
    });
  });

  it("with zdr, only providers that keep and collect nothing; the cost OpenRouter charged comes back", async () => {
    const s = stub(() =>
      ok('{"a":"x"}', { usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0.0012 } }),
    );
    const p = new OpenAIProvider({ apiKey: KEY, model: "m", baseURL: OR, zdr: true, fetch: s.f });
    const r = await p.complete(reader);
    expect(r.usage).toEqual({ input: 10, output: 5, cost: 0.0012 });
    expect(s.calls[0]?.body.provider).toEqual({
      require_parameters: true,
      zdr: true,
      data_collection: "deny",
    });
    // The planner (text, no format) keeps the zdr demand too.
    await p.complete({ ...reader, role: "planner", structured: false });
    expect(s.calls[1]?.body.provider).toEqual({ zdr: true, data_collection: "deny" });
  });

  it("the planner answers in text: the plan is taken from it, nothing forced", async () => {
    const s = stub(() => ok('Aquí está:\n```json\n{"version":1,"steps":[]}\n```'));
    const p = new OpenAIProvider({ apiKey: KEY, model: "m", baseURL: OR, fetch: s.f });
    const r = await p.complete({ ...reader, role: "planner", structured: false });
    expect(r.json).toEqual({ version: 1, steps: [] });
    expect(s.calls[0]?.body.response_format).toBeUndefined();
    expect(s.calls[0]?.body.provider).toBeUndefined();
  });

  it("a local model needs no key and is local; json_object puts the schema in the prompt", async () => {
    const s = stub(() => ok('{"a":null}'));
    const p = new OpenAIProvider({
      model: "m",
      baseURL: "http://127.0.0.1:8080/v1",
      readerFormat: "json_object",
      fetch: s.f,
    });
    expect([p.id, p.privacy]).toEqual(["local", "local"]);
    await p.complete(reader);
    const body = s.calls[0]?.body as { messages: { content: string }[]; response_format: unknown };
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.messages[0]?.content).toContain('"maxLength":3');
    expect(s.calls[0]?.headers.authorization).toBeUndefined();
    expect(() => new OpenAIProvider({ model: "m", baseURL: OR })).toThrow(ProviderError);
  });

  it("errors are fixed codes; the API's message only in detail", async () => {
    const fails = async (answer: () => Response | Error) => {
      const p = new OpenAIProvider({ apiKey: KEY, model: "m", baseURL: OR, fetch: stub(answer).f });
      return p.complete(reader).then(
        () => null,
        (e: ProviderError) => [e.code, e.detail],
      );
    };
    expect(await fails(() => new Response("sin saldo", { status: 402 }))).toEqual([
      "http-402",
      "sin saldo",
    ]);
    expect(
      await fails(() =>
        ok("", { choices: [{ message: { content: "{" }, finish_reason: "length" }] }),
      ),
    ).toEqual(["max-tokens", ""]);
    expect(
      await fails(() => ok("", { choices: [{ message: { content: null, refusal: "no" } }] })),
    ).toEqual(["refusal", ""]);
    expect(await fails(() => ok("", { error: { message: "upstream" } }))).toEqual([
      "failed",
      "upstream",
    ]);
    expect(await fails(() => ok("no es json"))).toEqual(["not-json", ""]);
    expect(await fails(() => new TypeError("fetch failed"))).toEqual(["network", ""]);
  });
});
