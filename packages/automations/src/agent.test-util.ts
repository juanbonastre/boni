// An «Agente» for the tests: a scripted planner behind the engine's port, through the real rounds of packages/agent
// (imported by path, as the tests do: the package itself imports no provider and nothing of the agent, A-02), and an
// automation «Inicio» → (a search) → «Analista» over collections shaped like his: generated keys and ids (D-14).
import type { AgentRequest, Planner } from "../../agent/src/rounds.ts";
import { runRounds } from "../../agent/src/rounds.ts";
import type { AiPort } from "./ai.ts";
import { sketch } from "./automation.test-util.ts";
import type { Connection } from "./connections.ts";
import { type Execution, type RunDeps, run } from "./engine.ts";
import { ACTION, type Automation, type ParamValue, type Step } from "./format.ts";
import { deps, OWN } from "./run.test-util.ts";

export const MODEL = "modelo-de-ejemplo";

/** A plan's call step, and the plan language's three kinds of expression. */
export const call = (id: string, tool: string, args: Record<string, unknown>) => ({
  id,
  op: "call",
  tool,
  args,
});
export const lit = (v: unknown) => ({ lit: v });
export const ref = (r: string) => ({ ref: r });
export const obj = (...kv: unknown[]) => ({ fn: "obj", args: kv });
export const plan = (...steps: unknown[]) => ({ version: 1, steps });
export const answer = (id: string, texto: unknown = lit("Hecho")) => call(id, "answer", { texto });

/**
 * A scripted model: `script` gives the plan of each call it receives (n from 1), and every request is kept as it
 * was sent (`asked`). The port's reader is not one: an «Agente» never calls it.
 */
export function scripted(script: (request: AgentRequest, n: number) => unknown): {
  asked: AgentRequest[];
  port: AiPort;
} {
  const asked: AgentRequest[] = [];
  const planner: Planner = async (request) => {
    asked.push(structuredClone(request));
    return { plan: script(request, asked.length), model: MODEL };
  };
  return {
    asked,
    port: {
      read: async () => {
        throw new Error("an «Agente» calls no reader");
      },
      agent: (c) => runRounds(c as never, planner) as never,
    },
  };
}

/**
 * «Inicio» → «Analista», or «Inicio» → «Buscar» (every row of `from`) → «Analista» with `from`: the «Agente» with
 * these parameters and connections, as the editor saves them.
 */
export function analyst(
  params: Record<string, ParamValue>,
  connections: Connection[],
  from?: string,
  settings?: Step["settings"],
): { automation: Automation; id: string } {
  const s = sketch(173).step("Inicio", "manual");
  if (from) s.step("Buscar", "collection", { collection: from, [ACTION]: "find", limit: 5000 });
  s.step(
    "Analista",
    "agent",
    { instructions: "Mira las tareas y propone una", ...params },
    settings,
  );
  if (from) s.arrow("Inicio", "Buscar").arrow("Buscar", "Analista");
  else s.arrow("Inicio", "Analista");
  const automation = s.build();
  const step = automation.steps.find((x) => x.id === s.id("Analista")) as Step;
  step.connections = connections;
  return { automation, id: s.id("Analista") };
}

/** Runs it from «Inicio», by Juan's hand, for real or as a test. */
export const go = (
  automation: Automation,
  over: Partial<RunDeps>,
  test = false,
): Promise<Execution> =>
  run(
    {
      automation,
      trigger: automation.steps[0]?.id as string,
      fields: { json: {}, label: OWN },
      test,
    },
    deps(over),
  );
