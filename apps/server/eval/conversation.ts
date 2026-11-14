/**
 * The conversation with the real planner (task 27; docs/conversacion.md §3.4 and C1), outside CI and run by hand with
 * a budget (AGENTS.md). On the server's own agent (its `turns.undo`, every kind of question), in a store of invented
 * data only, it checks that «antes te he dicho X, pero es Y» asks to take back that earlier turn, and that each kind
 * of question is asked when a request calls for it. It prints a line per case and what it spent; it writes nothing
 * to the repo (each case runs in a folder of its own under the system's temp, removed after).
 *
 *   ANTHROPIC_API_KEY=... node apps/server/eval/conversation.ts [claude-opus-5-5] [claude-haiku-4-5] --max-cost=2
 *   OPENROUTER_API_KEY=... node apps/server/eval/conversation.ts [anthropic/claude-haiku-5.5] [deepseek/deepseek-v4.1-flash]
 *
 * `--max-cost=<dollars>` (2 without it) is a hard cap: once the calls have spent it, no other call is made
 * (`capped`). `--only=<text>` runs the cases whose name has it and `--times=<n>` runs each n times (a failure seen
 * once may be the model's mood). A case not as expected prints its plan, which holds only the invented data. `--dry`
 * calls no model and needs no key: a planner that only replies measures how big each request is, for the estimate
 * before a real run.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type AskAnswer,
  type AskView,
  anthropicCost,
  createConversation,
  type ModelProvider,
  type ModelRequest,
  type TurnResult,
} from "@boni/agent";
import {
  capped,
  EVAL_NOW,
  type EvalKeys,
  evalKeys,
  evalProvider,
  maxCostFlag,
  newSpend,
  seedEval,
} from "@boni/agent/evals";
import { AgentHost } from "../src/agent.ts";

const dry = process.argv.includes("--dry");
const keys: EvalKeys | null = dry ? {} : evalKeys();
if (!keys) {
  console.error(
    "ANTHROPIC_API_KEY or OPENROUTER_API_KEY is not set (or --dry, which calls no model)",
  );
  process.exit(2);
}
const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const anthropic = dry || !!keys.anthropic;
const plannerModel = args[0] ?? (anthropic ? "claude-opus-5-5" : "anthropic/claude-haiku-5.5");
const readerModel = args[1] ?? (anthropic ? "claude-haiku-4-5" : "deepseek/deepseek-v4.1-flash");
const only = process.argv.find((a) => a.startsWith("--only="))?.slice("--only=".length);
const times =
  Number(process.argv.find((a) => a.startsWith("--times="))?.slice("--times=".length)) || 1;
const maxCost = maxCostFlag(process.argv, 2);
const spend = newSpend();

/** What a request weighs, in characters (the dry run's measure). */
const sizes: { role: string; chars: number }[] = [];
/** A planner or a reader that calls no model: the planner only replies, the reader says nothing. */
const dryProvider = (role: "planner" | "reader"): ModelProvider => ({
  id: `dry-${role}`,
  privacy: "local",
  async complete(req: ModelRequest) {
    sizes.push({
      role,
      // The planner's schema is not sent (it answers JSON that code checks); a reader's is, as its output's format.
      chars:
        req.system.length +
        JSON.stringify(req.input).length +
        (req.structured === false ? 0 : JSON.stringify(req.schema).length),
    });
    const reply = {
      version: 1,
      steps: [{ id: "r", op: "reply", component: "text", data: { template: { lit: "Hecho." } } }],
    };
    return {
      json: role === "planner" ? reply : {},
      usage: { input: 0, output: 0, cost: 0 },
      model: "dry",
    };
  },
});
const provider = (model: string, planner: boolean): ModelProvider =>
  dry
    ? dryProvider(planner ? "planner" : "reader")
    : capped(evalProvider(keys, model, planner), maxCost, spend);

/** The plans the planner gave in the turn being checked (one, or more when the agent asked it to mend one). */
let plans: unknown[] = [];
const recording = (p: ModelProvider): ModelProvider => ({
  id: p.id,
  privacy: p.privacy,
  async complete(req, o) {
    const r = await p.complete(req, o);
    plans.push(r.json);
    return r;
  },
});

/** The tools a plan calls, in order, each with its arguments (steps may hold steps: every object with a tool). */
function calls(plan: unknown): { tool: string; args: unknown }[] {
  const out: { tool: string; args: unknown }[] = [];
  const walk = (x: unknown) => {
    if (Array.isArray(x)) for (const y of x) walk(y);
    else if (x && typeof x === "object") {
      const o = x as Record<string, unknown>;
      if (typeof o.tool === "string") out.push({ tool: o.tool, args: o.args });
      for (const v of Object.values(o)) walk(v);
    }
  };
  walk(plan);
  return out;
}

interface Seen {
  /** How the turn checked ended, after its questions were answered and, where the case says, its cards accepted. */
  end: TurnResult;
  /** The questions it asked, in order: the control, and whether its options were a property's. */
  asked: { control: AskView["control"]; field: boolean }[];
  /** The cards it showed, each as text (to find the earlier turn it names). */
  cards: string[];
  tools: string[];
  undo: unknown[];
  /** The tasks in the store at the end: title and day. */
  tasks: { titulo: string; fecha: string }[];
}

interface Case {
  name: string;
  /** Turns before the one checked, in the same conversation, each to its end (a yes to its cards). */
  before?: string[];
  text: string;
  /** The cards of the turn checked are accepted (a C1 card, and what the plan does after it). */
  accept?: boolean;
  /** Null when the turn went as it should; otherwise what it did instead. */
  check: (s: Seen) => string | null;
}

const dentist = (s: Seen, day: string) =>
  s.tasks.some((t) => /dentista/i.test(t.titulo) && t.fecha === day);
const THU = "2026-10-22";
const FRI = "2026-10-23";
/** The first question asked was this kind (and with a property's options, when `field`). */
const asks =
  (control: AskView["control"], field = false) =>
  (s: Seen): string | null => {
    const first = s.asked[0];
    if (!first) return `asked nothing (${s.end.status}${s.end.error ? `, ${s.end.error}` : ""})`;
    if (first.control !== control) return `asked ${first.control}`;
    if (field && !first.field) return "a choice without the property's options";
    return null;
  };

/** EVAL_NOW is a Tuesday (2026-10-20, Europe/Madrid): «el jueves» is the 22nd, «el viernes» the 23rd. */
const CASES: Case[] = [
  {
    name: "C1: antes te he dicho el jueves, pero es el viernes",
    before: ["Apunta una tarea: llamar al dentista el jueves"],
    text: "Antes te he dicho el jueves, pero es el viernes",
    accept: true,
    check: (s) =>
      !s.undo.length
        ? `no turns.undo (${s.tools.join(", ") || "no tools"})`
        : !s.cards[0]?.includes("dentista")
          ? "its card does not name the earlier turn"
          : dentist(s, THU)
            ? "the Thursday task is still there"
            : !dentist(s, FRI)
              ? "no Friday task"
              : null,
  },
  {
    name: "C1: the earlier turn of two",
    before: ["Apunta una tarea: llamar al dentista el jueves", "Apunta una tarea: comprar sellos"],
    text: "Antes te he dicho el jueves para el dentista, pero es el viernes",
    accept: true,
    check: (s) =>
      !s.undo.length
        ? `no turns.undo (${s.tools.join(", ") || "no tools"})`
        : !s.cards[0]?.includes("dentista")
          ? "its card does not name the dentist's turn"
          : !s.tasks.some((t) => /sellos/i.test(t.titulo))
            ? "the other turn was taken back too"
            : dentist(s, THU)
              ? "the Thursday task is still there"
              : !dentist(s, FRI)
                ? "no Friday task"
                : null,
  },
  {
    name: "C1: something new is no correction",
    before: ["Apunta una tarea: llamar al dentista el jueves"],
    text: "Apunta también comprar sellos el viernes",
    accept: true,
    check: (s) =>
      s.undo.length
        ? "asked for turns.undo"
        : !dentist(s, THU)
          ? "the Thursday task is gone"
          : !s.tasks.some((t) => /sellos/i.test(t.titulo))
            ? "no task for the stamps"
            : null,
  },
  {
    name: "several: déjame elegir cuáles",
    text: "Quiero borrar algunos de mis movimientos; déjame elegir cuáles",
    check: asks("several"),
  },
  {
    name: "choice of a property: pregúntame la categoría",
    text: "Apunta un gasto de 18 € en «Regalo inventado»; pregúntame la categoría",
    check: asks("choice", true),
  },
  {
    name: "number: pregúntame cuánto fue",
    text: "Apunta un gasto de ocio en «Farmacia inventada»; pregúntame cuánto fue",
    check: asks("number"),
  },
  {
    name: "date: pregúntame qué día",
    text: "Apunta una tarea: renovar el pasaporte; pregúntame qué día",
    check: asks("date"),
  },
  {
    name: "file: la factura que te paso",
    text: "Apunta el gasto de la factura que te paso ahora",
    check: asks("file"),
  },
  {
    name: "yes or no: pregúntame si lo apunto",
    text: "Si hay algún correo de la secretaría, pregúntame si lo apunto como tarea",
    check: asks("yesno"),
  },
  {
    name: "dry run: antes enséñame lo que cambiarías",
    text: "Cambia la categoría de todos mis movimientos a ocio, pero antes enséñame lo que cambiarías",
    check: asks("rehearsal"),
  },
];

/** What each kind of question is answered with: the first option, a number, Friday, no and «Ahora no». */
function answerOf(v: AskView): AskAnswer | null {
  switch (v.control) {
    case "choice":
      return { choice: 0 };
    case "several":
      return { choices: [0] };
    case "text":
      return { text: "Sin más." };
    case "number":
      return { number: 12 };
    case "date":
      return { date: FRI };
    case "yesno":
      return { yes: false };
    case "rehearsal":
      return { save: false };
    default:
      // A file: the evaluation has none to give, and the question was the point.
      return null;
  }
}

const personal = { kind: "turn" as const, trust: "personal" as const };

async function runCase(c: Case): Promise<{ ok: boolean; note: string; detail: string }> {
  const dir = mkdtempSync(join(tmpdir(), "boni-eval-conversation-"));
  let clock = EVAL_NOW;
  const host = new AgentHost({
    dataDir: dir,
    providers: {
      planner: recording(provider(plannerModel, true)),
      reader: provider(readerModel, false),
    },
    tz: "Europe/Madrid",
    now: () => clock,
  });
  try {
    const store = host.store(1);
    seedEval(store, (t) => {
      clock = t;
    });
    const agent = host.agent(1);
    const conversation = createConversation(store, { now: EVAL_NOW });
    const asked: Seen["asked"] = [];
    const cards: string[] = [];
    // A turn to its end: its questions answered, its cards accepted when `accept` (four steps at most).
    const drive = async (r: TurnResult, accept: boolean, watch: boolean): Promise<TurnResult> => {
      for (let i = 0; i < 4 && r.status === "waiting" && r.pending; i++) {
        const p = r.pending;
        if (p.kind === "ask") {
          if (watch) asked.push({ control: p.control, field: !!p.field });
          const a = answerOf(p);
          if (!a) break;
          r = await agent.answer(r.run, p.id, a);
        } else {
          if (watch) cards.push(JSON.stringify(p.view));
          if (!accept) break;
          r = await agent.confirm(r.run, p.id, "personal");
        }
      }
      return r;
    };
    // A minute between turns, as a person types them: the history keeps them in the order they were said.
    const turn = (text: string) => {
      clock += 60_000;
      return agent.turn({ text, origin: personal, conversation });
    };
    for (const text of c.before ?? []) await drive(await turn(text), true, false);
    plans = [];
    const end = await drive(await turn(c.text), !!c.accept, true);
    const used = plans.flatMap(calls);
    const seen: Seen = {
      end,
      asked,
      cards,
      tools: used.map((x) => x.tool),
      undo: used.filter((x) => x.tool === "turns.undo").map((x) => x.args),
      tasks: store.list("t_tarea").map((x) => ({
        titulo: String(x.entity.values.f_titulo ?? ""),
        fecha: String(x.entity.values.f_fecha ?? ""),
      })),
    };
    const wrong = c.check(seen);
    const detail = [
      `tools: ${seen.tools.join(", ") || "none"}`,
      ...(seen.undo.length ? [`undo: ${JSON.stringify(seen.undo)}`] : []),
      `asked: ${asked.map((a) => a.control + (a.field ? "+field" : "")).join(", ") || "nothing"}`,
      `ended ${end.status}${end.error ? ` (${end.error})` : ""}`,
      // Why it went otherwise: what the planner wrote (more than one when the agent asked it to mend a plan).
      ...(wrong ? [`plan: ${JSON.stringify(plans.length === 1 ? plans[0] : plans)}`] : []),
    ].join("; ");
    return { ok: !wrong, note: wrong ?? "", detail };
  } finally {
    host.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

const chosen = CASES.filter((c) => !only || c.name.includes(only)).flatMap((c) =>
  Array.from({ length: times }, () => c),
);
console.error(dry ? "… dry run: no model is called" : `… ${plannerModel}, reader ${readerModel}`);
const t0 = Date.now();
let right = 0;
for (const c of chosen) {
  if (spend.cost >= maxCost) {
    console.log(`skip ${c.name} (the cap is spent)`);
    continue;
  }
  const r = await runCase(c);
  if (r.ok) right++;
  if (dry) continue;
  console.log(`${r.ok ? "ok  " : "FAIL"} ${c.name}${r.note ? ` (${r.note})` : ""}`);
  console.log(`     ${r.detail}`);
}
if (dry) {
  // Spanish JSON runs at about three characters a token; a planner that reasons at medium effort writes some
  // thousands of tokens of thought, counted as output.
  const planner = sizes.filter((s) => s.role === "planner");
  const tokens = Math.round(planner.reduce((n, s) => n + s.chars, 0) / 3);
  const out = 3000 * planner.length;
  console.log(
    `${planner.length} planner calls, ~${tokens} input tokens (the largest ~${Math.round(Math.max(...planner.map((s) => s.chars)) / 3)}), ${sizes.length - planner.length} reader calls`,
  );
  console.log(
    `at ${plannerModel}'s price with ~3000 output tokens a call: ~$${anthropicCost(plannerModel.replace(/^anthropic\//, "").replaceAll(".", "-"), tokens, out).toFixed(2)}`,
  );
} else {
  console.log(
    `\n${plannerModel}: ${right}/${chosen.length} as expected, ${Math.round((Date.now() - t0) / 1000)} s`,
  );
  console.log(`spent $${spend.cost.toFixed(4)} of $${maxCost} in ${spend.calls} calls`);
}
process.exit(right === chosen.length || dry ? 0 : 1);
