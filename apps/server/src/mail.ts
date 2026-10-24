import { createHash, randomUUID } from "node:crypto";
import type { Duplex } from "node:stream";
import {
  FILL_LIMITS,
  type FillField,
  type From,
  GUIDE_LIMITS,
  guideValue,
  leaf,
  list,
  plain,
  type ReadingGuide,
  readMessagePrompt,
  readStore,
  resolveModules,
  type UserIn,
  type Val,
} from "@boni/agent";
import { type FieldDef, label, newId, type TypeDef } from "@boni/entities";
import type { ExtensionManifest, RouteSpec } from "@boni/extensions";
import { wrappedKeysIn } from "@boni/identity";
import { ImapError, ImapReader, type Message, parseMessage } from "@boni/mail";
import { BODY, open, seal, type UserStore, wrappedKeyProvider } from "@boni/store";
import type { AgentHost } from "./agent.ts";
import type { Db } from "./db.ts";
import { extension, MAIL_EXTENSION } from "./extensions.ts";
import { decisions, review, type Suggestion } from "./mailReview.ts";
import { decrypt, type SecretKey } from "./secret.ts";

/**
 * Mail as a source (docs/nucleo.md, decision of 2026-10-20; plan PR 15b). An account may connect one mailbox
 * by IMAP (`@boni/mail`, read-only: nothing is marked read, moved or deleted). Every few minutes the new
 * messages of its folder become entities of the account's "Correos" collection, made by this code the first
 * time: every value `external` (it is someone else's text), with the sender as its source, third party.
 * Then, with the agent on and collections marked in Settings, each new mail runs a background plan (P7: it
 * reads and proposes, never acts): a reader lists the tasks the mail asks for, another picks one of those
 * collections, and each task becomes a proposal in the inbox, with where it came from.
 *
 * Kept in system.db's account data: `mail` (the settings, the app password among them, encrypted with the
 * server's secret key; never sent back to a device) and `mail-state` (where it is: UIDVALIDITY, the last
 * UID, the collection's id, the last check and its error).
 */
export interface MailSettings {
  host: string;
  port: number;
  user: string;
  password: string;
  folder: string;
  /** The collections (type ids) tasks from mail may be proposed into (the AI picks one; next step). */
  collections: string[];
  on: boolean;
}
export interface MailState {
  type: string | null;
  uidValidity: number;
  lastUid: number;
  lastCheck: number;
  /** A fixed code ("auth", "network", "timeout", "protocol"), never the server's words. */
  lastError: string | null;
  /** Messages brought in so far. */
  count: number;
  /**
   * Mail not yet read for tasks (no collection marked yet, or the agent off): read as soon as it can be, oldest
   * first, so the order of setting things up never loses a mail. Missing in a state from before it existed.
   */
  pending?: string[];
  /** With which reading (prompt, modules and guide, `readingVersion`) each mail was last read (the latest 1,000). */
  readWith?: Record<string, string>;
  /** The reviewer's last suggestion for the guide, waiting for Juan (docs/nucleo.md 7.4b, point 3). */
  suggestion?: Suggestion | null;
  /** When the reviewer last looked (decisions after it count towards the next review). */
  reviewedAt?: number;
  /** Senders and example ids Juan said no to: never suggested again. */
  refused?: string[];
}
/**
 * Juan's reading guide (docs/nucleo.md 7.4b, point 2), kept with the mailbox's settings and encrypted the
 * same way: his own words for the reader, rules the code applies (the model cannot skip them), and
 * examples of mail he decided (made from his decisions, never typed in by a device).
 */
export interface MailGuide {
  instructions: string;
  rules: MailRule[];
  examples: GuideExample[];
}
/** A rule from a closed catalogue: mail from an address or a domain ("@example.com") is never read, or
 * what it asks goes to one collection. The first rule that matches wins. */
export interface MailRule {
  id: string;
  from: string;
  action: "skip" | "collection";
  /** The type id, for "collection". */
  collection?: string;
}
export interface GuideExample {
  id: string;
  /** For Settings only: the mail's subject and sender. */
  subject: string;
  from: string;
  /** The mail as the reader read it (someone else's text). */
  mail: string;
  want: ReadingGuide["examples"][number]["want"];
}
const EMPTY_GUIDE: MailGuide = { instructions: "", rules: [], examples: [] };
const SENDER = /^(@[a-z0-9.-]+\.[a-z]{2,}|[^\s@]+@[a-z0-9.-]+\.[a-z]{2,})$/i;

/** The guide as the reader gets it, bound to the plan as `$guide`. */
export const guideOf = (g: MailGuide) =>
  guideValue({
    instructions: g.instructions,
    examples: g.examples.map((e) => ({ mail: e.mail, want: e.want })),
  });

/** The modules of an extension as the reader gets them (`$modules`, bound by code): built-in ones by id,
 * its own with their kind and prompt part. */
export const modulesOfManifest = (m: ExtensionManifest) =>
  leaf(
    (m.readers ?? []).map((r) =>
      "kind" in r ? { id: r.module, kind: r.kind, prompt: r.prompt } : r.module,
    ),
    label("own", "public", [{ kind: "code", id: `extension:${m.id}` }]),
  );
const moduleIds = (m: ExtensionManifest) => (m.readers ?? []).map((r) => r.module);
const budgetOf = (m: ExtensionManifest) =>
  m.needs.budget ? { key: m.id, perDay: m.needs.budget.readersPerDay } : undefined;

/** The first rule of the guide for mail from `address`. */
export function ruleFor(guide: MailGuide, address: string): MailRule | null {
  const a = address.trim().toLowerCase();
  return (
    guide.rules.find((r) => (r.from.startsWith("@") ? a.endsWith(r.from) : a === r.from)) ?? null
  );
}

/** A collection tasks may go to, as the plan names it. */
export interface Target {
  /** The type's id (a guide rule names it). */
  id?: string;
  key: string;
  name: string;
  /** The option the reader sees: the name and a few of Juan's own titles in it, so it knows what goes there. */
  option: string;
  /** The date field a task's due day goes to (`dueField`; none: the day is left out). */
  date: string | null;
  /** Its fields with a closed set of values, filled per item by the reader `fill` (docs/extensiones.md 9). */
  fill?: FillField[];
  /** The name the code binds `fill` to in the plan (`$fields_<n>`). */
  fillRef?: string;
  /** The entries whose titles `option` names, and those `fill` offers: the audit says a model saw them. */
  optionRefs?: From[];
  fillRefs?: From[];
}

/** How many entries of a related collection a relation field offers (the latest changed). */
const RELATION_CHOICES = 40;
/** The fields bound to the plan: made by code (only code may name them as a reader's fields). */
export const fieldsValue = (fields: FillField[], refs: From[] = []) => ({
  ...leaf(
    fields as unknown as Parameters<typeof leaf>[0],
    label("own", "personal", [{ kind: "code", id: "fill" }]),
  ),
  ...(refs.length ? { refs } : {}),
});
/** The collections the reader chooses among, bound as `$options` (made by code, with the entries they name). */
export const optionsValue = (targets: Target[]) => {
  const l = label("own", "personal", [{ kind: "code", id: "options" }]);
  return list(
    targets.map((t) => ({
      ...leaf(t.option, l),
      ...(t.optionRefs?.length ? { refs: t.optionRefs } : {}),
    })),
    l,
  );
};

/**
 * What the reader `fill` may set in a collection (Juan, 2026-10-23: proposals with their columns filled): a
 * select's options, the entries a relation may point to (of a collection the models may see, the latest
 * changed, titled by Juan or his import, nothing sensitive) and checkboxes. Never the title or the date (the
 * reading gives them), hidden, archived, sensitive or Boni's own fields.
 */
export function fillFields(
  ro: ReturnType<typeof readStore>,
  t: TypeDef,
  date: string | null,
  refs: From[] = [],
): FillField[] {
  const types = ro.schema().types;
  const out: FillField[] = [];
  for (const f of t.fields) {
    if (out.length >= FILL_LIMITS.fields) break;
    if (f.id === t.titleField || f.key === date || f.hidden || f.archived) continue;
    if (
      f.sensitivity === "sensitive" ||
      f.key.startsWith("boni") ||
      !/^[a-z0-9_-]{1,64}$/i.test(f.key)
    )
      continue;
    const name = f.name.slice(0, FILL_LIMITS.label);
    if (f.type === "checkbox") out.push({ key: f.key, name, kind: "check", options: [] });
    else if (f.type === "select" && f.options?.length)
      out.push({
        key: f.key,
        name,
        kind: "choice",
        options: f.options
          .filter((o) => o.name.trim())
          .slice(0, FILL_LIMITS.options)
          .map((o) => ({ value: o.id, label: o.name.slice(0, FILL_LIMITS.label) })),
      });
    else if (f.type === "relation" && f.relation && !f.relation.many) {
      const target = types[f.relation.target];
      if (!target || target.system || target.archived) continue;
      const seen = new Set<string>();
      const options = ro
        .list(target.id)
        .filter((e) => {
          const l = e.labels[target.titleField];
          const title = e.entity.values[target.titleField];
          return (
            typeof title === "string" &&
            title.trim() !== "" &&
            l !== undefined &&
            !l.noModel &&
            (l.integrity === "user" || l.integrity === "own" || l.integrity === "imported") &&
            l.sensitivity !== "sensitive"
          );
        })
        .sort((a, b) => b.entity.updated - a.entity.updated)
        .flatMap((e) => {
          const label = String(e.entity.values[target.titleField])
            .replace(/\s+/g, " ")
            .slice(0, FILL_LIMITS.label);
          if (seen.has(label)) return [];
          seen.add(label);
          return [{ value: e.entity.id, label, at: e.entity.version }];
        })
        .slice(0, Math.min(RELATION_CHOICES, FILL_LIMITS.options));
      for (const o of options)
        refs.push({ e: o.value, v: o.at, f: target.titleField, t: target.id });
      if (options.length)
        out.push({
          key: f.key,
          name,
          kind: "choice",
          options: options.map(({ value, label }) => ({ value, label })),
        });
    }
  }
  return out.filter((f) => f.kind === "check" || f.options.length > 0);
}

/** Fewer values than this say nothing about what a date field holds. */
const EVIDENCE = 3;
const DAY_MS = 86_400_000;

/**
 * The date field of a collection a due day goes to, judged by its data, never by its name (no field is
 * special to Boni): a field some of whose days fall after the day its item was recorded holds days ahead
 * (a due day, a meeting, a project's end), the one with most such days wins; a field with enough values and
 * none after that day only records what already happened (when a note was made, last reviewed, a birthday
 * written down) and never gets a due day. With no field of the first kind, the first one without enough
 * values to tell (a new collection); otherwise none. "After" means more than a day after the instant it was
 * stored, so a day written in another time zone is not taken for one ahead.
 */
export function dueField(
  type: TypeDef,
  entities: readonly { values: Record<string, unknown>; created: number }[],
): FieldDef | null {
  const dates = type.fields.filter((f) => f.type === "date" && !f.archived && !f.hidden);
  let best: FieldDef | null = null;
  let most = 0;
  let unknown: FieldDef | null = null;
  for (const f of dates) {
    let n = 0;
    let ahead = 0;
    for (const e of entities) {
      const v = e.values[f.id];
      if (typeof v !== "string") continue;
      const at = Date.parse(`${v}T00:00:00Z`);
      if (Number.isNaN(at)) continue;
      n++;
      if (at - e.created > DAY_MS) ahead++;
    }
    if (ahead > most) [best, most] = [f, ahead];
    else if (!ahead && n < EVIDENCE && !unknown) unknown = f;
  }
  return best ?? unknown;
}

/** Where the mailbox's address is among a mail's recipients: in Para, only in Cc, or neither (a list). */
export function userIn(mailbox: string, para: unknown, cc: unknown): UserIn {
  const me = mailbox.trim().toLowerCase();
  const has = (v: unknown) =>
    typeof v === "string" && me.includes("@") && v.toLowerCase().includes(me);
  return has(para) ? "to" : has(cc) ? "cc" : "group";
}

/** The modules a mail is read with (docs/nucleo.md 7.4b): what it asks the user to do, and to attend. */
export const MAIL_MODULES = ["tasks", "events"];

/**
 * The background plan for one mail (docs/nucleo.md 7.4b, 7.12; a plan template made by code): read the
 * mail once with `read_message` (its headers and text, where the user is among its recipients, the
 * modules), pick a collection when there are several (only if something is for the user), and one
 * `entities.create` per task or event in the chosen one. Every value comes from the mail, so the policy
 * sends each one to the inbox (P4, P7); nothing here is written by itself. `has`: the mail's fields that
 * have a value (the headers shown are those); `known`: the titles still waiting in the inbox from the same
 * sender, so a reminder does not propose them again (that sender's own text: nothing of Juan's, A14).
 */
export function mailPlan(
  mail: string,
  targets: Target[],
  o: {
    has?: readonly string[];
    known?: string[];
    userIn?: UserIn;
    /** The extension's module ids (each one's items go where its route says). */
    modules?: string[];
    /** The reader gets `$modules` (the extension's definitions, bound by code) instead of built-in ids. */
    boundModules?: boolean;
    /** Per module: propose in the collection the reader picks among `targets` (default), in a fixed one
     * (`fixed`), or nothing. */
    routes?: Record<string, RouteSpec>;
    fixed?: Target[];
    /** The plan reads `$guide` (the code binds it: Agent.background). */
    guide?: boolean;
    /**
     * When the decider is unsure of the collection, Juan is asked in the panel of requests (Juan, 2026-10-24)
     * instead of the reader choosing alone. Only for the live reading (a re-reading to measure never asks).
     */
    askWhenUnsure?: boolean;
  } = {},
): unknown {
  const modules = o.modules ?? MAIL_MODULES;
  const route = (m: string): RouteSpec => o.routes?.[m] ?? { propose: "chosen" };
  const chosen = modules.filter((m) => {
    const r = route(m);
    return "propose" in r && r.propose === "chosen";
  });
  const has = new Set(o.has ?? ["asunto", "body"]);
  const parts: unknown[] = [];
  const line = (name: string, ...keys: [string, string, string][]) => {
    const present = keys.filter(([k]) => has.has(k));
    if (!present.length) return;
    parts.push({ lit: `${name}: ` });
    for (const [k, before, after] of present)
      parts.push(
        ...(before ? [{ lit: before }] : []),
        { ref: `$m.${k}` },
        ...(after ? [{ lit: after }] : []),
      );
    parts.push({ lit: "\n" });
  };
  line("De", ["de_nombre", "", " "], ["de", "<", ">"]);
  line("Para", ["para", "", ""]);
  line("Cc", ["cc", "", ""]);
  line("Fecha", ["fecha", "", ""]);
  line("Asunto", ["asunto", "", ""]);
  if (has.has("body")) parts.push({ lit: "\n" }, { ref: "$m.body" });
  const text = { fn: "concat", args: parts };
  const known = o.known ?? [];
  const steps: unknown[] = [
    { id: "m", op: "call", tool: "entities.get", args: { id: { lit: mail } } },
    {
      id: "r",
      op: "read",
      reader: "read_message",
      input: text,
      params: {
        modules: o.boundModules
          ? { ref: "$modules" }
          : { fn: "list", args: modules.map((m) => ({ lit: m })) },
        user_in: { lit: o.userIn ?? "group" },
        ...(known.length ? { known: { fn: "list", args: known.map((k) => ({ lit: k })) } } : {}),
        ...(o.guide ? { guide: { ref: "$guide" } } : {}),
      },
    },
  ];
  // Each item's other fields and its note (reader `fill`, Jev when there is one): read with the mail and the
  // item, walked along the items when creating (`zip`).
  const fillStep = (id: string, module: string, t: Target, when?: unknown) => ({
    id,
    op: "read",
    reader: "fill",
    each: { ref: `$r.${module}` },
    ...(when ? { when } : {}),
    input: {
      fn: "concat",
      args: [
        ...parts,
        { lit: "\n\nElemento: " },
        { ref: "$item.title" },
        { lit: "\nPalabras del correo que lo piden: " },
        { ref: "$item.quote" },
      ],
    },
    params: { fields: { ref: `$${t.fillRef}` } },
  });
  const create = (id: string, module: string, t: Target, when?: unknown) => {
    const filled = !!(t.fill?.length && t.fillRef);
    const step = {
      id,
      op: "call",
      tool: "entities.create",
      each: { ref: `$r.${module}` },
      ...(filled ? { zip: { ref: `$${id}_f` } } : {}),
      ...(when ? { when } : {}),
      why: { ref: "$item.quote" },
      args: {
        type: { lit: t.key },
        values: {
          fn: "obj",
          args: [
            { lit: "title" },
            { ref: "$item.title" },
            ...(t.date ? [{ lit: t.date }, { ref: "$item.due" }] : []),
            ...(filled
              ? [
                  { lit: "body" },
                  { ref: "$zip.note" },
                  ...(t.fill ?? []).flatMap((f) => [
                    { lit: f.key },
                    { ref: `$zip.values.${f.key}` },
                  ]),
                ]
              : []),
          ],
        },
      },
    };
    return filled ? [fillStep(`${id}_f`, module, t, when), step] : [step];
  };
  if (chosen.length && targets.length > 1)
    steps.push({
      id: "c",
      op: "read",
      reader: "classify",
      input: text,
      params: {
        options: { ref: "$options" },
        question: {
          lit: "¿En cuál de estas colecciones apuntaría el destinatario lo que este mensaje le pide hacer o a lo que tiene que ir?",
        },
        ...(o.askWhenUnsure
          ? {
              ask: has.has("asunto")
                ? {
                    fn: "concat",
                    args: [{ lit: "¿A qué colección va «" }, { ref: "$m.asunto" }, { lit: "»?" }],
                  }
                : { lit: "¿A qué colección va este correo?" },
            }
          : {}),
      },
      when: { ref: "$r.all" },
    });
  targets.forEach((t, i) => {
    for (const module of chosen)
      steps.push(
        ...create(
          `n${i}_${module}`,
          module,
          t,
          targets.length > 1 ? { fn: "eq", args: [{ ref: "$c.choice" }, { lit: t.option }] } : null,
        ),
      );
  });
  for (const module of modules) {
    const r = route(module);
    if (!("propose" in r) || r.propose === "chosen") continue;
    const t = o.fixed?.find((x) => x.id === r.propose.collection);
    if (t) steps.push(...create(`f_${module}`, module, t));
  }
  return { version: 1, steps };
}

/** What a device sees: everything but the password. */
export type MailView = Omit<MailSettings, "password"> & {
  configured: true;
  state: Omit<MailState, "readWith" | "refused">;
};

const EMPTY: MailState = {
  type: null,
  uidValidity: 0,
  lastUid: 0,
  lastCheck: 0,
  lastError: null,
  count: 0,
};
const CODE = label("own", "personal", [{ kind: "code", id: "mail" }]);
const FIELDS: [key: string, name: string, type: FieldDef["type"]][] = [
  ["asunto", "Asunto", "text"],
  ["de", "De", "email"],
  ["de_nombre", "Nombre", "text"],
  ["para", "Para", "text"],
  ["cc", "Cc", "text"],
  ["fecha", "Fecha", "datetime"],
  ["adjuntos", "Adjuntos", "text"],
  ["id_mensaje", "Id del mensaje", "text"],
];

const fieldOf = ([k, name, type]: (typeof FIELDS)[number]): FieldDef => ({
  id: `f_${k}`,
  key: k,
  name,
  type,
  label: CODE,
  ...(k === "de" || k === "de_nombre" || k === "para" || k === "cc"
    ? { sensitivity: "personal" as const }
    : {}),
});

export class MailError extends Error {
  code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

export interface MailsOptions {
  db: Db;
  key: SecretKey;
  host: AgentHost;
  now?: () => number;
  /** On the first check, mail received in the last `firstDays` days (older mail is never brought in). */
  firstDays?: number;
  /** At most this many messages per check (the rest on the next one). */
  perCheck?: number;
  /** Called with the ids of the entities made from new mail (the agent's proposals hang from it). */
  onNew?: (account: number, entities: string[]) => void;
  /** Tests only: the IMAP connection. */
  connect?: () => Duplex;
}

export class Mails {
  private o: MailsOptions;
  private busy = new Map<number, Promise<MailState>>();
  private queued = new Map<number, Promise<MailState>>();
  private reviewing = new Set<number>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(o: MailsOptions) {
    this.o = o;
  }

  private now = () => (this.o.now ?? Date.now)();

  /**
   * Where each part lives (docs/extensiones.md 4): in the user's own store, outside its operation log; the
   * settings (with the app password) and the guide sealed with the user's data key. Before 0.8 they were in
   * system.db's account data (the settings and guide encrypted with the server's key): the first read moves
   * them, once, and removes them from there.
   */
  private static readonly PLACES: Record<string, { at: string; sealed: boolean }> = {
    mail: { at: "ext/correo/settings", sealed: true },
    "mail-state": { at: "ext/correo/state", sealed: false },
    "mail-guide": { at: "ext/correo/guide", sealed: true },
  };
  private keys = new Map<number, Buffer>();

  private dataKey(account: number): Buffer {
    let k = this.keys.get(account);
    if (!k) {
      k = wrappedKeyProvider(this.o.key, wrappedKeysIn(this.o.db)).dataKey(String(account));
      this.keys.set(account, k);
    }
    return k;
  }

  private get(account: number, key: string): string | null {
    const place = Mails.PLACES[key];
    if (!place || !this.o.host.hasData) return null;
    const store = this.o.host.store(account);
    let v = store.setting(place.at);
    if (v === null) {
      const old = this.o.db
        .prepare("SELECT value FROM account_data WHERE account_id = ? AND key = ?")
        .get(account, key) as { value: string } | undefined;
      if (!old) return null;
      this.set(account, key, place.sealed ? decrypt(this.o.key, old.value) : old.value);
      this.o.db
        .prepare("DELETE FROM account_data WHERE account_id = ? AND key = ?")
        .run(account, key);
      v = store.setting(place.at);
      if (v === null) return null;
    }
    return place.sealed
      ? open(this.dataKey(account), Buffer.from(v, "base64"), place.at).toString("utf8")
      : v;
  }

  private set(account: number, key: string, value: string | null): void {
    const place = Mails.PLACES[key];
    if (!place || !this.o.host.hasData) throw new MailError("no-store");
    const store = this.o.host.store(account);
    store.setSetting(
      place.at,
      value === null || !place.sealed
        ? value
        : seal(this.dataKey(account), Buffer.from(value, "utf8"), place.at).toString("base64"),
    );
  }

  settings(account: number): MailSettings | null {
    const v = this.get(account, "mail");
    return v ? (JSON.parse(v) as MailSettings) : null;
  }

  state(account: number): MailState {
    const v = this.get(account, "mail-state");
    return v ? { ...EMPTY, ...(JSON.parse(v) as Partial<MailState>) } : { ...EMPTY };
  }

  private saveState(account: number, s: MailState) {
    this.set(account, "mail-state", JSON.stringify(s));
  }

  view(account: number): MailView | null {
    const s = this.settings(account);
    if (!s) return null;
    const { password: _p, ...rest } = s;
    const { readWith: _r, refused: _x, ...state } = this.state(account);
    return { ...rest, configured: true, state };
  }

  /**
   * New settings, after a connection with them works (a wrong password is never kept). Without `password`
   * the stored one stays. A different mailbox starts over (cursor and count), keeping the mail already in.
   */
  async save(
    account: number,
    input: Partial<Omit<MailSettings, "password">> & { password?: string },
  ): Promise<MailView> {
    const old = this.settings(account);
    const s: MailSettings = {
      host: String(input.host ?? old?.host ?? "").trim(),
      port: Number(input.port ?? old?.port ?? 993),
      user: String(input.user ?? old?.user ?? "").trim(),
      password: input.password ? String(input.password) : (old?.password ?? ""),
      folder: String(input.folder ?? old?.folder ?? "INBOX").trim() || "INBOX",
      collections: (Array.isArray(input.collections)
        ? input.collections
        : (old?.collections ?? [])
      ).filter((c): c is string => typeof c === "string" && c.length < 80),
      on: input.on ?? old?.on ?? true,
    };
    if (
      !/^[a-z0-9.-]{1,253}$/i.test(s.host) ||
      !Number.isInteger(s.port) ||
      s.port < 1 ||
      s.port > 65535
    )
      throw new MailError("bad-server");
    if (!s.user || s.user.length > 320 || !s.password || s.password.length > 500)
      throw new MailError("bad-login");
    if (s.folder.length > 200) throw new MailError("bad-folder");
    const sameBox = old && old.host === s.host && old.user === s.user && old.folder === s.folder;
    if (!sameBox || input.password) {
      const r = await this.open(s);
      try {
        await r.examine(s.folder);
      } finally {
        r.close();
      }
    }
    this.set(account, "mail", JSON.stringify(s));
    if (!sameBox) {
      const st = this.state(account);
      this.saveState(account, { ...EMPTY, type: st.type, count: 0 });
    }
    return this.view(account) as MailView;
  }

  /** Juan's reading guide (empty until he writes one). */
  guide(account: number): MailGuide {
    const v = this.get(account, "mail-guide");
    return v ? { ...EMPTY_GUIDE, ...(JSON.parse(v) as Partial<MailGuide>) } : { ...EMPTY_GUIDE };
  }

  /**
   * A new guide from a device: his words and his rules as given (checked), and the examples he keeps
   * (only ids of examples that exist: a device removes examples, it never writes one).
   */
  saveGuide(
    account: number,
    input: { instructions?: unknown; rules?: unknown; keepExamples?: unknown },
  ): MailGuide {
    const old = this.guide(account);
    const g: MailGuide = { ...old };
    if (input.instructions !== undefined) {
      if (
        typeof input.instructions !== "string" ||
        input.instructions.length > GUIDE_LIMITS.instructions
      )
        throw new MailError("bad-guide");
      g.instructions = input.instructions.trim();
    }
    if (input.rules !== undefined) {
      if (!Array.isArray(input.rules) || input.rules.length > 100) throw new MailError("bad-guide");
      g.rules = input.rules.map((r) => {
        const x = r as Partial<MailRule>;
        const from = String(x.from ?? "")
          .trim()
          .toLowerCase();
        if (!SENDER.test(from) || (x.action !== "skip" && x.action !== "collection"))
          throw new MailError("bad-rule");
        if (x.action === "collection" && (typeof x.collection !== "string" || !x.collection))
          throw new MailError("bad-rule");
        return {
          id: typeof x.id === "string" && /^[a-z0-9_-]{1,40}$/i.test(x.id) ? x.id : randomUUID(),
          from,
          action: x.action,
          ...(x.action === "collection" ? { collection: x.collection as string } : {}),
        };
      });
    }
    if (input.keepExamples !== undefined) {
      if (!Array.isArray(input.keepExamples)) throw new MailError("bad-guide");
      const keep = new Set(input.keepExamples);
      g.examples = old.examples.filter((e) => keep.has(e.id));
    }
    this.set(account, "mail-guide", JSON.stringify(g));
    return g;
  }

  /** What a reading is: the prompt with the mail modules and the guide the reader gets (a short hash). */
  readingVersion(account: number): string {
    const g = this.guide(account);
    const mods = resolveModules(plain(modulesOfManifest(this.manifest(account)))) ?? [];
    return createHash("sha256")
      .update(readMessagePrompt(mods))
      .update(JSON.stringify([g.instructions, g.examples.map((e) => [e.mail, e.want])]))
      .digest("hex")
      .slice(0, 12);
  }

  /** The mail extension's manifest for this account (the preset until the store has one). */
  manifest(account: number): ExtensionManifest {
    return this.o.host.hasData
      ? (extension(this.o.host.store(account), MAIL_EXTENSION.id)?.manifest ?? MAIL_EXTENSION)
      : MAIL_EXTENSION;
  }

  /** Whether the mail extension is on (Settings → Extensiones); off, nothing is fetched or read. */
  enabled(account: number): boolean {
    return !this.o.host.hasData
      ? true
      : (extension(this.o.host.store(account), MAIL_EXTENSION.id)?.enabled ?? true);
  }

  /** Reads one mail with a guide as the mail plan would, without proposing anything: the titles it keeps. */
  private async readOnce(account: number, mail: string, g: MailGuide): Promise<string[] | null> {
    const s = this.settings(account);
    const store = this.o.host.store(account);
    const e = store.get(mail);
    if (!s || !e) return null;
    const v = e.entity.values;
    if (ruleFor(g, String(v.f_de ?? ""))?.action === "skip") return null;
    const has = ["de_nombre", "de", "para", "cc", "fecha", "asunto"].filter(
      (k) => typeof v[`f_${k}`] === "string" && v[`f_${k}`] !== "",
    );
    const withGuide = !!(g.instructions || g.examples.length);
    const m = this.manifest(account);
    const r = await this.o.host.agent(account).background(
      mailPlan(mail, [], {
        has: e.entity.body ? [...has, "body"] : has,
        userIn: userIn(s.user, v.f_para, v.f_cc),
        guide: withGuide,
        modules: moduleIds(m),
        boundModules: true,
      }),
      { modules: modulesOfManifest(m), ...(withGuide ? { guide: guideOf(g) } : {}) },
      ["r"],
      budgetOf(m),
    );
    const all = (r.kept?.r as { all?: { title: string }[] } | undefined)?.all;
    return all ? all.map((x) => x.title) : null;
  }

  /**
   * One review now (docs/nucleo.md 7.4b, point 3): Juan's latest decisions on mail proposals go to the
   * reviewer; a suggestion that gets more of them right waits in the state for him. One at a time.
   */
  async reviewNow(account: number): Promise<Suggestion | null> {
    if (this.reviewing.has(account)) return this.state(account).suggestion ?? null;
    this.reviewing.add(account);
    try {
      const s = this.settings(account);
      const st = this.state(account);
      if (!s || !st.type || !this.o.host.on) return null;
      const store = this.o.host.store(account);
      const guide = this.guide(account);
      const suggestion = await review({
        store,
        agent: this.o.host.agent(account),
        guide,
        targets: this.targets(store, s),
        ds: decisions(store, st.type, (v) => userIn(s.user, v.f_para, v.f_cc)),
        read: (mail, g) => this.readOnce(account, mail, g),
        now: this.now(),
        excluded: new Set(st.refused ?? []),
      });
      const after = this.state(account);
      after.reviewedAt = this.now();
      if (suggestion) after.suggestion = suggestion;
      this.saveState(account, after);
      if (suggestion) this.o.host.emit(account, "mail-suggestion", { id: suggestion.id });
      return suggestion;
    } finally {
      this.reviewing.delete(account);
    }
  }

  /** Juan's answer to the waiting suggestion: accepted, its rules and examples join his guide. */
  answerSuggestion(account: number, id: string, accept: boolean): MailGuide {
    const st = this.state(account);
    const s = st.suggestion;
    const guide = this.guide(account);
    if (!s || s.id !== id) throw new MailError("no-suggestion");
    if (accept) {
      const g: MailGuide = {
        ...guide,
        rules: [
          ...guide.rules,
          ...s.rules.filter((r) => !guide.rules.some((x) => x.from === r.from)),
        ],
        examples: [...guide.examples, ...s.examples].slice(-10),
      };
      this.set(account, "mail-guide", JSON.stringify(g));
    } else
      st.refused = [
        ...new Set([
          ...(st.refused ?? []),
          ...s.rules.map((r) => r.from),
          ...s.examples.map((e) => e.id),
        ]),
      ].slice(-500);
    st.suggestion = null;
    this.saveState(account, st);
    return this.guide(account);
  }

  /** Disconnects the mailbox: the settings go, the mail already brought in stays. */
  forget(account: number): void {
    this.set(account, "mail", null);
    this.set(account, "mail-state", null);
  }

  private async open(s: MailSettings): Promise<ImapReader> {
    try {
      return await ImapReader.open({
        host: s.host,
        port: s.port,
        user: s.user,
        password: s.password,
        ...(this.o.connect ? { connect: this.o.connect } : {}),
      });
    } catch (e) {
      throw new MailError(e instanceof ImapError ? e.code : "network");
    }
  }

  /** The account's "Correos" collection: the one this code made, or a new one if it is gone. */
  private collection(store: UserStore, st: MailState): TypeDef {
    const had = st.type ? store.schema().types[st.type] : undefined;
    if (had && !had.archived) {
      // A field this code added later (Cc) joins a collection made before it.
      const missing = FIELDS.map(fieldOf).filter((f) => !had.fields.some((x) => x.id === f.id));
      for (const field of missing)
        store.applySchema({ op: "add_field", type: had.id, field }, { actor: "connector" });
      return missing.length ? (store.schema().types[had.id] as TypeDef) : had;
    }
    const taken = new Set(Object.values(store.schema().types).map((t) => t.key));
    let key = "correo";
    for (let i = 2; taken.has(key); i++) key = `correo${i}`;
    const fields: FieldDef[] = FIELDS.map(fieldOf);
    const def: TypeDef = {
      id: newId("t", this.now()),
      key,
      name: "Correos",
      fields,
      titleField: "f_asunto",
      sensitivity: "personal",
      schemaVersion: 1,
      label: CODE,
    };
    store.applySchema({ op: "create_type", type: def }, { actor: "connector" });
    return def;
  }

  /** One message as an entity: every value the sender's (external), the body as its text. */
  private keep(store: UserStore, def: TypeDef, m: Message, arrived: string | null): string {
    const from = m.from[0];
    const l = label(
      "external",
      "personal",
      [{ kind: "mail", id: from?.address ?? "unknown" }],
      true,
    );
    const w = (v: unknown) => ({ value: v, label: l });
    const values: Record<string, { value: unknown; label: typeof l }> = {
      f_asunto: w(m.subject || "(sin asunto)"),
      f_id_mensaje: w(m.messageId),
    };
    if (from && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(from.address)) values.f_de = w(from.address);
    if (from?.name) values.f_de_nombre = w(from.name.slice(0, 200));
    const list = (as: typeof m.to) =>
      as
        .map((a) => (a.name ? `${a.name} <${a.address}>` : a.address))
        .join(", ")
        .slice(0, 2000);
    if (m.to.length) values.f_para = w(list(m.to));
    if (m.cc.length) values.f_cc = w(list(m.cc));
    const when = m.date ?? arrived;
    if (when) values.f_fecha = w(when);
    if (m.attachments.length)
      values.f_adjuntos = w(
        m.attachments
          .map((a) => a.name)
          .join(", ")
          .slice(0, 2000),
      );
    const notes = [
      m.hidden ? `[Boni: ${m.hidden} partes ocultas del HTML no se muestran]` : "",
      m.truncated ? "[Boni: el correo es más largo; solo se guarda el principio]" : "",
    ].filter(Boolean);
    const text = [m.text, ...notes].filter(Boolean).join("\n\n");
    if (text) values[BODY] = w(text);
    return store.create(def.id, values, { actor: "connector" }).entity.id;
  }

  /**
   * Brings in the new mail of one account, one check at a time. Asked while one runs, it waits for it and
   * then checks again (that one may have looked before the new mail arrived); callers meanwhile share it.
   */
  check(account: number): Promise<MailState> {
    const running = this.busy.get(account);
    const queued = this.queued.get(account);
    if (queued) return queued;
    const job: Promise<MailState> = (running ? running.catch(() => null) : Promise.resolve(null))
      .then(() => {
        this.queued.delete(account);
        this.busy.set(account, job);
        return this.run(account);
      })
      .finally(() => {
        if (this.busy.get(account) === job) this.busy.delete(account);
      });
    if (running) this.queued.set(account, job);
    else this.busy.set(account, job);
    return job;
  }

  /**
   * Reads again the mail of the last `days` days (by its date) with today's code: the pending proposals
   * those mails made are withdrawn (`stale`, never "rejected": Juan did not decide them) and the mails go
   * back to `pending`, then a check runs. Waits for a check under way, so neither overwrites the other's
   * state. Proposals Juan already accepted or rejected stay as they are.
   */
  async reread(account: number, days: number): Promise<{ mails: number; withdrawn: number }> {
    for (;;) {
      const running = this.queued.get(account) ?? this.busy.get(account);
      if (!running) break;
      await running.catch(() => null);
    }
    const st = this.state(account);
    if (!st.type || !this.o.host.hasData) return { mails: 0, withdrawn: 0 };
    const store = this.o.host.store(account);
    const since = this.now() - Math.max(1, Math.min(days, 60)) * 86_400_000;
    const mails = store
      .list(st.type)
      .map((e) => e.entity)
      .filter((e) => {
        const at = Date.parse(String(e.values.f_fecha ?? ""));
        return (Number.isNaN(at) ? e.created : at) >= since;
      })
      .sort((a, b) => a.created - b.created)
      .map((e) => e.id);
    const set = new Set(mails);
    const j = store.journal;
    let withdrawn = 0;
    for (const p of j.proposals("pending")) {
      const plan = j.run(p.run)?.plan as {
        steps?: { tool?: string; args?: { id?: { lit?: unknown } } }[];
      };
      const first = plan?.steps?.[0];
      if (first?.tool === "entities.get" && set.has(String(first.args?.id?.lit))) {
        j.setProposal(p.id, "stale", this.now());
        withdrawn++;
      }
    }
    st.pending = [...new Set([...(st.pending ?? []), ...mails])].slice(-500);
    this.saveState(account, st);
    if (withdrawn) this.o.host.emit(account, "proposals", { n: 0 });
    void this.check(account);
    return { mails: mails.length, withdrawn };
  }

  private async run(account: number): Promise<MailState> {
    const s = this.settings(account);
    const st = this.state(account);
    if (!s || !this.o.host.hasData || !this.enabled(account)) return st;
    const store = this.o.host.store(account);
    const made: string[] = [];
    let r: ImapReader | null = null;
    try {
      r = await this.open(s);
      const box = await r.examine(s.folder);
      const def = this.collection(store, st);
      st.type = def.id;
      // A new UIDVALIDITY means the old UIDs name other messages now: start from recent mail again,
      // skipping what is already in by its Message-ID.
      const restart = box.uidValidity !== st.uidValidity;
      const day = new Date(this.now() - (this.o.firstDays ?? 3) * 86_400_000)
        .toISOString()
        .slice(0, 10);
      const uids = restart
        ? await r.search({ since: day })
        : await r.search({ afterUid: st.lastUid });
      const known = restart
        ? new Set(
            store
              .list(def.id)
              .map((e) => e.entity.values.f_id_mensaje)
              .filter((x): x is string => typeof x === "string" && x !== ""),
          )
        : new Set<string>();
      if (restart) {
        st.uidValidity = box.uidValidity;
        st.lastUid = 0;
      }
      for (const uid of uids.slice(0, this.o.perCheck ?? 50)) {
        const f = await r.fetch(uid);
        st.lastUid = Math.max(st.lastUid, uid);
        if (!f) continue;
        const m = parseMessage(f.raw, f.raw.length < f.size);
        if (m.messageId && known.has(m.messageId)) continue;
        made.push(this.keep(store, def, m, f.internalDate));
        st.count++;
      }
      st.lastError = null;
    } catch (e) {
      st.lastError = e instanceof MailError ? e.code : e instanceof ImapError ? e.code : "failed";
      if (!(e instanceof MailError || e instanceof ImapError))
        console.error(`mail ${account}: ${(e as Error).message}`);
    } finally {
      r?.close();
      st.lastCheck = this.now();
      this.saveState(account, st);
    }
    if (made.length) this.o.onNew?.(account, made);
    // Every mail waits in `pending` until a plan has read it; a state from before `pending` existed gets
    // the mail of the first days (what the first check brought in) once.
    if (st.pending === undefined)
      st.pending = st.type
        ? store
            .list(st.type)
            .filter((e) => e.entity.created >= this.now() - (this.o.firstDays ?? 3) * 86_400_000)
            .sort((a, b) => a.entity.created - b.entity.created)
            .map((e) => e.entity.id)
        : [];
    st.pending = [...new Set([...st.pending, ...made])].slice(-500);
    this.saveState(account, st);
    await this.propose(account, s, st);
    return st;
  }

  /**
   * The marked collections the models may see, as plan targets (a hidden one is never offered). Each option
   * shows the collection's name and up to three of its latest titles, so a reader that only gets names (and
   * guesses) knows what each one holds: only titles that are Juan's or his data's, not sensitive, and none
   * from a collection the models may only know exists (R3). Options are the one thing of Juan's a reader of
   * outside text may get (A14), and its answer can only be one of them.
   */
  private targets(store: UserStore, s: MailSettings): Target[] {
    return this.targetsFor(store, s.collections);
  }

  private targetsFor(store: UserStore, ids: readonly string[]): Target[] {
    // What the models may see of each: its level and its rules (a closed row is never an example).
    const ro = readStore(store);
    const levels = store.aiAccess();
    const types = ro.schema().types;
    return ids.flatMap((id) => {
      const t = types[id];
      if (!t || t.archived || t.system) return [];
      const all = ro.list(id);
      const date = dueField(
        t,
        all.map((e) => e.entity),
      );
      const examples =
        levels[id] === "opaque"
          ? []
          : all
              .filter((e) => {
                const l = e.labels[t.titleField];
                return (
                  l !== undefined &&
                  !l.noModel &&
                  (l.integrity === "user" || l.integrity === "own" || l.integrity === "imported") &&
                  l.sensitivity !== "sensitive"
                );
              })
              .sort((a, b) => b.entity.updated - a.entity.updated)
              .slice(0, 3);
      const titles = examples.map((e) =>
        String(e.entity.values[t.titleField]).replace(/\s+/g, " ").slice(0, 40),
      );
      const option = titles.length ? `${t.name} (p. ej.: ${titles.join("; ")})` : t.name;
      const fillRefs: From[] = [];
      const fill = levels[id] === "opaque" ? null : fillFields(ro, t, date?.key ?? null, fillRefs);
      return [
        {
          id: t.id,
          key: t.key,
          name: t.name,
          option: option.slice(0, 200),
          date: date?.key ?? null,
          optionRefs: examples.map((e) => ({
            e: e.entity.id,
            v: e.entity.version,
            f: t.titleField,
            t: t.id,
          })),
          ...(fill ? { fill, fillRefs } : {}),
        },
      ];
    });
  }

  /**
   * Runs the mail plan for the pending mail (up to `perCheck` each time), each one taken off the list once its
   * plan ran; the proposals land in the inbox (and the devices are told). Waits while there is no agent or
   * no collection marked.
   */
  private async propose(account: number, s: MailSettings, st: MailState): Promise<void> {
    if (!this.o.host.on || !st.pending?.length || !this.enabled(account)) return;
    const store = this.o.host.store(account);
    const targets = this.targets(store, s);
    const m = this.manifest(account);
    // Collections a route names by id, whether or not they are marked (never a hidden or system one).
    const fixedIds = Object.values(m.routes ?? {}).flatMap((r) =>
      "propose" in r && r.propose !== "chosen" ? [r.propose.collection] : [],
    );
    const fixed = this.targetsFor(store, fixedIds);
    if (!targets.length && !fixed.length) return;
    const agent = this.o.host.agent(account);
    const guide = this.guide(account);
    const version = this.readingVersion(account);
    const withGuide = !!(guide.instructions || guide.examples.length);
    const bound: Record<string, Val> = {
      modules: modulesOfManifest(m),
      ...(withGuide ? { guide: guideOf(guide) } : {}),
    };
    // Each collection's fields to fill, bound by code (`$fields_<n>`).
    [...targets, ...fixed].forEach((t, i) => {
      if (!t.fill?.length) return;
      t.fillRef = `fields_${i}`;
      bound[t.fillRef] = fieldsValue(t.fill, t.fillRefs);
    });
    let n = 0;
    for (const id of st.pending.slice(0, this.o.perCheck ?? 50)) {
      st.pending = st.pending.filter((x) => x !== id);
      const read = { ...(st.readWith ?? {}) };
      delete read[id];
      read[id] = version;
      const keys = Object.keys(read);
      for (const k of keys.slice(0, Math.max(0, keys.length - 1000))) delete read[k];
      st.readWith = read;
      this.saveState(account, st);
      const e = store.get(id);
      if (!e || e.entity.deleted !== undefined) continue;
      const v = e.entity.values;
      const from = String(v.f_de ?? "");
      // Guide rules first, by code: a mail it says never to read is not read at all.
      const rule = ruleFor(guide, from);
      if (rule?.action === "skip") continue;
      const only =
        rule?.action === "collection" ? targets.filter((t) => t.id === rule.collection) : [];
      try {
        const has = ["de_nombre", "de", "para", "cc", "fecha", "asunto"].filter(
          (k) => typeof v[`f_${k}`] === "string" && v[`f_${k}`] !== "",
        );
        const chosen = only.length ? only : targets;
        const r = await agent.background(
          mailPlan(id, chosen, {
            has: e.entity.body ? [...has, "body"] : has,
            known: from ? this.known(store, from) : [],
            userIn: userIn(s.user, v.f_para, v.f_cc),
            guide: withGuide,
            modules: moduleIds(m),
            boundModules: true,
            ...(m.routes ? { routes: m.routes } : {}),
            fixed,
            askWhenUnsure: true,
          }),
          { ...bound, options: optionsValue(chosen) },
          [],
          budgetOf(m),
        );
        n += r.proposals.length;
        if (r.status === "stopped" && r.error)
          console.warn(`mail ${account}: plan stopped (${r.error})`);
      } catch (err) {
        console.error(`mail ${account}: ${(err as Error).message}`);
      }
    }
    if (n) this.o.host.emit(account, "proposals", { n });
    // Every `learning.every` new decisions of Juan's (the extension's manifest), the reviewer looks, in
    // the background.
    if (!m.learning) return;
    const since = st.reviewedAt ?? 0;
    // A correction (Juan changed the title or collection before accepting) counts double: a prediction error.
    const fresh = store.journal
      .proposals()
      .filter((p) => p.decided !== null && p.decided > since && p.status !== "stale")
      .reduce((n, p) => n + (p.edits ? 2 : 1), 0);
    if (fresh >= m.learning.every && !st.suggestion) void this.reviewNow(account).catch(() => null);
  }

  /** The titles of the proposals from `sender`'s mail still waiting in the inbox (the latest 20). */
  private known(store: UserStore, sender: string): string[] {
    const titles = store.journal
      .proposals("pending")
      .filter((p) => p.tool === "entities.create" && p.sources.includes(`mail:${sender}`))
      .sort((a, b) => b.created - a.created)
      .map((p) => {
        const rows = (p.view as { rows?: { arg: string; value: unknown }[] }).rows ?? [];
        return rows.find((r) => r.arg === "values.title")?.value;
      })
      .filter((v): v is string => typeof v === "string" && v !== "")
      .map((v) => v.slice(0, 200));
    return [...new Set(titles)].slice(0, 20);
  }

  /** Every `everyMs`, the accounts whose mailbox is on. */
  start(accounts: () => { id: number }[], everyMs = 5 * 60_000): void {
    const tick = () => {
      for (const a of accounts()) if (this.settings(a.id)?.on) void this.check(a.id);
    };
    this.timer = setInterval(tick, everyMs);
    this.timer.unref();
    setTimeout(tick, 10_000).unref();
  }

  async close(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await Promise.allSettled([...this.busy.values(), ...this.queued.values()]);
  }
}
