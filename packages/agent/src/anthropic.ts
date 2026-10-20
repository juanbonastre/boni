import type { ModelProvider, ModelRequest, ModelResponse } from "./providers.ts";

/**
 * The Anthropic provider (docs/nucleo.md, 7.10): the Messages API with structured output
 * (`output_config.format`, a JSON schema), never with tools: the planner only describes a plan and a
 * reader only fills its schema. No SDK (one dependency less in the server): a POST to the official
 * host and nothing else. The key is only sent in its header and never appears in an error.
 *
 * What the API's schemas do not support is removed here (`apiSchema`); the code checks every answer
 * again anyway (`validatePlan`, `checkReaderOutput`), so a looser schema only guides the model.
 * Checked against the structured outputs documentation on 2026-10-20; retention, zero data retention
 * and an EU region for this account remain UNVERIFIED (nucleo.md, 14).
 */
export class ProviderError extends Error {
  code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
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

export interface AnthropicOptions {
  apiKey: string;
  model: string;
  /** Tests only: a local stand-in for the API. */
  baseUrl?: string;
  timeoutMs?: number;
  retries?: number;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

const API = "https://api.anthropic.com";

export class AnthropicProvider implements ModelProvider {
  id = "anthropic";
  privacy = "external-api" as const;
  private o: AnthropicOptions;
  constructor(o: AnthropicOptions) {
    if (!o.apiKey) throw new ProviderError("no-api-key");
    this.o = o;
  }

  async complete(req: ModelRequest): Promise<ModelResponse> {
    const body = JSON.stringify({
      model: this.o.model,
      max_tokens: req.maxTokens,
      system: req.system,
      messages: [{ role: "user", content: JSON.stringify(req.input) }],
      output_config: { format: { type: "json_schema", schema: apiSchema(req.schema) } },
    });
    const doFetch = this.o.fetch ?? fetch;
    const sleep = this.o.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
    const retries = this.o.retries ?? 2;
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await doFetch(`${this.o.baseUrl ?? API}/v1/messages`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": this.o.apiKey,
            "anthropic-version": "2023-06-01",
          },
          body,
          signal: AbortSignal.timeout(this.o.timeoutMs ?? 120_000),
          redirect: "error",
        });
      } catch {
        if (attempt < retries) {
          await sleep(1000 * 2 ** attempt);
          continue;
        }
        throw new ProviderError("network");
      }
      // Too busy or failing on their side: try again a little later; anything else is final.
      if ((res.status === 429 || res.status === 529 || res.status >= 500) && attempt < retries) {
        await res.body?.cancel();
        await sleep(1000 * 2 ** attempt);
        continue;
      }
      if (!res.ok) {
        await res.body?.cancel();
        throw new ProviderError(`http-${res.status}`);
      }
      let data: {
        content?: { type: string; text?: string }[];
        stop_reason?: string;
        usage?: { input_tokens?: number; output_tokens?: number };
        model?: string;
      };
      try {
        data = (await res.json()) as typeof data;
      } catch {
        throw new ProviderError("bad-response");
      }
      if (data.stop_reason === "max_tokens") throw new ProviderError("max-tokens");
      if (data.stop_reason === "refusal") throw new ProviderError("refusal");
      const text = (data.content ?? [])
        .filter((b) => b.type === "text")
        .map((b) => b.text ?? "")
        .join("");
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        throw new ProviderError("not-json");
      }
      return {
        json,
        usage: { input: data.usage?.input_tokens ?? 0, output: data.usage?.output_tokens ?? 0 },
        model: data.model ?? this.o.model,
      };
    }
  }
}
