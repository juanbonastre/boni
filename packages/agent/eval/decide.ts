/**
 * Would a decision model (TypeSafe's Jev, a "System One" model: typed choices with probabilities and a
 * confidence, no generated text) do the mail pipeline's decisions better or cheaper than the reader we use?
 * Invented mail in Spanish shaped like Juan's, outside CI, run by hand (docs/extensiones.md 9, role
 * "decider"). Two decisions:
 * - the collection a mail's tasks go to (today `classify` with Haiku 4.5): accuracy, and whether the
 *   confidence tells right from wrong (so the code could ask Juan when it is low);
 * - a gate before the expensive reading: "does this mail ask anything of the recipient?" (reads saved,
 *   requests missed).
 * Jev goes through OpenRouter's decisions endpoint; the option order is also reversed to see if the answer
 * holds (a weakness TypeSafe documents).
 *
 *   OPENROUTER_API_KEY=... node packages/agent/eval/decide.ts [runs]
 */
import { OpenAIProvider } from "../src/openai.ts";
import { checkReaderOutput, delimit, READER_PROMPTS, READER_SCHEMAS } from "../src/readers.ts";
import { DECIDER_CASES as CASES, COLLECTIONS, NAMES, option } from "./lib/deciderCases.ts";

const key = process.env.OPENROUTER_API_KEY;
if (!key) {
  console.error("OPENROUTER_API_KEY is not set");
  process.exit(2);
}
const runs = Number(process.argv[2] ?? 1);

async function jev(state: string, names: string[]) {
  const r = await fetch("https://openrouter.ai/api/alpha/decisions", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: "typesafe/jev-1.14",
      state,
      questions: {
        asks: {
          type: "noul",
          instructions:
            "¿Pide este correo algo concreto a su destinatario (hacer algo, contestar, decidir, asistir a algo con él)? Un boletín, una oferta, un anuncio para muchos o algo que hará el remitente no cuentan.",
        },
        goes: {
          type: "choice",
          instructions:
            "Si el destinatario apuntara lo que le pide este correo, ¿en cuál de sus colecciones lo apuntaría? Cada opción lleva ejemplos de lo que ya tiene en ella.",
          criteria: Object.fromEntries(names.map((n) => [n, COLLECTIONS[n] as string])),
        },
      },
    }),
  });
  const b = (await r.json()) as {
    answers?: { asks: { noul: number }; goes: { choice: string; confidence: number } };
    usage?: { cost: number };
    error?: unknown;
  };
  if (!b.answers) throw new Error(JSON.stringify(b.error ?? b).slice(0, 200));
  return {
    asks: b.answers.asks.noul,
    goes: b.answers.goes.choice,
    conf: b.answers.goes.confidence,
    cost: b.usage?.cost ?? 0,
  };
}

const haiku = new OpenAIProvider({
  apiKey: key,
  model: "anthropic/claude-haiku-4.5",
  baseURL: "https://openrouter.ai/api/v1",
});
async function classify(state: string) {
  const { marker, text } = delimit(state);
  const options = NAMES.map(option);
  const r = await haiku.complete({
    role: "reader",
    system: READER_PROMPTS.classify,
    input: {
      marker,
      content: text,
      options,
      question:
        "¿En cuál de estas colecciones apuntaría el destinatario lo que este mensaje le pide hacer o a lo que tiene que ir?",
    },
    schema: READER_SCHEMAS.classify,
    maxTokens: 1000,
  });
  const c = checkReaderOutput("classify", r.json, options) as { choice: string } | null;
  return {
    goes: c ? (NAMES.find((n) => c.choice.startsWith(n)) ?? "?") : "?",
    tokens: r.usage.input + r.usage.output,
  };
}

let jevRight = 0,
  haikuRight = 0,
  flips = 0,
  judged = 0,
  cost = 0,
  haikuTokens = 0;
const conf: { right: boolean; conf: number }[] = [];
const gate: { asks: boolean; p: number }[] = [];
for (let run = 0; run < runs; run++)
  for (const c of CASES) {
    const j = await jev(c.mail, NAMES);
    const back = await jev(c.mail, [...NAMES].reverse());
    cost += j.cost + back.cost;
    gate.push({ asks: c.asks, p: j.asks });
    if (!c.goes) continue;
    judged++;
    const h = await classify(c.mail);
    haikuTokens += h.tokens;
    if (j.goes === c.goes) jevRight++;
    if (h.goes === c.goes) haikuRight++;
    if (back.goes !== j.goes) flips++;
    conf.push({ right: j.goes === c.goes, conf: j.conf });
    console.log(
      `${c.goes.padEnd(9)} jev ${j.goes.padEnd(9)} ${j.conf.toFixed(2)} | reversed ${back.goes.padEnd(9)} | haiku ${h.goes}`,
    );
  }

console.log(
  `\nCollection (${judged} mails that ask something): Jev ${jevRight}/${judged}, Haiku 4.5 ${haikuRight}/${judged}; Jev changed its answer with the options reversed ${flips} times`,
);
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
console.log(
  `Jev confidence: right ${avg(conf.filter((c) => c.right).map((c) => c.conf)).toFixed(2)}, wrong ${avg(conf.filter((c) => !c.right).map((c) => c.conf)).toFixed(2)}`,
);
for (const th of [0.6, 0.8, 0.9]) {
  const sure = conf.filter((c) => c.conf >= th);
  console.log(
    `  confidence ≥ ${th}: ${sure.length}/${conf.length} decided alone, ${sure.filter((c) => c.right).length} right; the rest would be asked`,
  );
}
console.log(
  "Gate on mails that ask nothing: " +
    CASES.map((c, i) => (c.asks ? null : `${i}:${gate[i]?.p.toFixed(2)}`))
      .filter(Boolean)
      .join(" "),
);
for (const th of [0.2, 0.3, 0.5]) {
  const skipped = gate.filter((g) => g.p < th);
  console.log(
    `Gate "asks?" < ${th}: ${skipped.length}/${gate.length} not read; of them ${skipped.filter((g) => g.asks).length} did ask (missed)`,
  );
}
console.log(
  `\nJev cost: $${cost.toFixed(5)} for ${gate.length * 2} calls; Haiku classify: ${haikuTokens} tokens`,
);
