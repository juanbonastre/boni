import Anthropic from "@anthropic-ai/sdk";
import { anthropicCost } from "./models.ts";
import type { CallOptions, ModelProvider, ModelRequest, ModelResponse } from "./providers.ts";

/**
 * The Anthropic provider (docs/nucleo.md, 7.10), on the official SDK, never with tools: the planner
 * only describes a plan and a reader only fills its schema.
 *
 * Readers use structured output (`output_config.format`). The planner does not: the API's
 * structured outputs allow at most 24 optional and 16 union-typed parameters in a schema
 * (documentation, 2026-10-20), and the plan language needs far more. So the planner answers with
 * the plan as JSON text, and `validatePlan` decides as it always did; security never depended on the
 * schema. `apiSchema` reduces a reader's schema to what the API accepts; `checkReaderOutput` checks
 * the answer again anyway.
 *
 * Errors become fixed codes (`http-400`, `refusal`...). The API's own message is kept in `detail`
 * for whoever runs the server or the evaluation, and never goes into a plan, a reply or the log.
 */
export class ProviderError extends Error {
  code: string;
  detail: string;
  constructor(code: string, detail = "") {
    super(code);
    this.code = code;
    this.detail = detail;
  }
}

/** Keywords the structured outputs schemas do not accept. */
const DROP = new Set([
  "maxLength",
  "minLength",
  "maxItems",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "pattern",
]);

/** `schema` in the subset the API accepts: type lists become `anyOf`, objects are closed. */
export function apiSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(apiSchema);
  if (!schema || typeof schema !== "object") return schema;
  const s = schema as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(s)) {
    if (DROP.has(k)) continue;
    if (k === "minItems" && typeof v === "number" && v > 1) continue;
    if (k === "properties" && v && typeof v === "object")
      out[k] = Object.fromEntries(Object.entries(v).map(([n, p]) => [n, apiSchema(p)]));
    else if (k === "additionalProperties") {
      if (v !== false) throw new Error("open objects are not supported by structured outputs");
      out[k] = false;
    } else out[k] = apiSchema(v);
  }
  if (Array.isArray(out.type)) {
    const { type, ...rest } = out;
    return { anyOf: (type as string[]).map((t) => ({ ...rest, type: t })) };
  }
  if (out.type === "object" && !("additionalProperties" in out)) out.additionalProperties = false;
  return out;
}

/** The JSON object in a model's text answer (it may come between code fences or with a line around it). */
export function jsonIn(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) throw new ProviderError("not-json");
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new ProviderError("not-json");
  }
}

export interface AnthropicOptions {
  apiKey: string;
  model: string;
  /** `output_config.effort`; leave it out for models without effort (Haiku 4.5). */
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  /** Server-side fallback when the model declines for policy reasons (`fallbacks: "default"`). */
  fallbacks?: boolean;
  maxRetries?: number;
  timeoutMs?: number;
  /** Tests only: a stand-in for the API. */
  baseURL?: string;
  fetch?: typeof fetch;
}

export class AnthropicProvider implements ModelProvider {
  id = "anthropic";
  privacy = "external-api" as const;
  private o: AnthropicOptions;
  private client: Anthropic;

  constructor(o: AnthropicOptions) {
    if (!o.apiKey) throw new ProviderError("no-api-key");
    this.o = o;
    this.client = new Anthropic({
      apiKey: o.apiKey,
      maxRetries: o.maxRetries ?? 2,
      timeout: o.timeoutMs ?? 300_000,
      ...(o.baseURL ? { baseURL: o.baseURL } : {}),
      ...(o.fetch ? { fetch: o.fetch } : {}),
    });
  }

  async complete(req: ModelRequest, call: CallOptions = {}): Promise<ModelResponse> {
    const structured = req.structured !== false;
    const outputConfig = {
      ...(this.o.effort ? { effort: this.o.effort } : {}),
      ...(structured
        ? {
            format: {
              type: "json_schema" as const,
              schema: apiSchema(req.schema) as Record<string, unknown>,
            },
          }
        : {}),
    };
    const params = {
      model: this.o.model,
      max_tokens: req.maxTokens,
      system: req.system,
      messages: [{ role: "user" as const, content: JSON.stringify(req.input) }],
      ...(Object.keys(outputConfig).length ? { output_config: outputConfig } : {}),
    };
    let res: {
      content: { type: string; text?: string }[];
      stop_reason: string | null;
      usage: { input_tokens: number; output_tokens: number };
      model: string;
    };
    try {
      const options = call.signal ? { signal: call.signal } : undefined;
      res = (this.o.fallbacks
        ? await this.client.beta.messages.create(
            {
              ...params,
              betas: ["server-side-fallback-2026-07-01"],
              fallbacks: "default",
            } as never,
            options,
          )
        : await this.client.messages.create(params as never, options)) as unknown as typeof res;
    } catch (e) {
      if (call.signal?.aborted) throw new ProviderError("aborted");
      if (e instanceof Anthropic.APIConnectionTimeoutError) throw new ProviderError("timeout");
      if (e instanceof Anthropic.APIConnectionError) throw new ProviderError("network");
      if (e instanceof Anthropic.APIError)
        throw new ProviderError(`http-${e.status ?? "error"}`, e.message);
      throw new ProviderError("failed");
    }
    if (res.stop_reason === "max_tokens") throw new ProviderError("max-tokens");
    if (res.stop_reason === "refusal") throw new ProviderError("refusal");
    const text = res.content
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("");
    let json: unknown;
    if (structured)
      try {
        json = JSON.parse(text);
      } catch {
        throw new ProviderError("not-json");
      }
    else json = jsonIn(text);
    return {
      json,
      usage: {
        input: res.usage.input_tokens,
        output: res.usage.output_tokens,
        cost: anthropicCost(res.model, res.usage.input_tokens, res.usage.output_tokens),
      },
      model: res.model,
    };
  }
}
