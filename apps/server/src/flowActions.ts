import {
  codeLabel,
  deepLabel,
  leaf,
  list,
  plain,
  rec,
  ToolError,
  type ToolRegistry,
  type Val,
} from "@boni/agent";
import { dayToIso, formatMinute, toLocal } from "@boni/calendar";
import { join, type Label } from "@boni/entities";
import type { RunRow, UserStore } from "@boni/store";

/**
 * The actions of the area «Flujos» that the core's (`flows.run`, `flows.save`) did not cover (docs/sistema.md §4.1,
 * F10): switching a flow on or off, deleting it, trying it («Probar») and reading its runs (to open one over the map,
 * F9). Switching one on or off is Juan's touch
 * (P21: the AI prepares it in his turn and he confirms the card); deleting is his card (P5); trying changes nothing.
 * They run the same code as the routes of «Flujos» (agent.ts `FlowsService`), and what a run switched or deleted is
 * taken back by Undo of the run.
 */

/** What the server gives a flow action for its run (`ToolDef.service` "flows"). */
export interface FlowsService {
  /** Switches a flow on or off; refuses one already so, and one with problems to switch on. */
  enable(flow: string, on: boolean): { flow: string; name: string; enabled: boolean };
  /** To the trash (Boni's own flows are turned off, never deleted). */
  remove(flow: string): { flow: string; name: string };
  /** «Probar»: the saved flow, dry, with its form's values (`said`: who wrote them); what it would do. */
  test(flow: string, inputs: Record<string, string>, said: Label): Promise<unknown>;
  /** A flow's runs (every flow's when null), the newest first: when, how it ended, and the step that stopped it. */
  runs(flow: string | null, limit: number): FlowRunFacts[];
}
/** A run of a flow as the model reads it: codes and the server's own words only, never a step's texts. */
export interface FlowRunFacts {
  run: string;
  flow: { id: string; name: string };
  /** The civil day and the time it started, in the account's zone. */
  day: string;
  time: string;
  status: string;
  /** The step it stopped at (an error, a denial, a piece that ended it), or null when it went to the end. */
  stopped: { step: string; decision: string; rule: string | null; code: string | null } | null;
}
/** The decisions that stop a run where they are logged (agent.ts `advance`, `run`). */
const STOPS = new Set(["end", "stopped", "deny"]);
const codeOf = (d: unknown): string | null => {
  const c = d && typeof d === "object" ? (d as { code?: unknown; reason?: unknown }) : null;
  const x = c?.code ?? c?.reason;
  return typeof x === "string" && /^[a-z0-9][a-z0-9:_-]{0,79}$/i.test(x) ? x : null;
};
/** A run's facts, for `flows.runs`: when it started in `tz`, and the last step that stopped it. */
export function runFacts(store: UserStore, r: RunRow, tz: string): FlowRunFacts {
  const at = toLocal(r.started, tz);
  const stop = store.journal
    .steps(r.id)
    .filter((s) => STOPS.has(s.decision))
    .at(-1);
  return {
    run: r.id,
    flow: { id: r.flow ?? "", name: (r.flow && store.journal.flow(r.flow)?.name) || "" },
    day: dayToIso(at.day),
    time: formatMinute(Math.floor(at.minute), true),
    status: r.status,
    stopped: stop
      ? { step: stop.step, decision: stop.decision, rule: stop.rule, code: codeOf(stop.detail) }
      : null,
  };
}
/** Runs one call gives, at most. */
export const MAX_RUNS = 20;
const serviceOf = (s: unknown): FlowsService => {
  if (!s || typeof s !== "object" || !("enable" in s)) throw new ToolError("not-available");
  return s as FlowsService;
};
const code = codeLabel("flows");
const idOf = (v: Val | undefined): string => {
  const x = v ? plain(v) : null;
  if (typeof x !== "string" || !x) throw new ToolError("bad-argument");
  return x;
};
const flow = {
  role: "option" as const,
  required: true,
  describe: 'the flow\'s id (input "flows")',
};

/** The flow actions, added to a registry. */
export function withFlowActions(r: ToolRegistry): ToolRegistry {
  r.register({
    name: "flows.enable",
    effect: "touch",
    area: "flows",
    service: "flows",
    title: "Encender flujo",
    describe:
      "Switch one of Juan's flows on (on: true) or off (on: false), as its switch in «Flujos» does; Juan confirms it on a card",
    args: { flow, on: { role: "value", required: true, describe: "true: on; false: off" } },
    run(c, a) {
      const on = a.on ? plain(a.on) : null;
      if (on !== true && on !== false && on !== "true" && on !== "false")
        throw new ToolError("bad-argument");
      const r = serviceOf(c.service).enable(idOf(a.flow), on === true || on === "true");
      return leaf(r, code);
    },
  });
  r.register({
    name: "flows.delete",
    effect: "write",
    area: "flows",
    service: "flows",
    // Deleting is Juan's card (docs/sistema.md §4.1, P5): to the trash, back with Undo.
    alwaysConfirm: true,
    title: "Borrar flujo",
    describe:
      "Send one of Juan's flows to the trash (Boni's own are only turned off); he confirms it",
    args: { flow },
    run(c, a) {
      return leaf(serviceOf(c.service).remove(idOf(a.flow)), code);
    },
  });
  r.register({
    name: "flows.test",
    effect: "read",
    area: "flows",
    service: "flows",
    title: "Probar flujo",
    describe:
      "Try one of Juan's flows as «Probar» does: it runs dry, changes nothing, and says what each step would do (inputs: its form's values by name, obj(name, value, ...))",
    args: {
      flow,
      inputs: {
        role: "content",
        describe: "the form's values by name, when its form asks for some",
      },
    },
    async run(c, a, extra) {
      const raw = a.inputs ? plain(a.inputs) : {};
      const inputs: Record<string, string> = {};
      if (raw && typeof raw === "object" && !Array.isArray(raw))
        for (const [k, v] of Object.entries(raw)) if (typeof v === "string") inputs[k] = v;
      return leaf(
        (await serviceOf(c.service).test(
          idOf(a.flow),
          inputs,
          a.inputs ? join(extra, deepLabel(a.inputs)) : extra,
        )) as never,
        code,
      );
    },
  });
  r.register({
    name: "flows.runs",
    effect: "read",
    area: "flows",
    service: "flows",
    title: "Ejecuciones de un flujo",
    describe: `The runs of one of Juan's flows (or of all of them, without flow), the newest first, up to ${MAX_RUNS}: the day and time each started, its status and the step that stopped it, if one did. To answer «¿por qué paró…?» and open that run on the map (screen.open with its run, map: true)`,
    args: {
      flow: { ...flow, required: false },
      limit: { role: "value", describe: `how many, ${MAX_RUNS} at most` },
    },
    run(c, a) {
      const n = a.limit ? Number(plain(a.limit)) : 10;
      const limit = Number.isFinite(n) ? Math.min(MAX_RUNS, Math.max(1, Math.floor(n))) : 10;
      // Records, so that a plan names one's run (`$r[0].run`) as a tool gave it.
      const runs = serviceOf(c.service).runs(a.flow ? idOf(a.flow) : null, limit);
      return list(
        runs.map((x) =>
          rec(
            {
              run: leaf(x.run, code),
              flow: rec({ id: leaf(x.flow.id, code), name: leaf(x.flow.name, code) }, code),
              day: leaf(x.day, code),
              time: leaf(x.time, code),
              status: leaf(x.status, code),
              stopped: leaf(x.stopped, code),
            },
            code,
          ),
        ),
        code,
      );
    },
  });
  return r;
}
