import { atLeast, join, type Label } from "@boni/entities";
import { CHAT_UNASKED, type ChatScope } from "./chat.ts";
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
   * accepted a proposal in the inbox (one tap); assistant: one of his assistants by Boni's MCP (P24); hand: Juan
   * himself, on a control of his app (a route of the API, P25). */
  kind: "turn" | "background" | "miniapp" | "accepted" | "assistant" | "hand";
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
  /** How many rows the call writes, when more than one (an extension's change set, task 93): P11 counts each. */
  rows?: number;
  /**
   * A page's chat (D-61, chat.ts): the actions its «Agente» step gives, its page and the collections that page shows.
   * P26 allows nothing outside them, before any other rule.
   */
  scope?: ChatScope;
  /** Of each `type` argument, the collection it names (its id), as the agent resolved it; null: none. A `definition`
   * that names a collection (a block's), under `<arg>.collection`. */
  typeIds?: Readonly<Record<string, string | null>>;
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
/**
 * What chooses a screen act's target (P22): the value's own label and its keys' (`at`, `id`), never its other
 * fields'. A row a mail made is still his row to light; which row comes from the code, not from the mail's words.
 */
const choosing = (v: Val): Label => {
  const one = (x: Val): Label[] =>
    x.t === "rec"
      ? [
          x.label,
          ...(["at", "id"] as const).flatMap((k) => (x.fields[k] ? [deepLabel(x.fields[k])] : [])),
        ]
      : [deepLabel(x)];
  const ls = v.t === "list" ? [v.label, ...v.items.flatMap(one)] : one(v);
  return join(ls[0] as Label, ...ls.slice(1));
};
const isPrivate = (l: Label) => l.sensitivity !== "public";

/**
 * Juan's own hand (P25, docs/sistema.md §4.1: a route of the API is one more way to an action, with the origin «Juan
 * desde este dispositivo»): what he does on a control of his app is his, his touch and his deletions included, and is
 * not confirmed again (his tap is what the card would ask for). Boni's pieces still run only in a flow (P20) and his
 * screen is his app's own (P22): no route reaches them.
 */
function byHand(tool: ToolDef): Decision {
  if (tool.effect === "piece") return deny("P20", "piece-outside-flow");
  if (tool.effect === "screen") return deny("P22", "screen-outside-turn");
  return allow("P25");
}

/**
 * One of Juan's assistants by Boni's MCP (P24, docs/sistema.md §4.1), on a personal device: it reads, and it writes on
 * what is wholly open to the models, each call one run its `undo` takes back whole; a note it removes goes to the
 * trash, as it always has (`trash`). A flow it writes is only proposed (P19). What only Juan decides is not its own:
 * his touch (P21), running his flows (P8), deleting anything else (P5: his card), his screen (P22), a file he dropped
 * (P23), Boni's pieces (P20), his memory, telling his devices and anything that goes out. What came from outside
 * waits for him (P4).
 */
function byAssistant(tool: ToolDef, personal: boolean, external: boolean): Decision {
  if (!personal) return deny("P24", "assistant-device");
  switch (tool.effect) {
    case "read":
      return tool.sees ? deny("P23", "file-outside-turn") : allow("P24");
    case "write":
    case "write_irreversible":
    case "schema":
      if (external) return propose("P4");
      // Deleting is Juan's card, but for a note to the trash (its one argument the note), which `undo` brings back.
      if (
        (tool.alwaysConfirm || tool.effect === "write_irreversible") &&
        !(
          tool.effect === "write" &&
          Object.values(tool.args).every((a) => a.role === "entity") &&
          Array.isArray(tool.undo) &&
          tool.undo.includes("trash")
        )
      )
        return deny("P5", "assistant-delete");
      return allow("P24");
    case "flow_save":
      return external ? deny("P16", "external-in-flow") : propose("P19");
    case "touch":
      return deny("P21", "touch-outside-turn");
    case "flow":
      return deny("P8", "flow-outside-turn");
    case "screen":
      return deny("P22", "screen-outside-turn");
    case "piece":
      return deny("P20", "piece-outside-flow");
    default:
      return deny("P24", "not-an-assistant's");
  }
}

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
  // A page's chat (P26): only the actions its step gives, only its own page, only the collections the page shows.
  // Whatever the rest says, nothing outside them runs.
  if (call.scope) {
    const scope = call.scope;
    if (!scope.actions.includes(tool.name)) return deny("P26", "not-the-chats-action");
    for (const [name, v] of entries) {
      const role = tool.args[name]?.role;
      if (role === "page" && !(v.t === "v" && v.value === scope.page))
        return deny("P26", "not-the-chats-page");
      if (role === "type") {
        const id = call.typeIds?.[name] ?? null;
        if (!id || !scope.types.includes(id)) return deny("P26", "not-the-pages-collection");
      }
      // A block the chat adds reads only a collection the page shows (its `collection`, resolved by the agent).
      if (role === "definition" && `${name}.collection` in (call.typeIds ?? {})) {
        const id = call.typeIds?.[`${name}.collection`] ?? null;
        if (!id || !scope.types.includes(id)) return deny("P26", "not-the-pages-collection");
      }
    }
  }
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
  if (origin.kind === "hand") return byHand(tool);
  if (origin.kind === "assistant")
    return byAssistant(tool, personal, externalArgs || controlExternal);
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
      // A page's chat changes the page's values without asking; anything else it writes (a block it adds) Juan sees
      // on a card first (P27, D-62).
      if (call.scope && !(CHAT_UNASKED as readonly string[]).includes(tool.name))
        return confirmOr("P27");
      // Every row a call writes counts (a function's change set, as `decideApply` counts it); what Juan accepted in
      // the Bandeja he has seen whole, so accepting it is not asked again.
      const rows = origin.kind === "accepted" ? 0 : Math.max(0, (call.rows ?? 1) - 1);
      if (counters.writes + rows >= limits.maxWrites) return confirmOr("P11");
      if (inTurn || origin.kind === "miniapp") return allow("P1");
      return deny("P0", "unforeseen");
    }
    // Juan's touch (docs/sistema.md §4.1, F10): what only he decides, as accepting or rejecting what waits in the
    // Bandeja. A model prepares it in his own turn, on a personal device, and he confirms it on the card the code
    // paints; nothing from outside chooses it, and no flow, background work, mini-app or proposal does it (P21).
    case "touch":
      if (externalArgs || controlExternal) return deny("P21", "external-touch");
      if (origin.kind !== "turn" || !personal) return deny("P21", "touch-outside-turn");
      return confirm("P21");
    // Boni over the screen (docs/sistema.md §4.7, F9): opening, scrolling to, lighting or filtering on Juan's own
    // screen writes nothing, so it is not confirmed; but only his own turn moves his screen, and nothing from outside
    // chooses what it shows (a mail that says «abre esto»), nor any work of its own (P22). A flow he runs by hand is his
    // turn, and may open (§4.7), though the editor does not offer it.
    case "screen": {
      // A target is judged by what chose it (its keys), every other argument whole.
      const chosen = entries.map(([k, v]) =>
        tool.args[k]?.role === "target" ? choosing(v) : deepLabel(v),
      );
      if (chosen.some(isExternal) || controlExternal) return deny("P22", "external-screen");
      if (origin.kind !== "turn") return deny("P22", "screen-outside-turn");
      return allow("P22");
    }
    // A file Juan dropped, read whole for a reader, its images too (docs/sistema.md §4.7, A-24): the file is one the
    // screen gave (its keys his), in his own turn, never in a flow, background work, a mini-app or from outside (P23).
    case "read": {
      if (!tool.sees) return allow("P1");
      const chosen = entries.map(([k, v]) =>
        tool.args[k]?.role === "target" ? choosing(v) : deepLabel(v),
      );
      if (chosen.some(isExternal) || controlExternal) return deny("P23", "external-file");
      if (origin.kind !== "turn" || call.flow) return deny("P23", "file-outside-turn");
      return allow("P23");
    }
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
