/**
 * A small evaluation with the real models (docs/nucleo.md, 12: outside CI, run by hand with a budget
 * Juan approved). Invented data only. It measures whether the planner makes plans that work, and apart how its
 * answers are shown (a list for several mails, a chart for numbers to compare); the security does not depend on it
 * (the corpus checks that with the attacker's plans).
 *
 *   ANTHROPIC_API_KEY=... node packages/agent/eval/eval.ts [planner models] [reader model]
 *   OPENROUTER_API_KEY=... node packages/agent/eval/eval.ts [anthropic/claude-haiku-5.5] [deepseek/deepseek-v4.1-flash]
 *
 * Several planner models, separated by commas, are compared side by side:
 * `anthropic/claude-haiku-5.5,anthropic/claude-sonnet-5.5,google/gemini-3-flash`. `--prompt=<file>[,<file>]` adds
 * other planner prompts to compare with today's («base»): each model runs with each prompt. `--only=<text>` runs only
 * the requests with that text and `--times=<n>` runs each n times (a failure seen once may be the model's mood). A
 * case not as expected prints how it ended and its plan.
 *
 * With OPENROUTER_API_KEY (and no ANTHROPIC_API_KEY) the models are OpenRouter's (cheaper for trying
 * things, and any vendor's; how good a plan is depends on the model, never how safe it is).
 */
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { AnthropicProvider } from "../src/anthropic.ts";
import { OpenAIProvider } from "../src/openai.ts";
import type { ModelProvider } from "../src/providers.ts";
import { evalPlanner } from "./lib/planner.ts";
import type { EvalResult } from "./lib/types.ts";

const key = process.env.ANTHROPIC_API_KEY;
const routerKey = process.env.OPENROUTER_API_KEY;
if (!key && !routerKey) {
  console.error("ANTHROPIC_API_KEY or OPENROUTER_API_KEY is not set");
  process.exit(2);
}
const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const flag = (name: string) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) || undefined;
const models = (args[0] ?? (key ? "claude-opus-5-5" : "anthropic/claude-haiku-5.5"))
  .split(",")
  .map((m) => m.trim())
  .filter(Boolean);
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
const prompts: { name: string; text?: string }[] = [
  { name: "base" },
  ...(flag("prompt") ?? "")
    .split(",")
    .filter(Boolean)
    .map((f) => ({ name: basename(f).replace(/\.[^.]+$/, ""), text: readFileSync(f, "utf8") })),
];

// Each column a model with a prompt, run one after another (the same cases for all).
const columns: { name: string; r: EvalResult; seconds: number }[] = [];
for (const model of models)
  for (const prompt of prompts) {
    const name = prompts.length > 1 ? `${model} · ${prompt.name}` : model;
    console.error(`… ${name}`);
    const t0 = Date.now();
    const r = await evalPlanner(provider(model, true), provider(readerModel, false), {
      ...(only ? { only } : {}),
      times,
      ...(prompt.text ? { plannerPrompt: prompt.text } : {}),
    });
    columns.push({ name, r, seconds: Math.round((Date.now() - t0) / 1000) });
  }

const mark = (c: EvalResult["cases"][number] | undefined) =>
  !c ? "" : !c.ok ? `FAIL (${c.note})` : c.format ? `ok, ${c.format}` : "ok";
if (columns.length === 1) {
  const { name, r, seconds } = columns[0] as (typeof columns)[number];
  for (const c of r.cases) {
    console.log(`${c.ok ? "ok  " : "FAIL"} ${c.name}${c.note ? ` (${c.note})` : ""}`);
    if (c.detail) console.log(`     ${c.detail}`);
    if (c.format) console.log(`     shown: ${c.format}`);
  }
  console.log(
    `\n${name}: ${r.right}/${r.total} as expected, ${r.shown}/${r.total} well shown, ${r.tokens} tokens, $${r.cost.toFixed(4)}, ${seconds} s`,
  );
} else {
  // A table in Markdown: a row per case, a column per model and prompt, and at the foot what each got.
  const rows = columns[0]?.r.cases.map((c) => c.name) ?? [];
  const line = (cells: string[]) => `| ${cells.join(" | ")} |`;
  console.log(line(["", ...columns.map((c) => c.name)]));
  console.log(line(["---", ...columns.map(() => "---")]));
  rows.forEach((name, i) => {
    console.log(line([name, ...columns.map((c) => mark(c.r.cases[i]))]));
  });
  console.log(line(["**As expected**", ...columns.map((c) => `${c.r.right}/${c.r.total}`)]));
  console.log(line(["**Well shown**", ...columns.map((c) => `${c.r.shown}/${c.r.total}`)]));
  console.log(line(["**Cost**", ...columns.map((c) => `$${c.r.cost.toFixed(4)}`)]));
  console.log(line(["**Tokens**", ...columns.map((c) => String(c.r.tokens))]));
  console.log(line(["**Time**", ...columns.map((c) => `${c.seconds} s`)]));
  // How each failure ended, to know why.
  for (const c of columns)
    for (const x of c.r.cases.filter((x) => x.detail))
      console.log(`\n${c.name}: ${x.name}\n     ${x.detail}`);
}
