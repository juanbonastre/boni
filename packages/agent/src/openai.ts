import { apiSchema, jsonIn, ProviderError } from "./anthropic.ts";
import type { CallOptions, ModelProvider, ModelRequest, ModelResponse } from "./providers.ts";

/**
 * A provider over the OpenAI-compatible chat API (docs/nucleo.md, 7.10): OpenRouter, OpenAI, and the
 * local or self-hosted servers that speak it (llama.cpp, Ollama, vLLM). No SDK and never with tools,
 * like the Anthropic one: the planner answers with the plan as JSON text (`validatePlan` decides), a
 * reader fills its schema through `response_format` when the model supports it, and the code checks
 * every answer again anyway (`checkReaderOutput`).
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
  timeoutMs?: number;
  /** Tests only: a stand-in for the API. */
  fetch?: typeof fetch;
}

const OPENROUTER = /(^|\.)openrouter\.ai$/;

export class OpenAIProvider implements ModelProvider {
  id: string;
  privacy: ModelProvider["privacy"];
  private o: OpenAIOptions;

  constructor(o: OpenAIOptions) {
    const url = new URL(o.baseURL);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (!o.apiKey && !local) throw new ProviderError("no-api-key");
    this.o = o;
    this.id = OPENROUTER.test(url.hostname) ? "openrouter" : local ? "local" : "openai";
    this.privacy = o.privacy ?? (local ? "local" : "external-api");
  }

  async complete(req: ModelRequest, call: CallOptions = {}): Promise<ModelResponse> {
    const format = req.structured === false ? "none" : (this.o.readerFormat ?? "json_schema");
    const system =
      format === "json_object"
        ? `${req.system}\n\nAnswer with one JSON object that follows this JSON Schema:\n${JSON.stringify(req.schema)}`
        : req.system;
    const body: Record<string, unknown> = {
      model: this.o.model,
      max_tokens: req.maxTokens,
      messages: [
        { role: "system", content: system },
        { role: "user", content: JSON.stringify(req.input) },
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
      // OpenRouter: only to a provider that honours the format asked for, and (zdr) keeps nothing.
      ...(this.id === "openrouter" && (format !== "none" || this.o.zdr)
        ? {
            provider: {
              ...(format !== "none" ? { require_parameters: true } : {}),
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
    if (!res.ok) throw new ProviderError(`http-${res.status}`, text.slice(0, 500));
    let data: {
      choices?: {
        message?: { content?: string | null; refusal?: string | null };
        finish_reason?: string;
      }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
      model?: string;
      error?: { message?: string };
    };
    try {
      data = JSON.parse(text);
    } catch {
      throw new ProviderError("not-json", text.slice(0, 500));
    }
    // OpenRouter can answer 200 with an error from the provider it routed to.
    if (data.error)
      throw new ProviderError("failed", String(data.error.message ?? "").slice(0, 500));
    const choice = data.choices?.[0];
    if (choice?.finish_reason === "length") throw new ProviderError("max-tokens");
    if (choice?.message?.refusal) throw new ProviderError("refusal");
    const content = choice?.message?.content ?? "";
    let json: unknown;
    if (format === "json_schema")
      try {
        json = JSON.parse(content);
      } catch {
        json = jsonIn(content);
      }
    else json = jsonIn(content);
    return {
      json,
      usage: {
        input: data.usage?.prompt_tokens ?? 0,
        output: data.usage?.completion_tokens ?? 0,
        // OpenRouter says what it charged (credits = dollars).
        ...(typeof data.usage?.cost === "number" && Number.isFinite(data.usage.cost)
          ? { cost: data.usage.cost }
          : {}),
      },
      model: data.model ?? this.o.model,
    };
  }
}
