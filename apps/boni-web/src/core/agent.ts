import { ApiError, NotConfiguredError, OfflineError, type Transport } from "./api.ts";

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
}
/** What the models may see of a collection (Juan's choice; the agent cannot change it). */
export type AiLevel = "visible" | "opaque" | "hidden";
export const AI_LEVELS: readonly AiLevel[] = ["visible", "opaque", "hidden"];
export interface Visibility {
  id: string;
  name: string;
  level: AiLevel;
  count: number;
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
    } else if (p.kind === "ask" && (p.control === "choice" || p.control === "text")) {
      const prompt = parsePainted(p.prompt);
      if (prompt)
        pending = {
          kind: "ask",
          id: p.id,
          control: p.control,
          prompt,
          options: (Array.isArray(p.options) ? p.options : [])
            .slice(0, 20)
            .map((o) => parsePainted(o))
            .filter((x): x is Painted => x !== null),
        };
    }
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
  state: { lastCheck: number; lastError: string | null; count: number; type: string | null };
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
    },
  };
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
    method: "GET" | "POST" | "PUT",
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
        },
      ];
    });
  }
  accept = async (id: string) =>
    parseTurn(await this.call("POST", `proposals/${encodeURIComponent(id)}/accept`));
  reject = async (id: string) =>
    void (await this.call("POST", `proposals/${encodeURIComponent(id)}/reject`));
  async runs(): Promise<RunSummary[]> {
    const b = await this.call("GET", "runs");
    const list = isObj(b) && Array.isArray(b.runs) ? b.runs : [];
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
      return [{ id, name, level, count: typeof t.count === "number" ? t.count : 0 }];
    });
  }
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
  forgetMail = async () => void (await this.call("POST", "/forget", {}, "api/mail"));
  async undo(id: string): Promise<number> {
    const b = await this.call("POST", `runs/${encodeURIComponent(id)}/undo`);
    return isObj(b) && typeof b.undone === "number" ? b.undone : 0;
  }
}
