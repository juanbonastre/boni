import Anthropic from "@anthropic-ai/sdk";
import { anthropicCost } from "./models.ts";
import type {
  CallOptions,
  ModelProvider,
  ModelRequest,
  ModelResponse,
  Usage,
} from "./providers.ts";

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
 * Errors become fixed codes (`refusedCode`, `refusal`...). The API's own message is kept in `detail`
 * for whoever runs the server or the evaluation, and never goes into a plan, a reply or the log.
 */
export class ProviderError extends Error {
  code: string;
  detail: string;
  /** When it ran out of room: how many tokens it wrote, and how many went to reasoning (numbers only). */
  tokens?: { output: number; reasoning: number };
  /**
   * An answer that came back and was charged but could not be read (`not-json`): what it cost, so the journal and the
   * month's spending count it like any call (task 132). Numbers only.
   */
  usage?: Usage;
  constructor(code: string, detail = "") {
    super(code);
    this.code = code;
    this.detail = detail;
  }
}

/**
 * Why the API refused a call, as a fixed code from a closed list (task 124: the run said `http-400` and nothing
 * more, though a 400 can be an account that cannot pay, a request too long or an option the API does not take).
 * The status and the error's type decide where they can (the API's documentation, 2026-11-15: 401 authentication,
 * 402 billing, 403 permission, 404 not found, 413 too large, 429 rate limit, 500 api, 504 timeout, 529 overloaded);
 * a 400 `invalid_request_error` covers several causes (a spend limit reached among them), so its message is matched
 * against fixed patterns here, by code, and only the code goes on: the message is text from outside. Anything
 * else is `http-<status>-<type>`, the type without `_error`.
 *
 * A spend limit is decided before the status, because it comes as a 400 (a limit the account set: «You have reached
 * your specified [workspace] API usage limits…») or as a 429 (the tier's monthly limit: «You have reached your API
 * usage limits…», with `details.error_code` `enforced_spend_limit_reached`), and it does not pass by trying again in
 * a moment as a rate limit does (the API's rate-limits page, 2026-11-15). Used-up credit is «Your credit balance is
 * too low…» in a 400 (public reports; the docs do not quote it) or a 402.
 */
export function refusedCode(
  status: number | undefined,
  type: string | null | undefined,
  message: string,
  /** The error's `details.error_code`, when the API gives one. */
  errorCode?: string | null,
): string {
  const m = message.slice(0, 2000);
  if (status === 402 || type === "billing_error" || /credit balance|purchase credits/i.test(m))
    return "no-credit";
  if (
    errorCode === "enforced_spend_limit_reached" ||
    /\busage limits?\b|\bspend(?:ing)? (?:limit|cap)\b/i.test(m)
  )
    return "spend-limit";
  if (status === 401 || type === "authentication_error") return "bad-key";
  if (status === 403 || type === "permission_error") return "forbidden";
  if (status === 404 || type === "not_found_error") return "no-model";
  if (
    status === 413 ||
    type === "request_too_large" ||
    /prompt is too long|input is too long|too many (?:input )?tokens|context window/i.test(m)
  )
    return "too-long";
  if (status === 429 || type === "rate_limit_error") return "rate-limit";
  if (status === 529 || type === "overloaded_error") return "overloaded";
  if (status === 504 || type === "timeout_error") return "timeout";
  if (status === 500 || type === "api_error") return "server-error";
  if (
    status === 400 &&
    /not supported|does not support|not permitted|unexpected value|extra inputs|unknown (?:parameter|field)/i.test(
      m,
    )
  )
    return "bad-option";
  const kind = (type ?? "")
    .toLowerCase()
    .replace(/_error$/, "")
    .replace(/_/g, "-")
    .replace(/[^a-z-]/g, "")
    .slice(0, 16);
  return `http-${status ?? "error"}${kind ? `-${kind}` : ""}`;
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

/** `e` with what its answer cost (an answer that came back but could not be read is paid for all the same). */
export function charged(e: ProviderError, usage: Usage): ProviderError {
  e.usage = usage;
  return e;
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
      // A reader shown images (a photo Juan dropped, A-24) gets them before its input, as the API's image blocks.
      messages: [
        {
          role: "user" as const,
          content: req.images?.length
            ? [
                ...req.images.map((i) => ({
                  type: "image" as const,
                  source: { type: "base64" as const, media_type: i.mime, data: i.data },
                })),
                { type: "text" as const, text: JSON.stringify(req.input) },
              ]
            : JSON.stringify(req.input),
        },
      ],
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
      if (e instanceof Anthropic.APIError) {
        const body = (
          e.error as
            | { error?: { type?: unknown; message?: unknown; details?: { error_code?: unknown } } }
            | undefined
        )?.error;
        const type = typeof body?.type === "string" ? body.type : (e.type ?? null);
        const message = typeof body?.message === "string" ? body.message : e.message;
        const errorCode =
          typeof body?.details?.error_code === "string" ? body.details.error_code : null;
        throw new ProviderError(refusedCode(e.status, type, message, errorCode), e.message);
      }
      throw new ProviderError("failed");
    }
    if (res.stop_reason === "max_tokens") throw new ProviderError("max-tokens");
    if (res.stop_reason === "refusal") throw new ProviderError("refusal");
    const text = res.content
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("");
    const usage = {
      input: res.usage.input_tokens,
      output: res.usage.output_tokens,
      cost: anthropicCost(res.model, res.usage.input_tokens, res.usage.output_tokens),
    };
    let json: unknown;
    try {
      json = structured ? JSON.parse(text) : jsonIn(text);
    } catch {
      throw charged(new ProviderError("not-json"), usage);
    }
    return { json, usage, model: res.model };
  }
}
