import { atLeast, join, type Label } from "@boni/entities";
import { DESTINATION_ROLES, type ToolDef } from "./tools.ts";
import { deepLabel, type Val } from "./values.ts";

/**
 * The policy engine (docs/nucleo.md, 7.5): a pure function from a call, its labelled arguments and
 * its context to allow, deny, confirm or propose, with the id of the rule that decided. The rules are
 * not configurable (Juan only chooses how much he hears about them). Anything not foreseen is denied.
 */
export type Trust = "personal" | "shared" | "ambient";
export interface Origin {
  /** turn: Juan asked now; background: a job, no turn; miniapp: one of his mini-apps; accepted: he
   * accepted a proposal in the inbox (one tap). */
  kind: "turn" | "background" | "miniapp" | "accepted";
  trust: Trust;
  device?: string;
}
export interface Call {
  tool: ToolDef | null;
  /** The arguments, each already joined with the step's control label. */
  args: Readonly<Record<string, Val>>;
  /** The label of what decided that the step runs (its `when` / `each`), when there is one. */
  control: Label | null;
  /** The run is a saved flow's (docs/flujos.md D-42), not a plan a model wrote for a turn. */
  flow?: boolean;
  /** «Probar»: nothing is written, proposed or confirmed; what a step would do is said. */
  dry?: boolean;
}
export interface RunCounters {
  writes: number;
  sensitiveReads: number;
}
export interface Limits {
  /** P11: writes in one run before it stops and asks. */
  maxWrites: number;
  /** P11: sensitive reads before an egress needs confirming. */
  maxSensitiveReadsBeforeEgress: number;
}
export const DEFAULT_LIMITS: Limits = { maxWrites: 20, maxSensitiveReadsBeforeEgress: 10 };

export type Decision =
  | { kind: "allow"; rule: string }
  | { kind: "deny"; rule: string; reason: string }
  | { kind: "confirm"; rule: string }
  | { kind: "propose"; rule: string };

const allow = (rule: string): Decision => ({ kind: "allow", rule });
const deny = (rule: string, reason: string): Decision => ({ kind: "deny", rule, reason });
const confirm = (rule: string): Decision => ({ kind: "confirm", rule });
const propose = (rule: string): Decision => ({ kind: "propose", rule });

const low = (l: Label) => !atLeast(l, "imported"); // external, model or ambient
const isExternal = (l: Label) => l.integrity === "external";
const isPrivate = (l: Label) => l.sensitivity !== "public";

export function decide(
  call: Call,
  origin: Origin,
  counters: RunCounters,
  limits: Limits = DEFAULT_LIMITS,
): Decision {
  const tool = call.tool;
  if (!tool) return deny("P0", "unregistered-tool");
  const entries = Object.entries(call.args);
  for (const [name] of entries) if (!tool.args[name]) return deny("P0", "unclassified-argument");
  const labels = entries.map(([, v]) => deepLabel(v));
  const all = labels.length ? join(labels[0] as Label, ...labels.slice(1)) : null;
  const externalArgs = !!all && isExternal(all);
  const controlExternal = !!call.control && isExternal(call.control);

  // Destinations: a value taken as it is, from Juan or his data (P14, then P2).
  for (const [name, v] of entries) {
    if (
      !DESTINATION_ROLES.includes(
        (tool.args[name] as { role: (typeof DESTINATION_ROLES)[number] }).role,
      )
    )
      continue;
    if (v.t !== "v" || v.derived) return deny("P14", "derived-destination");
    if (low(v.label)) return deny("P2", "untrusted-destination");
  }

  const personal = origin.trust === "personal";
  const inTurn = origin.kind === "turn" || origin.kind === "accepted";
  // A confirmation is only asked on a personal device; elsewhere it becomes a proposal (P6).
  const confirmOr = (rule: string) => (personal ? confirm(rule) : propose("P6"));

  switch (tool.effect) {
    case "egress":
    case "send": {
      if (origin.kind === "background") return deny("P7", "background-egress");
      if (origin.kind === "miniapp") return deny("P7", "miniapp-egress");
      // A search or a download is a way out too: what it carries must be Juan's (P2).
      for (const [name, v] of entries)
        if ((tool.args[name] as { role: string }).role === "query" && low(deepLabel(v)))
          return deny("P2", "untrusted-query");
      const privateArgs = entries.filter(
        ([name, v]) =>
          !DESTINATION_ROLES.includes(
            (tool.args[name] as { role: (typeof DESTINATION_ROLES)[number] }).role,
          ) && isPrivate(deepLabel(v)),
      );
      if (privateArgs.length && !privateArgs.every(([, v]) => deepLabel(v).integrity === "user"))
        return deny("P3", "private-data-out");
      if (!personal) return propose("P6");
      if (privateArgs.length) return confirm("P3");
      if (counters.sensitiveReads >= limits.maxSensitiveReadsBeforeEgress) return confirm("P11");
      if (controlExternal || externalArgs) return confirm("P15");
      // Nothing leaves without Juan seeing it, for now (12.1): an e-mail is sent, a page fetched,
      // only after he confirms those values.
      return confirm("P5");
    }
    case "memory":
      if (externalArgs || controlExternal) return deny("P9", "external-to-memory");
      if (origin.kind === "background") return propose("P7");
      if (!personal) return propose("P6");
      return allow("P1");
    case "schema":
      if (origin.kind === "accepted" && personal) return allow("P10");
      if (externalArgs || controlExternal) return propose("P10");
      if (origin.kind === "background") return propose("P10");
      if (!personal) return propose("P6");
      if (origin.kind !== "turn") return propose("P10");
      return allow("P10");
    case "notify":
      return allow("P1");
    // One of the user's flows runs from his own turn, once he confirms it; nothing from outside starts one (P16),
    // and no flow or background work starts another (docs/flujos.md §4.3).
    case "flow":
      if (externalArgs || controlExternal) return deny("P16", "external-starts-flow");
      if (origin.kind !== "turn" || !personal) return deny("P8", "flow-outside-turn");
      return confirm("P8");
    // A flow a model writes is only proposed; it is saved when the user accepts it (P19, D-41). Nothing from outside
    // makes or changes one (P16), and no work of its own does.
    case "flow_save":
      if (externalArgs || controlExternal) return deny("P16", "external-in-flow");
      if (origin.kind === "accepted") return allow("P19");
      if (origin.kind === "turn") return propose("P19");
      return deny("P8", "flow-outside-turn");
    case "write":
    case "write_irreversible": {
      // What an e-mail decides, or what is made of it, waits in the inbox (P4, P15) unless Juan
      // accepted it there; accepting does not lift any other rule.
      if (origin.kind !== "accepted") {
        if (externalArgs) return propose("P4");
        if (controlExternal) return propose("P15");
        if (origin.kind === "background") return propose("P7");
        if (!personal) return propose("P6");
      }
      if (tool.alwaysConfirm || tool.effect === "write_irreversible") return confirmOr("P5");
      if (counters.writes >= limits.maxWrites) return confirmOr("P11");
      if (inTurn || origin.kind === "miniapp") return allow("P1");
      return deny("P0", "unforeseen");
    }
    case "read":
      return allow("P1");
    // A piece of Boni (docs/sistema.md §4.2) is Boni's own code as a step: only in a flow, never in a plan a model
    // wrote; one that changes the inbox (folds a thread, accepts alone), only in the flow's own background run, or
    // said as «haría» when the flow is tried (P20).
    case "piece":
      if (!call.flow) return deny("P20", "piece-outside-flow");
      if (tool.changes && origin.kind !== "background" && !call.dry)
        return deny("P20", "piece-outside-background");
      return allow("P20");
    default:
      return deny("P0", "unforeseen");
  }
}
