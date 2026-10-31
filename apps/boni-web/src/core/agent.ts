import {
  type DatabaseFilter,
  emptyPage,
  filterErrors,
  isPageTemplate,
  type PageSpec,
  type PageTemplate,
  pageErrors,
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
  component: "text" | "number" | "list" | "table" | "chart";
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
  /** What the inbox shows of it, made by the server's code (apps/server/src/inboxCard.ts). */
  card: InboxCard | null;
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
  what: string;
  /** The arguments as the plan wrote them, as text. */
  args: string;
  decision: string | null;
  rule: string | null;
  error: string | null;
}
export interface RunDetail {
  id: string;
  status: string;
  request: string | null;
  steps: RunStep[];
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
}
export type RunWhat =
  | { kind: "request"; text: string }
  | { kind: "mail"; subject: string; from: string; account: string | null }
  | { kind: "measure"; subject: string }
  | { kind: "review" }
  | { kind: "accepted" }
  | { kind: "other" };
/** How often Boni would have accepted alone over Juan's last decisions, and been right (the server's rule). */
export interface AutoAccept {
  decided: number;
  would: number;
  right: number;
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
          },
        ];
      }),
    evaluating: evalRole && evalChoice ? { ...evalChoice, role: evalRole } : null,
  };
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

const COMPONENTS = new Set(["text", "number", "list", "table", "chart"]);

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

/** A live event as the server sends it: fixed codes and the code's words; a reply parsed as any reply. */
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
  name: string;
  type: string;
  options?: { id: string; name: string; color?: string }[];
  relation?: { target: string; many: boolean };
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
  /** How its rows open as pages (the account's, every device): properties unfolded, and those hidden. */
  rowUi: {
    open: boolean;
    hidden: string[];
    related: boolean;
    folded: string[];
    /** The table's columns' widths in px, by field (as the user left them). */
    widths: Record<string, number>;
  };
  /** Boni's own records (calls to models, its activity): read only, never seen by a model. */
  system?: true;
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
}

function parseDataType(v: unknown): DataType | null {
  if (!isObj(v) || typeof v.id !== "string" || !Array.isArray(v.fields)) return null;
  return {
    id: v.id,
    ...(typeof v.parent === "string" ? { parent: v.parent } : {}),
    name: str(v.name, 200) ?? v.id,
    icon: str(v.icon, 16) ?? "",
    titleField: str(v.titleField, 80) ?? "",
    count: typeof v.count === "number" ? v.count : 0,
    level: levelOf(v.level),
    ...(v.system === true ? { system: true as const } : {}),
    ...(typeof v.done === "string" ? { done: v.done } : {}),
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
    },
    fields: v.fields.flatMap((f): DataField[] =>
      isObj(f) && typeof f.id === "string" && typeof f.type === "string"
        ? [
            {
              id: f.id,
              name: str(f.name, 200) ?? f.id,
              type: f.type,
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
    const r = await this.transport.request(method, `${prefix}${path}`, body);
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

  /** `live`: an id the device makes to watch the turn while it runs (`live()`). */
  turn = async (text: string, conversation?: string, live?: string) =>
    parseTurn(
      await this.call("POST", "turn", {
        text,
        ...(conversation ? { conversation } : {}),
        ...(live ? { live } : {}),
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
          card: parseCard(p.card),
        },
      ];
    });
  }
  /** `edits`: Juan's corrections (a new title, another collection by id), kept for the reviewer. */
  accept = async (id: string, edits?: { title?: string; collection?: string; done?: true }) =>
    parseTurn(
      await this.call(
        "POST",
        `proposals/${encodeURIComponent(id)}/accept`,
        edits ? { edits } : undefined,
      ),
    );
  reject = async (id: string) =>
    void (await this.call("POST", `proposals/${encodeURIComponent(id)}/reject`));
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
  /** A collection out of the tree (only when nothing is left in it). */
  deleteCollection = async (type: string) =>
    void (await this.call("DELETE", `/${encodeURIComponent(type)}`, undefined, "api/data/types"));
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
    return {
      id: str(b.id, 80) ?? id,
      status: str(b.status, 80) ?? "",
      request: typeof b.request === "string" ? b.request.slice(0, 4000) : null,
      steps: b.steps.filter(isObj).map((x) => ({
        id: str(x.id, 40) ?? "",
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
      })),
    };
  }
  private mailOf = (b: unknown) => (isObj(b) ? parseMail(b.mail) : null);
  mail = async () => this.mailOf(await this.call("GET", "", undefined, "api/mail"));
  saveMail = async (input: MailInput) => this.mailOf(await this.call("PUT", "", input, "api/mail"));
  checkMail = async () => this.mailOf(await this.call("POST", "/check", {}, "api/mail"));
  /** Reads the mail of the last `days` days again; how many mails and withdrawn proposals. */
  rereadMail = async (days: number) => {
    const b = await this.call("POST", "/reread", { days }, "api/mail");
    return {
      mails: isObj(b) && typeof b.mails === "number" ? b.mails : 0,
      withdrawn: isObj(b) && typeof b.withdrawn === "number" ? b.withdrawn : 0,
    };
  };
  forgetMail = async () => void (await this.call("POST", "/forget", {}, "api/mail"));
  private guideOf = (b: unknown) => (isObj(b) ? parseGuide(b.guide) : null);
  reviewMail = async () => this.mailOf(await this.call("POST", "/review", {}, "api/mail"));
  answerSuggestion = async (id: string, accept: boolean) => {
    const b = await this.call("POST", "/suggestion", { id, accept }, "api/mail");
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
