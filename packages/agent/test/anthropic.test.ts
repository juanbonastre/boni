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

const header = (init: RequestInit | undefined, name: string) =>
  new Headers(init?.headers).get(name);
const bodyOf = (c: Call | undefined) => JSON.parse(String(c?.init.body));

describe("the Anthropic provider", () => {
  it("asks a reader for structured output, with no tools, and reads the JSON", async () => {
    const { calls, f } = stub([() => ok('{"a":"x"}')]);
    const p = new AnthropicProvider({ apiKey: KEY, model: "claude-haiku-4-5", fetch: f });
    const res = await p.complete({ ...req, role: "reader" });
    expect(res).toEqual({
      json: { a: "x" },
      usage: { input: 10, output: 5 },
      model: "claude-opus-5-5",
    });
    expect(calls[0]?.url).toBe("https://api.anthropic.com/v1/messages");
    expect(header(calls[0]?.init, "x-api-key")).toBe(KEY);
    const body = bodyOf(calls[0]);
    expect(body).not.toHaveProperty("tools");
    expect(body.model).toBe("claude-haiku-4-5");
    expect(body.output_config).toEqual({
      format: {
        type: "json_schema",
        schema: {
          type: "object",
          properties: { a: { anyOf: [{ type: "string" }, { type: "null" }] } },
          additionalProperties: false,
        },
      },
    });
    expect(JSON.parse(body.messages[0].content)).toEqual({ request: "hola" });
  });

  it("asks the planner for JSON text, with its effort and the server-side fallback", async () => {
    const { calls, f } = stub([() => ok('Aquí está:\n```json\n{"version":1,"steps":[]}\n```')]);
    const p = new AnthropicProvider({
      apiKey: KEY,
      model: "claude-opus-5-5",
      effort: "medium",
      fallbacks: true,
      fetch: f,
    });
    const res = await p.complete({ ...req, structured: false });
    expect(res.json).toEqual({ version: 1, steps: [] });
    const body = bodyOf(calls[0]);
    expect(body.output_config).toEqual({ effort: "medium" });
    expect(body.fallbacks).toBe("default");
    expect(header(calls[0]?.init, "anthropic-beta")).toContain("server-side-fallback-2026-07-01");
    expect(body).not.toHaveProperty("tools");
  });

  it("retries when the API is busy, and fails with a fixed code that never carries the key", async () => {
    const busy = stub([
      () => new Response("{}", { status: 529, headers: { "retry-after-ms": "1" } }),
      () => ok('{"a":null}'),
    ]);
    expect(
      (
        await new AnthropicProvider({
          apiKey: KEY,
          model: "m",
          fetch: busy.f,
          maxRetries: 1,
        }).complete(req)
      ).json,
    ).toEqual({ a: null });
    expect(busy.calls.length).toBe(2);
    const apiError = (status: number) => () =>
      new Response(
        JSON.stringify({
          type: "error",
          error: { type: "invalid_request_error", message: "schema is too complex" },
        }),
        {
          status,
          headers: { "content-type": "application/json" },
        },
      );
    for (const [answers, code] of [
      [[apiError(400)], "http-400"],
      [[apiError(401)], "http-401"],
      [[() => new Error(`connect ${KEY}`)], "network"],
      [[() => ok("no es json")], "not-json"],
      [[() => ok("{}", { stop_reason: "max_tokens" })], "max-tokens"],
      [[() => ok("{}", { stop_reason: "refusal" })], "refusal"],
    ] as const) {
      const s = stub([...answers]);
      const e = await new AnthropicProvider({ apiKey: KEY, model: "m", fetch: s.f, maxRetries: 0 })
        .complete(req)
        .catch((x) => x);
      expect(e).toBeInstanceOf(ProviderError);
      expect(e.code).toBe(code);
      expect(String(e.message)).not.toContain(KEY);
    }
    // The API's message stays available to whoever runs the server, apart from the code.
    const s = stub([apiError(400)]);
    const e = await new AnthropicProvider({ apiKey: KEY, model: "m", fetch: s.f, maxRetries: 0 })
      .complete(req)
      .catch((x) => x);
    expect(e.detail).toContain("schema is too complex");
    expect(() => new AnthropicProvider({ apiKey: "", model: "m" })).toThrow("no-api-key");
  });

  it("sends only reader schemas the API accepts, within its complexity limits", () => {
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
    // The documented limits: 24 optional parameters and 16 with union types per request.
    const count = (s: unknown): { optional: number; unions: number } => {
      if (Array.isArray(s))
        return s
          .map(count)
          .reduce((a, b) => ({ optional: a.optional + b.optional, unions: a.unions + b.unions }), {
            optional: 0,
            unions: 0,
          });
      if (!s || typeof s !== "object") return { optional: 0, unions: 0 };
      const o = s as Record<string, unknown>;
      let optional = 0;
      let unions = 0;
      if (o.properties && typeof o.properties === "object") {
        const required = new Set((o.required as string[]) ?? []);
        for (const [n, p] of Object.entries(o.properties)) {
          if (!required.has(n)) optional++;
          if (p && typeof p === "object" && "anyOf" in p) unions++;
        }
      }
      const inner = count(Object.values(o));
      return { optional: optional + inner.optional, unions: unions + inner.unions };
    };
    for (const [name, schema] of Object.entries(READER_SCHEMAS)) {
      const api = apiSchema(schema);
      expect(forbidden(api, name)).toEqual([]);
      const c = count(api);
      expect(c.optional, name).toBeLessThanOrEqual(24);
      expect(c.unions, name).toBeLessThanOrEqual(16);
    }
    // The plan's schema is far beyond them: that is why the planner answers with JSON text.
    const names = coreTools()
      .all()
      .flatMap((t) => Object.keys(t.args));
    expect(count(apiSchema(planSchema(names))).unions).toBeGreaterThan(16);
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
