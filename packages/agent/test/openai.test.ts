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

  it("the planner is asked for a JSON object, nothing forced, and the plan is still taken from text", async () => {
    const s = stub(() => ok('Aquí está:\n```json\n{"version":1,"steps":[]}\n```'));
    const p = new OpenAIProvider({ apiKey: KEY, model: "m", baseURL: OR, fetch: s.f });
    const r = await p.complete({ ...reader, role: "planner", structured: false });
    expect(r.json).toEqual({ version: 1, steps: [] });
    // Task 132: a JSON object as a preference; no `require_parameters`, so a route without it is still taken.
    expect(s.calls[0]?.body.response_format).toEqual({ type: "json_object" });
    expect(s.calls[0]?.body.provider).toBeUndefined();
  });

  it("a server that takes no format: the planner is asked with none, configured or learned from its refusal (task 132)", async () => {
    const plan = '{"version":1,"steps":[]}';
    const planner = { ...reader, role: "planner" as const, structured: false };
    // Configured: a server whose readers are asked in plain text asks its planner in plain text too.
    const plain = stub(() => ok(plan));
    await new OpenAIProvider({
      model: "m",
      baseURL: "http://127.0.0.1:8080/v1",
      readerFormat: "none",
      fetch: plain.f,
    }).complete(planner);
    expect(plain.calls[0]?.body.response_format).toBeUndefined();
    // Learned: a 400 that names the format is asked again without it, once, and from then on without it.
    let n = 0;
    const s = stub(() =>
      n++ === 0
        ? new Response('{"error":{"message":"response_format is not supported"}}', { status: 400 })
        : ok(plan),
    );
    const p = new OpenAIProvider({ model: "m", baseURL: "http://127.0.0.1:8080/v1", fetch: s.f });
    expect((await p.complete(planner)).json).toEqual({ version: 1, steps: [] });
    await p.complete(planner);
    expect(s.calls.map((c) => "response_format" in c.body)).toEqual([true, false, false]);
    // A reader is not affected by what the planner learned, and another 400 is not asked again.
    await p.complete(reader);
    expect(s.calls[3]?.body.response_format).toMatchObject({ type: "json_schema" });
    const other = stub(
      () => new Response('{"error":{"message":"prompt is too long"}}', { status: 400 }),
    );
    const q = new OpenAIProvider({
      model: "m",
      baseURL: "http://127.0.0.1:8080/v1",
      fetch: other.f,
    });
    await expect(q.complete(planner)).rejects.toMatchObject({ code: "http-400" });
    expect(other.calls.length).toBe(1);
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

  it("a reader asked not to reason (task 29); without it for a model no provider takes it; run out, it says how far", async () => {
    let answers: (() => Response)[] = [
      () => ok('{"a":"x"}'),
      () =>
        new Response('{"error":{"message":"No endpoints found that support all parameters"}}', {
          status: 404,
        }),
      () => ok('{"a":"y"}'),
      () => ok('{"a":"z"}'),
    ];
    const s = stub(() => (answers.shift() as () => Response)());
    const off = new OpenAIProvider({
      apiKey: KEY,
      model: "m",
      baseURL: OR,
      reasoning: "off",
      fetch: s.f,
    });
    await off.complete(reader);
    expect(s.calls[0]?.body.reasoning).toEqual({ enabled: false });
    expect(s.calls[0]?.body.provider).toEqual({ require_parameters: true });
    // A model none of whose providers take it: asked again without it, and from then on.
    expect((await off.complete(reader)).json).toEqual({ a: "y" });
    expect(s.calls[1]?.body.reasoning).toEqual({ enabled: false });
    expect(s.calls[2]?.body.reasoning).toBeUndefined();
    await off.complete(reader);
    expect(s.calls[3]?.body.reasoning).toBeUndefined();
    // Not asked: nothing sent (the planner may reason).
    answers = [() => ok('{"a":"x"}')];
    await new OpenAIProvider({ apiKey: KEY, model: "m", baseURL: OR, fetch: s.f }).complete(reader);
    expect(s.calls[4]?.body.reasoning).toBeUndefined();
    // Out of room: how many tokens it wrote and how many were reasoning, numbers only.
    answers = [
      () =>
        ok("", {
          choices: [{ message: { content: "" }, finish_reason: "length" }],
          usage: {
            prompt_tokens: 10,
            completion_tokens: 4000,
            completion_tokens_details: { reasoning_tokens: 3900 },
          },
        }),
    ];
    const e = await off.complete(reader).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ProviderError);
    expect((e as ProviderError).code).toBe("max-tokens");
    expect((e as ProviderError).tokens).toEqual({ output: 4000, reasoning: 3900 });
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
    // The body itself not JSON is the provider's, apart from the model's answer (task 132).
    expect(await fails(() => new Response("<html>", { status: 200 }))).toEqual([
      "bad-body",
      "<html>",
    ]);
    expect(await fails(() => new TypeError("fetch failed"))).toEqual(["network", ""]);
  });

  it("an answer that is not JSON carries what it cost (task 132), numbers only", async () => {
    const p = new OpenAIProvider({
      apiKey: KEY,
      model: "m",
      baseURL: OR,
      fetch: stub(() =>
        ok("prosa", { usage: { prompt_tokens: 7, completion_tokens: 3, cost: 0.01 } }),
      ).f,
    });
    const e = (await p.complete(reader).catch((x) => x)) as ProviderError;
    expect([e.code, e.usage]).toEqual(["not-json", { input: 7, output: 3, cost: 0.01 }]);
  });

  it("a reader is asked and read as before task 132: only the planner's request changed", async () => {
    const s = stub(() => ok('Aquí va: {"a": "sí"}'));
    const p = new OpenAIProvider({
      apiKey: KEY,
      model: "m",
      baseURL: OR,
      zdr: true,
      reasoning: "off",
      fetch: s.f,
    });
    expect((await p.complete(reader)).json).toEqual({ a: "sí" });
    expect(s.calls[0]?.body).toEqual({
      model: "m",
      max_tokens: 100,
      messages: [
        { role: "system", content: "s" },
        { role: "user", content: JSON.stringify({ text: "hola" }) },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "reader",
          strict: true,
          schema: {
            type: "object",
            properties: { a: { anyOf: [{ type: "string" }, { type: "null" }] } },
            additionalProperties: false,
          },
        },
      },
      reasoning: { enabled: false },
      provider: { require_parameters: true, zdr: true, data_collection: "deny" },
    });
    // A reader with no format reads the JSON out of its text, as it did.
    const t = stub(() => ok('Aquí va: {"a": "no"} y nada más'));
    const none = new OpenAIProvider({
      apiKey: KEY,
      model: "m",
      baseURL: OR,
      readerFormat: "none",
      fetch: t.f,
    });
    expect((await none.complete(reader)).json).toEqual({ a: "no" });
    expect(t.calls[0]?.body.response_format).toBeUndefined();
    expect(t.calls[0]?.body.provider).toBeUndefined();
  });
});
