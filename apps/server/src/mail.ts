import { createHash, randomUUID } from "node:crypto";
import type { Duplex } from "node:stream";
import {
  type Budget,
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
  rec,
  resolveModules,
  type UserIn,
  type Val,
} from "@boni/agent";
import { systemTimeZone } from "@boni/calendar";
import { type FieldDef, label, newId, rolesOf, type TypeDef } from "@boni/entities";
import type { ExtensionManifest, RouteSpec } from "@boni/extensions";
import { wrappedKeysIn } from "@boni/identity";
import { ImapError, ImapReader, type Message, parseMessage } from "@boni/mail";
import { BODY, open, seal, type UserStore, wrappedKeyProvider } from "@boni/store";
import { readAccount } from "./account.ts";
import type { AgentHost } from "./agent.ts";
import { AUTO_AREA, acceptAlone, autoOn } from "./autoAccept.ts";
import type { Db } from "./db.ts";
import { extension, MAIL_EXTENSION } from "./extensions.ts";
import type { Feeds } from "./feeds.ts";
import { feedHas, invitationLine, invitationOf } from "./invitation.ts";
import { GUIDE_AREA, GUIDE_COST, learningOn, mayReview, TRIED_FOR } from "./learning.ts";
import { type Decision, decisions, review, ruleCandidates, type Suggestion } from "./mailReview.ts";
import { readRows } from "./money/sheets.ts";
import { FILE_FIELD, FOLDER_FIELD, mimeOf } from "./paths.ts";
import { timed } from "./perf.ts";
import { decrypt, type SecretKey } from "./secret.ts";
import { likeTitle, normalizeSubject, threadIdOf, whenOf, whenParts } from "./thread.ts";

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
  /** When it last suggested something: at most one a day that Juan did not ask for (learning.ts). */
  suggestedAt?: number;
  /** Senders and example ids Juan said no to: never suggested again. */
  refused?: string[];
  /** Rules found by code that measured no better, by sender, with when: not tried again for a week (learning.ts). */
  tried?: Record<string, number>;
  /** The one-off rescans done (`RESCAN`). */
  rescans?: string[];
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
/** The mail a reading's run read: its plan's first step (`entities.get` with the mail's id), else "". */
function mailOfRun(j: UserStore["journal"], run: string): string {
  const plan = j.run(run)?.plan as {
    steps?: { tool?: string; args?: { id?: { lit?: unknown } } }[];
  };
  const first = plan?.steps?.[0];
  return first?.tool === "entities.get" ? String(first.args?.id?.lit ?? "") : "";
}
/** The module whose items are events (a calendar invitation's event follows its route): "events" unless an extension names its own. */
const eventModule = (m: ExtensionManifest) =>
  (resolveModules(plain(modulesOfManifest(m))) ?? []).find((x) => x.kind === "event")?.id ??
  "events";
const budgetOf = (m: ExtensionManifest) =>
  m.needs.budget ? { key: m.id, perDay: m.needs.budget.readersPerDay } : undefined;

/**
 * The readings the reviewer makes to measure a guide (mail Juan already decided, read again): their own allowance
 * per day, one review's worth (20 mails read twice, and some margin), counted in the account's day but never in the
 * mail's own budget nor in each sender's, so measuring never leaves new mail unread (task 37; P13 in
 * docs/nucleo.md). The reviewer looks once a day at most (learning.ts); a sender cannot make it read.
 */
export const MEASURE_PER_DAY = 45;
const measureBudget = (m: ExtensionManifest): Budget => ({
  key: `${m.id}:measure`,
  perDay: MEASURE_PER_DAY,
  bySender: false,
});

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
  /** The fields playing `time` and `endTime` (docs/clases.md §6), where the mail's times go; none: left out. */
  time?: string | null;
  endTime?: string | null;
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
    /**
     * The mail is a calendar invitation (task 45): its event comes from the mail's own fields, read from the .ics
     * by code and bound as `$inv` (uid, titulo, dia, inicio, fin, nota, linea), and follows this module's route
     * (the events'); no reader in between. The caller puts its title in `known`, so the reader does not propose
     * it again.
     */
    invitation?: string;
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
  // What the code could read of the attachments (a sheet, a text file), after the mail's own text. A hidden
  // field never comes through `$m` (entities.get leaves them out): the code binds it as `$adjuntos`.
  if (has.has("adjuntos_texto")) parts.push({ lit: "\n\nAdjuntos:\n" }, { ref: "$adjuntos" });
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
            ...(t.time ? [{ lit: t.time }, { ref: "$item.start" }] : []),
            ...(t.endTime ? [{ lit: t.endTime }, { ref: "$item.end" }] : []),
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
      // With an invitation the collection is chosen even when the reader finds nothing else.
      when: o.invitation
        ? { fn: "or", args: [{ ref: "$r.all" }, { ref: "$inv.uid" }] }
        : { ref: "$r.all" },
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
  // The invitation's event (task 45): the mail's own fields into the collection its module's route says; its
  // place and link as the record's note, and the invitation's line as the reason the card shows.
  const invite = (id: string, t: Target, when?: unknown) => ({
    id,
    op: "call",
    tool: "entities.create",
    ...(when ? { when } : {}),
    why: { ref: "$inv.linea" },
    args: {
      type: { lit: t.key },
      values: {
        fn: "obj",
        args: [
          { lit: "title" },
          { ref: "$inv.titulo" },
          ...(t.date ? [{ lit: t.date }, { ref: "$inv.dia" }] : []),
          ...(t.time ? [{ lit: t.time }, { ref: "$inv.inicio" }] : []),
          ...(t.endTime ? [{ lit: t.endTime }, { ref: "$inv.fin" }] : []),
          { lit: "body" },
          { ref: "$inv.nota" },
        ],
      },
    },
  });
  if (o.invitation) {
    const r = route(o.invitation);
    if ("propose" in r && r.propose === "chosen")
      targets.forEach((t, i) => {
        steps.push(
          invite(
            `inv${i}`,
            t,
            targets.length > 1
              ? { fn: "eq", args: [{ ref: "$c.choice" }, { lit: t.option }] }
              : undefined,
          ),
        );
      });
    else if ("propose" in r) {
      const t = o.fixed?.find((x) => x.id === r.propose.collection);
      if (t) steps.push(invite("inv_f", t));
    }
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

/** Bytes fetched of one message (its attachments included), and kept of one attachment (Juan, 2026-11-02). */
export const FETCH_MAX = 16 * 1024 * 1024;
export const ATTACHMENT_MAX = 8 * 1024 * 1024;
/**
 * A mail's original (its `.eml`, as it came) is kept as a file of the mail up to this size (Juan, 2026-11-03, task
 * 26: «Sí»; docs/correo.md §4.6): it opens whole in a mail app, with its HTML and its attachments.
 */
export const EML_MAX = 2 * 1024 * 1024;
/** A mail's original's file name: its subject, without what a file name cannot hold. */
const emlName = (subject: string) =>
  subject
    .replace(/[\p{Cc}/\\:*?"<>|]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || "correo";
/** A mail's original as fetched: its bytes and its whole size (more than the bytes when it was cut). */
interface Original {
  raw: Uint8Array;
  size: number;
}
/** Text read out of a mail's attachments (a sheet's rows, a text file) for the reader, at most. */
const ATTACHMENTS_TEXT_MAX = 50_000;

/**
 * The account's collection of files: the one with a file and the folder it is in (the import's «Archivos»), when
 * it has one. Another collection may hold files too (photos of a diary): never that one (2026-11-03, task 34: the
 * first collection with a file field was taken, a restricted one without folders, and every mail with attachments
 * failed to be kept from 0.8.70 on).
 */
export function filesType(store: UserStore): TypeDef | undefined {
  const has = (t: TypeDef, id: string) => t.fields.some((f) => f.id === id && !f.archived);
  return Object.values(store.schema().types).find(
    (t) => !t.archived && !t.system && has(t, FILE_FIELD) && has(t, FOLDER_FIELD),
  );
}

/**
 * Mail lost while its attachments went to that collection (0.8.70 to 0.8.79): the messages since then that are not
 * in yet, by their Message-ID, are brought in once (a mailbox's state made after it is marked done).
 */
const RESCAN = { id: "2026-11-03-attachments", since: "2026-11-01" } as const;

/**
 * The fields a mail's collection has beyond the headers: its attachments as files of the account (a relation to
 * the collection of files, when the account keeps one) and what the code could read of them, for the reader
 * (hidden: the page shows the files themselves).
 */
function extraFields(files: TypeDef | undefined): FieldDef[] {
  return [
    ...(files
      ? [
          {
            id: "f_archivos",
            key: "archivos",
            name: "Archivos",
            type: "relation" as const,
            relation: { target: files.id, many: true },
            label: CODE,
          },
        ]
      : []),
    {
      id: "f_adjuntos_texto",
      key: "adjuntos_texto",
      name: "Texto de los adjuntos",
      type: "longtext" as const,
      hidden: true,
      label: CODE,
    },
    ...INVITATION_FIELDS,
    ...THREAD_FIELDS,
  ];
}

/** The thread a mail belongs to and what it answers (task 46; `thread.ts`): hidden, for one proposal per thread. */
const THREAD_FIELDS: FieldDef[] = (
  [
    ["hilo", "Hilo", "text"],
    ["en_respuesta_a", "En respuesta a", "text"],
  ] as const
).map(([key, name, type]) => ({ id: `f_${key}`, key, name, type, hidden: true, label: CODE }));

/**
 * A calendar invitation's event, read by code from the mail's .ics (task 45; `invitation.ts`): hidden fields of
 * the mail, from which its plan proposes the event with its exact hours, and the card says why.
 */
const INVITATION_FIELDS: FieldDef[] = (
  [
    ["evento_uid", "Evento: id", "text"],
    ["evento_titulo", "Evento", "text"],
    ["evento_dia", "Evento: día", "date"],
    ["evento_inicio", "Evento: inicio", "time"],
    ["evento_fin", "Evento: fin", "time"],
    ["evento_lugar", "Evento: lugar", "text"],
    ["evento_enlace", "Evento: enlace", "url"],
    ["evento_nota", "Evento: nota", "longtext"],
    ["invitacion", "Invitación", "text"],
  ] as const
).map(([key, name, type]) => ({ id: `f_${key}`, key, name, type, hidden: true, label: CODE }));

/** What the code reads of an attachment for the reader: a sheet's rows (csv, xlsx, xls) or a text file; else nothing. */
export function attachmentText(a: { name: string; type: string; content?: Uint8Array }): string {
  if (!a.content) return "";
  const name = a.name.toLowerCase();
  try {
    if (/\.(csv|xlsx|xls)$/.test(name) || a.type === "text/csv")
      return readRows(a.content, name.endsWith(".csv") || a.type === "text/csv" ? "x.csv" : name)
        .slice(0, 2000)
        .map((r) => r.map((c) => (c === null || c === undefined ? "" : String(c))).join("\t"))
        .join("\n");
    if (/\.(txt|md)$/.test(name) || a.type === "text/plain")
      return new TextDecoder("utf-8").decode(a.content);
  } catch {
    // an attachment the reader cannot parse: its name is still in the mail
  }
  return "";
}

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

/** What a mail's plan needs (`planContext`), made once for the mail read in a row. */
interface PlanContext {
  store: UserStore;
  s: MailSettings;
  targets: Target[];
  fixed: Target[];
  m: ExtensionManifest;
  agent: ReturnType<AgentHost["agent"]>;
  guide: MailGuide;
  withGuide: boolean;
  bound: Record<string, Val>;
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
  /** The account's external calendars, downloaded by the server: an invitation already in one is not proposed. */
  feeds?: Feeds;
  /** The user's timezone, for an invitation's day and hours (the server's by default). */
  tz?: string;
  /** Tests only: the IMAP connection. */
  connect?: () => Duplex;
}

export class Mails {
  private o: MailsOptions;
  private busy = new Map<number, Promise<MailState>>();
  private queued = new Map<number, Promise<MailState>>();
  private reviewing = new Set<number>();
  private timer: ReturnType<typeof setInterval> | null = null;

  private readonly tz: string;

  constructor(o: MailsOptions) {
    this.o = o;
    this.tz = o.tz ?? systemTimeZone();
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
    // A mailbox set up from now on lost nothing: nothing to bring in again.
    return v
      ? { ...EMPTY, ...(JSON.parse(v) as Partial<MailState>) }
      : { ...EMPTY, rescans: [RESCAN.id] };
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
    const has = ["de_nombre", "de", "para", "cc", "fecha", "asunto", "adjuntos_texto"].filter(
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
      {
        modules: modulesOfManifest(m),
        ...(withGuide ? { guide: guideOf(g) } : {}),
        ...this.hiddenBindings(e),
      },
      ["r"],
      measureBudget(m),
    );
    const all = (r.kept?.r as { all?: { title: string }[] } | undefined)?.all;
    return all ? all.map((x) => x.title) : null;
  }

  /**
   * One review now (docs/nucleo.md 7.4b, point 3): Juan's latest decisions on mail proposals go to the
   * reviewer, with the rules his corrections already show (found by code, docs/fiabilidad.md F4); a suggestion
   * that gets more of them right waits in the state for him. One at a time. `auto` is the learner looking on its
   * own (after a check of the mailbox): only when learning.ts says it may; on demand, always.
   */
  async reviewNow(account: number, auto = false): Promise<Suggestion | null> {
    if (this.reviewing.has(account)) return this.state(account).suggestion ?? null;
    this.reviewing.add(account);
    try {
      const s = this.settings(account);
      const st = this.state(account);
      if (!s || !st.type || !this.o.host.on) return null;
      const store = this.o.host.store(account);
      const guide = this.guide(account);
      const targets = this.targets(store, s);
      const now = this.now();
      const tried = Object.entries(st.tried ?? {}).filter(([, at]) => now - at < TRIED_FOR);
      const excluded = new Set([...(st.refused ?? []), ...tried.map(([from]) => from)]);
      const type = st.type;
      let ds: Decision[] | null = null;
      const theDs = () => (ds ??= decisions(store, type, (v) => userIn(s.user, v.f_para, v.f_cc)));
      let found: MailRule[] | null = null;
      const candidates = () => (found ??= ruleCandidates(theDs(), targets, guide, excluded));
      if (auto) {
        const every = this.manifest(account).learning?.every;
        if (
          every === undefined ||
          !mayReview({
            learning: learningOn(store),
            waiting: !!st.suggestion,
            suggestedAt: st.suggestedAt ?? null,
            lookedAt: st.reviewedAt ?? null,
            now,
            fresh: () => this.freshDecisions(store, st.reviewedAt ?? 0),
            every,
            candidates: () => candidates().length,
          })
        )
          return null;
        console.log(
          `mail ${account}: the reviewer looks on its own (${candidates().length} found by code)`,
        );
      }
      const suggestion = await review({
        store,
        agent: this.o.host.agent(account),
        guide,
        targets,
        ds: theDs(),
        read: (mail, g) => this.readOnce(account, mail, g),
        now: this.now(),
        excluded,
        candidates: candidates(),
      });
      const after = this.state(account);
      after.reviewedAt = this.now();
      // What the code found and did not make the cut waits a week before it is measured again.
      const dropped = candidates();
      if (!suggestion && dropped.length)
        after.tried = Object.fromEntries(
          [...tried, ...dropped.map((r) => [r.from, this.now()] as [string, number])].slice(-200),
        );
      if (suggestion) {
        after.suggestion = suggestion;
        after.suggestedAt = this.now();
        // A suggestion is a decision of docs/fiabilidad.md: class B (it touches his guide), always asked, as sure
        // as the candidate guide was on the mail measured; Juan's answer judges it (`answerSuggestion`).
        store.journal.addDecision({
          id: randomUUID(),
          run: suggestion.run ?? suggestion.id,
          area: GUIDE_AREA,
          cost: GUIDE_COST,
          p: suggestion.total ? suggestion.after / suggestion.total : 0,
          outcome: "ask",
          detail: {
            suggestion: suggestion.id,
            rules: suggestion.rules.length,
            examples: suggestion.examples.length,
            found: candidates().length,
          },
          at: this.now(),
        });
      }
      this.saveState(account, after);
      if (suggestion) this.o.host.emit(account, "mail-suggestion", { id: suggestion.id });
      return suggestion;
    } finally {
      this.reviewing.delete(account);
    }
  }

  /**
   * Juan's decisions on mail proposals since the reviewer last looked; a correction (he changed the title or the
   * collection before accepting) counts double: a prediction error.
   */
  private freshDecisions(store: UserStore, since: number): number {
    return store.journal
      .proposals()
      .filter((p) => p.decided !== null && p.decided > since && p.status !== "stale")
      .reduce((n, p) => n + (p.edits ? 2 : 1), 0);
  }

  /**
   * Juan's answer to the waiting suggestion: accepted, its rules and examples join his guide; `changed`, he
   * writes it in his own words in his instructions (docs/preferencias.md §5) and nothing is added here. Either
   * way the suggestion's decision is judged right; rejected, wrong. What he did not take is never suggested again.
   */
  answerSuggestion(account: number, id: string, accept: boolean, changed = false): MailGuide {
    const st = this.state(account);
    const s = st.suggestion;
    const guide = this.guide(account);
    if (!s || s.id !== id) throw new MailError("no-suggestion");
    const store = this.o.host.store(account);
    const decision = store.journal
      .decisions(GUIDE_AREA, 50)
      .find((d) => !d.result && (d.detail as { suggestion?: string } | null)?.suggestion === id);
    if (decision)
      store.journal.setDecisionResult(
        decision.id,
        accept || changed ? "right" : "wrong",
        this.now(),
      );
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
    let had = st.type ? store.schema().types[st.type] : undefined;
    if (had && !had.archived) {
      const files = filesType(store);
      // The attachments' relation made toward another collection than the files' (task 34): made again toward the
      // files', while no mail holds anything in it (none could: every one with attachments failed).
      const wrong = had.fields.find(
        (f) => f.id === "f_archivos" && f.relation?.target !== files?.id,
      );
      const held = (v: unknown) =>
        Array.isArray(v) ? v.length > 0 : v !== null && v !== undefined;
      if (wrong && !store.list(had.id).some((e) => held(e.entity.values.f_archivos))) {
        store.applySchema(
          { op: "remove_field", type: had.id, field: "f_archivos" },
          { actor: "connector" },
        );
        had = store.schema().types[had.id] as TypeDef;
        console.warn("mail: the attachments now go to the collection of files");
      }
      const mine = had;
      // A field this code added later (Cc, the attachments) joins a collection made before it.
      const missing = [...FIELDS.map(fieldOf), ...extraFields(files)].filter(
        (f) => !mine.fields.some((x) => x.id === f.id),
      );
      for (const field of missing)
        store.applySchema({ op: "add_field", type: mine.id, field }, { actor: "connector" });
      return missing.length ? (store.schema().types[mine.id] as TypeDef) : mine;
    }
    const taken = new Set(Object.values(store.schema().types).map((t) => t.key));
    let key = "correo";
    for (let i = 2; taken.has(key); i++) key = `correo${i}`;
    const fields: FieldDef[] = [...FIELDS.map(fieldOf), ...extraFields(filesType(store))];
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

  /**
   * One message kept; if its attachments cannot be, the mail without them, saying so in its text; if not even that,
   * nothing, said in the log. Either way the check goes on with the next one.
   */
  private keepOne(
    account: number,
    store: UserStore,
    def: TypeDef,
    m: Message,
    arrived: string | null,
    original: Original | null = null,
  ): string | null {
    try {
      return this.keep(store, def, m, arrived, original);
    } catch (e) {
      console.error(
        `mail ${account}: a mail's attachments could not be kept (${(e as Error).message})`,
      );
    }
    try {
      const text = [m.text, "[Boni: sus adjuntos no se pudieron guardar]"]
        .filter(Boolean)
        .join("\n\n");
      return this.keep(store, def, { ...m, attachments: [], text }, arrived);
    } catch (e) {
      console.error(`mail ${account}: a mail could not be kept (${(e as Error).message})`);
      return null;
    }
  }

  /** One message as an entity: every value the sender's (external), the body as its text, its original a file. */
  private keep(
    store: UserStore,
    def: TypeDef,
    m: Message,
    arrived: string | null,
    original: Original | null = null,
  ): string {
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
    // The thread (task 46): the first message's id, else what it answers, else a reply by its subject.
    if (m.inReplyTo) values.f_en_respuesta_a = w(m.inReplyTo);
    if (def.fields.some((f) => f.id === "f_hilo"))
      values.f_hilo = w(
        threadIdOf(m, () => this.sameSubjectThread(store, def, m.subject), randomUUID()),
      );
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
    const files = def.fields.some((f) => f.id === "f_archivos") ? filesType(store) : undefined;
    const left = m.attachments.filter((a) => !a.content && a.size > 0);
    // The original as it came (task 26), when it came whole and fits.
    const eml =
      files && original && original.raw.length >= original.size && original.size <= EML_MAX
        ? original.raw
        : null;
    const notes = [
      m.hidden ? `[Boni: ${m.hidden} partes ocultas del HTML no se muestran]` : "",
      m.truncated ? "[Boni: el correo es más largo; solo se guarda el principio]" : "",
      ...(files
        ? left.map(
            (a) =>
              `[Boni: el adjunto «${a.name}» (${Math.round(a.size / 1024)} KB) no se guarda: pasa de ${ATTACHMENT_MAX / 1024 / 1024} MB]`,
          )
        : []),
      files && original && !eml && original.size > EML_MAX
        ? `[Boni: el correo original (${(original.size / 1024 / 1024).toFixed(1)} MB) no se guarda: pasa de ${EML_MAX / 1024 / 1024} MB]`
        : "",
    ].filter(Boolean);
    const text = [m.text, ...notes].filter(Boolean).join("\n\n");
    if (text) values[BODY] = w(text);
    // A calendar invitation (task 45): its event as the mail's own fields, read from the .ics by code (a
    // cancellation or someone's reply describes an event too, but asks nothing of the user).
    const inv = m.calendar ? invitationOf(m.calendar, this.tz) : null;
    if (
      inv &&
      inv.method !== "CANCEL" &&
      inv.method !== "REPLY" &&
      def.fields.some((f) => f.id === "f_invitacion")
    ) {
      values.f_evento_uid = w(inv.uid);
      values.f_evento_titulo = w(inv.title);
      values.f_evento_dia = w(inv.day);
      if (inv.start) values.f_evento_inicio = w(inv.start);
      if (inv.end) values.f_evento_fin = w(inv.end);
      if (inv.location) values.f_evento_lugar = w(inv.location);
      if (inv.link) values.f_evento_enlace = w(inv.link);
      const note = [inv.location, inv.link].filter(Boolean).join("\n");
      if (note) values.f_evento_nota = w(note);
      values.f_invitacion = w(invitationLine(inv));
    }
    // The attachments that fit: each a file of the account (a row of its files, in a folder by month), named by
    // the mail, and what the code could read of them for the reader (Juan, 2026-11-02).
    const kept = m.attachments.filter((a) => a.content);
    if (files && (kept.length || eml)) {
      const folder = `correo/${(when ?? "").slice(0, 7) || "sin-fecha"}`;
      const taken = new Set(
        store
          .entities(files.id)
          .filter((e) => e.values[FOLDER_FIELD] === folder)
          .map((e) => String(e.values[files.titleField] ?? "")),
      );
      const ids: string[] = [];
      const all = [
        ...kept,
        ...(eml
          ? [{ name: `${emlName(m.subject)}.eml`, type: "message/rfc822", content: eml }]
          : []),
      ];
      for (const a of all) {
        const sha = store.putFile(a.content as Uint8Array, a.type || mimeOf(a.name));
        const dot = a.name.lastIndexOf(".");
        const [base, ext] = dot > 0 ? [a.name.slice(0, dot), a.name.slice(dot)] : [a.name, ""];
        let name = a.name;
        for (let n = 2; taken.has(name); n++) name = `${base} (${n})${ext}`;
        taken.add(name);
        const made = store.create(
          files.id,
          { [files.titleField]: w(name), [FILE_FIELD]: w(sha), [FOLDER_FIELD]: w(folder) },
          { actor: "connector" },
        );
        ids.push(made.entity.id);
      }
      values.f_archivos = w(ids);
    }
    const texts = kept
      .map((a) => ({ a, text: attachmentText(a).trim() }))
      .filter((x) => x.text)
      .map((x) => `[${x.a.name}]\n${x.text}`);
    if (texts.length && def.fields.some((f) => f.id === "f_adjuntos_texto"))
      values.f_adjuntos_texto = w(texts.join("\n\n").slice(0, ATTACHMENTS_TEXT_MAX));
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
      const rescan =
        !restart && st.lastUid > 0 && !(st.rescans ?? []).includes(RESCAN.id)
          ? (await r.search({ since: RESCAN.since })).filter((u) => u <= st.lastUid)
          : [];
      const known =
        restart || rescan.length
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
      for (const uid of rescan) {
        const f = await r.fetch(uid, FETCH_MAX);
        if (!f) continue;
        const m = parseMessage(f.raw, f.raw.length < f.size, { keep: ATTACHMENT_MAX });
        // Without a Message-ID a mail cannot be told from one already in: left out.
        if (!m.messageId || known.has(m.messageId)) continue;
        const id = this.keepOne(account, store, def, m, f.internalDate, {
          raw: f.raw,
          size: f.size,
        });
        if (!id) continue;
        known.add(m.messageId);
        made.push(id);
        st.count++;
      }
      if (rescan.length) console.log(`mail ${account}: ${made.length} mails brought in again`);
      if (!restart) st.rescans = [...new Set([...(st.rescans ?? []), RESCAN.id])];
      for (const uid of uids.slice(0, this.o.perCheck ?? 50)) {
        const f = await r.fetch(uid, FETCH_MAX);
        st.lastUid = Math.max(st.lastUid, uid);
        if (!f) continue;
        const m = parseMessage(f.raw, f.raw.length < f.size, { keep: ATTACHMENT_MAX });
        if (m.messageId && known.has(m.messageId)) continue;
        // One mail that cannot be kept never stops the others (task 34: it stopped the check, and was lost).
        const id = timed("a mail kept", 300, () =>
          this.keepOne(account, store, def, m, f.internalDate, { raw: f.raw, size: f.size }),
        );
        if (!id) continue;
        made.push(id);
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

  /**
   * The collections a mail may propose into as last worked out, per store (task 43: each check of the mailbox read
   * every record of each, 0.66 s on the NAS): the same while no record they read changes (theirs and those their
   * relations name), nor the schema, the levels or the rules. Callers get copies (`planContext` marks them).
   */
  private targetMemo = new WeakMap<
    UserStore,
    { key: string; version: number; watch: Set<string>; targets: Target[] }
  >();

  private targetsFor(store: UserStore, ids: readonly string[]): Target[] {
    const key = JSON.stringify([ids, store.aiAccess(), store.aiRules()]);
    const version = store.version();
    const was = this.targetMemo.get(store);
    if (was && was.key === key && was.version !== version) {
      const ch = store.changesSince(was.version);
      if (!ch.schemaChanged && !ch.entities.some((e) => was.watch.has(e.entity.type)))
        was.version = version;
    }
    if (was && was.key === key && was.version === version)
      return was.targets.map((t) => ({ ...t }));
    const schema = store.schema().types;
    const watch = new Set<string>(ids);
    for (const id of ids)
      for (const f of schema[id]?.fields ?? [])
        if (f.type === "relation" && f.relation?.target) watch.add(f.relation.target);
    const targets = this.makeTargets(store, ids);
    this.targetMemo.set(store, { key, version, watch, targets });
    return targets.map((t) => ({ ...t }));
  }

  private makeTargets(store: UserStore, ids: readonly string[]): Target[] {
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
      const roles = rolesOf(ro.schema(), id);
      const keyOf = (fid: string | undefined) =>
        fid ? (t.fields.find((f) => f.id === fid)?.key ?? null) : null;
      return [
        {
          id: t.id,
          key: t.key,
          name: t.name,
          option: option.slice(0, 200),
          date: date?.key ?? null,
          time: keyOf(roles.time),
          endTime: keyOf(roles.endTime),
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
   * What a mail's plan needs, made once for the mail read in a row: the collections it may propose into (marked,
   * and those a route names), the agent, Juan's guide and what code binds. Null without a collection.
   */
  private planContext(account: number, s: MailSettings): PlanContext | null {
    const store = this.o.host.store(account);
    const targets = this.targets(store, s);
    const m = this.manifest(account);
    // Collections a route names by id, whether or not they are marked (never a hidden or system one).
    const fixedIds = Object.values(m.routes ?? {}).flatMap((r) =>
      "propose" in r && r.propose !== "chosen" ? [r.propose.collection] : [],
    );
    const fixed = this.targetsFor(store, fixedIds);
    if (!targets.length && !fixed.length) return null;
    const guide = this.guide(account);
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
    return {
      store,
      s,
      targets,
      fixed,
      m,
      agent: this.o.host.agent(account),
      guide,
      withGuide,
      bound,
    };
  }

  /**
   * One mail's plan: its proposals land in the inbox. `asked`: Juan asked for it (a guide rule that says never to
   * read the sender does not stop it then). How many proposals, and why the plan stopped if it did.
   */
  private async proposeOne(
    account: number,
    c: PlanContext,
    id: string,
    asked = false,
    again = false,
  ): Promise<{ n: number; stopped: string | null; already: number; decided: number }> {
    const none = { n: 0, stopped: null, already: 0, decided: 0 };
    const e = c.store.get(id);
    if (!e || e.entity.deleted !== undefined) return none;
    const v = e.entity.values;
    const from = String(v.f_de ?? "");
    // Guide rules first, by code: a mail it says never to read is not read at all.
    const rule = ruleFor(c.guide, from);
    if (rule?.action === "skip" && !asked) return none;
    // Asked from the conversation (task 54): what this mail already proposed is said, not made again; asked again,
    // its pending proposals give way and the mail is read afresh (Juan, 2026-11-04: «que el usuario pudiese
    // volver a proponerlo»).
    const mine = asked ? this.proposalsOf(c.store, id) : { pending: [], decided: [] };
    if (asked && !again && (mine.pending.length || mine.decided.length))
      return { ...none, already: mine.pending.length, decided: mine.decided.length };
    if (again) for (const p of mine.pending) c.store.journal.setProposal(p.id, "stale", this.now());
    const only =
      rule?.action === "collection" ? c.targets.filter((t) => t.id === rule.collection) : [];
    try {
      const has = ["de_nombre", "de", "para", "cc", "fecha", "asunto", "adjuntos_texto"].filter(
        (k) => typeof v[`f_${k}`] === "string" && v[`f_${k}`] !== "",
      );
      const chosen = only.length ? only : c.targets;
      // A calendar invitation (task 45): its event comes from the .ics by code, so the reader leaves it out
      // (`known`); already in one of the account's external calendars, it is not proposed at all.
      const inv =
        typeof v.f_evento_uid === "string" && v.f_evento_uid
          ? { uid: v.f_evento_uid, title: String(v.f_evento_titulo ?? "") }
          : null;
      const already = inv ? await this.calendarWith(account, inv.uid) : null;
      if (inv && already)
        console.log(
          `mail ${account}: invitation «${inv.title.slice(0, 60)}» already in calendar «${already}»: not proposed`,
        );
      const known = [
        ...(inv?.title ? [inv.title.slice(0, 200)] : []),
        ...(from && !again ? this.known(c.store, from) : []),
      ].slice(0, 20);
      const bound: Record<string, Val> = {
        ...c.bound,
        options: optionsValue(chosen),
        ...this.hiddenBindings(e),
      };
      const r = await c.agent.background(
        mailPlan(id, chosen, {
          has: e.entity.body ? [...has, "body"] : has,
          known,
          userIn: userIn(c.s.user, v.f_para, v.f_cc),
          guide: c.withGuide,
          modules: moduleIds(c.m),
          boundModules: true,
          ...(c.m.routes ? { routes: c.m.routes } : {}),
          fixed: c.fixed,
          askWhenUnsure: true,
          ...(inv && !already ? { invitation: eventModule(c.m) } : {}),
        }),
        bound,
        [],
        budgetOf(c.m),
      );
      const stopped = r.status === "stopped" ? (r.error ?? "stopped") : null;
      if (stopped && r.error) console.warn(`mail ${account}: plan stopped (${r.error})`);
      this.logRead(account, c.store, from, r.proposals);
      if (!again) this.foldThread(account, c.store, e, r.proposals);
      // What stays after the thread's fold (a repeat gave way): the proposals this reading made.
      const made = r.proposals.filter((p) => c.store.journal.proposal(p)?.status !== "stale");
      // «Solo» on for the mail's proposals (docs/fiabilidad.md §3.4): the ones like those Juan always kept are
      // accepted here, each a decision he judges by leaving it or undoing it.
      if (made.length && autoOn(c.store, AUTO_AREA))
        await acceptAlone(c.store, c.agent, made, this.now());
      return { n: made.length, stopped, already: 0, decided: mine.decided.length };
    } catch (err) {
      console.error(`mail ${account}: ${(err as Error).message}`);
      return { ...none, stopped: (err as Error).message };
    }
  }

  /** The proposals a mail made (last 60 days): the ones still waiting, and the ones Juan accepted. */
  private proposalsOf(
    store: UserStore,
    mail: string,
  ): { pending: { id: string }[]; decided: { id: string }[] } {
    const since = this.now() - 60 * 86_400_000;
    const j = store.journal;
    const mine = j
      .proposals()
      .filter(
        (p) =>
          p.created >= since &&
          p.tool === "entities.create" &&
          (p.status === "pending" || p.status === "accepted") &&
          mailOfRun(j, p.run) === mail,
      );
    return {
      pending: mine.filter((p) => p.status === "pending"),
      decided: mine.filter((p) => p.status === "accepted"),
    };
  }

  /**
   * A mail's tasks proposed now because Juan asked (task 30: «Proponer tarea» on a mail of the conversation): the
   * plan a new mail gets, for this one, after what the mailbox is doing; its proposals land in the inbox. How many.
   */
  async proposeFor(
    account: number,
    id: string,
    again = false,
  ): Promise<{ n: number; already: number; decided: number }> {
    for (;;) {
      const running = this.queued.get(account) ?? this.busy.get(account);
      if (!running) break;
      await running.catch(() => null);
    }
    if (!this.o.host.on || !this.o.host.hasData) throw new MailError("agent-off");
    const st = this.state(account);
    const e = this.o.host.store(account).get(id);
    if (!st.type || !e || e.entity.deleted !== undefined || e.entity.type !== st.type)
      throw new MailError("not-found");
    const settings = this.settings(account);
    if (!settings) throw new MailError("not-configured");
    const c = this.planContext(account, settings);
    if (!c) throw new MailError("no-collections");
    const { n, stopped, already, decided } = await this.proposeOne(account, c, id, true, again);
    if (n || again) this.o.host.emit(account, "proposals", { n });
    else if (stopped) throw new MailError("stopped");
    return { n, already, decided };
  }

  /**
   * Runs the mail plan for the pending mail (up to `perCheck` each time), each one taken off the list once its
   * plan ran; the proposals land in the inbox (and the devices are told). Waits while there is no agent or
   * no collection marked.
   */
  private async propose(account: number, s: MailSettings, st: MailState): Promise<void> {
    if (!this.o.host.on || !st.pending?.length || !this.enabled(account)) return;
    const c = this.planContext(account, s);
    if (!c) return;
    const version = this.readingVersion(account);
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
      n += (await this.proposeOne(account, c, id)).n;
    }
    if (n) this.o.host.emit(account, "proposals", { n });
    // The learner looks in the background when learning.ts says it may: every `learning.every` new decisions
    // of Juan's (the extension's manifest), or when his corrections already show a rule; at most once a day.
    if (c.m.learning) void this.reviewNow(account, true).catch(() => null);
  }

  /**
   * The mail's hidden fields for its plan, bound by code with the mail's own labels: what the code read of the
   * attachments (`$adjuntos`) and the invitation's event (`$inv`). `entities.get` leaves hidden fields out, so a
   * `$m.` reference to one stopped the plan (bad-ref: every mail with a readable attachment, until 2026-11-03).
   */
  private hiddenBindings(e: NonNullable<ReturnType<UserStore["get"]>>): Record<string, Val> {
    const v = e.entity.values;
    const val = (fid: string): Val =>
      leaf(
        typeof v[fid] === "string" && v[fid] ? (v[fid] as string) : null,
        e.labels[fid] ?? e.labels.f_asunto ?? CODE,
      );
    return {
      adjuntos: val("f_adjuntos_texto"),
      inv: rec(
        {
          uid: val("f_evento_uid"),
          titulo: val("f_evento_titulo"),
          dia: val("f_evento_dia"),
          inicio: val("f_evento_inicio"),
          fin: val("f_evento_fin"),
          nota: val("f_evento_nota"),
          linea: val("f_invitacion"),
        },
        e.labels.f_evento_uid ?? e.labels.f_asunto ?? CODE,
      ),
    };
  }

  /** The thread of a recent mail (30 days) with this subject, for a reply that lost its thread headers. */
  private sameSubjectThread(store: UserStore, def: TypeDef, subject: string): string | null {
    const want = normalizeSubject(subject);
    if (!want) return null;
    const since = this.now() - 30 * 86_400_000;
    const hit = store
      .list(def.id)
      .filter((e) => e.entity.created >= since && typeof e.entity.values.f_hilo === "string")
      .sort((a, b) => b.entity.created - a.entity.created)
      .find((e) => normalizeSubject(String(e.entity.values.f_asunto ?? "")) === want);
    return hit ? String(hit.entity.values.f_hilo) : null;
  }

  /**
   * One thread, one proposal (task 46; Juan, 2026-11-03: «me han salido múltiples recomendaciones en la bandeja
   * cuando debería ser una sola»): what a reply proposes again the same (title, day and hours) is dropped, from
   * whoever it comes; what it changes (another day or hour) takes the place of the earlier pending proposal, and
   * the new one keeps what it was (`before`), so the card says «Antes: …». Decided by code over the thread's
   * proposals of the last 60 days, never by the reader.
   */
  private foldThread(
    account: number,
    store: UserStore,
    e: NonNullable<ReturnType<UserStore["get"]>>,
    made: string[],
  ): void {
    const hilo = e.entity.values.f_hilo;
    if (typeof hilo !== "string" || !hilo || !made.length) return;
    const since = this.now() - 60 * 86_400_000;
    const mails = new Set(
      store
        .list(e.entity.type)
        .filter(
          (x) =>
            x.entity.id !== e.entity.id &&
            x.entity.values.f_hilo === hilo &&
            x.entity.created >= since,
        )
        .map((x) => x.entity.id),
    );
    if (!mails.size) return;
    const j = store.journal;
    const rowsOf = (p: { view: unknown }) =>
      (p.view as { rows?: { arg: string; value?: unknown }[] }).rows ?? [];
    const titleOf = (p: { view: unknown }) => {
      const v = rowsOf(p).find((r) => r.arg === "values.title")?.value;
      return typeof v === "string" ? v : "";
    };
    const earlier = j
      .proposals()
      .filter(
        (p) =>
          p.created >= since &&
          p.status !== "stale" &&
          p.tool === "entities.create" &&
          !made.includes(p.id) &&
          mails.has(mailOfRun(j, p.run)),
      );
    if (!earlier.length) return;
    const now = this.now();
    let changed = false;
    for (const id of made) {
      const n = j.proposal(id);
      if (!n || n.status !== "pending") continue;
      const title = titleOf(n);
      const like = earlier.filter((o) => likeTitle(titleOf(o), title));
      if (!like.length) continue;
      const when = whenOf(rowsOf(n));
      const same = like.find((o) => whenOf(rowsOf(o)) === when);
      if (same) {
        j.setProposal(id, "stale", now);
        changed = true;
        console.log(
          `mail ${account}: «${title.slice(0, 60)}» again in its thread (already ${same.status}): not proposed`,
        );
        continue;
      }
      const prev = [...like].sort((a, b) => b.created - a.created)[0] as (typeof like)[number];
      for (const o of like) if (o.status === "pending") j.setProposal(o.id, "stale", now);
      j.setProposalBefore(id, { proposal: prev.id, ...whenParts(rowsOf(prev)) });
      changed = true;
      console.log(
        `mail ${account}: «${title.slice(0, 60)}» changed in its thread (was ${whenOf(rowsOf(prev)) || "without a day"}): the earlier proposal gives way`,
      );
    }
    if (changed) this.o.host.emit(account, "proposals", { n: 0 });
  }

  /** The name of the account's external calendar that already holds the event `uid`, or null. */
  private async calendarWith(account: number, uid: string): Promise<string | null> {
    const feeds = this.o.feeds;
    if (!feeds || !uid) return null;
    for (const ext of readAccount(this.o.db, this.o.key, account).externals) {
      try {
        const copy = await feeds.get(account, ext.id, ext.url);
        if (feedHas(copy.text, uid)) return ext.name;
      } catch {
        // not reachable now: the invitation is proposed anyway (at worst Juan sees it twice)
      }
    }
    return null;
  }

  /**
   * What a reading made, in the log, so the log can say why a card looks as it does (Juan, 2026-11-03: «me
   * recomienda siempre a las 9:00»): each proposal's title, collection, day and hours.
   */
  private logRead(account: number, store: UserStore, from: string, ids: string[]): void {
    const made = ids.flatMap((id) => {
      const p = store.journal.proposal(id);
      if (!p) return [];
      const rows = (p.view as { rows?: { arg: string; value: unknown }[] }).rows ?? [];
      const of = (arg: string) => rows.find((r) => r.arg === arg)?.value;
      const text = (v: unknown) => (typeof v === "string" ? v : "");
      const day = rows.map((r) => text(r.value)).find((x) => /^\d{4}-\d\d-\d\d$/.test(x));
      const times = rows.map((r) => text(r.value)).filter((x) => /^\d\d:\d\d$/.test(x));
      const when = `${day ?? ""}${times.length ? ` ${times.join("–")}` : ""}`.trim();
      return [
        `«${text(of("values.title")).slice(0, 60)}» (${text(of("type"))}${when ? `, ${when}` : ""})`,
      ];
    });
    console.log(
      `mail ${account}: read <${from}>: ${made.length ? made.join("; ") : "nothing proposed"}`,
    );
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
