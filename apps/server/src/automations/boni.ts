/**
 * The engine's `BoniPort` on the server (docs/automatizaciones.md §5.9, AU-127, AU-223, AU-230; phase F16 S1): how a
 * Boni step of an automation reaches today's code. Each unit is one plan of one step `a` that this code makes — a
 * `call` of the tool the step names, or a `read` of its reader — run by the account's agent as a flow runs in the
 * background (`Agent.boniCall`): every act goes through `decide` with the background origin (P7: what it creates is
 * proposed, a flow is never started from it), outside content keeps its labels (P4), and «Probar» runs it dry (A-19,
 * D-43). Its answer is the step's value as the tool or the reader labelled it; the engine joins that label with
 * everything the call was given (AU-230), so it can only go down.
 *
 * Which of Boni's automations a run is comes from where the automation is stored (`BONI_STORED`, its author), never
 * from the document: none in S1, where Boni's four stay flows (S2 moves them).
 */
import {
  type Agent,
  codeLabel,
  deepLabel,
  type Json,
  leaf,
  plain,
  READERS,
  type Val,
} from "@boni/agent";
import type { BoniAnswer, BoniAutomation, BoniCall, BoniPort } from "@boni/automations";
import { BONI_PARAMS } from "@boni/automations";
import type { UserStore } from "@boni/store";

export interface BoniWiring {
  /** Whether a store is an account's, whose agent can run Boni's code: asked without making the agent. */
  reaches(store: UserStore): boolean;
  /** The account's agent of that store, made at the first call of a Boni step. */
  agentOf(store: UserStore): Agent;
}

let wired: BoniWiring | null = null;
/** Set once at the server's start (main.ts): the host's agents. Tests set their own. */
export function wireBoni(w: BoniWiring | null): void {
  wired = w;
}

/** Boni's own automations by the id they are stored under: empty until S2 moves the four flows. */
export const BONI_STORED: Readonly<Record<string, BoniAutomation>> = {};

/** The fixed codes a Boni unit fails with: what the agent stopped on, never a text of outside. */
export class BoniFault extends Error {
  readonly code: string;
  constructor(code: string) {
    super(`boni: ${code}`);
    this.code = code;
  }
}

/** The port of one run of automation `id` in `store`, or null when no agent is wired (Boni steps then do not validate). */
export function boniPortFor(store: UserStore, id: string): BoniPort | null {
  const w = wired;
  if (!w?.reaches(store)) return null;
  const automation = BONI_STORED[id];
  return {
    ...(automation ? { automation } : {}),
    run: (call) => runUnit(w.agentOf(store), call),
  };
}

/** What a Boni step validates with, for publishing (`contextOf`): the same as its runs. */
export function boniContextFor(
  store: UserStore,
  id: string,
): { boni: { automation?: BoniAutomation } } | Record<string, never> {
  if (!wired?.reaches(store)) return {};
  const automation = BONI_STORED[id];
  return { boni: automation ? { automation } : {} };
}

/** A cell of the engine as a value of the agent, with its label. */
function valOf(c: BoniCall["args"][string]): Val {
  return leaf(c.value as Json, c.label, c.derived);
}

/**
 * The plan of one unit: arguments bound as `$x0`, `$x1`… in the order of their keys (only code binds, and a key of
 * the document never becomes a name of the plan). A reader reads `values.input`; its other values are its parameters.
 */
export function unitPlan(call: BoniCall): { plan: unknown; bind: Record<string, Val> } {
  const bind: Record<string, Val> = {};
  const refs: Record<string, { ref: string }> = {};
  Object.keys(call.args)
    .sort()
    .forEach((k, i) => {
      const n = `x${i}`;
      bind[n] = valOf(call.args[k] as BoniCall["args"][string]);
      refs[k] = { ref: `$${n}` };
    });
  if ((READERS as readonly string[]).includes(call.name)) {
    const input = call.values[BONI_PARAMS.input];
    bind.input = input ? valOf(input) : leaf(null, codeLabel("boni"));
    return {
      plan: {
        version: 1,
        steps: [{ id: "a", op: "read", reader: call.name, input: { ref: "$input" }, params: refs }],
      },
      bind,
    };
  }
  const why = call.values[BONI_PARAMS.why];
  if (why) bind.why = valOf(why);
  return {
    plan: {
      version: 1,
      steps: [
        {
          id: "a",
          op: "call",
          tool: call.name,
          args: refs,
          ...(why ? { why: { ref: "$why" } } : {}),
        },
      ],
    },
    bind,
  };
}

async function runUnit(agent: Agent, call: BoniCall): Promise<BoniAnswer> {
  const { plan, bind } = unitPlan(call);
  const r = await agent.boniCall(plan, bind, call.test);
  if (r.status !== "done") throw new BoniFault(r.error ?? r.status);
  // «Probar»: what it would do, by decision and tool (never its arguments, which may hold outside text).
  if (call.test && !r.value)
    return {
      value: { would: r.would.map((w) => ({ decision: w.decision, tool: w.tool })) },
      label: codeLabel("boni"),
    };
  if (!r.value) return { value: { proposals: r.proposals }, label: codeLabel("boni") };
  return { value: plain(r.value) as BoniAnswer["value"], label: deepLabel(r.value) };
}
