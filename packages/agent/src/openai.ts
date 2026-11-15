import { apiSchema, charged, jsonIn, ProviderError } from "./anthropic.ts";
import type { CallOptions, ModelProvider, ModelRequest, ModelResponse } from "./providers.ts";

/**
 * A provider over the OpenAI-compatible chat API (docs/nucleo.md, 7.10): OpenRouter, OpenAI, and the
 * local or self-hosted servers that speak it (llama.cpp, Ollama, vLLM). No SDK and never with tools,
 * like the Anthropic one: the planner answers with the plan as JSON text (`validatePlan` decides), a
 * reader fills its schema through `response_format` when the model supports it, and the code checks
 * every answer again anyway (`checkReaderOutput`).
 *
 * The planner is asked for a JSON object (`response_format: json_object`, task 132: a model that is not Claude
 * answered «Ponme al día» in prose), never its schema: the plan language is beyond what strict structured outputs
 * take (anthropic.ts). On OpenRouter it is a preference, not a requirement (no `require_parameters`): a route that
 * takes no format is still taken, and the JSON is read from the text as before. A server configured with
 * `readerFormat: "none"` is asked for none, and one that refuses the format (a 400 that names it) is asked again
 * without it, once, and from then on (a refused request is not charged).
 *
 * The address and key are Juan's configuration, not something a request asks for, so this does not go
 * through @boni/net (a local model lives on a private address).
 */
export interface OpenAIOptions {
  apiKey?: string;
  model: string;
  /** e.g. https://openrouter.ai/api/v1, https://api.openai.com/v1, http://127.0.0.1:8080/v1 */
  baseURL: string;
  /**
   * How a reader's schema is asked for: `json_schema` (structured outputs), `json_object` (any JSON,
   * the schema goes in the prompt) or `none` (plain text, the JSON is taken from it).
   */
  readerFormat?: "json_schema" | "json_object" | "none";
  /** Where the data goes: a remote API, or a model on Juan's own machines. */
  privacy?: ModelProvider["privacy"];
  /**
   * OpenRouter only: route only to providers that keep nothing (`provider.zdr`) and collect nothing
   * (`provider.data_collection: "deny"`) (Juan, 2026-10-24: option 1). OpenRouter refuses rather than fall back.
   */
  zdr?: boolean;
  /**
   * OpenRouter only: `off` asks the model not to reason before answering (`reasoning.enabled: false`). A reader
   * reads and fills a schema: a model that reasons by default spent the whole answer on it (task 29: DeepSeek V4.1
   * Flash stopped at 4,000 tokens on four short mails). A model none of whose providers take it is asked without.
   */
  reasoning?: "off";
  timeoutMs?: number;
  /** Tests only: a stand-in for the API. */
  fetch?: typeof fetch;
}

const OPENROUTER = /(^|\.)openrouter\.ai$/;

export class OpenAIProvider implements ModelProvider {
  id: string;
  privacy: ModelProvider["privacy"];
  private o: OpenAIOptions;
  /** Learned: no provider of this model takes `reasoning`, so it is not asked for again. */
  private noReasoning = false;
  /** Learned: this server refused the planner's `json_object`, so the planner is asked with no format. */
  private noPlannerFormat = false;

  constructor(o: OpenAIOptions) {
    const url = new URL(o.baseURL);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (!o.apiKey && !local) throw new ProviderError("no-api-key");
    this.o = o;
    this.id = OPENROUTER.test(url.hostname) ? "openrouter" : local ? "local" : "openai";
    this.privacy = o.privacy ?? (local ? "local" : "external-api");
  }

  async complete(req: ModelRequest, call: CallOptions = {}): Promise<ModelResponse> {
    // The planner (`structured: false`): a JSON object, as a preference. A reader: its schema, as configured.
    const planner = req.structured === false;
    const format = planner
      ? this.o.readerFormat === "none" || this.noPlannerFormat
        ? "none"
        : "json_object"
      : (this.o.readerFormat ?? "json_schema");
    const system =
      format === "json_object" && !planner
        ? `${req.system}\n\nAnswer with one JSON object that follows this JSON Schema:\n${JSON.stringify(req.schema)}`
        : req.system;
    const body: Record<string, unknown> = {
      model: this.o.model,
      max_tokens: req.maxTokens,
      messages: [
        { role: "system", content: system },
        // A reader shown images (A-24): each as a data URL before its input, as OpenAI-compatible APIs take them.
        {
          role: "user",
          content: req.images?.length
            ? [
                ...req.images.map((i) => ({
                  type: "image_url",
                  image_url: { url: `data:${i.mime};base64,${i.data}` },
                })),
                { type: "text", text: JSON.stringify(req.input) },
              ]
            : JSON.stringify(req.input),
        },
      ],
      ...(format === "json_schema"
        ? {
            response_format: {
              type: "json_schema",
              json_schema: { name: req.role, strict: true, schema: apiSchema(req.schema) },
            },
          }
        : format === "json_object"
          ? { response_format: { type: "json_object" } }
          : {}),
      ...(this.id === "openrouter" && this.o.reasoning === "off" && !this.noReasoning
        ? { reasoning: { enabled: false } }
        : {}),
      // OpenRouter: only to a provider that honours a reader's format, and (zdr) keeps nothing.
      ...(this.id === "openrouter" && ((format !== "none" && !planner) || this.o.zdr)
        ? {
            provider: {
              ...(format !== "none" && !planner ? { require_parameters: true } : {}),
              ...(this.o.zdr ? { zdr: true, data_collection: "deny" } : {}),
            },
          }
        : {}),
    };
    let res: Response;
    try {
      res = await (this.o.fetch ?? fetch)(
        `${this.o.baseURL.replace(/\/+$/, "")}/chat/completions`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(this.o.apiKey ? { authorization: `Bearer ${this.o.apiKey}` } : {}),
          },
          body: JSON.stringify(body),
          signal: call.signal
            ? AbortSignal.any([AbortSignal.timeout(this.o.timeoutMs ?? 300_000), call.signal])
            : AbortSignal.timeout(this.o.timeoutMs ?? 300_000),
        },
      );
    } catch (e) {
      if (call.signal?.aborted) throw new ProviderError("aborted");
      const name = (e as { name?: string }).name;
      throw new ProviderError(name === "TimeoutError" ? "timeout" : "network");
    }
    const text = await res.text();
    // OpenRouter routes only to providers that take every parameter asked for: none takes `reasoning`, ask without.
    if (
      res.status === 404 &&
      "reasoning" in body &&
      /support all parameters|no endpoints/i.test(text)
    ) {
      this.noReasoning = true;
      return this.complete(req, call);
    }
    // A server that does not take the planner's format (task 132): asked again without it, and never again with it.
    if (
      planner &&
      format === "json_object" &&
      (res.status === 400 || res.status === 422) &&
      /response_format|json_object|not supported|unsupported/i.test(text)
    ) {
      this.noPlannerFormat = true;
      return this.complete(req, call);
    }
    if (!res.ok) throw new ProviderError(`http-${res.status}`, text.slice(0, 500));
    let data: {
      choices?: {
        message?: { content?: string | null; refusal?: string | null };
        finish_reason?: string;
      }[];
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        cost?: number;
        completion_tokens_details?: { reasoning_tokens?: number };
      };
      model?: string;
      error?: { message?: string };
    };
    try {
      data = JSON.parse(text);
    } catch {
      // The provider's body, not the model's answer (task 132): the evaluation says it under «Proveedor».
      throw new ProviderError("bad-body", text.slice(0, 500));
    }
    // OpenRouter can answer 200 with an error from the provider it routed to.
    if (data.error)
      throw new ProviderError("failed", String(data.error.message ?? "").slice(0, 500));
    const choice = data.choices?.[0];
    if (choice?.finish_reason === "length") {
      // How many tokens it wrote, and how many of them went to reasoning: numbers, never what it said.
      const e = new ProviderError("max-tokens");
      e.tokens = {
        output: data.usage?.completion_tokens ?? 0,
        reasoning: data.usage?.completion_tokens_details?.reasoning_tokens ?? 0,
      };
      throw e;
    }
    if (choice?.message?.refusal) throw new ProviderError("refusal");
    const content = choice?.message?.content ?? "";
    const usage = {
      input: data.usage?.prompt_tokens ?? 0,
      output: data.usage?.completion_tokens ?? 0,
      // OpenRouter says what it charged (credits = dollars).
      ...(typeof data.usage?.cost === "number" && Number.isFinite(data.usage.cost)
        ? { cost: data.usage.cost }
        : {}),
    };
    let json: unknown;
    try {
      // A reader's as before; the planner's JSON object read whole first, like a reader's schema.
      if (format !== "json_schema" && !planner) json = jsonIn(content);
      else
        try {
          json = JSON.parse(content);
        } catch {
          json = jsonIn(content);
        }
    } catch (e) {
      // Charged all the same: the journal counts it (task 132).
      throw e instanceof ProviderError ? charged(e, usage) : e;
    }
    return { json, usage, model: data.model ?? this.o.model };
  }
}
