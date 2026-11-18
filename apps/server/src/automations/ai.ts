/**
 * The engine's `AiPort` on the server (docs/automatizaciones.md §5.6, §7; AU-57, AU-199, AU-206; phase F15 S1): how an
 * automation's AI step calls a model. One port per run (or per «Probar»), made over the account's «Modelos»:
 *
 * - **Which model.** The step's «Modelo» is the id of a choice it kept, or null for «El de la cuenta»
 *   (`AccountModels.stepProvider`): the four readers spend the use «Lector» (`reader`), an «Agente» the use «Agente»
 *   (`planner`). A model whose key is gone, or that is no model, is refused with a key (`no-key`, `no-model`) and the
 *   step fails saying so through its «Si falla» (`ai.refused`).
 * - **The month's budget.** Asked before every call, a retry and every round of an «Agente» included, for a run of
 *   any origin (PR 490, choice 7); a «Probar» asks it too (`dry`, so it starts no notice) and spends from it (AU-199).
 *   Over it, the call is not made and is refused `budget`.
 * - **Each call.** One request through the provider with a timeout (`AI_TIMEOUTS`); it is never retried here: a call
 *   that timed out may have been charged, and asking again would pay twice. The engine asks again for an answer that
 *   did not fit its shape (AU-59, AU-198), and, only when the step's «Reintentar si el modelo falla» says so (decision
 *   28 of docs/automatizaciones.md §10; born at none), after a refusal this port marks `transient`: our timeout, or the
 *   provider's own timeout, overload or 5xx (`isTransient`). Each such call is counted first (AU-206). Every call that
 *   came back is kept in the journal with its usage, so the month's spending counts it; one that failed after the
 *   provider charged it (a provider error that carries `usage`) is kept too, with only its error code as response. What
 *   the provider said on an error never goes on: the step gets a fixed key.
 * - **What a model receives.** A reader: its prompt and schema of packages/agent, the texts between markers and what
 *   Juan set in the step; nothing else of the run (`docs/nucleo.md` §7.4). An «Agente»: `AGENT_PROMPT` and the
 *   round's request as packages/agent's `runRounds` builds it (AU-197); its plan is checked by the code, and every
 *   call it makes goes through the engine's gate and the server's policy (P29, policy.ts).
 *
 * Nothing in this module decides what a step may do: it only calls models. No test calls a real one: they give
 * «Modelos» a scripted provider (`ModelsOptions.makeProvider`).
 */
import { createHash } from "node:crypto";
import {
  AGENT_PROMPT,
  type AgentRequest,
  type AgentCall as AgentRoundsCall,
  classifySchema,
  delimit,
  extractSchema,
  labelEachSchema,
  type ModelProvider,
  type ModelRequest,
  planSchema,
  READER_PROMPTS,
  READER_SCHEMAS,
  roundArgNames,
  runRounds,
  shortenInput,
  summarizeEachSchema,
} from "@boni/agent";
import type { AgentCall, AgentReply, AiPort, ReaderCall, ReaderReply } from "@boni/automations";
import type { UserStore } from "@boni/store";
import type { AccountModels } from "../models.ts";

/** How long one call may take before it is given up (ms): a reader's batch, and one round of an «Agente». */
export const AI_TIMEOUTS = { reader: 60_000, planner: 180_000 } as const;

/** What the port needs of «Modelos». */
export type AiModels = Pick<AccountModels, "stepProvider" | "overBudget">;

export interface AiFor {
  models: AiModels;
  account: number;
  store: UserStore;
  /** What the journal keeps the calls under: the run's id, or the test's. */
  run: string;
  /** «Probar»: the budget is asked `dry` (it starts no notice); the calls are made and spend all the same (AU-199). */
  test: boolean;
  now?: () => number;
  /** Tests only: shorter timeouts. */
  timeouts?: Partial<Record<keyof typeof AI_TIMEOUTS, number>>;
}

type Called = { json: unknown; model: string } | { refused: string; transient?: true };

/**
 * A refusal the step's «Reintentar si el modelo falla» may retry (decision 28 of §10): the call timed out, or the
 * provider was down for a moment (its timeout, overload or a 5xx). Never a limit (429), a key, a budget, the policy or
 * a network fault on our side: those would only fail again or pay again.
 */
export const isTransient = (key: string): boolean =>
  key === "timeout" ||
  key === "model-timeout" ||
  key === "model-overloaded" ||
  key === "model-server-error" ||
  /^model-http-5\d\d(-|$)/.test(key);

const hashOf = (s: string) => createHash("sha256").update(s).digest("hex");
const READER_HASHES = new Map<string, string>();
const AGENT_HASH = hashOf(AGENT_PROMPT);

/** A provider's error as a fixed key: what it said never goes on. */
function errorKey(e: unknown, timedOut: boolean): string {
  if (timedOut) return "timeout";
  const code = (e as { code?: unknown } | null)?.code;
  return typeof code === "string" && /^[a-z0-9-]{1,30}$/.test(code)
    ? `model-${code}`
    : "model-failed";
}

/** A reader call as the request packages/agent's readers take (§7.4): prompt, schema, texts between markers. */
export function readerRequest(call: ReaderCall): ModelRequest {
  const kind = call.reader;
  const options = call.options ?? [];
  const schema =
    kind === "fill"
      ? extractSchema(call.fields ?? [])
      : kind === "classify"
        ? classifySchema(options, true)
        : kind === "label_each"
          ? labelEachSchema(options, true)
          : kind === "summarize_each"
            ? summarizeEachSchema(options)
            : READER_SCHEMAS[kind];
  const list = kind === "label_each" || kind === "summarize_each";
  // The second call of AU-59 reads the same input shortened, between new markers.
  const texts = call.again ? (shortenInput(call.texts) as string[]) : call.texts;
  const flat = list ? texts.map((t, i) => `[${i + 1}]\n${t}`).join("\n\n") : (texts[0] ?? "");
  const { marker, text } = delimit(flat);
  return {
    role: "reader",
    kind,
    system: READER_PROMPTS[kind],
    input: {
      marker,
      content: text,
      ...(list ? { count: texts.length } : {}),
      ...(options.length ? { options } : {}),
      ...(call.fields ? { fields: call.fields } : {}),
      ...(call.instructions ? { instruction: call.instructions } : {}),
      ...(call.length ? { length: call.length } : {}),
      ...(call.again ? { shortened: true, refused: call.again.fault } : {}),
    },
    schema,
    maxTokens: 4000,
  };
}

/** The port of one run (or one «Probar») for `o.account`. */
export function serverAi(o: AiFor): AiPort {
  const now = o.now ?? Date.now;
  const timeout = (role: keyof typeof AI_TIMEOUTS) => o.timeouts?.[role] ?? AI_TIMEOUTS[role];
  const over = () => o.models.overBudget(o.account, { dry: o.test });
  /**
   * Each «Modelo» resolved once (AU-239): every row, round and retry of the run's steps that name it go with the
   * model it gave first, whatever the list does meanwhile. A failed call fails its step: no other model is tried.
   */
  const resolved = new Map<string, ReturnType<AiModels["stepProvider"]>>();
  const providerOf = (kind: "agent" | "reading", value: string | null) => {
    const k = `${kind}|${value ?? ""}`;
    const had = resolved.get(k);
    if (had) return had;
    const p = o.models.stepProvider(o.account, kind, value);
    resolved.set(k, p);
    return p;
  };
  /** The model as «Lo que hizo» says it: with the tag it came by (AU-239). */
  const said = (model: string, tag: string | null) => (tag ? `${model} · ${tag}` : model);

  /** One call, timed out, kept in the journal when it came back or was charged. Never retried here. */
  async function complete(
    provider: ModelProvider,
    req: ModelRequest,
    promptHash: string,
  ): Promise<Called> {
    const signal = AbortSignal.timeout(timeout(req.role === "planner" ? "planner" : "reader"));
    let res: Awaited<ReturnType<ModelProvider["complete"]>>;
    try {
      res = await provider.complete(req, { signal });
    } catch (e) {
      const why = errorKey(e, signal.aborted);
      const usage = (e as { usage?: { input?: unknown; output?: unknown } } | null)?.usage;
      if (usage && Number.isFinite(usage.input) && Number.isFinite(usage.output))
        o.store.journal.modelCall({
          run: o.run,
          role: req.role,
          provider: provider.id,
          model: provider.id,
          promptHash,
          request: req,
          response: { error: why },
          usage,
          at: now(),
        });
      return isTransient(why) ? { refused: why, transient: true } : { refused: why };
    }
    o.store.journal.modelCall({
      run: o.run,
      role: req.role,
      provider: provider.id,
      model: res.model,
      promptHash,
      request: req,
      response: res.json,
      usage: res.usage,
      at: now(),
    });
    return { json: res.json, model: res.model };
  }

  return {
    async read(call: ReaderCall): Promise<ReaderReply> {
      if (over()) return { refused: "budget" };
      const p = providerOf("reading", call.model);
      if ("refused" in p) return { refused: p.refused };
      const req = readerRequest(call);
      let hash = READER_HASHES.get(req.system);
      if (!hash) {
        hash = hashOf(req.system);
        READER_HASHES.set(req.system, hash);
      }
      const got = await complete(p.provider, req, hash);
      return "refused" in got
        ? {
            refused: got.refused,
            model: said(p.model, p.tag),
            ...(got.transient ? { transient: true } : {}),
          }
        : { answer: got.json, model: said(got.model, p.tag) };
    },
    async agent(call: AgentCall): Promise<AgentReply> {
      // `AgentCall` of packages/automations mirrors the rounds' one field by field (A-02: it imports nothing of
      // packages/agent).
      const rounds = call as unknown as AgentRoundsCall;
      const schema = planSchema(roundArgNames(rounds));
      const reply = await runRounds(rounds, async (request: AgentRequest) => {
        if (over()) return { refused: "budget" };
        const p = providerOf("agent", request.model);
        if ("refused" in p) return { refused: p.refused };
        const got = await complete(
          p.provider,
          {
            role: "planner",
            system: AGENT_PROMPT,
            input: request,
            schema,
            structured: false,
            maxTokens: 16000,
          },
          AGENT_HASH,
        );
        return "refused" in got
          ? {
              refused: got.refused,
              model: said(p.model, p.tag),
              ...(got.transient ? { transient: true } : {}),
            }
          : { plan: got.json, model: said(got.model, p.tag) };
      });
      return reply as unknown as AgentReply;
    },
  };
}

// ---------------------------------------------------------------- the server's wiring

/**
 * How runs reach «Modelos»: main.ts sets it once, with the account a store is of. Without it (a server with no data
 * folder, a test that sets none) no run has a port, and the AI steps are `step.unknownType` as before F15.
 */
export interface AutomationModels {
  models: AiModels & Pick<AccountModels, "resolveModel" | "offered">;
  accountOf(store: UserStore): number | null;
}
let wired: AutomationModels | null = null;

/** Sets (or, with null, clears) how runs reach «Modelos». */
export function wireAutomationModels(m: AutomationModels | null): void {
  wired = m;
}

/** «Modelos» of the account `store` is of, when the server has them. */
export function modelsOf(
  store: UserStore,
): { models: AutomationModels["models"]; account: number } | null {
  const account = wired?.accountOf(store) ?? null;
  return wired && account !== null ? { models: wired.models, account } : null;
}

/** The port of one run or test over `store`, or none when the server has no «Modelos». */
export function aiFor(store: UserStore, run: string, test: boolean): AiPort | undefined {
  const m = modelsOf(store);
  return m ? serverAi({ ...m, store, run, test }) : undefined;
}
