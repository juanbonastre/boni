import {
  codeLabel,
  deepLabel,
  leaf,
  plain,
  ToolError,
  type ToolRegistry,
  type Val,
} from "@boni/agent";
import { join, type Label } from "@boni/entities";

/**
 * The actions of the area «Flujos» that the core's (`flows.run`, `flows.save`) did not cover (docs/sistema.md §4.1,
 * F10): switching a flow on or off, deleting it and trying it («Probar»). Switching one on or off is Juan's touch
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
}
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
  return r;
}
