import { afterEach, describe, expect, it } from "vitest";
import { AnthropicProvider, apiSchema, ProviderError } from "../src/anthropic.ts";
import { planSchema } from "../src/plan.ts";
import { fakePlanner } from "../src/providers.ts";
import { READER_SCHEMAS } from "../src/readers.ts";
import { coreTools } from "../src/tools.ts";
import { type Env, makeEnv, PERSONAL } from "./fixture.ts";

/** The provider against a stand-in for the API (no network, no key). */
const KEY = "clave-de-prueba-inventada";
type Call = { url: string; init: RequestInit };
function stub(answers: (() => Response | Error)[]) {
  const calls: Call[] = [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const a = (answers[Math.min(calls.length - 1, answers.length - 1)] as () => Response | Error)();
    if (a instanceof Error) throw a;
    return a;
  }) as unknown as typeof fetch;
  return { calls, f };
}
const ok = (text: string, extra: Record<string, unknown> = {}) =>
  new Response(
    JSON.stringify({
      content: [{ type: "text", text }],
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 5 },
      model: "claude-opus-5-5",
      ...extra,
    }),
    {
      status: 200,
      headers: { "content-type": "application/json" },
    },
  );
const req = {
  role: "planner" as const,
  system: "s",
  input: { request: "hola" },
  schema: { type: "object", properties: { a: { type: ["string", "null"], maxLength: 3 } } },
  maxTokens: 100,
};

describe("the Anthropic provider", () => {
  it("asks for structured output, with no tools, and reads the JSON", async () => {
    const { calls, f } = stub([() => ok('{"a":"x"}')]);
    const p = new AnthropicProvider({ apiKey: KEY, model: "claude-opus-5-5", fetch: f });
    const res = await p.complete(req);
    expect(res).toEqual({
      json: { a: "x" },
      usage: { input: 10, output: 5 },
      model: "claude-opus-5-5",
    });
    expect(calls[0]?.url).toBe("https://api.anthropic.com/v1/messages");
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe(KEY);
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    const body = JSON.parse(String(calls[0]?.init.body));
    expect(body).not.toHaveProperty("tools");
    expect(body.output_config.format).toEqual({
      type: "json_schema",
      schema: {
        type: "object",
        properties: { a: { anyOf: [{ type: "string" }, { type: "null" }] } },
        additionalProperties: false,
      },
    });
    expect(JSON.parse(body.messages[0].content)).toEqual({ request: "hola" });
  });

  it("retries when the API is busy, and fails with a code that never carries the key", async () => {
    const sleep = async () => {};
    const busy = stub([() => new Response("", { status: 529 }), () => ok('{"a":null}')]);
    expect(
      (await new AnthropicProvider({ apiKey: KEY, model: "m", fetch: busy.f, sleep }).complete(req))
        .json,
    ).toEqual({ a: null });
    expect(busy.calls.length).toBe(2);
    for (const [answers, code] of [
      [[() => new Response(`{"error":"bad key ${KEY}"}`, { status: 401 })], "http-401"],
      [[() => new Error(`connect ${KEY}`)], "network"],
      [[() => ok("no es json")], "not-json"],
      [[() => ok("{}", { stop_reason: "max_tokens" })], "max-tokens"],
      [[() => ok("{}", { stop_reason: "refusal" })], "refusal"],
    ] as const) {
      const s = stub([...answers]);
      const e = await new AnthropicProvider({
        apiKey: KEY,
        model: "m",
        fetch: s.f,
        sleep,
        retries: 0,
      })
        .complete(req)
        .catch((x) => x);
      expect(e).toBeInstanceOf(ProviderError);
      expect(e.code).toBe(code);
      expect(String(e.message)).not.toContain(KEY);
    }
    expect(() => new AnthropicProvider({ apiKey: "", model: "m" })).toThrow("no-api-key");
  });

  it("sends only schemas the API accepts: closed objects, no length or count limits, no type lists", () => {
    const names = coreTools()
      .all()
      .flatMap((t) => Object.keys(t.args));
    const forbidden = (s: unknown, path: string): string[] => {
      if (Array.isArray(s)) return s.flatMap((x, i) => forbidden(x, `${path}[${i}]`));
      if (!s || typeof s !== "object") return [];
      const o = s as Record<string, unknown>;
      const bad: string[] = [];
      for (const k of ["maxLength", "minLength", "maxItems", "minimum", "maximum", "pattern"])
        if (k in o) bad.push(`${path}.${k}`);
      if (Array.isArray(o.type)) bad.push(`${path}.type`);
      if (o.type === "object" && o.additionalProperties !== false) bad.push(`${path} open`);
      return [...bad, ...Object.entries(o).flatMap(([k, v]) => forbidden(v, `${path}.${k}`))];
    };
    for (const [name, schema] of [
      ["plan", planSchema(names)],
      ...Object.entries(READER_SCHEMAS),
    ] as [string, unknown][])
      expect(forbidden(apiSchema(schema), name)).toEqual([]);
  });
});

describe("the agent when the model fails", () => {
  let env: Env;
  afterEach(() => env?.close());
  it("stops the run with a fixed code", async () => {
    env = makeEnv();
    const failing = fakePlanner([]);
    failing.complete = async () => {
      throw new ProviderError("http-500");
    };
    const r = await env.agent(failing).turn({ text: "hola", origin: PERSONAL });
    expect([r.status, r.error]).toEqual(["stopped", "model-http-500"]);
  });
});
