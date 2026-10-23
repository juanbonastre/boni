import type { ModelProvider, ModelRequest, ModelResponse } from "./providers.ts";

/**
 * The `decider` role (docs/extensiones.md 9): a decision model such as TypeSafe's Jev ("System One") answers
 * typed questions about a text: a choice among options the code wrote, with its confidence, or the
 * probability that a yes/no question is true. It never writes text, so whatever it reads (someone else's mail)
 * can at most move it to another of the code's own options; the code checks every answer again and decides
 * with thresholds. Measured on invented mail (`eval/decide.ts`, 2026-10-21): it chooses a collection as well as
 * Haiku 4.5, for about a 25th of the price, and its confidence tells right from wrong.
 */
export type DecisionQuestion =
  | { type: "choice"; instructions: string; criteria: Record<string, string> }
  | { type: "noul"; instructions: string };
export interface DecisionInput {
  state: string;
  questions: Record<string, DecisionQuestion>;
}
export type DecisionAnswer =
  | { type: "choice"; choice: string; confidence: number }
  | { type: "noul"; noul: number };
export type DecisionAnswers = Record<string, DecisionAnswer>;

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const unit = (v: unknown): v is number => typeof v === "number" && v >= 0 && v <= 1;

/** The answers checked against the questions asked: every one, of its type, a choice among its criteria. */
export function checkAnswers(out: unknown, questions: DecisionInput["questions"]) {
  if (!isObj(out)) return null;
  const answers: DecisionAnswers = {};
  for (const [name, q] of Object.entries(questions)) {
    const a = out[name];
    if (!isObj(a)) return null;
    if (q.type === "choice") {
      if (typeof a.choice !== "string" || !Object.hasOwn(q.criteria, a.choice)) return null;
      answers[name] = {
        type: "choice",
        choice: a.choice,
        confidence: unit(a.confidence) ? a.confidence : 0,
      };
    } else {
      if (!unit(a.noul)) return null;
      answers[name] = { type: "noul", noul: a.noul };
    }
  }
  return answers;
}

/**
 * Jev, straight from TypeSafe (`via: "typesafe"`, `POST /v1/systemone`) or through OpenRouter's decisions
 * endpoint (`via: "openrouter"`, the way it was measured). The request is `{ state, questions }` in
 * `ModelRequest.input` (system and schema are not used: the questions are the schema); the answer is the
 * checked answers by question name. Output tokens are free; only the input is counted.
 */
export class JevProvider implements ModelProvider {
  id: string;
  privacy = "external-api" as const;
  private url: string;
  private model: string;
  private key: string;
  private fetch: typeof fetch;
  constructor(o: {
    apiKey: string;
    via: "typesafe" | "openrouter";
    model?: string;
    fetch?: typeof fetch;
  }) {
    this.key = o.apiKey;
    this.id = o.via === "typesafe" ? "typesafe" : "openrouter";
    this.url =
      o.via === "typesafe"
        ? "https://api.typesafe.ai/v1/systemone"
        : "https://openrouter.ai/api/alpha/decisions";
    this.model = o.model ?? (o.via === "typesafe" ? "jev-1.14.0" : "typesafe/jev-1.14");
    this.fetch = o.fetch ?? fetch;
  }
  async complete(req: ModelRequest): Promise<ModelResponse> {
    const input = req.input as DecisionInput;
    const r = await this.fetch(this.url, {
      method: "POST",
      headers: { authorization: `Bearer ${this.key}`, "content-type": "application/json" },
      body: JSON.stringify({ model: this.model, state: input.state, questions: input.questions }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!r.ok) throw Object.assign(new Error("decider"), { code: `http-${r.status}` });
    const b = (await r.json()) as {
      answers?: unknown;
      model?: unknown;
      usage?: { input_tokens?: unknown; prompt_tokens?: unknown };
    };
    const answers = checkAnswers(b.answers, input.questions);
    if (!answers) throw Object.assign(new Error("decider"), { code: "bad-answer" });
    const tokens = Number(b.usage?.input_tokens ?? b.usage?.prompt_tokens);
    return {
      json: answers,
      usage: {
        input: Number.isFinite(tokens) ? tokens : Math.ceil(input.state.length / 4),
        output: 0,
      },
      model: typeof b.model === "string" ? b.model.slice(0, 80) : this.model,
    };
  }
}
