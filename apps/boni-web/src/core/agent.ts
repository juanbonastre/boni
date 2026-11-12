import {
  type DatabaseFilter,
  emptyPage,
  filterErrors,
  isPageTemplate,
  type PageSpec,
  type PageTemplate,
  pageErrors,
  type SavedView,
  savedViewsOf,
  withoutRetired,
} from "@boni/views";
import { ApiError, NotConfiguredError, OfflineError, type Transport } from "./api.ts";
import {
  parseActions,
  parseColumns,
  parseDetail,
  parseHistory,
  parseStorage,
  parseSummary,
  type SystemColumns,
} from "./audit.ts";
import { type BlockResult, type DataBlock, parseBlockResults } from "./blocks.ts";
import type { MapEdgeKind, MapEdgeLike, MapKind, MapNodeLike } from "./flowLayout.ts";
import type { PointedRef } from "./pointing.ts";
import { tracked } from "./wait.ts";

/**
 * The agent's conversation API (apps/server/src/agent.ts, docs/nucleo.md 7 and 7.14). What comes back is
 * painted by this code from labelled values: every value says how far to trust it, and text from a model
 * or from outside is shown as plain text, never as HTML, Markdown or a link. Answers are checked here
 * (`parseTurn`) the way the server checks plans: anything unexpected is dropped, never rendered as is.
 */
export type Painted =
  | { t: "v"; value: unknown; integrity: string; sensitivity: string }
  | { t: "list"; items: Painted[]; integrity: string }
  | { t: "rec"; fields: Record<string, Painted>; integrity: string };

export interface Reply {
  component: "text" | "number" | "list" | "table" | "chart" | "run" | "open";
  data: Record<string, Painted>;
}
export interface ConfirmRow {
  arg: string;
  role: string;
  value: string;
  integrity: string;
  sources: string[];
  marks: string[];
  /** The field's name as Juan reads it, for a row of one field of a record. */
  name?: string;
  /** An entity's title, next to its id. */
  detail?: string;
}
export interface ConfirmView {
  tool: string;
  title: string;
  rows: ConfirmRow[];
}
export type Pending =
  | { kind: "ask"; id: string; control: "choice" | "text"; prompt: Painted; options: Painted[] }
  | { kind: "confirm"; id: string; view: ConfirmView };
export interface Notice {
  code: string;
  rule?: string;
  n?: number;
}
export interface TurnResult {
  run: string;
  status: "done" | "waiting" | "stopped";
  replies: Reply[];
  pending: Pending | null;
  proposals: string[];
  notices: Notice[];
  error: string | null;
  /** Whether it changed something still not undone; absent from older servers (then «Deshacer» shows). */
  changed?: boolean;
}
/** One of Juan's conversations with Boni, as the list shows it (docs/conversacion.md 3.1). */
export interface ConversationSummary {
  id: string;
  title: string;
  /** The planner model chosen for it (a planner's id), or "" for the account's. */
  model: string;
  last: number;
}
/** A turn of a conversation as the server keeps it. */
export interface TurnView extends TurnResult {
  id: string;
  request: string;
  at: number;
}
/** What a turn does while it runs (docs/conversacion.md 3.5), as the server tells it. */
export type LiveEvent =
  | { type: "start"; run: string }
  | { type: "planning" }
  | { type: "planned"; steps: number }
  | {
      type: "step";
      id: string;
      op: string;
      what: string;
      state: "start" | "done";
      /** A call in Juan's words: the tool, and its arguments by the names Juan gave things. */
      words?: StepWords;
      /** At its end: how many it found, or the number it gave. */
      n?: number;
      value?: number;
    }
  | { type: "reply"; reply: Reply }
  | { type: "waiting" }
  | { type: "end"; status: TurnResult["status"]; error: string | null };
/** A model a conversation may plan with. */
export interface Planner {
  id: string;
  model: string;
  connection: string;
  privacy: string;
  current: boolean;
}

export interface Proposal {
  id: string;
  tool: string;
  view: ConfirmView | null;
  sources: string[];
  created: number;
  /** The run that made it («Recorrido», task 52); missing from an older server. */
  run: string | null;
  /** The flow whose run made it (null: a turn of the conversation, or an older server): «Ver en el mapa». */
  madeBy?: string | null;
  /** What the inbox shows of it, made by the server's code (apps/server/src/inboxCard.ts). */
  card: InboxCard | null;
  /** A flow a model proposed (docs/flujos.md F5): drawn by the server, with what it changes. */
  flow?: FlowProposalView;
}
/** Who reads or writes a collection (F6, apps/server/src/usage.ts): a flow, or who did in the period. */
export interface Who {
  id: string;
  name: string;
  kind: "flow" | "user" | "assistant" | "model" | "boni";
  n: number;
  /** A flow: whether it is on. */
  on?: boolean;
}
export interface DataUsage {
  days: number;
  types: Record<string, { reads: Who[]; writes: Who[] }>;
}
const WHO_KINDS = ["flow", "user", "assistant", "model", "boni"] as const;
export function parseUsage(b: unknown): DataUsage {
  const out: DataUsage = { days: 30, types: {} };
  if (!isObj(b) || !isObj(b.types)) return out;
  if (typeof b.days === "number") out.days = b.days;
  const whos = (v: unknown): Who[] =>
    Array.isArray(v)
      ? v.flatMap((w) =>
          isObj(w) &&
          typeof w.id === "string" &&
          typeof w.name === "string" &&
          (WHO_KINDS as readonly unknown[]).includes(w.kind)
            ? [
                {
                  id: w.id.slice(0, 80),
                  name: w.name.slice(0, 80),
                  kind: w.kind as Who["kind"],
                  n: typeof w.n === "number" ? w.n : 0,
                  ...(typeof w.on === "boolean" ? { on: w.on } : {}),
                },
              ]
            : [],
        )
      : [];
  for (const [type, u] of Object.entries(b.types))
    if (isObj(u)) out.types[type] = { reads: whos(u.reads), writes: whos(u.writes) };
  return out;
}
/** A flow a model proposed, as the inbox draws it (apps/server/src/flows.ts `flowProposalView`). */
export interface FlowProposalView {
  name: string;
  /** The flow it changes, or null: a new one. */
  changes: { id: string; name: string; version: number } | null;
  trigger: Record<string, unknown>;
  inputs: { id: string; what: string }[];
  nodes: (FlowStepNode & { change: "new" | "changed" | "same" | "removed" })[];
}
/** The inbox card (Juan, 2026-10-22): what it does, where it came from, its day and the days around it. */
export interface InboxCard {
  action: "create" | "update" | "delete" | "other";
  collection: string | null;
  collectionId: string | null;
  kind: "event" | "task" | "item";
  title: string | null;
  day: string | null;
  start: string | null;
  end: string | null;
  source: {
    kind: "mail";
    account: string | null;
    from: string;
    subject: string;
    excerpt: string;
    /** The mail's own row in Boni, for "Ver correo". */
    open: { type: string; id: string } | null;
    /** Its Message-ID: the webmail that opens a mail by it (Gmail; task 55). */
    messageId: string | null;
  } | null;
  /** Why it was made: the reader's quote of the mail (verbatim when the server found it in the mail). */
  why: { text: string; verbatim: boolean } | null;
  familiar: number;
  complete: boolean;
  /** "Ya lo hice" can make it already done (its collection has a task column). */
  canMarkDone: boolean;
  /** Boni would have accepted it alone (measured only, Juan 2026-10-23). */
  wouldAccept: boolean;
  mode: "compact" | "detailed";
  context: { day: string; items: { title: string; start: string | null; end: string | null }[] }[];
  /**
   * A time for a task the mail gave none for (the first free hour of its day): asked on the card («¿A las 16:00?»,
   * one tap takes it), or already set when Boni earned it (`do`: the card's start and end say it).
   */
  suggestedTime: {
    start: string;
    end: string;
    startKey: string;
    endKey: string | null;
    outcome: "ask" | "do";
  } | null;
  /** What an earlier proposal of the same thread of mail said, when this one changed its day or hours (task 46). */
  before: { day: string | null; start: string | null; end: string | null } | null;
  /** The earlier mails of its thread it also comes from (task 68), newest first; empty when it comes from one. */
  earlier: {
    from: string;
    subject: string;
    at: string | null;
    open: { type: string; id: string };
  }[];
  /**
   * What the calendar already has of it (task 51): an entry that is the same thing (`external`: an external
   * calendar's event, so «Enlazar» accepts the record linked to it), and others it overlaps.
   */
  calendar: {
    already: {
      title: string;
      start: string | null;
      end: string | null;
      calendar: string | null;
      external: string | null;
    } | null;
    /**
     * An entry at the same moment that may be it («¿Es «X»?», task 58): «Es el mismo» accepts the proposal into
     * that record (`id`), or linked to that external event (`external`).
     */
    same: {
      id: string | null;
      title: string;
      start: string | null;
      end: string | null;
      calendar: string | null;
      external: string | null;
    } | null;
    overlaps: { title: string; start: string | null; end: string | null }[];
  } | null;
}
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const optStr = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : null);
const optMatch = (v: unknown, re: RegExp) => (typeof v === "string" && re.test(v) ? v : null);
function parseCard(v: unknown): InboxCard | null {
  if (!isObj(v)) return null;
  const actions = ["create", "update", "delete", "other"] as const;
  const kinds = ["event", "task", "item"] as const;
  const src = isObj(v.source) ? v.source : null;
  const source: InboxCard["source"] =
    src?.kind === "mail"
      ? {
          kind: "mail",
          account: optStr(src.account, 200),
          from: optStr(src.from, 200) ?? "",
          subject: optStr(src.subject, 200) ?? "",
          excerpt: optStr(src.excerpt, 1500) ?? "",
          messageId: optStr(src.messageId, 300),
          open:
            isObj(src.open) && typeof src.open.type === "string" && typeof src.open.id === "string"
              ? { type: src.open.type.slice(0, 100), id: src.open.id.slice(0, 100) }
              : null,
        }
      : null;
  return {
    action: actions.find((a) => a === v.action) ?? "other",
    collection: optStr(v.collection, 200),
    collectionId: optStr(v.collectionId, 100),
    kind: kinds.find((k) => k === v.kind) ?? "item",
    title: optStr(v.title, 300),
    day: optMatch(v.day, DAY_RE),
    start: optMatch(v.start, TIME_RE),
    end: optMatch(v.end, TIME_RE),
    source,
    why:
      isObj(v.why) && typeof v.why.text === "string" && v.why.text.trim()
        ? { text: v.why.text.slice(0, 300), verbatim: v.why.verbatim === true }
        : null,
    familiar: typeof v.familiar === "number" ? v.familiar : 0,
    complete: v.complete === true,
    canMarkDone: v.canMarkDone === true,
    wouldAccept: v.wouldAccept === true,
    mode: v.mode === "compact" ? "compact" : "detailed",
    suggestedTime:
      isObj(v.suggestedTime) &&
      typeof v.suggestedTime.start === "string" &&
      TIME_RE.test(v.suggestedTime.start) &&
      typeof v.suggestedTime.startKey === "string"
        ? {
            start: v.suggestedTime.start,
            end:
              typeof v.suggestedTime.end === "string" && TIME_RE.test(v.suggestedTime.end)
                ? v.suggestedTime.end
                : "",
            startKey: v.suggestedTime.startKey.slice(0, 80),
            endKey:
              typeof v.suggestedTime.endKey === "string"
                ? v.suggestedTime.endKey.slice(0, 80)
                : null,
            outcome: v.suggestedTime.outcome === "do" ? "do" : "ask",
          }
        : null,
    before: isObj(v.before)
      ? {
          day: optMatch(v.before.day, DAY_RE),
          start: optMatch(v.before.start, TIME_RE),
          end: optMatch(v.before.end, TIME_RE),
        }
      : null,
    earlier: Array.isArray(v.earlier)
      ? v.earlier.slice(0, 5).flatMap((e) =>
          isObj(e) &&
          isObj(e.open) &&
          typeof e.open.type === "string" &&
          typeof e.open.id === "string"
            ? [
                {
                  from: optStr(e.from, 200) ?? "",
                  subject: optStr(e.subject, 200) ?? "",
                  at: optStr(e.at, 40) ?? null,
                  open: { type: e.open.type, id: e.open.id },
                },
              ]
            : [],
        )
      : [],
    calendar: isObj(v.calendar)
      ? {
          already: isObj(v.calendar.already)
            ? {
                title: optStr(v.calendar.already.title, 120) ?? "",
                start: optMatch(v.calendar.already.start, TIME_RE),
                end: optMatch(v.calendar.already.end, TIME_RE),
                calendar: optStr(v.calendar.already.calendar, 80),
                external: optStr(v.calendar.already.external, 300),
              }
            : null,
          same: isObj(v.calendar.same)
            ? {
                id: optStr(v.calendar.same.id, 80),
                title: optStr(v.calendar.same.title, 120) ?? "",
                start: optMatch(v.calendar.same.start, TIME_RE),
                end: optMatch(v.calendar.same.end, TIME_RE),
                calendar: optStr(v.calendar.same.calendar, 80),
                external: optStr(v.calendar.same.external, 300),
              }
            : null,
          overlaps: Array.isArray(v.calendar.overlaps)
            ? v.calendar.overlaps
                .filter(isObj)
                .slice(0, 3)
                .map((o) => ({
                  title: optStr(o.title, 120) ?? "",
                  start: optMatch(o.start, TIME_RE),
                  end: optMatch(o.end, TIME_RE),
                }))
            : [],
        }
      : null,
    context: Array.isArray(v.context)
      ? v.context.filter(isObj).flatMap((d) => {
          const day = optMatch(d.day, DAY_RE);
          if (!day) return [];
          const items = Array.isArray(d.items)
            ? d.items.filter(isObj).map((i) => ({
                title: optStr(i.title, 120) ?? "",
                start: optMatch(i.start, TIME_RE),
                end: optMatch(i.end, TIME_RE),
              }))
            : [];
          return [{ day, items: items.slice(0, 30) }];
        })
      : [],
  };
}
/** What the models may see of a collection (Juan's choice; the agent cannot change it). */
export type AiLevel = "visible" | "opaque" | "restricted" | "private";
export const AI_LEVELS: readonly AiLevel[] = ["visible", "opaque", "restricted", "private"];
const levelOf = (v: unknown): AiLevel => AI_LEVELS.find((l) => l === v) ?? "visible";
/** A vault zone moved into Boni: no AI ever sees it, and no screen changes that. */
export type Zone = "restricted" | "private";
const zoneOf = (v: unknown): Zone | undefined =>
  v === "restricted" || v === "private" ? v : undefined;
export interface Visibility {
  id: string;
  name: string;
  level: AiLevel;
  count: number;
  zone?: Zone;
}

/** One step of a run as Juan's Registro shows it (`GET api/agent/runs/:id`). */
export interface RunStep {
  id: string;
  /** call, read, ask or reply; and a tool's title («Crear»), as the flow editor names its nodes. */
  op: string;
  title: string | null;
  what: string;
  /** The arguments as the plan wrote them, as text. */
  args: string;
  decision: string | null;
  rule: string | null;
  error: string | null;
  /** The steps it took its data from: the diagram's edges («Recorrido», task 52). */
  deps: string[];
  /** The inputs it took (what the trigger or the code bound): an edge from the trigger. */
  uses: string[];
  /** What the models answered in it, as text (Juan's own content; never markup). */
  answers: string[];
  /** The words of Juan's request it took as they were (its quotes: «informe»), the one part of its arguments said. */
  said?: string[];
  /** Its model calls in this run and their cost (task 91: what is this run's, in orange). */
  calls?: number;
  cost?: number;
  /** What it gave the next step, as the model answered it: Juan's own content, painted as text. */
  output?: unknown;
}
/** A record as a box's panel shows it: its title, collection and fields by their names, as text. */
export interface RecordView {
  id: string;
  title: string;
  collection: string;
  fields: { name: string; value: string }[];
}
/** A run step by step («Recorrido», task 52): all from the journal and the audit, painted as text. */
export interface RunDetail {
  id: string;
  status: string;
  origin: string;
  started: number;
  finished: number | null;
  request: string | null;
  /** The flow and version it ran (docs/flujos.md), when it is one; what the plan took from outside its steps. */
  flow: string | null;
  flowVersion: number | null;
  inputs: string[];
  steps: RunStep[];
  /** Each with its collection's name and id (`type`, empty when unknown): the map draws the way the run went. */
  read: { collection: string; type: string; titles: string[]; n: number }[];
  changes: { action: string; title: string; collection: string; type: string; undone: boolean }[];
  /** Each with its rows as the Bandeja showed them, the step that made it and the record it became (task 91). */
  proposals: {
    id?: string;
    title: string;
    status: string;
    type: string | null;
    created?: number;
    decided?: number | null;
    rows?: { name: string; value: string }[];
    step?: string | null;
    record?: RecordView | null;
  }[];
  /** The record that started it (a mail): its title is outside text, painted as text. */
  input: {
    id: string;
    title: string;
    collection: string;
    type: string;
    fields?: { name: string; value: string }[];
  } | null;
  /**
   * What it told the account's devices, by the step that did: the notices that left, as the server counts them (a
   * «Probar» told none, nor did an «Avisar» its tool refused). Never worked out here from the steps' decisions.
   */
  told: { step: string; n: number }[];
  /** The node of the map it belongs to (`flow:…`, `boni:chat`, `boni:review`, `boni:inbox`); null: none. */
  owner: string | null;
  /** Its flow as it ran, when that is not the flow's latest version: the map draws the run over these boxes. */
  drawn?: { version: number | null; plan: FlowPlan; steps: FlowStepNode[] } | null;
  decisions: { area: string; p: number; outcome: string; result: string | null }[];
  models: {
    role: string;
    provider: string;
    model: string;
    input: number;
    output: number;
    cost: number | null;
    at: number;
  }[];
}

/** Who made a record and from what («¿De dónde viene?», apps/server origin.ts). */
export interface Origin {
  by: "flow" | "chat" | "user" | "assistant" | "import" | "connector" | "boni";
  at: number;
  /** The user's device, or the assistant's name. */
  device: string | null;
  /** The run that made or proposed it, and the node of the map it belongs to. */
  run: {
    id: string;
    flow: string | null;
    flowVersion: number | null;
    started: number;
    owner: string | null;
  } | null;
  /** The record that started that run (a mail): outside text, painted as text. */
  input: { id: string; title: string; collection: string } | null;
  /** It came through the Bandeja: what was proposed (its title, outside text), when, and accepted (by the user, or
   * by Boni alone). */
  proposal: { title: string; created: number; decided: number | null; alone: boolean } | null;
}
const ORIGIN_BY: readonly Origin["by"][] = [
  "flow",
  "chat",
  "user",
  "assistant",
  "import",
  "connector",
  "boni",
];
export function parseOrigin(b: unknown): Origin | null {
  if (!isObj(b)) return null;
  const by = ORIGIN_BY.find((x) => x === b.by);
  if (!by || typeof b.at !== "number") return null;
  const r = isObj(b.run) ? b.run : null;
  const i = isObj(b.input) ? b.input : null;
  const p = isObj(b.proposal) ? b.proposal : null;
  const s = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : null);
  return {
    by,
    at: b.at,
    device: s(b.device, 60),
    run:
      r && typeof r.id === "string" && typeof r.started === "number"
        ? {
            id: r.id.slice(0, 80),
            flow: s(r.flow, 80),
            flowVersion: typeof r.flowVersion === "number" ? r.flowVersion : null,
            started: r.started,
            owner: typeof r.owner === "string" && MAP_ID.test(r.owner) ? r.owner : null,
          }
        : null,
    input:
      i && typeof i.id === "string"
        ? {
            id: i.id.slice(0, 80),
            title: s(i.title, 120) ?? "",
            collection: s(i.collection, 80) ?? "",
          }
        : null,
    proposal:
      p && typeof p.created === "number"
        ? {
            title: s(p.title, 120) ?? "",
            created: p.created,
            decided: typeof p.decided === "number" ? p.decided : null,
            alone: p.alone === true,
          }
        : null,
  };
}

/** A plan expression as text: a literal as it is, a quote of the request in quotes, a reference by name. */
export function exprText(e: unknown): string {
  if (!isObj(e)) return "?";
  if ("lit" in e) return JSON.stringify(e.lit);
  if ("quote" in e) return `«${String(e.quote)}»`;
  if ("ref" in e) return String(e.ref);
  if ("fn" in e && Array.isArray(e.args))
    return `${String(e.fn)}(${e.args.map(exprText).join(", ")})`;
  return "?";
}

export interface RunSummary {
  id: string;
  origin: string;
  device: string | null;
  status: string;
  started: number;
  finished: number | null;
  /** What it was (the server's `runInfo`; missing from an older server). Outside text, shown only as text. */
  what?: RunWhat;
  proposals?: { pending: number; accepted: number; rejected: number; stale: number };
  /** The first few things it changed, and how many in all. */
  changes?: RunChange[];
  changed?: number;
  /** Boni accepted the proposal alone («Solo», docs/fiabilidad.md §3.4). */
  alone?: boolean;
}
export type RunWhat =
  | { kind: "request"; text: string }
  | { kind: "mail"; subject: string; from: string; account: string | null }
  | { kind: "measure"; subject: string }
  | { kind: "review" }
  | { kind: "accepted" }
  | { kind: "test"; flow: string }
  /** A run of a flow (on its schedule, or by hand), by the flow's name. */
  | { kind: "flow"; flow: string }
  | { kind: "other" };
/** How often Boni would have accepted alone over Juan's last decisions, and been right (the server's rule). */
export interface AutoAccept {
  decided: number;
  would: number;
  right: number;
}
/**
 * How right Boni's decisions are in one area (docs/fiabilidad.md §3.3, §3.4): what the Registro's «Acierto» and
 * Settings «Decisiones» show, with the area's «Solo» switch where it has one.
 */
export interface AreaAccuracy {
  area: string;
  cost: "A" | "B" | "C";
  total: number;
  done: number;
  asked: number;
  nothing: number;
  judged: number;
  right: number;
  levels: { from: number; to: number; judged: number; right: number }[];
  /** Whether it has a «Solo» switch; an area decided inside a proposal Juan decides has none. */
  switchable: boolean;
  auto: boolean;
  /** Who turned the switch last, and when: Juan, or Boni backing off. */
  autoBy: "juan" | "boni" | null;
  autoAt: number | null;
  earned: boolean;
  /** What earns «Solo»: this many judged decisions, this share right (an older server does not say). */
  earnsWith: { decisions: number; accuracy: number } | null;
}
export interface RunChange {
  action: "create" | "update" | "delete" | "restore";
  title: string;
  collection: string;
  undone: boolean;
}
const count = (v: unknown): number =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 ? Math.min(v, 1_000_000) : 0;
function runWhat(v: unknown): RunWhat | undefined {
  if (!isObj(v)) return undefined;
  const s = (x: unknown, max = 300) => (typeof x === "string" ? x.slice(0, max) : "");
  switch (v.kind) {
    case "request":
      return { kind: "request", text: s(v.text) };
    case "mail":
      return {
        kind: "mail",
        subject: s(v.subject),
        from: s(v.from),
        account: typeof v.account === "string" ? v.account.slice(0, 200) : null,
      };
    case "measure":
      return { kind: "measure", subject: s(v.subject) };
    case "review":
    case "accepted":
      return { kind: v.kind };
    case "test":
      return { kind: "test", flow: s(v.flow, 80) };
    case "flow":
      return { kind: "flow", flow: s(v.flow, 80) };
    default:
      return { kind: "other" };
  }
}
/** A question (the agent's `ask`): its prompt and options as painted values; null when it is not one. */
export function parseAsk(p: unknown): Extract<Pending, { kind: "ask" }> | null {
  if (!isObj(p) || typeof p.id !== "string" || p.kind !== "ask") return null;
  if (p.control !== "choice" && p.control !== "text") return null;
  const prompt = parsePainted(p.prompt);
  if (!prompt) return null;
  return {
    kind: "ask",
    id: p.id.slice(0, 80),
    control: p.control,
    prompt,
    options: (Array.isArray(p.options) ? p.options : [])
      .slice(0, 20)
      .map((o) => parsePainted(o))
      .filter((x): x is Painted => x !== null),
  };
}

/**
 * A question from background work waiting in the panel (Juan, 2026-10-24): what it asks, until when, and where it
 * came from (the mail being read; outside text, shown only as text).
 */
export interface InboxRequest {
  id: string;
  run: string;
  ask: Extract<Pending, { kind: "ask" }>;
  created: number;
  expires: number;
  about: RunWhat | null;
  /** The mail's own row, for "Ver correo". */
  open: { type: string; id: string } | null;
}

/** «Modelos» (Juan, 2026-10-24): which model does each role, what it spends, how it treats the data. */
export const MODEL_ROLES = ["planner", "reader", "decider", "reviewer"] as const;
export type ModelRole = (typeof MODEL_ROLES)[number];
export const MODEL_CONNECTIONS = ["openrouter", "anthropic", "typesafe"] as const;
export type ModelConnection = (typeof MODEL_CONNECTIONS)[number];
export type ModelPrivacy = "keeps-nothing" | "deletes-in-30-days" | "may-keep" | "unknown";
export interface ModelChoice {
  connection: ModelConnection;
  model: string;
  zdr: boolean;
}
export interface ModelRoleView extends ModelChoice {
  role: ModelRole;
  privacy: ModelPrivacy;
  chosen: boolean;
  missingKey: boolean;
}
export interface ModelEvaluation extends ModelChoice {
  role: ModelRole;
  at: number;
  right: number;
  total: number;
  wrong: number;
  cost: number;
  cases: { name: string; ok: boolean; note: string }[];
  /** The decider's calibration by level of confidence, when the evaluation measured it (docs/fiabilidad.md §3.3). */
  calibration?: { from: number; to: number; judged: number; right: number }[];
}
export interface ModelSpendRow {
  role: string;
  provider: string;
  model: string;
  calls: number;
  eur: number;
  unpriced: number;
}
export interface ModelsView {
  roles: ModelRoleView[];
  connections: { connection: ModelConnection; mine: boolean; server: boolean }[];
  budget: { monthlyEur: number; warnAt: number };
  /** Passing the warning tells: Boni's «Aviso del presupuesto» is on (a server from before it always told). */
  notice: boolean;
  usdToEur: number;
  spending: {
    month: string;
    eur: number;
    rows: ModelSpendRow[];
    byDay: { day: string; eur: number; byModel: Record<string, number> }[];
  };
  over: boolean;
  evaluations: ModelEvaluation[];
  evaluating: (ModelChoice & { role: ModelRole }) | null;
}
export interface CatalogueModel {
  id: string;
  name: string;
  input: number;
  output: number;
  context: number;
  providers: string[];
  structured: boolean;
}
const num = (v: unknown, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const s200 = (v: unknown, max = 200) => (typeof v === "string" ? v.slice(0, max) : "");
const oneOf = <T extends string>(list: readonly T[], v: unknown): T | null =>
  list.find((x) => x === v) ?? null;
function choiceOf(v: Record<string, unknown>): ModelChoice | null {
  const connection = oneOf(MODEL_CONNECTIONS, v.connection);
  return connection ? { connection, model: s200(v.model, 120), zdr: v.zdr === true } : null;
}
const numOf = (v: unknown, d = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : d);

/** Boni's map (docs/sistema.md §4.4, F8; the server's `flowMap`): what brings, starts, reads and writes the data. */
export interface MapNode extends MapNodeLike {
  /** A collection's, a flow's, a page's or an assistant's own name; null for Boni's own (named by `code`). */
  name: string | null;
  code: string | null;
  icon: string;
  runs: number;
  last: number | null;
  calls: number;
  /** US dollars. */
  cost: number;
  models: string[];
  roles: string[];
  proposals: number;
  accepted: number;
  /** The Bandeja: rejected in the period, and waiting now. */
  rejected: number;
  pending: number;
  /** A collection's key (what a trigger names). */
  key: string | null;
  rows: number | null;
  parent: string | null;
  trigger: Record<string, unknown> | null;
  on: boolean;
  by: string | null;
  boni: boolean;
  plan: FlowPlan | null;
  steps: FlowStepNode[];
  pack: string | null;
  /** The devices: how many notices they were told in the period. */
  notices: number;
}
export interface MapEdge extends MapEdgeLike {
  steps: string[];
}
export interface MapView {
  days: number;
  nodes: MapNode[];
  edges: MapEdge[];
}
const MAP_KINDS: readonly MapKind[] = [
  "connector",
  "collection",
  "flow",
  "boni",
  "actor",
  "page",
  "device",
];
const MAP_EDGES: readonly MapEdgeKind[] = [
  "brings",
  "starts",
  "reads",
  "writes",
  "proposes",
  "accepts",
  "decides",
  "learns",
  "improves",
  "shows",
  "tells",
];
const MAP_ID = /^(conn|col|flow|boni|actor|page|dev):[A-Za-z0-9_.:@-]{1,120}$/;
/** The account's devices on the map (the server's `DEVICES`): where what Boni tells arrives. */
export const MAP_DEVICES = "dev:all";
/** The devices' node as a map has it, for one whose period has no notice (a run that told before it goes to them). */
export const mapDevices = (): MapNode | null =>
  parseMap({ nodes: [{ id: MAP_DEVICES, kind: "device", code: "devices" }], edges: [] })
    ?.nodes[0] ?? null;
/** Name and value pairs, as text (a record's fields, a proposal's rows). */
function namedValues(v: unknown): { name: string; value: string }[] {
  return Array.isArray(v)
    ? v
        .filter(isObj)
        .slice(0, 20)
        .map((x) => ({
          name: typeof x.name === "string" ? x.name.slice(0, 60) : "",
          value: typeof x.value === "string" ? x.value.slice(0, 200) : "",
        }))
        .filter((x) => x.name && x.value)
    : [];
}
function recordViewOf(v: unknown): RecordView | null {
  if (!isObj(v) || typeof v.id !== "string") return null;
  return {
    id: v.id.slice(0, 80),
    title: typeof v.title === "string" ? v.title.slice(0, 120) : "",
    collection: typeof v.collection === "string" ? v.collection.slice(0, 80) : "",
    fields: namedValues(v.fields),
  };
}

export function parseMap(b: unknown): MapView | null {
  if (!isObj(b) || !Array.isArray(b.nodes) || !Array.isArray(b.edges)) return null;
  const nodes: MapNode[] = [];
  for (const n of b.nodes) {
    if (!isObj(n) || typeof n.id !== "string" || !MAP_ID.test(n.id)) continue;
    const kind = MAP_KINDS.find((k) => k === n.kind);
    if (!kind) continue;
    const strs = (v: unknown, max: number) =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, max) : [];
    const plan = isObj(n.plan) ? planOf(n.plan) : null;
    nodes.push({
      id: n.id,
      kind,
      name: strOf(n.name, 120),
      code: strOf(n.code, 40),
      icon: strOf(n.icon, 8) ?? "",
      runs: numOf(n.runs),
      last: typeof n.last === "number" ? n.last : null,
      calls: numOf(n.calls),
      cost: numOf(n.cost),
      models: strs(n.models, 8).map((m) => m.slice(0, 80)),
      roles: strs(n.roles, 8).filter((r) => /^[a-z]{1,20}$/.test(r)),
      proposals: numOf(n.proposals),
      accepted: numOf(n.accepted),
      rejected: numOf(n.rejected),
      pending: numOf(n.pending),
      through: n.through === true,
      key: strOf(n.key, 80),
      rows: typeof n.rows === "number" ? n.rows : null,
      parent: typeof n.parent === "string" && MAP_ID.test(n.parent) ? n.parent : null,
      trigger: isObj(n.trigger) ? n.trigger : null,
      on: n.on !== false,
      by: strOf(n.by, 20),
      boni: n.boni === true,
      plan,
      steps: Array.isArray(n.steps)
        ? n.steps.map(parseFlowNode).filter((x): x is FlowStepNode => x !== null)
        : [],
      pack: strOf(n.pack, 40),
      notices: numOf(n.notices),
    });
  }
  const ids = new Set(nodes.map((n) => n.id));
  const edges: MapEdge[] = [];
  for (const e of b.edges) {
    if (!isObj(e) || typeof e.from !== "string" || typeof e.to !== "string") continue;
    const kind = MAP_EDGES.find((k) => k === e.kind);
    if (!kind || !ids.has(e.from) || !ids.has(e.to)) continue;
    edges.push({
      from: e.from,
      to: e.to,
      kind,
      n: typeof e.n === "number" ? e.n : null,
      steps: Array.isArray(e.steps)
        ? e.steps.filter((x): x is string => typeof x === "string" && ID_RE.test(x))
        : [],
      outside: e.outside === true,
      ...(Array.isArray(e.into)
        ? { into: e.into.filter((x): x is string => typeof x === "string" && ids.has(x)) }
        : {}),
      ...(isObj(e.per)
        ? {
            per: Object.fromEntries(
              Object.entries(e.per).filter(
                (x): x is [string, number] => ids.has(x[0]) && typeof x[1] === "number",
              ),
            ),
          }
        : {}),
      ...(Array.isArray(e.via)
        ? { via: e.via.filter((x): x is string => typeof x === "string" && ids.has(x)) }
        : {}),
    });
  }
  return { days: numOf(b.days, 7), nodes, edges };
}

/** A flow (docs/flujos.md): a plan with a trigger kept as data, as the list shows it. */
export interface FlowSummary {
  id: string;
  name: string;
  version: number;
  trigger: Record<string, unknown>;
  by: string;
  enabled: boolean;
  steps: number;
  runs: number;
  last: number | null;
}
export interface FlowStepNode {
  id: string;
  op: string;
  what: string;
  title: string | null;
  detail: string | null;
  when: boolean;
  each: boolean;
  args: string[];
  deps: string[];
  ran: Record<string, number>;
  /** «Crear en la elegida»: the collections it chooses among, by name. */
  into?: string[];
  /** Its model calls of the period and their cost (US dollars), when it asks a model. */
  calls?: number;
  cost?: number;
}
export interface FlowDetailView extends FlowSummary {
  inputs: { id: string; what: string }[];
  nodes: FlowStepNode[];
  days: number;
  versions: { version: number; by: string; created: number }[];
  /** The plan itself: what the editor changes (its canvas lays itself out). */
  plan: FlowPlan;
  /** Boni's own version of it, when it has one («Volver al de Boni»). */
  preset: number | null;
  /** The key of the collection the mail's connector brings records to (a trigger on it «viene del conector Correo»),
   * or null; servers before 0.8.114 say none. */
  mailKey?: string | null;
}
/** A flow's plan as the editor holds it (docs/flujos.md: the plan language, `packages/agent` plan.ts). */
export interface FlowPlan {
  version: 1;
  steps: FlowStep[];
}
export type FlowStep = { id: string; op: string } & Record<string, unknown>;
/** The editor's catalog of nodes (the server's `flowCatalog`): tools, readers, the rest of the plan language. */
export interface FlowCatalog {
  tools: {
    name: string;
    title: string;
    effect: string;
    args: { name: string; role: string; required: boolean }[];
    /** A piece of Boni that works on the record that started the flow (docs/sistema.md §4.2). */
    record?: boolean;
    /** A piece that changes the inbox. */
    changes?: boolean;
  }[];
  readers: Record<string, { params: string[]; required: string[]; out: string[] }>;
  asks: string[];
  replies: Record<string, string[]>;
  fns: Record<string, [number, number]>;
  limits: { steps: number; each: number; nesting: number };
  /** The active extensions' functions a «Función» step may name, with their code and their tests' names (task 93);
   * servers before 0.8.114 send none. */
  functions: { id: string; name: string; code: string; tests: string[] }[];
  collections: {
    /** Its id (a guide's rule names a collection by it); servers before 0.8.114 send none. */
    id?: string;
    key: string;
    name: string;
    parent: string | null;
    fields: { key: string; name: string; type: string; roles: string[]; relation: string | null }[];
  }[];
  modules: string[];
}
/** «Probar» (docs/flujos.md F3): what each step did in a dry run, and what it would have done. */
export type TestOut =
  | { t: "list"; n: number }
  | { t: "text"; text: string }
  | { t: "number"; value: number }
  | { t: "record"; text: string | null; n: number | null }
  | { t: "none" };
/** What one of Boni's pieces found in a test (the server's `PieceSaid`), for its line on the canvas. */
export type PieceSaid =
  | { piece: "mail.rule"; to: string | null }
  | { piece: "mail.known"; n: number }
  | {
      piece: "mail.invitation";
      title: string | null;
      day: string | null;
      start: string | null;
      held: boolean;
    }
  | { piece: "mail.relations"; found: { field: string; title: string }[] }
  | { piece: "inbox.fold"; n: number }
  | { piece: "inbox.accept_alone"; n: number }
  | { piece: "mail.save"; n: number }
  | { piece: "guide.decisions"; n: number; found: number }
  | {
      piece: "guide.measure";
      rules: number;
      examples: number;
      /** In «Probar»: how much mail it would read again; the measure itself otherwise. */
      would: number | null;
      before: number | null;
      after: number | null;
      total: number | null;
    }
  | { piece: "guide.suggest"; n: number };
function parsePiece(v: unknown): PieceSaid | undefined {
  if (!isObj(v)) return undefined;
  switch (v.piece) {
    case "mail.rule":
      return { piece: v.piece, to: strOf(v.to, 120) };
    case "mail.known":
    case "inbox.fold":
    case "inbox.accept_alone":
    case "mail.save":
    case "guide.suggest":
      return { piece: v.piece, n: numOf(v.n) };
    case "guide.decisions":
      return { piece: v.piece, n: numOf(v.n), found: numOf(v.found) };
    case "guide.measure": {
      const maybe = (x: unknown) => (typeof x === "number" ? x : null);
      return {
        piece: v.piece,
        rules: numOf(v.rules),
        examples: numOf(v.examples),
        would: maybe(v.would),
        before: maybe(v.before),
        after: maybe(v.after),
        total: maybe(v.total),
      };
    }
    case "mail.invitation":
      return {
        piece: v.piece,
        title: strOf(v.title, 200),
        day: strOf(v.day, 20),
        start: strOf(v.start, 10),
        held: v.held === true,
      };
    case "mail.relations":
      return {
        piece: v.piece,
        found: (Array.isArray(v.found) ? v.found : [])
          .filter(isObj)
          .slice(0, 6)
          .map((f) => ({ field: strOf(f.field, 80) ?? "", title: strOf(f.title, 160) ?? "" })),
      };
    default:
      return undefined;
  }
}
export interface TestStepView {
  decision: string | null;
  rule: string | null;
  error: string | null;
  out: TestOut;
  /** One of Boni's pieces: what it found. */
  piece?: PieceSaid;
  would: {
    decision: string;
    rule: string | null;
    tool: string | null;
    title: string | null;
    type: string | null;
    text: string | null;
  }[];
}
export interface FlowTestView {
  run: string;
  status: string;
  error: string | null;
  sample: { mail: string; subject: string } | null;
  steps: Record<string, TestStepView>;
}
function parseOut(v: unknown): TestOut {
  if (!isObj(v)) return { t: "none" };
  if (v.t === "list") return { t: "list", n: numOf(v.n) };
  if (v.t === "number") return { t: "number", value: numOf(v.value) };
  if (v.t === "text") return { t: "text", text: strOf(v.text, 200) ?? "" };
  if (v.t === "record")
    return { t: "record", text: strOf(v.text, 200), n: typeof v.n === "number" ? v.n : null };
  return { t: "none" };
}
export function parseFlowTest(b: unknown): FlowTestView | null {
  if (!isObj(b) || typeof b.run !== "string" || !isObj(b.steps)) return null;
  const steps: Record<string, TestStepView> = {};
  for (const [k, v] of Object.entries(b.steps)) {
    if (!isObj(v) || !ID_RE.test(k)) continue;
    steps[k] = {
      decision: strOf(v.decision, 20),
      rule: strOf(v.rule, 20),
      error: strOf(v.error, 80),
      out: parseOut(v.out),
      ...(parsePiece(v.piece) ? { piece: parsePiece(v.piece) as PieceSaid } : {}),
      would: (Array.isArray(v.would) ? v.would : []).filter(isObj).map((w) => ({
        decision: strOf(w.decision, 20) ?? "",
        rule: strOf(w.rule, 20),
        tool: strOf(w.tool, 60),
        title: strOf(w.title, 80),
        type: strOf(w.type, 120),
        text: strOf(w.text, 200),
      })),
    };
  }
  return {
    run: b.run,
    status: strOf(b.status, 40) ?? "",
    error: strOf(b.error, 80),
    sample:
      isObj(b.sample) && typeof b.sample.mail === "string"
        ? { mail: b.sample.mail, subject: strOf(b.sample.subject, 200) ?? "" }
        : null,
    steps,
  };
}
/** The checklist and the values each step may take (the server's `checkFlow`). */
export interface FlowProblem {
  step: string | null;
  at: string | null;
  code: string;
}
export interface FlowCheck {
  problems: FlowProblem[];
  refs: Record<string, { ref: string; t: string }[]>;
  /** What each step gives (its panel's «Sale»; task 70): itself and its fields. */
  outs: Record<string, { ref: string; t: string }[]>;
}
const strOf = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : null);
export function parseFlowCatalog(b: unknown): FlowCatalog | null {
  if (!isObj(b) || !Array.isArray(b.tools) || !isObj(b.readers)) return null;
  const strs = (v: unknown) =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  return {
    tools: b.tools.filter(isObj).flatMap((t) =>
      typeof t.name === "string"
        ? [
            {
              name: t.name,
              title: strOf(t.title, 80) ?? t.name,
              effect: strOf(t.effect, 40) ?? "",
              args: (Array.isArray(t.args) ? t.args : []).filter(isObj).map((a) => ({
                name: strOf(a.name, 40) ?? "",
                role: strOf(a.role, 40) ?? "",
                required: a.required === true,
              })),
              ...(t.record === true ? { record: true } : {}),
              ...(t.changes === true ? { changes: true } : {}),
            },
          ]
        : [],
    ),
    readers: Object.fromEntries(
      Object.entries(b.readers)
        .filter(([, r]) => isObj(r))
        .map(([k, r]) => {
          const x = r as Record<string, unknown>;
          return [k, { params: strs(x.params), required: strs(x.required), out: strs(x.out) }];
        }),
    ),
    asks: strs(b.asks),
    replies: isObj(b.replies)
      ? Object.fromEntries(Object.entries(b.replies).map(([k, v]) => [k, strs(v)]))
      : {},
    fns: isObj(b.fns)
      ? Object.fromEntries(
          Object.entries(b.fns).flatMap(([k, v]) =>
            Array.isArray(v) && typeof v[0] === "number" && typeof v[1] === "number"
              ? [[k, [v[0], v[1]] as [number, number]]]
              : [],
          ),
        )
      : {},
    limits: isObj(b.limits)
      ? {
          steps: numOf(b.limits.steps, 40),
          each: numOf(b.limits.each, 50),
          nesting: numOf(b.limits.nesting, 3),
        }
      : { steps: 40, each: 50, nesting: 3 },
    functions: (Array.isArray(b.functions) ? b.functions : []).filter(isObj).flatMap((f) =>
      typeof f.id === "string"
        ? [
            {
              id: f.id.slice(0, 120),
              name: strOf(f.name, 160) ?? f.id,
              code: strOf(f.code, 200_000) ?? "",
              tests: (Array.isArray(f.tests) ? f.tests : [])
                .slice(0, 100)
                .flatMap((x) => (typeof x === "string" ? [x.slice(0, 200)] : [])),
            },
          ]
        : [],
    ),
    collections: (Array.isArray(b.collections) ? b.collections : []).filter(isObj).flatMap((c) =>
      typeof c.key === "string"
        ? [
            {
              ...(typeof c.id === "string" ? { id: c.id.slice(0, 80) } : {}),
              key: c.key,
              name: strOf(c.name, 120) ?? c.key,
              parent: strOf(c.parent, 80),
              fields: (Array.isArray(c.fields) ? c.fields : []).filter(isObj).map((f) => ({
                key: strOf(f.key, 80) ?? "",
                name: strOf(f.name, 120) ?? "",
                type: strOf(f.type, 40) ?? "text",
                roles: strs(f.roles),
                relation: strOf(f.relation, 80),
              })),
            },
          ]
        : [],
    ),
    modules: strs(b.modules),
  };
}
export function parseFlowCheck(b: unknown): FlowCheck {
  if (!isObj(b)) return { problems: [], refs: {}, outs: {} };
  const problems = (Array.isArray(b.problems) ? b.problems : []).filter(isObj).map((p) => ({
    step: strOf(p.step, 80),
    at: strOf(p.at, 120),
    code: strOf(p.code, 60) ?? "bad-plan",
  }));
  const byStep = (x: unknown): FlowCheck["refs"] => {
    const out: FlowCheck["refs"] = {};
    if (isObj(x))
      for (const [k, v] of Object.entries(x))
        if (Array.isArray(v))
          out[k] = v
            .filter(isObj)
            .flatMap((r) =>
              typeof r.ref === "string" ? [{ ref: r.ref, t: strOf(r.t, 20) ?? "value" }] : [],
            );
    return out;
  };
  // A server before task 70 says nothing of what each step gives.
  return { problems, refs: byStep(b.refs), outs: byStep(b.outs) };
}
const planOf = (v: unknown): FlowPlan =>
  isObj(v) && Array.isArray(v.steps)
    ? {
        version: 1,
        steps: v.steps.filter(
          (s): s is FlowStep => isObj(s) && typeof s.id === "string" && typeof s.op === "string",
        ),
      }
    : { version: 1, steps: [] };
const ID_RE = /^[A-Za-z0-9_-]{1,80}$/;
function parseFlowSummary(v: unknown): FlowSummary | null {
  if (!isObj(v) || typeof v.id !== "string" || !ID_RE.test(v.id) || typeof v.name !== "string")
    return null;
  return {
    id: v.id,
    name: v.name.slice(0, 120),
    version: numOf(v.version, 1),
    trigger: isObj(v.trigger) ? v.trigger : {},
    by: typeof v.by === "string" ? v.by.slice(0, 40) : "",
    enabled: v.enabled !== false,
    steps: numOf(v.steps),
    runs: numOf(v.runs),
    last: typeof v.last === "number" ? v.last : null,
  };
}
export function parseFlows(b: unknown): FlowSummary[] {
  if (!isObj(b) || !Array.isArray(b.flows)) return [];
  return b.flows.map(parseFlowSummary).filter((f): f is FlowSummary => f !== null);
}
const strsOf = (v: unknown, max: number) =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, max) : [];
/** A step as the server draws it (`nodesOf`); null when it is not one. */
function parseFlowNode(n: unknown): FlowStepNode | null {
  if (!isObj(n) || typeof n.id !== "string" || !ID_RE.test(n.id)) return null;
  const ran: Record<string, number> = {};
  if (isObj(n.ran))
    for (const [k, x] of Object.entries(n.ran)) if (/^[a-z]+$/.test(k)) ran[k] = numOf(x);
  return {
    id: n.id,
    op: typeof n.op === "string" ? n.op : "",
    what: typeof n.what === "string" ? n.what.slice(0, 80) : "",
    title: typeof n.title === "string" ? n.title.slice(0, 80) : null,
    detail: typeof n.detail === "string" ? n.detail.slice(0, 120) : null,
    when: n.when === true,
    each: n.each === true,
    args: strsOf(n.args, 40).map((a) => a.slice(0, 300)),
    deps: strsOf(n.deps, 40),
    ran,
    ...(Array.isArray(n.into) ? { into: strsOf(n.into, 20).map((x) => x.slice(0, 80)) } : {}),
    ...(typeof n.calls === "number" ? { calls: numOf(n.calls), cost: numOf(n.cost) } : {}),
  };
}
const parseInputs = (v: unknown) =>
  Array.isArray(v)
    ? v
        .filter((i): i is { id: string; what: string } => isObj(i) && typeof i.id === "string")
        .map((i) => ({
          id: i.id.slice(0, 40),
          what: typeof i.what === "string" ? i.what : "value",
        }))
    : [];
const CHANGES = ["new", "changed", "same", "removed"] as const;
export function parseFlowProposal(v: unknown): FlowProposalView | undefined {
  if (!isObj(v) || typeof v.name !== "string" || !Array.isArray(v.nodes)) return undefined;
  const c = isObj(v.changes) ? v.changes : null;
  return {
    name: v.name.slice(0, 120),
    changes:
      c && typeof c.id === "string" && typeof c.name === "string"
        ? { id: c.id, name: c.name.slice(0, 120), version: numOf(c.version, 1) }
        : null,
    trigger: isObj(v.trigger) ? v.trigger : {},
    inputs: parseInputs(v.inputs),
    nodes: v.nodes.flatMap((n) => {
      const node = parseFlowNode(n);
      const change = isObj(n) ? (n.change as string) : "same";
      return node
        ? [
            {
              ...node,
              change: (CHANGES as readonly string[]).includes(change)
                ? (change as (typeof CHANGES)[number])
                : "same",
            },
          ]
        : [];
    }),
  };
}
export function parseFlowDetail(b: unknown): FlowDetailView | null {
  const s = parseFlowSummary(b);
  if (!s || !isObj(b) || !Array.isArray(b.nodes)) return null;
  const nodes = b.nodes.map(parseFlowNode).filter((n): n is FlowStepNode => n !== null);
  const inputs = parseInputs(b.inputs);
  const versions = Array.isArray(b.versions)
    ? b.versions.filter(isObj).map((v) => ({
        version: numOf(v.version),
        by: typeof v.by === "string" ? v.by : "",
        created: numOf(v.created),
      }))
    : [];
  return {
    ...s,
    inputs,
    nodes,
    days: numOf(b.days, 7),
    versions,
    plan: planOf(b.plan),
    preset: typeof b.preset === "number" ? b.preset : null,
    mailKey: strOf(b.mailKey, 80),
  };
}

export function parseModels(b: unknown): ModelsView | null {
  if (!isObj(b)) return null;
  const roles = (Array.isArray(b.roles) ? b.roles : []).filter(isObj).flatMap((r) => {
    const role = oneOf(MODEL_ROLES, r.role);
    const c = choiceOf(r);
    if (!role || !c) return [];
    const privacy =
      oneOf(["keeps-nothing", "deletes-in-30-days", "may-keep", "unknown"] as const, r.privacy) ??
      "unknown";
    return [{ ...c, role, privacy, chosen: r.chosen === true, missingKey: r.missingKey === true }];
  });
  const sp = isObj(b.spending) ? b.spending : {};
  const budget = isObj(b.budget) ? b.budget : {};
  const evaluating = isObj(b.evaluating) ? b.evaluating : null;
  const evalRole = evaluating ? oneOf(MODEL_ROLES, evaluating.role) : null;
  const evalChoice = evaluating ? choiceOf(evaluating) : null;
  return {
    roles,
    connections: (Array.isArray(b.connections) ? b.connections : []).filter(isObj).flatMap((c) => {
      const connection = oneOf(MODEL_CONNECTIONS, c.connection);
      return connection ? [{ connection, mine: c.mine === true, server: c.server === true }] : [];
    }),
    budget: { monthlyEur: num(budget.monthlyEur, 10), warnAt: num(budget.warnAt, 0.8) },
    notice: b.notice !== false,
    usdToEur: num(b.usdToEur, 0.9),
    spending: {
      month: s200(sp.month, 7),
      eur: num(sp.eur),
      rows: (Array.isArray(sp.rows) ? sp.rows : [])
        .filter(isObj)
        .slice(0, 100)
        .map((r) => ({
          role: s200(r.role, 40),
          provider: s200(r.provider, 40),
          model: s200(r.model, 120),
          calls: num(r.calls),
          eur: num(r.eur),
          unpriced: num(r.unpriced),
        })),
      byDay: (Array.isArray(sp.byDay) ? sp.byDay : [])
        .filter(isObj)
        .slice(0, 31)
        .map((d) => ({
          day: s200(d.day, 10),
          eur: num(d.eur),
          byModel: Object.fromEntries(
            Object.entries(isObj(d.byModel) ? d.byModel : {})
              .slice(0, 30)
              .map(([k, v]) => [k.slice(0, 120), num(v)]),
          ),
        })),
    },
    over: b.over === true,
    evaluations: (Array.isArray(b.evaluations) ? b.evaluations : [])
      .filter(isObj)
      .slice(0, 20)
      .flatMap((e) => {
        const role = oneOf(MODEL_ROLES, e.role);
        const c = choiceOf(e);
        if (!role || !c) return [];
        return [
          {
            ...c,
            role,
            at: num(e.at),
            right: num(e.right),
            total: num(e.total),
            wrong: num(e.wrong),
            cost: num(e.cost),
            cases: (Array.isArray(e.cases) ? e.cases : [])
              .filter(isObj)
              .slice(0, 50)
              .map((x) => ({
                name: s200(x.name, 300),
                ok: x.ok === true,
                note: s200(x.note, 200),
              })),
            ...(Array.isArray(e.calibration)
              ? {
                  calibration: e.calibration
                    .filter(isObj)
                    .slice(0, 10)
                    .map((l) => ({
                      from: Number(l.from) || 0,
                      to: Number(l.to) || 0,
                      judged: count(l.judged),
                      right: count(l.right),
                    })),
                }
              : {}),
          },
        ];
      }),
    evaluating: evalRole && evalChoice ? { ...evalChoice, role: evalRole } : null,
  };
}
/** What Settings «Decisiones» shows: the areas and whether Boni learns at all (an older server: it does). */
export interface DecisionsView {
  areas: AreaAccuracy[];
  learning: boolean;
}
const parseDecisions = (b: unknown): DecisionsView => ({
  areas: parseAreas(b),
  learning: !(isObj(b) && b.learning === false),
});
/**
 * What is on the screen as Juan writes (docs/sistema.md §4.7, F9; task 85), by reference only: what is open, the
 * Bandeja's cards in the order it shows them, the rows he chose, what he pointed at. The server makes them values
 * from what the store holds, through the models' view.
 */
export interface ScreenRefs {
  open: { kind: string; id: string | null } | null;
  inbox: { kind: "proposal" | "question"; id: string }[];
  chosen: string[];
  /** What Juan pointed at for this message (`Ctrl+Shift+E`): blocks of a page, rows, cards. */
  pointed?: PointedRef[];
}

/** The areas of `GET /api/agent/decisions` (and of the PUT that turns a switch). */
function parseAreas(b: unknown): AreaAccuracy[] {
  const areas = isObj(b) && Array.isArray(b.areas) ? b.areas : [];
  return areas.filter(isObj).flatMap((a) => {
    const area = str(a.area, 40);
    if (!area) return [];
    const levels = (Array.isArray(a.levels) ? a.levels : []).filter(isObj).map((l) => ({
      from: Number(l.from) || 0,
      to: Number(l.to) || 0,
      judged: count(l.judged),
      right: count(l.right),
    }));
    const e = isObj(a.earnsWith) ? a.earnsWith : null;
    return [
      {
        area,
        cost: a.cost === "A" || a.cost === "B" ? a.cost : "C",
        total: count(a.total),
        done: count(a.done),
        asked: count(a.asked),
        nothing: count(a.nothing),
        judged: count(a.judged),
        right: count(a.right),
        levels,
        switchable: a.switchable === true,
        auto: a.auto === true,
        autoBy: a.autoBy === "juan" || a.autoBy === "boni" ? a.autoBy : null,
        autoAt: typeof a.autoAt === "number" ? a.autoAt : null,
        earned: a.earned === true,
        earnsWith: e ? { decisions: count(e.decisions), accuracy: Number(e.accuracy) || 0 } : null,
      },
    ];
  });
}
function parseCatalogue(b: unknown): CatalogueModel[] {
  const list = isObj(b) && Array.isArray(b.models) ? b.models : [];
  return list
    .filter(isObj)
    .slice(0, 1000)
    .flatMap((m) =>
      typeof m.id === "string" && m.id.length <= 120
        ? [
            {
              id: m.id,
              name: s200(m.name, 120) || m.id,
              input: num(m.input),
              output: num(m.output),
              context: num(m.context),
              providers: (Array.isArray(m.providers) ? m.providers : [])
                .filter((x): x is string => typeof x === "string")
                .slice(0, 60)
                .map((x) => x.slice(0, 60)),
              structured: m.structured === true,
            },
          ]
        : [],
    );
}

const ACTIONS = ["create", "update", "delete", "restore"] as const;
function runChanges(v: unknown): RunChange[] | undefined {
  if (!Array.isArray(v)) return undefined;
  return v
    .filter(isObj)
    .slice(0, 20)
    .flatMap((c) => {
      const action = ACTIONS.find((a) => a === c.action);
      if (!action) return [];
      return [
        {
          action,
          title: typeof c.title === "string" ? c.title.slice(0, 200) : "",
          collection: typeof c.collection === "string" ? c.collection.slice(0, 200) : "",
          undone: c.undone === true,
        },
      ];
    });
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown, max = 200): string | null =>
  typeof v === "string" && v.length <= max ? v : null;
const strs = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 50) : [];

/** A painted value, or null when it is not one (depth and size are bounded). */
export function parsePainted(v: unknown, depth = 0): Painted | null {
  if (!isObj(v) || depth > 6) return null;
  const integrity = str(v.integrity, 20) ?? "external";
  if (v.t === "v") {
    const sensitivity = str(v.sensitivity, 20) ?? "personal";
    return { t: "v", value: v.value, integrity, sensitivity };
  }
  if (v.t === "list" && Array.isArray(v.items))
    return {
      t: "list",
      integrity,
      items: v.items
        .slice(0, 200)
        .map((i) => parsePainted(i, depth + 1))
        .filter((x): x is Painted => x !== null),
    };
  if (v.t === "rec" && isObj(v.fields)) {
    const fields: Record<string, Painted> = {};
    for (const [k, f] of Object.entries(v.fields).slice(0, 50)) {
      const p = parsePainted(f, depth + 1);
      if (p) fields[k] = p;
    }
    return { t: "rec", integrity, fields };
  }
  return null;
}

export function parseConfirmView(v: unknown): ConfirmView | null {
  if (!isObj(v) || !Array.isArray(v.rows)) return null;
  const tool = str(v.tool, 80);
  const title = str(v.title, 80);
  if (!tool || !title) return null;
  const rows: ConfirmRow[] = [];
  // A confirmation shows every value or none: an entity's fields are one row each.
  if (v.rows.length > 120) return null;
  for (const r of v.rows) {
    if (!isObj(r)) continue;
    const arg = str(r.arg, 100);
    const value = typeof r.value === "string" ? r.value : null;
    if (!arg || value === null) continue;
    rows.push({
      arg,
      role: str(r.role, 20) ?? "",
      value,
      integrity: str(r.integrity, 20) ?? "external",
      sources: strs(r.sources),
      marks: strs(r.marks),
      ...(str(r.name, 80) ? { name: str(r.name, 80) as string } : {}),
      ...(str(r.detail, 300) ? { detail: str(r.detail, 300) as string } : {}),
    });
  }
  return { tool, title, rows };
}

const COMPONENTS = new Set(["text", "number", "list", "table", "chart", "run", "open"]);

export function parseTurn(v: unknown): TurnResult {
  if (!isObj(v)) throw new ApiError(0, "bad-answer", "bad answer");
  const replies: Reply[] = [];
  for (const r of Array.isArray(v.replies) ? v.replies.slice(0, 20) : []) {
    if (!isObj(r) || !COMPONENTS.has(r.component as string) || !isObj(r.data)) continue;
    const data: Record<string, Painted> = {};
    for (const [k, d] of Object.entries(r.data)) {
      const p = parsePainted(d);
      if (p) data[k] = p;
    }
    replies.push({ component: r.component as Reply["component"], data });
  }
  let pending: Pending | null = null;
  const p = v.pending;
  if (isObj(p) && typeof p.id === "string") {
    if (p.kind === "confirm") {
      const view = parseConfirmView(p.view);
      if (view) pending = { kind: "confirm", id: p.id, view };
    } else pending = parseAsk(p);
  }
  const status = v.status === "done" || v.status === "waiting" ? v.status : "stopped";
  return {
    run: str(v.run, 80) ?? "",
    status,
    replies,
    pending: status === "waiting" ? pending : null,
    proposals: strs(v.proposals),
    notices: (Array.isArray(v.notices) ? v.notices : []).filter(isObj).map((n) => ({
      code: str(n.code, 40) ?? "",
      ...(typeof n.rule === "string" ? { rule: n.rule.slice(0, 10) } : {}),
      ...(typeof n.n === "number" ? { n: n.n } : {}),
    })),
    error: typeof v.error === "string" ? v.error.slice(0, 80) : null,
    ...(typeof v.changed === "boolean" ? { changed: v.changed } : {}),
  };
}

function parseConversation(v: unknown): ConversationSummary | null {
  if (!isObj(v)) return null;
  const id = str(v.id, 80);
  if (!id) return null;
  return {
    id,
    title: typeof v.title === "string" ? v.title.slice(0, 200) : "",
    model: typeof v.model === "string" ? v.model.slice(0, 200) : "",
    last: typeof v.last === "number" ? v.last : 0,
  };
}

/** Something of today in Juan's calendars (Inicio's «Hoy» on the phone). */
export interface TodayItem {
  id: string;
  type: string;
  collection: string;
  title: string;
  /** "HH:MM" when it starts today at a time; null for all day. */
  start: string | null;
  task: boolean;
  done: boolean;
  doneField: string | null;
}

/** A step's words: the tool's name and up to 8 arguments, each a short text. */
export interface StepWords {
  tool: string;
  args: Record<string, string>;
}
function parseWords(v: Record<string, unknown>): StepWords | null {
  const tool = str(v.tool, 80);
  if (!tool || !isObj(v.args)) return null;
  const args: Record<string, string> = {};
  for (const [k, x] of Object.entries(v.args).slice(0, 8)) {
    const s = str(x, 80);
    if (s && /^[a-z_]{1,20}$/.test(k)) args[k] = s;
  }
  return { tool, args };
}

/** A live event as the server sends it: fixed codes and the code's words; a reply parsed as any reply. */
function parseLive(v: unknown): LiveEvent | null {
  if (!isObj(v)) return null;
  switch (v.type) {
    case "start":
      return str(v.run, 80) ? { type: "start", run: v.run as string } : null;
    case "planning":
      return { type: "planning" };
    case "planned":
      return { type: "planned", steps: typeof v.steps === "number" ? v.steps : 0 };
    case "step": {
      const id = str(v.id, 80);
      if (!id || (v.state !== "start" && v.state !== "done")) return null;
      const words = isObj(v.words) ? parseWords(v.words) : null;
      return {
        type: "step",
        id,
        op: str(v.op, 20) ?? "",
        what: str(v.what, 120) ?? "",
        state: v.state,
        ...(words ? { words } : {}),
        ...(Number.isInteger(v.n) && (v.n as number) >= 0 ? { n: v.n as number } : {}),
        ...(typeof v.value === "number" && Number.isFinite(v.value) ? { value: v.value } : {}),
      };
    }
    case "reply": {
      const r = parseTurn({ replies: [v.reply], status: "done" }).replies[0];
      return r ? { type: "reply", reply: r } : null;
    }
    case "waiting":
      return { type: "waiting" };
    case "end":
      return {
        type: "end",
        status: v.status === "done" || v.status === "waiting" ? v.status : "stopped",
        error: typeof v.error === "string" ? v.error.slice(0, 80) : null,
      };
    default:
      return null;
  }
}

// ---------------------------------------------------------------- painting as text

/** The plain text of a value: what the interface shows, always as text. */
export function textOf(p: Painted): string {
  if (p.t === "list") return p.items.map(textOf).join(", ");
  if (p.t === "rec") {
    const f = p.fields;
    const main = f.titulo ?? f.title ?? f.nombre ?? f.name ?? f.text ?? f.asunto;
    return main ? textOf(main) : Object.values(f).map(textOf).join(" · ");
  }
  const x = p.value;
  if (x === null || x === undefined) return "";
  if (typeof x === "string") return x;
  if (typeof x === "number" || typeof x === "boolean") return String(x);
  if (isObj(x) && typeof x.proposal === "string") return "";
  return JSON.stringify(x);
}

/** Whether a value is the marker the server leaves for a step that went to the inbox. */
export const isProposal = (p: Painted): boolean =>
  p.t === "v" && isObj(p.value) && typeof (p.value as { proposal?: unknown }).proposal === "string";

/** The deepest-trusted label first: what a value made of several is worth. */
const ORDER = ["external", "model", "ambient", "imported", "own", "user"];
export function lowest(p: Painted): string {
  const all: string[] = [];
  const walk = (x: Painted) => {
    all.push(x.integrity);
    if (x.t === "list") x.items.forEach(walk);
    if (x.t === "rec") Object.values(x.fields).forEach(walk);
  };
  walk(p);
  return all.reduce((a, b) => (ORDER.indexOf(b) < ORDER.indexOf(a) ? b : a), "user");
}

/** A template's pieces: literal text and the slots {a}..{d} filled with their values. */
export function fillTemplate(
  template: string,
  slots: Record<string, Painted | undefined>,
): ({ text: string } | { slot: Painted })[] {
  const out: ({ text: string } | { slot: Painted })[] = [];
  let last = 0;
  for (const m of template.matchAll(/\{([abcd])\}/g)) {
    const slot = slots[m[1] as string];
    if (!slot) continue;
    if (m.index > last) out.push({ text: template.slice(last, m.index) });
    out.push({ slot });
    last = m.index + m[0].length;
  }
  if (last < template.length) out.push({ text: template.slice(last) });
  return out;
}

/** Code points that do not show or turn text around, made visible: "‮" -> "⟦U+202E⟧". */
export function reveal(text: string): string {
  let out = "";
  for (const ch of text) {
    const c = ch.codePointAt(0) as number;
    const hidden =
      c === 0xad ||
      c === 0x34f ||
      c === 0x61c ||
      (c >= 0x115f && c <= 0x1160) ||
      (c >= 0x17b4 && c <= 0x17b5) ||
      (c >= 0x180b && c <= 0x180e) ||
      (c >= 0x200b && c <= 0x200f) ||
      (c >= 0x202a && c <= 0x202e) ||
      (c >= 0x2060 && c <= 0x206f) ||
      c === 0x3164 ||
      (c >= 0xfe00 && c <= 0xfe0f) ||
      c === 0xfeff;
    out += hidden ? `⟦U+${c.toString(16).toUpperCase().padStart(4, "0")}⟧` : ch;
  }
  return out;
}

// ---------------------------------------------------------------- the API

/** The account's mailbox as the server shows it (never its password). */
export interface MailView {
  host: string;
  port: number;
  user: string;
  folder: string;
  collections: string[];
  on: boolean;
  /** `type`: the "Correos" collection's id (null before the first check). */
  state: {
    lastCheck: number;
    lastError: string | null;
    count: number;
    type: string | null;
    /** The reviewer's suggestion for the reading guide, waiting for Juan. */
    suggestion: MailSuggestion | null;
  };
}
export interface MailSuggestion {
  id: string;
  rules: MailRule[];
  examples: { id: string; subject: string; want: { title: string }[] }[];
  before: number;
  after: number;
  total: number;
}

function parseSuggestion(v: unknown): MailSuggestion | null {
  if (!isObj(v)) return null;
  const id = str(v.id, 80);
  const n = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : 0);
  const g = parseGuide({ rules: v.rules, examples: v.examples, instructions: "" });
  if (!id || !g) return null;
  return {
    id,
    rules: g.rules,
    examples: g.examples,
    before: n(v.before),
    after: n(v.after),
    total: n(v.total),
  };
}

export function parseMail(v: unknown): MailView | null {
  if (!isObj(v) || !isObj(v.state)) return null;
  const host = str(v.host, 253);
  const user = str(v.user, 320);
  if (!host || !user) return null;
  return {
    host,
    port: typeof v.port === "number" ? v.port : 993,
    user,
    folder: str(v.folder, 200) ?? "INBOX",
    collections: strs(v.collections),
    on: v.on !== false,
    state: {
      lastCheck: typeof v.state.lastCheck === "number" ? v.state.lastCheck : 0,
      lastError: str(v.state.lastError, 40),
      count: typeof v.state.count === "number" ? v.state.count : 0,
      type: str(v.state.type, 80),
      suggestion: parseSuggestion(v.state.suggestion),
    },
  };
}
/** A page of the user's (docs/extensiones.md 6): its place in the tree, and its blocks when opened. */
export interface PageInfo {
  id: string;
  title: string;
  icon: string;
  parent: string | null;
  position: number;
  template?: PageTemplate;
}
export interface Page extends PageInfo {
  spec: PageSpec;
}

function parsePageInfo(v: unknown): PageInfo | null {
  if (!isObj(v)) return null;
  const id = str(v.id, 80);
  if (!id) return null;
  return {
    id,
    title: str(v.title, 200) ?? "",
    icon: str(v.icon, 16) ?? "",
    parent: str(v.parent, 80),
    position: typeof v.position === "number" ? v.position : 0,
    ...(isPageTemplate(v.template) ? { template: v.template } : {}),
  };
}

/** A page with its blocks, checked again here: a block off the catalogue is never painted. */
function parsePage(b: unknown): Page | null {
  const v = isObj(b) ? b.page : null;
  const i = parsePageInfo(v);
  if (!i || !isObj(v)) return null;
  // Blocks of a kind that is no more are left out (packages/views `withoutRetired`), never the whole page.
  const raw = withoutRetired(v.spec);
  const spec = pageErrors(raw).length ? emptyPage() : (raw as PageSpec);
  return { ...i, spec };
}

/** Rows as a collection's table lists them: each checked, the titles relations point to, the system columns. */
function rowList(b: unknown) {
  const rows =
    isObj(b) && Array.isArray(b.rows) ? b.rows.map(parseRow).filter((x): x is DataRow => !!x) : [];
  const titles = isObj(b) && isObj(b.titles) ? (b.titles as Record<string, string>) : {};
  // Each row's system columns (Juan, 2026-10-24), when the server keeps them.
  const columns: Record<string, SystemColumns> = {};
  if (isObj(b) && isObj(b.columns))
    for (const [id, c] of Object.entries(b.columns)) {
      const p = parseColumns(c);
      if (p) columns[id] = p;
    }
  return { rows, titles, columns };
}

/** A collection of the user's as a database (plan PR 19): its fields, and its rows. */
export interface DataField {
  id: string;
  /** Its key: what a proposal's values are named by (an older server does not say). */
  key?: string;
  name: string;
  type: string;
  options?: { id: string; name: string; color?: string }[];
  relation?: { target: string; many: boolean };
  /** A mother's field her daughter has: changed at the mother, never in the daughter's table. */
  inherited?: boolean;
}
/** A collection in the tree: its mother, its name and whether its records with a note show under it. */
export interface TreeCollection {
  id: string;
  parent?: string;
  name: string;
  icon: string;
  count: number;
  notes: boolean;
}
export interface TreeNote {
  id: string;
  type: string;
  title: string;
  /** The models and assistants that read it, and when last («Todas las páginas» only). */
  ai?: string[];
  aiAt?: number | null;
}
export interface Tree {
  collections: TreeCollection[];
  notes: TreeNote[];
}

export interface DataType {
  id: string;
  /** Its key, how the planner names it in plans and replies ("correo"); servers before 0.8.73 send none. */
  key?: string;
  /** Its mother collection (docs/clases.md): its table is part of hers. */
  parent?: string;
  name: string;
  icon: string;
  titleField: string;
  fields: DataField[];
  count: number;
  /** How much the models may see of it. */
  level: AiLevel;
  /** The vault zone it came from, if any. */
  zone?: Zone;
  /** Parts of it with their own level: the rows that match every condition of a rule. */
  rules: ProtectionRule[];
  /** The fields that play a role for the apps (docs/clases.md §6): day, amount, category… by role. */
  roles?: Record<string, string>;
  /** A collection a connector fills (the mail's): shown, never edited (D-22). */
  readOnly?: boolean;
  /** Its rows open as a mail (who, to whom, when, the text) instead of as a page. */
  view?: "mail";
  /** How its rows open as pages (the account's, every device): properties unfolded, and those hidden. */
  rowUi: {
    open: boolean;
    hidden: string[];
    related: boolean;
    folded: string[];
    /** The table's columns' widths in px, by field (as the user left them). */
    widths: Record<string, number>;
    /** Its views as tabs (task 69): the account's, the same on every device. */
    views: SavedView[];
  };
  /** Boni's own records (calls to models, its activity): read only, never seen by a model. */
  system?: true;
  /**
   * In one of Boni's collections that a person changes («Mis datos»: a row's name, mother, level and eye are its
   * collection's or its page's), the fields he changes; the rest is computed.
   */
  editable?: string[];
  /**
   * The box that marks a record done (its calendar's task column, Boni Calendar's «Hecha»), by its field's id: what
   * the phone's lists tick and filter by. None when the collection keeps no tasks.
   */
  done?: string;
}
export interface ProtectionRule {
  id: string;
  filter: DatabaseFilter[];
  level: AiLevel;
}
export type DataValue =
  | string
  | number
  | boolean
  | string[]
  | { amount: number; currency: string }
  | null;
export interface DataRow {
  id: string;
  values: Record<string, DataValue>;
  updated: number;
  /** The row's text (a note's body), when it was opened as a page. */
  body?: string;
  type?: string;
  /** A pending proposal drawn as a row (its id): never an entity, nothing counts it until accepted. */
  ghost?: string;
  /** What of it a person does not change here, though its collection lets him («Mis datos»: a page's level). */
  fixed?: string[];
}

/**
 * Whether a person changes a field of a collection from the app: any of his own (not one a connector fills); in Boni's,
 * only what it says he changes («Mis datos»).
 */
export const fieldEditable = (t: DataType, field: string, row?: DataRow) =>
  (t.editable ? t.editable.includes(field) : !t.system && !t.readOnly) &&
  !row?.fixed?.includes(field);

function parseDataType(v: unknown): DataType | null {
  if (!isObj(v) || typeof v.id !== "string" || !Array.isArray(v.fields)) return null;
  return {
    id: v.id,
    ...(typeof v.parent === "string" ? { parent: v.parent } : {}),
    name: str(v.name, 200) ?? v.id,
    icon: str(v.icon, 16) ?? "",
    titleField: str(v.titleField, 80) ?? "",
    ...(typeof v.key === "string" && v.key ? { key: v.key.slice(0, 60) } : {}),
    count: typeof v.count === "number" ? v.count : 0,
    level: levelOf(v.level),
    ...(v.system === true ? { system: true as const } : {}),
    ...(Array.isArray(v.editable)
      ? { editable: v.editable.filter((x): x is string => typeof x === "string").slice(0, 20) }
      : {}),
    ...(typeof v.done === "string" ? { done: v.done } : {}),
    ...(v.readOnly === true ? { readOnly: true } : {}),
    ...(v.view === "mail" ? { view: "mail" as const } : {}),
    ...(isObj(v.roles)
      ? {
          roles: Object.fromEntries(
            Object.entries(v.roles)
              .filter((e): e is [string, string] => typeof e[1] === "string")
              .slice(0, 12),
          ),
        }
      : {}),
    rules: Array.isArray(v.rules)
      ? v.rules.flatMap((r): ProtectionRule[] =>
          isObj(r) && typeof r.id === "string" && filterErrors(r.filter).length === 0
            ? [{ id: r.id, filter: r.filter as DatabaseFilter[], level: levelOf(r.level) }]
            : [],
        )
      : [],
    ...(zoneOf(v.zone) ? { zone: zoneOf(v.zone) } : {}),
    rowUi: {
      open: isObj(v.rowUi) && v.rowUi.open === true,
      hidden:
        isObj(v.rowUi) && Array.isArray(v.rowUi.hidden)
          ? v.rowUi.hidden.filter((x): x is string => typeof x === "string")
          : [],
      related: isObj(v.rowUi) && v.rowUi.related === true,
      folded:
        isObj(v.rowUi) && Array.isArray(v.rowUi.folded)
          ? v.rowUi.folded.filter((x): x is string => typeof x === "string")
          : [],
      widths: Object.fromEntries(
        Object.entries(isObj(v.rowUi) && isObj(v.rowUi.widths) ? v.rowUi.widths : {}).filter(
          (e): e is [string, number] => typeof e[1] === "number" && e[1] >= 40 && e[1] <= 1600,
        ),
      ),
      views: savedViewsOf(isObj(v.rowUi) ? v.rowUi.views : undefined),
    },
    fields: v.fields.flatMap((f): DataField[] =>
      isObj(f) && typeof f.id === "string" && typeof f.type === "string"
        ? [
            {
              id: f.id,
              ...(typeof f.key === "string" ? { key: f.key.slice(0, 80) } : {}),
              name: str(f.name, 200) ?? f.id,
              type: f.type,
              ...(f.inherited === true ? { inherited: true } : {}),
              ...(Array.isArray(f.options)
                ? {
                    options: f.options.flatMap((o) =>
                      isObj(o) && typeof o.id === "string"
                        ? [
                            {
                              id: o.id,
                              name: str(o.name, 200) ?? o.id,
                              ...(typeof o.color === "string" ? { color: o.color } : {}),
                            },
                          ]
                        : [],
                    ),
                  }
                : {}),
              ...(isObj(f.relation) && typeof f.relation.target === "string"
                ? { relation: { target: f.relation.target, many: Boolean(f.relation.many) } }
                : {}),
            },
          ]
        : [],
    ),
  };
}
/** What points to a row (its «Relacionado»): by collection and field, each with its rows (title, first date). */
export interface RelatedGroup {
  type: string;
  collection: string;
  icon?: string;
  field: string;
  fieldName: string;
  count: number;
  rows: { id: string; title: string; date?: string }[];
}
export interface Related {
  groups: RelatedGroup[];
  /** The titles of what the row itself points to (its relations' values). */
  titles: Record<string, string>;
}
function parseRelated(v: unknown): Related {
  const b = isObj(v) ? v : {};
  const s = (x: unknown, max = 300) => (typeof x === "string" ? x.slice(0, max) : "");
  const groups = (Array.isArray(b.groups) ? b.groups : []).flatMap((g): RelatedGroup[] => {
    if (!isObj(g) || typeof g.type !== "string" || typeof g.field !== "string") return [];
    const rows = (Array.isArray(g.rows) ? g.rows : []).flatMap((r) =>
      isObj(r) && typeof r.id === "string"
        ? [
            {
              id: r.id,
              title: s(r.title),
              ...(typeof r.date === "string" ? { date: s(r.date, 10) } : {}),
            },
          ]
        : [],
    );
    return [
      {
        type: g.type,
        collection: s(g.collection, 80),
        ...(typeof g.icon === "string" ? { icon: s(g.icon, 8) } : {}),
        field: g.field,
        fieldName: s(g.fieldName, 80),
        count: Number(g.count) || rows.length,
        rows,
      },
    ];
  });
  const titles: Record<string, string> = {};
  if (isObj(b.titles))
    for (const [k, x] of Object.entries(b.titles))
      if (typeof x === "string") titles[k] = x.slice(0, 300);
  return { groups, titles };
}

function parseRow(v: unknown): DataRow | null {
  if (!isObj(v) || typeof v.id !== "string" || !isObj(v.values)) return null;
  return {
    id: v.id,
    values: v.values as DataRow["values"],
    updated: Number(v.updated) || 0,
    ...(typeof v.body === "string" ? { body: v.body } : {}),
    ...(typeof v.type === "string" ? { type: v.type } : {}),
    ...(Array.isArray(v.fixed)
      ? { fixed: v.fixed.filter((x): x is string => typeof x === "string").slice(0, 20) }
      : {}),
  };
}

/** An installed extension as the server shows it (docs/extensiones.md 3). */
export interface ExtensionView {
  id: string;
  name: string;
  description: string;
  version: number;
  /** The preset version it still is, or null once it was changed. */
  preset: number | null;
  enabled: boolean;
  reads: string[];
  proposes: boolean;
  readersPerDay: number | null;
  sources: string[];
  modules: string[];
  /** The version before the active one, to go back to with one click (E3), or null. */
  previous: number | null;
}

/**
 * A version of an extension proposed through Boni's MCP and waiting for Juan (docs/extensiones.md §11, E3): what it
 * asks for beyond the active version, in the account's names; what it reads that is private; its tests, its dry
 * runs on Juan's data, and its code. Everything in it is shown as plain text.
 */
export interface ProposalView {
  id: string;
  name: string;
  description: string;
  version: number;
  active: number | null;
  by: string;
  at: number;
  more: {
    code: string[];
    reads: { collection: string; fields: string[] }[];
    writes: { collection: string; fields: string[] }[];
    creates: string[];
    updates: string[];
    asks: boolean;
    other: string[];
  };
  privateReads: string[];
  tests: { function: string; name: string; ok: boolean; message: string }[];
  dryRuns: {
    function: string;
    ok: boolean;
    message: string;
    creates: Record<string, number>;
    updates: number;
    asks: string[];
  }[];
  functions: { name: string; hash: string; code: string }[];
}

const groups = (v: unknown) =>
  (Array.isArray(v) ? v : []).flatMap((g) =>
    isObj(g) && typeof g.collection === "string"
      ? [{ collection: g.collection.slice(0, 80), fields: strs(g.fields) }]
      : [],
  );

function parseProposal(v: unknown): ProposalView | null {
  if (!isObj(v)) return null;
  const id = str(v.id, 40);
  const name = str(v.name, 60);
  if (!id || !name) return null;
  const m = isObj(v.more) ? v.more : {};
  const report = isObj(v.report) ? v.report : {};
  const counts = (x: unknown): Record<string, number> =>
    isObj(x)
      ? Object.fromEntries(
          Object.entries(x).filter((e): e is [string, number] => typeof e[1] === "number"),
        )
      : {};
  return {
    id,
    name,
    description: str(v.description, 300) ?? "",
    version: typeof v.version === "number" ? v.version : 1,
    active: typeof v.active === "number" ? v.active : null,
    by: str(v.by, 80) ?? "",
    at: typeof v.at === "number" ? v.at : 0,
    more: {
      code: strs(m.code),
      reads: groups(m.reads),
      writes: groups(m.writes),
      creates: strs(m.creates),
      updates: strs(m.updates),
      asks: m.asks === true,
      other: strs(m.other),
    },
    privateReads: strs(v.privateReads),
    tests: (Array.isArray(report.tests) ? report.tests : []).flatMap((t) =>
      isObj(t)
        ? [
            {
              function: str(t.function, 64) ?? "",
              name: str(t.name, 80) ?? "",
              ok: t.ok === true,
              message: str(t.message, 300) ?? "",
            },
          ]
        : [],
    ),
    dryRuns: (Array.isArray(report.dryRuns) ? report.dryRuns : []).flatMap((d) =>
      isObj(d)
        ? [
            {
              function: str(d.function, 64) ?? "",
              ok: d.ok === true,
              message: str(d.message, 300) ?? "",
              creates: counts(d.creates),
              updates: typeof d.updates === "number" ? d.updates : 0,
              asks: strs(d.asks),
            },
          ]
        : [],
    ),
    functions: (Array.isArray(v.functions) ? v.functions : []).flatMap((f) =>
      isObj(f) && typeof f.name === "string" && typeof f.code === "string"
        ? [
            {
              name: f.name.slice(0, 64),
              hash: str(f.hash, 64) ?? "",
              code: f.code.slice(0, 200_000),
            },
          ]
        : [],
    ),
  };
}

function parseExtension(v: unknown): ExtensionView | null {
  if (!isObj(v)) return null;
  const id = str(v.id, 40);
  const name = str(v.name, 60);
  if (!id || !name) return null;
  const needs = isObj(v.needs) ? v.needs : {};
  const budget = isObj(needs.budget) ? needs.budget.readersPerDay : null;
  return {
    id,
    name,
    description: str(v.description, 300) ?? "",
    version: typeof v.version === "number" ? v.version : 1,
    preset: typeof v.preset === "number" ? v.preset : null,
    enabled: v.enabled !== false,
    reads: strs(needs.reads),
    proposes: needs.proposes === true,
    readersPerDay: typeof budget === "number" ? budget : null,
    sources: strs(v.sources),
    modules: strs(v.modules),
    previous: typeof v.previous === "number" ? v.previous : null,
  };
}

/** Juan's reading guide (docs/nucleo.md 7.4b): his words, the code's rules, the examples he keeps. */
export interface MailRule {
  id: string;
  from: string;
  action: "skip" | "collection";
  collection?: string;
}
export interface MailGuide {
  instructions: string;
  rules: MailRule[];
  examples: { id: string; subject: string; from: string; want: { title: string }[] }[];
}

export function parseGuide(v: unknown): MailGuide | null {
  if (!isObj(v)) return null;
  const rules: MailRule[] = [];
  for (const r of Array.isArray(v.rules) ? v.rules : []) {
    if (!isObj(r)) continue;
    const id = str(r.id, 80);
    const from = str(r.from, 320);
    if (!id || !from || (r.action !== "skip" && r.action !== "collection")) continue;
    const collection = str(r.collection, 80);
    rules.push({ id, from, action: r.action, ...(collection ? { collection } : {}) });
  }
  const examples: MailGuide["examples"] = [];
  for (const e of Array.isArray(v.examples) ? v.examples : []) {
    if (!isObj(e)) continue;
    const id = str(e.id, 80);
    if (!id) continue;
    examples.push({
      id,
      subject: str(e.subject, 300) ?? "",
      from: str(e.from, 320) ?? "",
      want: (Array.isArray(e.want) ? e.want : [])
        .map((w) => (isObj(w) ? str(w.title, 200) : null))
        .filter((t): t is string => !!t)
        .map((title) => ({ title })),
    });
  }
  return { instructions: str(v.instructions, 2000) ?? "", rules, examples };
}

export interface MailInput {
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  folder?: string;
  collections?: string[];
  on?: boolean;
}

export class AgentApi {
  private readonly transport: Transport;
  constructor(transport: Transport) {
    this.transport = transport;
  }

  private async call(
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    body?: unknown,
    prefix = "api/agent/",
  ): Promise<unknown> {
    const r = await tracked(this.transport.request(method, `${prefix}${path}`, body));
    if (!r.ok) {
      if (r.offline) throw new OfflineError(r.message);
      throw new NotConfiguredError("not configured");
    }
    let parsed: unknown = null;
    try {
      parsed = r.body ? JSON.parse(r.body) : null;
    } catch {
      parsed = null;
    }
    if (r.status < 200 || r.status >= 300) {
      const code =
        isObj(parsed) && typeof parsed.error === "string" ? parsed.error : `http_${r.status}`;
      throw new ApiError(r.status, code, code);
    }
    return parsed;
  }

  /** `live`: an id the device makes to watch the turn while it runs (`live()`); `screen`: what is on the screen, by
   * reference (F9; servers before 0.8.114 ignore it). */
  turn = async (text: string, conversation?: string, live?: string, screen?: ScreenRefs) =>
    parseTurn(
      await this.call("POST", "turn", {
        text,
        ...(conversation ? { conversation } : {}),
        ...(live ? { live } : {}),
        ...(screen ? { screen } : {}),
      }),
    );
  answer = async (
    run: string,
    ask: string,
    a: { choice: number } | { text: string },
    live?: string,
  ) => parseTurn(await this.call("POST", "answer", { run, ask, ...a, ...(live ? { live } : {}) }));
  confirm = async (run: string, confirmation: string, live?: string) =>
    parseTurn(await this.call("POST", "confirm", { run, confirmation, ...(live ? { live } : {}) }));
  async conversations(): Promise<ConversationSummary[]> {
    const b = await this.call("GET", "conversations");
    return (isObj(b) && Array.isArray(b.conversations) ? b.conversations : [])
      .slice(0, 500)
      .flatMap((c) => {
        const s = parseConversation(c);
        return s ? [s] : [];
      });
  }
  async newConversation(): Promise<ConversationSummary> {
    const b = await this.call("POST", "conversations", {});
    const c = isObj(b) ? parseConversation(b.conversation) : null;
    if (!c) throw new ApiError(0, "bad-answer", "bad answer");
    return c;
  }
  async conversation(
    id: string,
  ): Promise<{ conversation: ConversationSummary; turns: TurnView[] }> {
    const b = await this.call("GET", `conversations/${encodeURIComponent(id)}`);
    const c = isObj(b) ? parseConversation(b.conversation) : null;
    if (!c || !isObj(b)) throw new ApiError(0, "bad-answer", "bad answer");
    const turns: TurnView[] = [];
    for (const t of Array.isArray(b.turns) ? b.turns.slice(-200) : []) {
      if (!isObj(t)) continue;
      const id = str(t.id, 80);
      if (!id) continue;
      turns.push({
        ...parseTurn(t),
        id,
        request: typeof t.request === "string" ? t.request.slice(0, 8000) : "",
        at: typeof t.at === "number" ? t.at : 0,
      });
    }
    return { conversation: c, turns };
  }
  async updateConversation(id: string, o: { title?: string; model?: string }) {
    const b = await this.call("PUT", `conversations/${encodeURIComponent(id)}`, o);
    return isObj(b) ? parseConversation(b.conversation) : null;
  }
  deleteConversation = async (id: string) =>
    void (await this.call("DELETE", `conversations/${encodeURIComponent(id)}`));
  async planners(): Promise<Planner[]> {
    const b = await this.call("GET", "planners");
    return (isObj(b) && Array.isArray(b.planners) ? b.planners : []).filter(isObj).flatMap((p) => {
      const id = str(p.id, 200);
      const model = str(p.model, 200);
      if (!id || !model) return [];
      return [
        {
          id,
          model,
          connection: str(p.connection, 40) ?? "",
          privacy: str(p.privacy, 40) ?? "",
          current: p.current === true,
        },
      ];
    });
  }
  /** What the turn `id` did since event `after`; null while the server does not know it yet. */
  async live(id: string, after: number): Promise<{ events: LiveEvent[]; done: boolean } | null> {
    try {
      const b = await this.call("GET", `live/${encodeURIComponent(id)}?after=${after}`);
      if (!isObj(b)) return null;
      return {
        events: (Array.isArray(b.events) ? b.events : []).slice(0, 500).flatMap((e) => {
          const x = parseLive(e);
          return x ? [x] : [];
        }),
        done: b.done === true,
      };
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) return null;
      throw e;
    }
  }
  stop = async (live: string) =>
    void (await this.call("POST", `live/${encodeURIComponent(live)}/stop`));
  decline = async (run: string, confirmation: string) =>
    parseTurn(await this.call("POST", "decline", { run, confirmation }));
  async proposals(): Promise<Proposal[]> {
    const b = await this.call("GET", "proposals");
    const list = isObj(b) && Array.isArray(b.proposals) ? b.proposals : [];
    return list.filter(isObj).flatMap((p) => {
      const id = str(p.id, 80);
      const tool = str(p.tool, 80);
      if (!id || !tool) return [];
      return [
        {
          id,
          tool,
          view: parseConfirmView(p.view),
          sources: strs(p.sources),
          created: typeof p.created === "number" ? p.created : 0,
          run: str(p.run, 80),
          madeBy: str(p.madeBy, 80),
          card: parseCard(p.card),
          ...(p.tool === "flows.save" && parseFlowProposal(p.flow)
            ? { flow: parseFlowProposal(p.flow) }
            : {}),
        },
      ];
    });
  }
  /** `edits`: Juan's corrections (a new title, another collection by id), kept for the reviewer. */
  accept = async (
    id: string,
    edits?: {
      title?: string;
      collection?: string;
      values?: Record<string, DataValue>;
      done?: true;
      /** The external event the record is made linked to («Enlazar», task 51). */
      link?: string;
      /** The record the proposal is the same thing as («Es el mismo», task 58): it takes what the proposal adds. */
      into?: string;
    },
  ) =>
    parseTurn(
      await this.call(
        "POST",
        `proposals/${encodeURIComponent(id)}/accept`,
        edits ? { edits } : undefined,
      ),
    );
  reject = async (id: string) =>
    void (await this.call("POST", `proposals/${encodeURIComponent(id)}/reject`));
  /** A decision taken back («Deshacer»): the proposal waits again; `run`, the acceptance's, is undone. */
  restore = async (id: string, run?: string) =>
    void (await this.call(
      "POST",
      `proposals/${encodeURIComponent(id)}/restore`,
      run ? { run } : {},
    ));
  async requests(): Promise<InboxRequest[]> {
    const b = await this.call("GET", "requests");
    const list = isObj(b) && Array.isArray(b.requests) ? b.requests : [];
    return list
      .filter(isObj)
      .slice(0, 200)
      .flatMap((r) => {
        const id = str(r.id, 80);
        const run = str(r.run, 80);
        const ask = parseAsk(r.view);
        if (!id || !run || !ask) return [];
        const open =
          isObj(r.open) && str(r.open.type, 80) && str(r.open.id, 80)
            ? { type: r.open.type as string, id: r.open.id as string }
            : null;
        return [
          {
            id,
            run,
            ask,
            created: typeof r.created === "number" ? r.created : 0,
            expires: typeof r.expires === "number" ? r.expires : 0,
            about: runWhat(r.about) ?? null,
            open,
          },
        ];
      });
  }
  answerRequest = async (id: string, a: { choice: number } | { text: string }) =>
    parseTurn(await this.call("POST", `requests/${encodeURIComponent(id)}/answer`, a));
  models = async () => parseModels(await this.call("GET", "models"));
  /** Boni's map with its numbers of the last `days` (docs/sistema.md §4.4, F8). */
  map = async (days: number) =>
    parseMap(await this.call("GET", `map?days=${Math.max(1, Math.round(days))}`));
  /** The account's flows (docs/flujos.md), and one of them drawn with the last `days`' numbers. */
  flows = async () => parseFlows(await this.call("GET", "flows"));
  /** The flow editor (docs/flujos.md, F2): its catalog, its checklist, and the user's changes. */
  flowCatalog = async () => parseFlowCatalog(await this.call("GET", "flows/catalog"));
  checkFlow = async (trigger: unknown, plan: FlowPlan) =>
    parseFlowCheck(await this.call("POST", "flows/check", { trigger, plan }));
  createFlow = async (name: string, from?: string) =>
    parseFlowDetail(await this.call("POST", "flows", { name, ...(from ? { from } : {}) }));
  saveFlow = async (
    id: string,
    body: {
      base: number;
      name: string;
      trigger: unknown;
      plan: FlowPlan;
    },
  ) => parseFlowDetail(await this.call("PUT", `flows/${encodeURIComponent(id)}`, body));
  setFlowEnabled = async (id: string, enabled: boolean) =>
    parseFlowDetail(await this.call("PUT", `flows/${encodeURIComponent(id)}/enabled`, { enabled }));
  revertFlow = async (id: string, to: { version: number } | { preset: true }) =>
    parseFlowDetail(await this.call("POST", `flows/${encodeURIComponent(id)}/revert`, to));
  deleteFlow = async (id: string) =>
    void (await this.call("DELETE", `flows/${encodeURIComponent(id)}`));
  /** «Probar»: the draft dry, with a sample (the latest mail, or the form's values). */
  testFlow = async (
    id: string,
    body: { plan: FlowPlan; trigger: unknown; mail?: string; inputs?: Record<string, string> },
  ) => parseFlowTest(await this.call("POST", `flows/${encodeURIComponent(id)}/test`, body));
  /** A flow by hand, as a turn of the conversation (its replies, questions and confirmations there). */
  runFlow = async (
    id: string,
    inputs: Record<string, string>,
    conversation?: string,
    live?: string,
  ) =>
    parseTurn(
      await this.call("POST", `flows/${encodeURIComponent(id)}/run`, {
        inputs,
        ...(conversation ? { conversation } : {}),
        ...(live ? { live } : {}),
      }),
    );
  flowDetail = async (id: string, days: number) =>
    parseFlowDetail(
      await this.call(
        "GET",
        `flows/${encodeURIComponent(id)}?days=${Math.max(1, Math.round(days))}`,
      ),
    );
  catalogue = async () => parseCatalogue(await this.call("GET", "models/catalogue"));
  evaluateModel = async (role: ModelRole, c: ModelChoice) =>
    parseModels(await this.call("POST", "models/evaluate", { role, ...c }));
  setModelRole = async (role: ModelRole, c: ModelChoice | null) =>
    parseModels(await this.call("PUT", `models/roles/${role}`, c ?? {}));
  setModelKey = async (connection: ModelConnection, key: string | null) =>
    parseModels(await this.call("PUT", `models/keys/${connection}`, { key }));
  setModelBudget = async (b: { monthlyEur?: number; warnAt?: number; usdToEur?: number }) =>
    parseModels(await this.call("PUT", "models/budget", b));
  dismissRequest = async (id: string) =>
    void (await this.call("POST", `requests/${encodeURIComponent(id)}/dismiss`));
  /** Boni's decisions counted per area, with each area's «Solo» (an older server: none). */
  async decisions(): Promise<DecisionsView> {
    return parseDecisions(await this.call("GET", "decisions"));
  }
  /** Juan turns an area's «Solo» (docs/fiabilidad.md §3.4): the areas as they are after it. */
  async setDecisionAuto(area: string, auto: boolean): Promise<DecisionsView> {
    return parseDecisions(
      await this.call("PUT", `decisions/${encodeURIComponent(area)}`, { auto }),
    );
  }
  /** Juan turns «Aprender» (docs/preferencias.md §5): off, no learner suggests anything on its own. */
  async setLearning(on: boolean): Promise<DecisionsView> {
    return parseDecisions(await this.call("PUT", "learning", { on }));
  }
  async runs(): Promise<{ runs: RunSummary[]; autoAccept: AutoAccept | null }> {
    const b = await this.call("GET", "runs");
    const list = isObj(b) && Array.isArray(b.runs) ? b.runs : [];
    const a = isObj(b) && isObj(b.autoAccept) ? b.autoAccept : null;
    const autoAccept = a
      ? { decided: count(a.decided), would: count(a.would), right: count(a.right) }
      : null;
    return { runs: this.runList(list), autoAccept };
  }
  private runList(list: unknown[]): RunSummary[] {
    return list.filter(isObj).flatMap((r) => {
      const id = str(r.id, 80);
      if (!id) return [];
      return [
        {
          id,
          origin: str(r.origin, 20) ?? "",
          device: str(r.device, 80),
          status: str(r.status, 80) ?? "",
          started: typeof r.started === "number" ? r.started : 0,
          finished: typeof r.finished === "number" ? r.finished : null,
          ...(isObj(r.what) ? { what: runWhat(r.what) } : {}),
          ...(isObj(r.proposals)
            ? {
                proposals: {
                  pending: count(r.proposals.pending),
                  accepted: count(r.proposals.accepted),
                  rejected: count(r.proposals.rejected),
                  stale: count(r.proposals.stale),
                },
              }
            : {}),
          ...(Array.isArray(r.changes) ? { changes: runChanges(r.changes) } : {}),
          ...(r.changed !== undefined ? { changed: count(r.changed) } : {}),
          ...(r.alone === true ? { alone: true } : {}),
        },
      ];
    });
  }
  async visibility(): Promise<Visibility[]> {
    const b = await this.call("GET", "visibility");
    const list = isObj(b) && Array.isArray(b.types) ? b.types : [];
    return list.filter(isObj).flatMap((t) => {
      const id = str(t.id, 80);
      const name = str(t.name, 120);
      const level = AI_LEVELS.find((l) => l === t.level);
      if (!id || !name || !level) return [];
      const zone = zoneOf(t.zone);
      return [
        {
          id,
          name,
          level,
          count: typeof t.count === "number" ? t.count : 0,
          ...(zone ? { zone } : {}),
        },
      ];
    });
  }
  // The user's pages (docs/extensiones.md 6).
  pages = async (): Promise<PageInfo[]> => {
    const b = await this.call("GET", "", undefined, "api/pages");
    return isObj(b) && Array.isArray(b.pages)
      ? b.pages.map(parsePageInfo).filter((x): x is PageInfo => !!x)
      : [];
  };
  page = async (id: string) =>
    parsePage(
      (await this.call("GET", `/${encodeURIComponent(id)}`, undefined, "api/pages")) as never,
    );
  createPage = async (input: { title: string; parent?: string | null; spec?: PageSpec }) =>
    parsePage((await this.call("POST", "", input, "api/pages")) as never);
  updatePage = async (
    id: string,
    input: {
      title?: string;
      icon?: string;
      parent?: string | null;
      position?: number;
      spec?: PageSpec;
    },
  ) =>
    parsePage((await this.call("PUT", `/${encodeURIComponent(id)}`, input, "api/pages")) as never);
  trash = async (): Promise<(PageInfo & { deleted: number })[]> => {
    const b = await this.call("GET", "", undefined, "api/pages-trash");
    return isObj(b) && Array.isArray(b.pages)
      ? b.pages.flatMap((x) => {
          const i = parsePageInfo(x);
          return i && isObj(x)
            ? [{ ...i, deleted: typeof x.deleted === "number" ? x.deleted : 0 }]
            : [];
        })
      : [];
  };
  restorePage = async (id: string) =>
    void (await this.call("POST", `/${encodeURIComponent(id)}/restore`, {}, "api/pages"));
  deletePage = async (id: string) =>
    void (await this.call("DELETE", `/${encodeURIComponent(id)}`, undefined, "api/pages"));
  // The audit (core/audit.ts): who did and saw what, a row's history, storage, the notes by path.
  auditSummary = async (from: number, to: number) =>
    parseSummary(
      await this.call("GET", `summary?from=${from}&to=${to}`, undefined, "api/data/audit/"),
    );
  auditActions = async (q: {
    before?: number;
    who?: string;
    type?: string;
    run?: string;
    limit?: number;
  }) => {
    const qs = Object.entries(q)
      .filter(([, v]) => v !== undefined && v !== "")
      .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
      .join("&");
    return parseActions(
      await this.call("GET", `actions${qs ? `?${qs}` : ""}`, undefined, "api/data/audit/"),
    );
  };
  auditAction = async (seq: number) =>
    parseDetail(await this.call("GET", `actions/${seq}`, undefined, "api/data/audit/"));
  rowHistory = async (id: string) =>
    parseHistory(
      await this.call("GET", `rows/${encodeURIComponent(id)}`, undefined, "api/data/audit/"),
    );
  auditVerify = async () => {
    const b = await this.call("GET", "verify", undefined, "api/data/audit/");
    return isObj(b) && b.ok === true;
  };
  storage = async () =>
    parseStorage(await this.call("GET", "storage", undefined, "api/data/audit/"));
  /** A page's data blocks computed from the user's collections: each one's numbers or its problems. */
  blocks = async (blocks: Omit<DataBlock, "at">[]): Promise<Record<string, BlockResult>> => {
    const b = await this.call("POST", "", { blocks }, "api/data/blocks");
    return parseBlockResults(b);
  };
  /** The rows a data block counts (or one of its bars or points: `drill`), as its collection's table lists them. */
  blockRows = async (
    block: Omit<DataBlock, "at">,
    drill?: string,
  ): Promise<
    | {
        rows: DataRow[];
        total: number;
        titles: Record<string, string>;
        columns: Record<string, SystemColumns>;
      }
    | { problems: unknown[] }
  > => {
    const b = await this.call(
      "POST",
      "",
      { block, ...(drill ? { drill } : {}) },
      "api/data/blocks/rows",
    );
    if (isObj(b) && Array.isArray(b.problems)) return { problems: b.problems };
    return { ...rowList(b), total: isObj(b) && typeof b.total === "number" ? b.total : 0 };
  };
  /** The tree (docs/clases.md §2.7): every collection with its mother, and the records with a note it shows. */
  tree = async (): Promise<Tree> => {
    const b = await this.call("GET", "", undefined, "api/data/tree");
    const cols = isObj(b) && Array.isArray(b.collections) ? b.collections : [];
    const notes = isObj(b) && Array.isArray(b.notes) ? b.notes : [];
    return {
      collections: cols.flatMap((c): TreeCollection[] =>
        isObj(c) && typeof c.id === "string"
          ? [
              {
                id: c.id,
                ...(typeof c.parent === "string" ? { parent: c.parent } : {}),
                name: str(c.name, 200) ?? c.id,
                icon: str(c.icon, 16) ?? "",
                count: typeof c.count === "number" ? c.count : 0,
                notes: c.notes === true,
              },
            ]
          : [],
      ),
      notes: notes.flatMap((n): TreeNote[] =>
        isObj(n) && typeof n.id === "string" && typeof n.type === "string"
          ? [{ id: n.id, type: n.type, title: str(n.title, 300) ?? "" }]
          : [],
      ),
    };
  };
  /** Whether a collection's records with a note show in the tree. */
  setNotesInTree = async (type: string, notes: boolean) =>
    void (await this.call("PUT", `/${encodeURIComponent(type)}/tree`, { notes }, "api/data/types"));
  /** Every record with a note of one collection (for «Todas las páginas», whatever its eye says). */
  treeNotes = async (type: string): Promise<TreeNote[]> => {
    const b = await this.call(
      "GET",
      `?type=${encodeURIComponent(type)}`,
      undefined,
      "api/data/tree",
    );
    return isObj(b) && Array.isArray(b.notes)
      ? b.notes.flatMap((x): TreeNote[] =>
          isObj(x) && typeof x.id === "string" && typeof x.type === "string"
            ? [
                {
                  id: x.id,
                  type: x.type,
                  title: str(x.title, 300) ?? "",
                  ai: Array.isArray(x.ai)
                    ? x.ai.filter((a): a is string => typeof a === "string").slice(0, 20)
                    : [],
                  aiAt: typeof x.aiAt === "number" ? x.aiAt : null,
                },
              ]
            : [],
        )
      : [];
  };
  /** A new collection, at the root or inside another; its id. */
  createCollection = async (name: string, parent?: string): Promise<string> => {
    const b = await this.call(
      "POST",
      "",
      { name, ...(parent ? { parent } : {}) },
      "api/data/types",
    );
    return isObj(b) && typeof b.id === "string" ? b.id : "";
  };
  /** Who reads and writes each collection (F6): the flows that name it, and who did in the last days. */
  dataUsage = async (): Promise<DataUsage> =>
    parseUsage(await this.call("GET", "", undefined, "api/data/usage"));
  /** A relation drawn from the diagram (F6): a column of `type` pointing to `target`; its id. */
  addRelation = async (type: string, rel: { name: string; target: string }): Promise<string> => {
    const b = await this.call(
      "POST",
      `/${encodeURIComponent(type)}/fields`,
      { name: rel.name, type: "relation", target: rel.target },
      "api/data/types",
    );
    return isObj(b) && typeof b.id === "string" ? b.id : "";
  };
  /**
   * A new column of a collection (Notion's «+»): its name and kind, or beside another (task 76); with `copy`, a
   * duplicate of that column with its values. Its id.
   */
  addColumn = async (
    type: string,
    col: {
      name: string;
      type?: string;
      beside?: { field: string; side: "left" | "right" };
      copy?: string;
    },
  ): Promise<string> => {
    const b = await this.call("POST", `/${encodeURIComponent(type)}/fields`, col, "api/data/types");
    return isObj(b) && typeof b.id === "string" ? b.id : "";
  };
  /** A column changed: its name, its kind or a list's options (each by its id when kept). */
  changeColumn = async (
    type: string,
    field: string,
    change: {
      name?: string;
      type?: string;
      options?: { id?: string; name: string; color?: string }[];
    },
  ) =>
    void (await this.call(
      "PUT",
      `/${encodeURIComponent(type)}/fields/${encodeURIComponent(field)}`,
      change,
      "api/data/types",
    ));
  /** A column out (its values kept), and back. */
  removeColumn = async (type: string, field: string) =>
    void (await this.call(
      "DELETE",
      `/${encodeURIComponent(type)}/fields/${encodeURIComponent(field)}`,
      undefined,
      "api/data/types",
    ));
  restoreColumn = async (type: string, field: string) =>
    void (await this.call(
      "POST",
      `/${encodeURIComponent(type)}/fields/${encodeURIComponent(field)}/restore`,
      {},
      "api/data/types",
    ));
  /** A collection out of the tree (only when nothing is left in it). */
  deleteCollection = async (type: string) =>
    void (await this.call("DELETE", `/${encodeURIComponent(type)}`, undefined, "api/data/types"));
  /** A collection's new name (its key stays); a name taken by another is refused ("taken"). */
  renameCollection = async (type: string, name: string) =>
    void (await this.call("PUT", `/${encodeURIComponent(type)}/name`, { name }, "api/data/types"));
  /** A collection moved under another (`null`: the root). */
  moveCollection = async (type: string, parent: string | null) =>
    void (await this.call(
      "PUT",
      `/${encodeURIComponent(type)}/parent`,
      { parent },
      "api/data/types",
    ));
  /** A record moved to another collection (it keeps its id). */
  moveRow = async (id: string, type: string) =>
    void (await this.call("PUT", `/${encodeURIComponent(id)}/type`, { type }, "api/data/rows"));
  // The user's collections as databases (plan PR 19).
  dataTypes = async (): Promise<DataType[]> => {
    const b = await this.call("GET", "", undefined, "api/data/types");
    return isObj(b) && Array.isArray(b.types)
      ? b.types.map(parseDataType).filter((x): x is DataType => !!x)
      : [];
  };
  /**
   * Inicio's «Hoy» on the phone: what the calendars hold today in this device's timezone (the server's today.ts);
   * empty with no calendar. Null from a server older than it.
   */
  today = async (tz: string): Promise<TodayItem[] | null> => {
    let b: unknown;
    try {
      b = await this.call("GET", `?tz=${encodeURIComponent(tz)}`, undefined, "api/data/today");
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) return null;
      throw e;
    }
    if (!isObj(b) || !Array.isArray(b.items)) return [];
    return b.items.slice(0, 50).flatMap((x): TodayItem[] => {
      if (!isObj(x)) return [];
      const id = str(x.id, 80);
      const type = str(x.type, 80);
      if (!id || !type) return [];
      return [
        {
          id,
          type,
          collection: str(x.collection, 80) ?? "",
          title: str(x.title, 300) ?? "",
          start: typeof x.start === "string" && /^\d\d:\d\d$/.test(x.start) ? x.start : null,
          task: x.task === true,
          done: x.done === true,
          doneField: str(x.doneField, 80),
        },
      ];
    });
  };
  dataRows = async (type: string) => {
    const b = await this.call(
      "GET",
      `/${encodeURIComponent(type)}/rows`,
      undefined,
      "api/data/types",
    );
    const { rows, titles, columns } = rowList(b);
    const ghosts =
      isObj(b) && Array.isArray(b.ghosts)
        ? b.ghosts.flatMap((g): DataRow[] => {
            const r = parseRow(g);
            return r && isObj(g) && typeof g.proposal === "string"
              ? [{ ...r, ghost: g.proposal }]
              : [];
          })
        : [];
    return { rows, titles, ghosts, columns };
  };
  createRow = async (type: string, values: Record<string, DataValue>) =>
    parseRow(
      (
        (await this.call(
          "POST",
          `/${encodeURIComponent(type)}/rows`,
          { values },
          "api/data/types",
        )) as {
          row?: unknown;
        }
      )?.row,
    );
  updateRow = async (id: string, values: Record<string, DataValue>, body?: string) =>
    parseRow(
      (
        (await this.call(
          "PUT",
          `/${encodeURIComponent(id)}`,
          { values, ...(body !== undefined ? { body } : {}) },
          "api/data/rows",
        )) as { row?: unknown }
      )?.row,
    );
  dataRow = async (id: string) =>
    parseRow(
      (
        (await this.call("GET", `/${encodeURIComponent(id)}`, undefined, "api/data/rows")) as {
          row?: unknown;
        }
      )?.row,
    );
  /** An image of the user's as a data: address a page can paint (its policy takes data:, never blob:); null if not. */
  fileInline = async (sha: string): Promise<string | null> => {
    const b = await this.call(
      "GET",
      `/${encodeURIComponent(sha)}/inline`,
      undefined,
      "api/data/files",
    );
    return isObj(b) &&
      typeof b.mime === "string" &&
      /^image\/[a-z0-9.+-]+$/.test(b.mime) &&
      typeof b.data === "string" &&
      /^[A-Za-z0-9+/]*={0,2}$/.test(b.data)
      ? `data:${b.mime};base64,${b.data}`
      : null;
  };
  /**
   * A file pasted or dropped into a page, kept in Boni: its row; or, with several collections of files and no choice
   * kept yet, the collections to choose from (`into` then names one, and the account keeps it).
   */
  addFile = async (
    name: string,
    data: string,
    into?: string,
  ): Promise<{ id: string; name: string } | { choose: { type: string; name: string }[] }> => {
    const r = await this.transport.request("POST", "api/data/files", {
      name,
      data,
      ...(into ? { into, remember: true } : {}),
    });
    if (!r.ok) {
      if (r.offline) throw new OfflineError(r.message);
      throw new NotConfiguredError("not configured");
    }
    let b: unknown = null;
    try {
      b = r.body ? JSON.parse(r.body) : null;
    } catch {
      b = null;
    }
    if (r.status === 409 && isObj(b) && Array.isArray(b.options))
      return {
        choose: b.options.flatMap((o) =>
          isObj(o) && typeof o.type === "string" && typeof o.name === "string"
            ? [{ type: o.type, name: o.name.slice(0, 80) }]
            : [],
        ),
      };
    if (r.status < 200 || r.status >= 300) {
      const code = isObj(b) && typeof b.error === "string" ? b.error : `http_${r.status}`;
      throw new ApiError(r.status, code, code);
    }
    if (!isObj(b) || typeof b.id !== "string")
      throw new ApiError(r.status, "bad-answer", "bad-answer");
    return { id: b.id, name: typeof b.name === "string" ? b.name.slice(0, 200) : name };
  };
  /** What points to a row, and the titles of what it points to. */
  dataRelated = async (id: string) =>
    parseRelated(
      await this.call("GET", `/${encodeURIComponent(id)}/related`, undefined, "api/data/rows"),
    );
  deleteRow = async (id: string) =>
    void (await this.call("DELETE", `/${encodeURIComponent(id)}`, undefined, "api/data/rows"));
  restoreRow = async (id: string) =>
    void (await this.call("POST", `/${encodeURIComponent(id)}/restore`, {}, "api/data/rows"));
  /** A part of a collection with its own level: added (no id), changed or removed. */
  saveRule = async (
    type: string,
    rule: { id?: string; filter: DatabaseFilter[]; level: AiLevel },
    unlock = false,
  ) => {
    const body = { filter: rule.filter, level: rule.level, ...(unlock ? { unlock: true } : {}) };
    if (rule.id) await this.call("PUT", `/${encodeURIComponent(rule.id)}`, body, "api/data/rules");
    else await this.call("POST", `/${encodeURIComponent(type)}/rules`, body, "api/data/types");
  };
  removeRule = async (id: string, unlock = false) =>
    void (await this.call(
      "DELETE",
      `/${encodeURIComponent(id)}`,
      unlock ? { unlock: true } : undefined,
      "api/data/rules",
    ));
  /** How a collection's rows open: properties unfolded or not, and those hidden one by one. */
  setRowUi = async (
    type: string,
    patch: {
      open?: boolean;
      hidden?: string[];
      related?: boolean;
      folded?: string[];
      widths?: Record<string, number>;
      views?: SavedView[];
    },
  ) =>
    void (await this.call("PUT", `/${encodeURIComponent(type)}/row-ui`, patch, "api/data/types"));
  /** How much the models may see of a collection; `unlock` lowers a private one (its own page only). */
  setProtection = async (type: string, level: AiLevel, unlock = false) =>
    void (await this.call(
      "PUT",
      `/${encodeURIComponent(type)}/protection`,
      { level, ...(unlock ? { unlock: true } : {}) },
      "api/data/types",
    ));
  extensions = async (): Promise<ExtensionView[]> => {
    const b = await this.call("GET", "extensions");
    return isObj(b) && Array.isArray(b.extensions)
      ? b.extensions.map(parseExtension).filter((x): x is ExtensionView => !!x)
      : [];
  };
  setExtension = async (id: string, enabled: boolean) =>
    void (await this.call("PUT", `extensions/${encodeURIComponent(id)}`, { enabled }));
  extensionProposals = async (): Promise<ProposalView[]> => {
    const b = await this.call("GET", "extensions/proposals");
    return isObj(b) && Array.isArray(b.proposals)
      ? b.proposals.map(parseProposal).filter((x): x is ProposalView => !!x)
      : [];
  };
  /** Juan's decision on a proposed version, or going back to the one before (a personal device). */
  decideExtension = async (id: string, action: "activate" | "reject" | "revert") =>
    void (await this.call("POST", `extensions/${encodeURIComponent(id)}/${action}`, {}));
  setVisibility = async (id: string, level: AiLevel) =>
    void (await this.call("PUT", `visibility/${encodeURIComponent(id)}`, { level }));
  async runDetail(id: string): Promise<RunDetail | null> {
    const b = await this.call("GET", `runs/${encodeURIComponent(id)}`);
    if (!isObj(b) || !Array.isArray(b.steps)) return null;
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
    const list = <T>(v: unknown, of: (x: Record<string, unknown>) => T): T[] =>
      Array.isArray(v) ? v.filter(isObj).slice(0, 200).map(of) : [];
    return {
      id: str(b.id, 80) ?? id,
      status: str(b.status, 80) ?? "",
      origin: str(b.origin, 40) ?? "",
      started: num(b.started),
      finished: typeof b.finished === "number" ? b.finished : null,
      request: typeof b.request === "string" ? b.request.slice(0, 4000) : null,
      flow: str(b.flow, 80),
      flowVersion: typeof b.flowVersion === "number" ? b.flowVersion : null,
      inputs: strs(b.inputs).slice(0, 40),
      steps: b.steps.filter(isObj).map((x) => ({
        id: str(x.id, 40) ?? "",
        op: str(x.op, 20) ?? "",
        title: str(x.title, 80),
        what: str(x.what, 60) ?? "",
        args: isObj(x.args)
          ? Object.entries(x.args)
              .map(([k, v]) => `${k}: ${exprText(v)}`)
              .join(", ")
              .slice(0, 600)
          : "",
        decision: str(x.decision, 20),
        rule: str(x.rule, 10),
        error: str(x.error, 80),
        deps: strs(x.deps).slice(0, 40),
        uses: strs(x.uses).slice(0, 40),
        answers: strs(x.answers).map((a) => a.slice(0, 4000)),
        calls: typeof x.calls === "number" ? x.calls : 0,
        cost: typeof x.cost === "number" && Number.isFinite(x.cost) ? x.cost : 0,
        output: x.output ?? null,
        said: isObj(x.args)
          ? Object.values(x.args).flatMap((v) =>
              isObj(v) && typeof v.quote === "string" ? [`«${v.quote.slice(0, 120)}»`] : [],
            )
          : [],
      })),
      read: list(b.read, (x) => ({
        collection: str(x.collection, 80) ?? "",
        type: str(x.type, 80) ?? "",
        titles: strs(x.titles).map((y) => y.slice(0, 80)),
        n: num(x.n),
      })),
      changes: list(b.changes, (x) => ({
        action: str(x.action, 20) ?? "",
        title: str(x.title, 80) ?? "",
        collection: str(x.collection, 80) ?? "",
        type: str(x.type, 80) ?? "",
        undone: x.undone === true,
      })),
      proposals: list(b.proposals, (x) => ({
        id: str(x.id, 80) ?? undefined,
        title: str(x.title, 120) ?? "",
        status: str(x.status, 20) ?? "",
        type: str(x.type, 80),
        created: typeof x.created === "number" ? x.created : undefined,
        decided: typeof x.decided === "number" ? x.decided : null,
        rows: namedValues(x.rows),
        step: str(x.step, 40),
        record: recordViewOf(x.record),
      })),
      input: isObj(b.input)
        ? {
            id: str(b.input.id, 80) ?? "",
            title: str(b.input.title, 120) ?? "",
            collection: str(b.input.collection, 80) ?? "",
            type: str(b.input.type, 80) ?? "",
            fields: namedValues(b.input.fields),
          }
        : null,
      told: list(b.told, (x) => ({ step: str(x.step, 40) ?? "", n: num(x.n) })).filter(
        (x) => x.step && x.n > 0,
      ),
      owner: typeof b.owner === "string" && MAP_ID.test(b.owner) ? b.owner : null,
      drawn:
        isObj(b.drawn) && isObj(b.drawn.plan) && Array.isArray(b.drawn.steps)
          ? {
              version: typeof b.drawn.version === "number" ? b.drawn.version : null,
              plan: planOf(b.drawn.plan),
              steps: b.drawn.steps.map(parseFlowNode).filter((x): x is FlowStepNode => x !== null),
            }
          : null,
      decisions: list(b.decisions, (x) => ({
        area: str(x.area, 40) ?? "",
        p: num(x.p),
        outcome: str(x.outcome, 20) ?? "",
        result: str(x.result, 20),
      })),
      models: list(b.models, (x) => ({
        role: str(x.role, 40) ?? "",
        provider: str(x.provider, 40) ?? "",
        model: str(x.model, 80) ?? "",
        input: num(x.input),
        output: num(x.output),
        cost: typeof x.cost === "number" && Number.isFinite(x.cost) ? x.cost : null,
        at: num(x.at),
      })),
    };
  }
  /** «¿De dónde viene?» of a record (docs/sistema.md §4.4): who made it, and the run that proposed it. */
  async origin(id: string): Promise<Origin | null> {
    const b = await this.call("GET", `origin/${encodeURIComponent(id)}`);
    return parseOrigin(b);
  }
  private mailOf = (b: unknown) => (isObj(b) ? parseMail(b.mail) : null);
  mail = async () => this.mailOf(await this.call("GET", "", undefined, "api/mail"));
  saveMail = async (input: MailInput) => this.mailOf(await this.call("PUT", "", input, "api/mail"));
  checkMail = async () => this.mailOf(await this.call("POST", "/check", {}, "api/mail"));
  /** A mail's tasks proposed now (task 30): how many went to the inbox. */
  /** A mail's tasks proposed now (task 30), or again (task 54): how many were made, waited already, or were taken. */
  proposeFromMail = async (id: string, again = false) => {
    const b = (await this.call(
      "POST",
      "/propose",
      { id, ...(again ? { again } : {}) },
      "api/mail",
    )) as {
      proposals?: unknown;
      already?: unknown;
      decided?: unknown;
    };
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
    return { n: num(b.proposals), already: num(b.already), decided: num(b.decided) };
  };
  /** Reads the mail of the last `days` days again; how many mails and withdrawn proposals. */
  rereadMail = async (days: number) => {
    const b = await this.call("POST", "/reread", { days }, "api/mail");
    return {
      mails: isObj(b) && typeof b.mails === "number" ? b.mails : 0,
      withdrawn: isObj(b) && typeof b.withdrawn === "number" ? b.withdrawn : 0,
    };
  };
  forgetMail = async () => void (await this.call("POST", "/forget", {}, "api/mail"));
  /** Where a mail of the collection opens in its webmail (task 68): Gmail's own address of it, or null. */
  mailWebmail = async (id: string): Promise<string | null> => {
    const b = await this.call("GET", `/webmail/${encodeURIComponent(id)}`, undefined, "api/mail");
    const url = isObj(b) && typeof b.url === "string" ? b.url : null;
    return url && /^https:\/\/mail\.google\.com\//.test(url) ? url : null;
  };
  private guideOf = (b: unknown) => (isObj(b) ? parseGuide(b.guide) : null);
  reviewMail = async () => this.mailOf(await this.call("POST", "/review", {}, "api/mail"));
  /** Juan's answer to the reviewer's suggestion: yes, no, or `changed` (he writes it in his own words). */
  answerSuggestion = async (id: string, accept: boolean, changed = false) => {
    const b = await this.call(
      "POST",
      "/suggestion",
      { id, accept, ...(changed ? { changed: true } : {}) },
      "api/mail",
    );
    return {
      guide: isObj(b) ? parseGuide(b.guide) : null,
      mail: isObj(b) ? parseMail(b.mail) : null,
    };
  };
  mailGuide = async () => this.guideOf(await this.call("GET", "/guide", undefined, "api/mail"));
  saveMailGuide = async (input: {
    instructions?: string;
    rules?: Omit<MailRule, "id">[] | MailRule[];
    keepExamples?: string[];
  }) => this.guideOf(await this.call("PUT", "/guide", input, "api/mail"));
  async undo(id: string): Promise<number> {
    const b = await this.call("POST", `runs/${encodeURIComponent(id)}/undo`);
    return isObj(b) && typeof b.undone === "number" ? b.undone : 0;
  }
}
