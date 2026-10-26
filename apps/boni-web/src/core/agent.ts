import {
  type DatabaseFilter,
  emptyPage,
  filterErrors,
  type PageSpec,
  pageErrors,
  withoutRetired,
} from "@boni/views";
import { ApiError, NotConfiguredError, OfflineError, type Transport } from "./api.ts";
import {
  parseActions,
  parseColumns,
  parseDetail,
  parseHistory,
  parseNotes,
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
  component: "text" | "number" | "list" | "table";
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
  source:
    | {
        kind: "mail";
        account: string | null;
        from: string;
        subject: string;
        excerpt: string;
        /** The mail's own row in Boni, for "Ver correo". */
        open: { type: string; id: string } | null;
      }
    | { kind: "note"; path: string }
    | null;
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
      : src?.kind === "note" && typeof src.path === "string"
        ? { kind: "note", path: src.path.slice(0, 500) }
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
  | { kind: "note"; path: string; action: "update" | "create" | "delete" }
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
    case "note":
      return {
        kind: "note",
        path: s(v.path, 500),
        action: v.action === "create" || v.action === "delete" ? v.action : "update",
      };
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

const COMPONENTS = new Set(["text", "number", "list", "table"]);

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
export interface DataType {
  id: string;
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
  rowUi: { open: boolean; hidden: string[] };
  /** Boni's own records (calls to models, its activity): read only, never seen by a model. */
  system?: true;
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
    name: str(v.name, 200) ?? v.id,
    icon: str(v.icon, 16) ?? "",
    titleField: str(v.titleField, 80) ?? "",
    count: typeof v.count === "number" ? v.count : 0,
    level: levelOf(v.level),
    ...(v.system === true ? { system: true as const } : {}),
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

  turn = async (text: string, conversation?: string) =>
    parseTurn(await this.call("POST", "turn", { text, ...(conversation ? { conversation } : {}) }));
  answer = async (run: string, ask: string, a: { choice: number } | { text: string }) =>
    parseTurn(await this.call("POST", "answer", { run, ask, ...a }));
  confirm = async (run: string, confirmation: string) =>
    parseTurn(await this.call("POST", "confirm", { run, confirmation }));
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
  notes = async () => parseNotes(await this.call("GET", "", undefined, "api/data/notes"));
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
  // The user's collections as databases (plan PR 19).
  dataTypes = async (): Promise<DataType[]> => {
    const b = await this.call("GET", "", undefined, "api/data/types");
    return isObj(b) && Array.isArray(b.types)
      ? b.types.map(parseDataType).filter((x): x is DataType => !!x)
      : [];
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
  deleteRow = async (id: string) =>
    void (await this.call("DELETE", `/${encodeURIComponent(id)}`, undefined, "api/data/rows"));
  restoreRow = async (id: string) =>
    void (await this.call("POST", `/${encodeURIComponent(id)}/restore`, {}, "api/data/rows"));
  /** The row a vault note became (Boni Calendar's "Abrir en Boni"), or null. */
  lookupNote = async (path: string): Promise<{ type: string; id: string } | null> => {
    // Every character that is not a letter or a digit escaped: the desktop app passes only plain query strings.
    const q = [...new TextEncoder().encode(path)]
      .map((b) =>
        /[A-Za-z0-9]/.test(String.fromCharCode(b))
          ? String.fromCharCode(b)
          : `%${b.toString(16).toUpperCase().padStart(2, "0")}`,
      )
      .join("");
    try {
      const b = await this.call("GET", `?path=${q}`, undefined, "api/data/lookup");
      return isObj(b) && typeof b.type === "string" && typeof b.id === "string"
        ? { type: b.type, id: b.id }
        : null;
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) return null;
      throw e;
    }
  };
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
  setRowUi = async (type: string, patch: { open?: boolean; hidden?: string[] }) =>
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
