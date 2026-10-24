import { checkAnswers, type DecisionQuestion } from "../../src/decider.ts";
import type { ModelProvider } from "../../src/providers.ts";
import { COLLECTIONS, DECIDER_CASES, NAMES } from "./deciderCases.ts";
import type { EvalResult } from "./types.ts";

const QUESTION =
  "Si el destinatario apuntara lo que le pide este correo, ¿en cuál de sus colecciones lo apuntaría? Cada opción lleva ejemplos de lo que ya tiene en ella.";

/**
 * How well a decider chooses a mail's collection, by the agent's own rule (`decideChoice`): the options in both
 * orders, decided only when both agree with confidence ≥ 0.6. Right: decided the expected one; wrong: decided
 * another; otherwise Juan would be asked (neither).
 */
export async function evalDecider(
  p: ModelProvider,
  o: { runs?: number } = {},
): Promise<EvalResult> {
  const runs = o.runs ?? 1;
  const criteria = (names: string[]) =>
    Object.fromEntries(names.map((n) => [n, COLLECTIONS[n] as string]));
  const questions: Record<string, DecisionQuestion> = {
    c: { type: "choice", instructions: QUESTION, criteria: criteria(NAMES) },
    r: { type: "choice", instructions: QUESTION, criteria: criteria([...NAMES].reverse()) },
  };
  const out: EvalResult = { right: 0, total: 0, wrong: 0, cost: 0, tokens: 0, cases: [] };
  for (let i = 0; i < runs; i++)
    for (const c of DECIDER_CASES) {
      if (!c.goes) continue;
      out.total++;
      let note = "";
      let ok = false;
      try {
        const r = await p.complete({
          role: "decider",
          system: "",
          input: { state: c.mail, questions },
          schema: {},
          maxTokens: 0,
        });
        out.tokens += r.usage.input + r.usage.output;
        out.cost += r.usage.cost ?? 0;
        const a = checkAnswers(r.json, questions);
        const x = a?.c;
        const y = a?.r;
        if (x?.type !== "choice" || y?.type !== "choice") note = "invalid answer";
        else if (x.choice !== y.choice || Math.min(x.confidence, y.confidence) < 0.6)
          note = "would ask Juan";
        else if (x.choice === c.goes) ok = true;
        else {
          out.wrong++;
          note = `chose ${x.choice}`;
        }
      } catch (e) {
        note = String((e as { code?: string }).code ?? "failed");
      }
      if (ok) out.right++;
      out.cases.push({ name: c.mail.split("\n")[2]?.replace("Asunto: ", "") ?? "", ok, note });
    }
  return out;
}
