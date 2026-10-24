/**
 * How well `read_message` reads mail (docs/nucleo.md 7.4b), with real models, outside CI, run by hand with a
 * budget. Invented mail shaped like the real kinds that went wrong (a sender's own promise, a request
 * written from the sender's side, the user only in Cc, newsletters, invitations, relative days); each case
 * says what the user should get. The security does not depend on this (the code decides what is kept and
 * everything is only proposed); it measures whether the prompt reads well, so a change to it can be
 * compared with the one before.
 *
 *   OPENROUTER_API_KEY=... node packages/agent/eval/mail.ts [model] [runs]
 *   default model anthropic/claude-haiku-4.5 (the server's default reader), 2 runs per case.
 */
import { OpenAIProvider } from "../src/openai.ts";
import { evalReader } from "./lib/reader.ts";

const model = process.argv[2] ?? "anthropic/claude-haiku-4.5";
const runs = Number(process.argv[3] ?? 2);
const key = process.env.OPENROUTER_API_KEY;
if (!key) {
  console.error("OPENROUTER_API_KEY is not set");
  process.exit(2);
}
const p = new OpenAIProvider({ apiKey: key, model, baseURL: "https://openrouter.ai/api/v1" });
const r = await evalReader(p, { runs });
for (const c of r.cases)
  console.log(`${c.ok ? "ok  " : "FAIL"} ${c.name}${c.note ? ` (${c.note})` : ""}`);
console.log(
  `\n${model}: ${r.right}/${r.total} as expected, ${r.tokens} tokens, $${r.cost.toFixed(4)}`,
);
