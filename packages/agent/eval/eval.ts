/**
 * A small evaluation with the real models (docs/nucleo.md, 12: outside CI, run by hand with a budget
 * Juan approved). Invented data only. It measures whether the planner makes plans that work; the
 * security does not depend on it (the corpus checks that with the attacker's plans).
 *
 *   ANTHROPIC_API_KEY=... node packages/agent/eval/eval.ts [planner model] [reader model]
 *   OPENROUTER_API_KEY=... node packages/agent/eval/eval.ts [anthropic/claude-haiku-5.5] [deepseek/deepseek-v4.1-flash]
 *
 * `--only=<text>` runs only the requests with that text and `--times=<n>` runs each n times (a failure seen once may be
 * the model's mood): `--only=correos --times=5`. A case not as expected prints how it ended and its plan.
 *
 * With OPENROUTER_API_KEY (and no ANTHROPIC_API_KEY) the models are OpenRouter's (cheaper for trying
 * things; how good a plan is depends on the model, never how safe it is).
 *
 * It prints each request, whether it ended as it should (checked by code: `lib/planner.ts`), and the cost.
 */
import { AnthropicProvider } from "../src/anthropic.ts";
import { OpenAIProvider } from "../src/openai.ts";
import type { ModelProvider } from "../src/providers.ts";
import { evalPlanner } from "./lib/planner.ts";

const key = process.env.ANTHROPIC_API_KEY;
const routerKey = process.env.OPENROUTER_API_KEY;
if (!key && !routerKey) {
  console.error("ANTHROPIC_API_KEY or OPENROUTER_API_KEY is not set");
  process.exit(2);
}
const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const flag = (name: string) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) || undefined;
const plannerModel = args[0] ?? (key ? "claude-opus-5-5" : "anthropic/claude-haiku-5.5");
const readerModel = args[1] ?? (key ? "claude-haiku-4-5" : "deepseek/deepseek-v4.1-flash");
const provider = (model: string, planner: boolean): ModelProvider =>
  key
    ? new AnthropicProvider({
        apiKey: key,
        model,
        ...(planner ? { effort: "medium" as const, fallbacks: true } : {}),
      })
    : new OpenAIProvider({ apiKey: routerKey, model, baseURL: "https://openrouter.ai/api/v1" });

const only = flag("only");
const times = Number(flag("times")) || 1;
const r = await evalPlanner(provider(plannerModel, true), provider(readerModel, false), {
  ...(only ? { only } : {}),
  times,
});
for (const c of r.cases) {
  console.log(`${c.ok ? "ok  " : "FAIL"} ${c.name}${c.note ? ` (${c.note})` : ""}`);
  if (c.detail) console.log(`     ${c.detail}`);
}
console.log(
  `\n${plannerModel}: ${r.right}/${r.total} as expected, ${r.tokens} tokens, $${r.cost.toFixed(4)}`,
);
