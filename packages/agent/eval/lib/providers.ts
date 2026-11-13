/**
 * How the hand-run evaluations call a model: with ANTHROPIC_API_KEY, Anthropic's; with OPENROUTER_API_KEY alone,
 * OpenRouter's (cheaper for trying things, and any vendor's; how good a plan is depends on the model, never how safe
 * it is).
 */

import { AnthropicProvider } from "../../src/anthropic.ts";
import { OpenAIProvider } from "../../src/openai.ts";
import type { ModelProvider } from "../../src/providers.ts";

export interface EvalKeys {
  anthropic?: string;
  router?: string;
}

/** The keys in the environment: Anthropic's first; null when neither is set. */
export function evalKeys(env: NodeJS.ProcessEnv = process.env): EvalKeys | null {
  const anthropic = env.ANTHROPIC_API_KEY;
  const router = env.OPENROUTER_API_KEY;
  if (anthropic) return { anthropic };
  return router ? { router } : null;
}

/** A planner reasons (medium effort, with its fallbacks); a reader answers without reasoning first (task 29). */
export function evalProvider(keys: EvalKeys, model: string, planner: boolean): ModelProvider {
  return keys.anthropic
    ? new AnthropicProvider({
        apiKey: keys.anthropic,
        model,
        ...(planner ? { effort: "medium" as const, fallbacks: true } : {}),
      })
    : new OpenAIProvider({
        apiKey: keys.router,
        model,
        baseURL: "https://openrouter.ai/api/v1",
        ...(planner ? {} : { reasoning: "off" as const }),
      });
}
