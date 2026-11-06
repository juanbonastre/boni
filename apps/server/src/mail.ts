import { createHash, randomUUID } from "node:crypto";
import type { Duplex } from "node:stream";
import {
  type Budget,
  EndRun,
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
  ToolError,
  type UserIn,
  type Val,
} from "@boni/agent";
import { systemTimeZone } from "@boni/calendar";
import { type FieldDef, label, newId, rolesOf, type TypeDef } from "@boni/entities";
import type { ExtensionManifest, RouteSpec } from "@boni/extensions";
import { wrappedKeysIn } from "@boni/identity";
import { gmailThreadUrl, ImapError, ImapReader, type Message, parseMessage } from "@boni/mail";
import { BODY, type FlowRow, open, seal, type UserStore, wrappedKeyProvider } from "@boni/store";
import { readAccount } from "./account.ts";
import type { AgentHost } from "./agent.ts";
import { AUTO_AREA, acceptAlone, autoOn } from "./autoAccept.ts";
import type { Db } from "./db.ts";
import { extension, MAIL_EXTENSION } from "./extensions.ts";
import type { Feeds } from "./feeds.ts";
import {
  collectionKeysOf,
  ensureFlow,
  FETCH_FLOW,
  inputsOf,
  MAIL_FLOW,
  REVIEW_FLOW,
  stepsOf,
} from "./flows.ts";
import { feedHas, invitationLine, invitationOf } from "./invitation.ts";
import { GUIDE_AREA, GUIDE_COST, learningOn, mayReview, TRIED_FOR } from "./learning.ts";
import {
  type Decision,
  decisions,
  measureCandidate,
  measuredMail,
  type ReviewCandidate,
  type ReviewerAnswer,
  type ReviewHost,
  reviewCandidate,
  reviewInput,
  ruleCandidates,
  type Suggestion,
} from "./mailReview.ts";
import { dueField, fillFields, type Target, TargetMemo } from "./mailTargets.ts";
import { readRows } from "./money/sheets.ts";
import { FILE_FIELD, FOLDER_FIELD, mimeOf } from "./paths.ts";
import { timed } from "./perf.ts";
import { type MailPieces, PIECES } from "./pieces.ts";
import { type Named, ownText, type Prefill, prefillOf } from "./prefill.ts";
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
  /** The version of «Traer correo» that ran without bringing the mail (D-50): no run until it changes. */
  fetchStopped?: number;
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
/** The mail a reading's run read: the run's input (a flow's run), else its plan's first step (older runs), else "". */
function mailOfRun(j: UserStore["journal"], run: string): string {
  const r = j.run(run);
  if (r?.input) return r.input;
  const plan = r?.plan as {
    steps?: { tool?: string; args?: { id?: { lit?: unknown } } }[];
  };
  const first = plan?.steps?.[0];
  return first?.tool === "entities.get" ? String(first.args?.id?.lit ?? "") : "";
}

/**
 * A mail as the reader reads it (docs/flujos.md: bound to the flow as `$text`): its headers that have a value, its
 * text, and what the code read of its attachments. The same lines the plan used to join from the record's fields.
 */
export function mailAsText(values: Record<string, unknown>, body: string | undefined): string {
  const v = (k: string) =>
    typeof values[`f_${k}`] === "string" && values[`f_${k}`] !== "" ? String(values[`f_${k}`]) : "";
  const lines: string[] = [];
  if (v("de_nombre") || v("de"))
    lines.push(`De: ${v("de_nombre") ? `${v("de_nombre")} ` : ""}${v("de") ? `<${v("de")}>` : ""}`);
  if (v("para")) lines.push(`Para: ${v("para")}`);
  if (v("cc")) lines.push(`Cc: ${v("cc")}`);
  if (v("fecha")) lines.push(`Fecha: ${v("fecha")}`);
  if (v("asunto")) lines.push(`Asunto: ${v("asunto")}`);
  let text = lines.map((l) => `${l}\n`).join("");
  if (body) text += `\n${body}`;
  if (v("adjuntos_texto")) text += `\n\nAdjuntos:\n${v("adjuntos_texto")}`;
  return text;
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

export { dueField, fillFields, type Target } from "./mailTargets.ts";

/** The relations the code found, bound to the plan by code (never written in it): `{ <field key>: <record id> }`. */
export const prefillValue = (prefill: readonly Prefill[]) => {
  const l = label("own", "personal", [{ kind: "code", id: "prefill" }]);
  return rec(Object.fromEntries(prefill.map((p) => [p.key, leaf(p.id, l)])), l);
};

/** How many entries of a related collection a relation field offers (the latest changed). */

/** The first rule of the guide for mail from `address`. */
export function ruleFor(guide: MailGuide, address: string): MailRule | null {
  const a = address.trim().toLowerCase();
  return (
    guide.rules.find((r) => (r.from.startsWith("@") ? a.endsWith(r.from) : a === r.from)) ?? null
  );
}

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

/** Where the mailbox's address is among a mail's recipients: in Para, only in Cc, or neither (a list). */
export function userIn(mailbox: string, para: unknown, cc: unknown): UserIn {
  const me = mailbox.trim().toLowerCase();
  const has = (v: unknown) =>
    typeof v === "string" && me.includes("@") && v.toLowerCase().includes(me);
  return has(para) ? "to" : has(cc) ? "cc" : "group";
}

/** The modules a mail is read with (docs/nucleo.md 7.4b): what it asks the user to do, and to attend. */
export const MAIL_MODULES = ["tasks", "events"];

/** How many days back «Plegar hilo» looks in a thread (task 46), unless its step says otherwise (F7: its setting). */
export const FOLD_DAYS = 60;
/** The days a «Plegar hilo» step asks for, within 1 and a year; its default otherwise. */
export const foldDays = (v: unknown): number =>
  typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 366 ? v : FOLD_DAYS;

/**
 * The background plan for one mail (docs/nucleo.md 7.4b, 7.12; the preset of the flow «Leer correo», docs/flujos.md):
 * read the mail once with `read_message` (its headers and text, where the user is among its recipients, the
 * modules), pick a collection when there are several (only if something is for the user), and one
 * `entities.create` per task or event in the chosen one. Every value comes from the mail, so the policy
 * sends each one to the inbox (P4, P7); nothing here is written by itself.
 *
 * It is the same plan for every mail of a configuration (the collections marked for mail, the modules, the routes,
 * the guide): what varies with the mail is bound by code as the flow's inputs (`mailBindings`): the record
 * (`$mail`), the mail as the reader reads it (`$text`), its subject, where the user is among its recipients, whether
 * Juan asked for it (`$asked`) or to read it again (`$again`), the collections the plan writes in (`$writes`), and per
 * collection, by its key, the fields the reader fills (`$fill.<key>`). What the code works out around the models is done by Boni's pieces, as steps of the plan
 * that show on its canvas (docs/sistema.md §4.2, pieces.ts): the guide's rules (`only`: the collection a rule sends
 * the sender to, or the run ends there), what the sender has waiting (`known`), the invitation's event (`inv`), the
 * relations the mail names (`prefill.<key>`), and, once proposed, folding the thread and «Aceptar solas».
 */
export function mailPlan(
  targets: Target[],
  o: {
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
     * The module whose items are events (task 45): a calendar invitation's event comes from the mail's own fields,
     * read from the .ics by code and bound as `$inv` (uid, titulo, dia, inicio, fin, nota, linea), and follows this
     * module's route; no reader in between. Its steps run only when the mail is one (`$inv.uid`).
     */
    invitation?: string;
    /** Boni's pieces as steps (the flow «Leer correo»); without them (a reading that only measures, no flow), the
     * plan reads `$only`, `$known`, `$inv` and `$prefill` as bound values, as it did before F7. */
    pieces?: boolean;
  } = {},
): unknown {
  const withPieces = o.pieces !== false;
  const modules = o.modules ?? MAIL_MODULES;
  const route = (m: string): RouteSpec => o.routes?.[m] ?? { propose: "chosen" };
  const chosen = modules.filter((m) => {
    const r = route(m);
    return "propose" in r && r.propose === "chosen";
  });
  const text = { ref: "$text" };
  const mail = { ref: "$mail" };
  // Boni's pieces before the reading (pieces.ts): their step names are what the rest of the plan reads.
  const before = withPieces
    ? [
        { id: "only", op: "call", tool: "mail.rule", args: { mail, asked: { ref: "$asked" } } },
        { id: "known", op: "call", tool: "mail.known", args: { mail, again: { ref: "$again" } } },
        ...(o.invitation
          ? [{ id: "inv", op: "call", tool: "mail.invitation", args: { mail } }]
          : []),
      ]
    : [];
  const steps: unknown[] = [
    { id: "m", op: "call", tool: "entities.get", args: { id: mail } },
    ...before,
    {
      id: "r",
      op: "read",
      reader: "read_message",
      input: text,
      params: {
        modules: o.boundModules
          ? { ref: "$modules" }
          : { fn: "list", args: modules.map((m) => ({ lit: m })) },
        user_in: { ref: "$userIn" },
        known: { ref: "$known" },
        ...(o.guide ? { guide: { ref: "$guide" } } : {}),
      },
    },
  ];
  // The collection the reading goes to: the one a rule of the guide names for this sender (`$only`, the decider's
  // `given`), else the decider's choice; with one collection there is nothing to choose.
  const choosing = targets.length > 1;
  const choice = { ref: "$c.choice" };
  /** Of each collection the decider may choose, what the plan needs of it (its key, a field's key), as `case`: the
   * options and what each gives, written in the plan (D-48: one of a literal list), null for one it has not. */
  const per = (of: (t: Target) => string | null | undefined) => {
    const pairs = targets.flatMap((t) => {
      const v = of(t);
      return v ? [{ lit: t.option }, { lit: v }] : [];
    });
    return pairs.length ? { fn: "case", args: [choice, ...pairs] } : null;
  };
  const chosenKey = per((t) => t.key);
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
        text,
        { lit: "\n\nElemento: " },
        { ref: "$item.title" },
        { lit: "\nPalabras del correo que lo piden: " },
        { ref: "$item.quote" },
      ],
    },
    params: { fields: { ref: `$fill.${t.key}` } },
  });
  // The record: the relations the code found (task 51), then what the reader filled (its choice first), then the
  // item's own title, day and hours (`merge`: a later value wins, an empty one never).
  const create = (id: string, module: string, t: Target, when?: unknown) => {
    const filled = !!t.fill?.length;
    const own = {
      fn: "obj",
      args: [
        { lit: "title" },
        { ref: "$item.title" },
        ...(t.date ? [{ lit: t.date }, { ref: "$item.due" }] : []),
        ...(t.time ? [{ lit: t.time }, { ref: "$item.start" }] : []),
        ...(t.endTime ? [{ lit: t.endTime }, { ref: "$item.end" }] : []),
        ...(filled ? [{ lit: "body" }, { ref: "$zip.note" }] : []),
      ],
    };
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
          fn: "merge",
          args: [{ ref: `$prefill.${t.key}` }, ...(filled ? [{ ref: "$zip.values" }] : []), own],
        },
      },
    };
    return filled ? [fillStep(`${id}_f`, module, t, when), step] : [step];
  };
  /** A day, a start and an end into the chosen collection's own fields for them (none: left out). */
  const dated = (values: [unknown, unknown, unknown]) =>
    (
      [
        [per((t) => t.date), values[0]],
        [per((t) => t.time), values[1]],
        [per((t) => t.endTime), values[2]],
      ] as const
    ).flatMap(([k, v]) => (k ? [k, v] : []));
  /** «Crear en la elegida»: the item's fields read for the chosen collection (only when one has fields to fill),
   * then the record in it: the relations the code found for it, what was filled, the item's own title and day. */
  const createInChosen = (id: string, module: string) => {
    const filled = targets.some((t) => t.fill?.length);
    const fill = {
      id: `${id}_f`,
      op: "read",
      reader: "fill",
      each: { ref: `$r.${module}` },
      when: choice,
      input: fillStep(`${id}_f`, module, targets[0] as Target).input,
      params: { fields: { ref: "$fill" }, collection: chosenKey },
    };
    const own = {
      fn: "obj",
      args: [
        { lit: "title" },
        { ref: "$item.title" },
        ...dated([{ ref: "$item.due" }, { ref: "$item.start" }, { ref: "$item.end" }]),
        ...(filled ? [{ lit: "body" }, { ref: "$zip.note" }] : []),
      ],
    };
    const step = {
      id,
      op: "call",
      tool: "entities.create",
      each: { ref: `$r.${module}` },
      ...(filled ? { zip: { ref: `$${id}_f` } } : {}),
      when: choice,
      why: { ref: "$item.quote" },
      args: {
        type: chosenKey,
        values: {
          fn: "merge",
          args: [
            { fn: "pick", args: [{ ref: "$prefill" }, chosenKey] },
            ...(filled ? [{ ref: "$zip.values" }] : []),
            own,
          ],
        },
      },
    };
    return filled ? [fill, step] : [step];
  };
  if (chosen.length && choosing) {
    // With an invitation the collection is chosen even when the reader finds nothing else.
    const found = o.invitation
      ? { fn: "or", args: [{ ref: "$r.all" }, { ref: "$inv.uid" }] }
      : { ref: "$r.all" };
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
              ask: {
                fn: "concat",
                args: [
                  { lit: "¿A qué colección va «" },
                  { fn: "first", args: [{ ref: "$subject" }, { lit: "este correo" }] },
                  { lit: "»?" },
                ],
              },
            }
          : {}),
        // A rule of the guide already says where it goes: that is the choice, and no model is asked.
        given: { ref: "$only" },
      },
      when: found,
    });
  }
  if (choosing) {
    // «Crear en la elegida» (docs/sistema.md §4.2): one «Rellenadora» and one «Crear» for every thing the reader
    // finds (`$r.all`: its tasks and its events in one list; Juan, 2026-11-06), in the collection chosen; each
    // collection's own fields come from `case`, all of them in the plan. When a kind goes elsewhere (a route to a
    // fixed collection, or none), each kind that goes to the chosen one walks its own list; with no kind to read,
    // nothing is created (and no step reads a choice no decider made).
    if (chosen.length > 0 && chosen.length === modules.length)
      steps.push(...createInChosen("n", "all"));
    else for (const module of chosen) steps.push(...createInChosen(`n_${module}`, module));
  } else
    targets.forEach((t, i) => {
      for (const module of chosen) steps.push(...create(`n${i}_${module}`, module, t, null));
    });
  for (const module of modules) {
    const r = route(module);
    if (!("propose" in r) || r.propose === "chosen") continue;
    const t = o.fixed?.find((x) => x.id === r.propose.collection);
    if (t) steps.push(...create(`f_${module}`, module, t));
  }
  // The invitation's event (task 45): the mail's own fields into the collection its module's route says; its
  // place and link as the record's note, and the invitation's line as the reason the card shows. Only a mail that
  // is an invitation has `$inv.uid`: the steps stay, their condition says.
  const invite = (id: string, t: Target, when?: unknown) => ({
    id,
    op: "call",
    tool: "entities.create",
    when: when ? { fn: "and", args: [{ ref: "$inv.uid" }, when] } : { ref: "$inv.uid" },
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
    if ("propose" in r && r.propose === "chosen" && choosing) {
      // The invitation's event in the chosen collection, as any other proposal.
      const owns = [
        { lit: "title" },
        { ref: "$inv.titulo" },
        ...dated([{ ref: "$inv.dia" }, { ref: "$inv.inicio" }, { ref: "$inv.fin" }]),
        { lit: "body" },
        { ref: "$inv.nota" },
      ];
      steps.push({
        id: "inv_create",
        op: "call",
        tool: "entities.create",
        when: { fn: "and", args: [{ ref: "$inv.uid" }, choice] },
        why: { ref: "$inv.linea" },
        args: { type: chosenKey, values: { fn: "obj", args: owns } },
      });
    } else if ("propose" in r && r.propose === "chosen")
      targets.forEach((t, i) => {
        steps.push(invite(`inv${i}`, t));
      });
    else if ("propose" in r) {
      const t = o.fixed?.find((x) => x.id === r.propose.collection);
      if (t) steps.push(invite("inv_f", t));
    }
  }
  if (withPieces) {
    // «Buscar relaciones» (piece) after the «Rellenadora», right before the first «Crear», as docs/sistema.md §4.2
    // orders them; the collections it looks in come from the code (`$writes`): a step's collection changes in one
    // place.
    const first = steps.findIndex((s) => (s as { tool?: unknown }).tool === "entities.create");
    steps.splice(first < 0 ? steps.length : first, 0, {
      id: "prefill",
      op: "call",
      tool: "mail.relations",
      args: { mail, types: { ref: "$writes" } },
    });
    // Boni's pieces after the proposals: one thread, one proposal (D-29), over the days its setting says; then
    // «Aceptar solas» when «Solo» is on.
    steps.push(
      {
        id: "fold",
        op: "call",
        tool: "inbox.fold",
        args: { mail, again: { ref: "$again" }, days: { lit: FOLD_DAYS } },
      },
      { id: "alone", op: "call", tool: "inbox.accept_alone", args: {} },
    );
  }
  return { version: 1, steps };
}

/** A plan with Boni's pieces in it (F7): what it does around its models is in it, not around it. One saved before
 * the pieces existed has none, and the code still does those things for it. */
export const usesPieces = (plan: unknown): boolean =>
  stepsOf(plan).some(
    (s) => s.op === "call" && (PIECES as readonly string[]).includes(String(s.tool)),
  );

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
/** What the code tells a reader of outside text about the mail itself (where the user is, what waits): nothing of Juan's (A14, R1). */
const PUBLIC = label("own", "public", [{ kind: "code", id: "mail" }]);
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
  /** Its Gmail thread, from Gmail's IMAP (task 68): what opens the mail itself in Gmail. */
  gmailThread?: string | null;
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
    // Gmail's own thread id (task 68), so «Gmail» opens the mail and not a search.
    ["gmail_hilo", "Hilo de Gmail", "text"],
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

/** How long a Gmail thread not found is not looked for again (`Mails.webmail`). */
const MISS_TTL = 10 * 60_000;

/** A review under way (D-51): what its pieces work on, and what each leaves for the next. */
interface ReviewCtx {
  host: Omit<ReviewHost, "agent">;
  candidate?: ReviewCandidate | null;
  measured?: { before: number; after: number; total: number };
  chosen?: boolean;
}

/**
 * Boni's «Revisar la guía» (docs/sistema.md §4.2, D-51): «Tus decisiones» → «Revisora» (the reviewer's model) →
 * «Medir releyendo» → «Sugerencia». What it learns from and what it suggests are the pieces' (mail.ts `piecesFor`).
 */
const REVIEW_PLAN = {
  version: 1,
  steps: [
    { id: "d", op: "call", tool: "guide.decisions", args: {} },
    {
      id: "r",
      op: "read",
      reader: "review_reading",
      input: { ref: "$d.lines" },
      params: { options: { ref: "$d.options" } },
    },
    { id: "m", op: "call", tool: "guide.measure", args: { reading: { ref: "$r" } } },
    { id: "s", op: "call", tool: "guide.suggest", args: {} },
  ],
};

export class Mails {
  private o: MailsOptions;
  private busy = new Map<number, Promise<MailState>>();
  private queued = new Map<number, Promise<MailState>>();
  private reviewing = new Set<number>();
  /** What a look at an account's mailbox found, for «Traer correo»'s «Guardar en Correos» to bring in its run. */
  private bringing = new Map<number, () => Promise<number>>();
  /** What failed while «Guardar en Correos» brought it (the run stops; the look says it, as before). */
  private bringError = new Map<number, unknown>();
  /** A review under way, for the pieces of «Revisar la guía» (D-51). */
  private reviewCtx = new Map<number, ReviewCtx>();
  private timer: ReturnType<typeof setInterval> | null = null;

  private readonly tz: string;

  constructor(o: MailsOptions) {
    this.o = o;
    this.tz = o.tz ?? systemTimeZone();
    // Boni's pieces of «Leer correo» run this code, as steps of the flow (docs/sistema.md §4.2).
    o.host.pieces = (account) => this.piecesFor(account);
    // «Flujos» shows Boni's «Leer correo» as the code makes it now.
    o.host.mailFlowCurrent = (account) => this.keepFlowCurrent(account);
  }

  /**
   * Boni's pieces for one account (pieces.ts): what the mail reading did around its plan, now steps of it, each
   * the same code with the same labels as the values it bound before.
   */
  piecesFor(account: number): MailPieces {
    const store = () => this.o.host.store(account);
    const mailOf = (id: string) => {
      const e = store().get(id);
      if (!e || e.entity.deleted !== undefined) throw new ToolError("not-found");
      return e;
    };
    return {
      rule: (id, asked) => {
        const from = String(mailOf(id).entity.values.f_de ?? "");
        const rule = ruleFor(this.guide(account), from);
        if (rule?.action === "skip" && !asked) {
          console.log(`mail ${account}: the guide says not to read ${from}: not read`);
          throw new EndRun("guide-skip");
        }
        const s = this.settings(account);
        const only =
          rule?.action === "collection" && s
            ? (this.targets(store(), s).find((t) => t.id === rule.collection)?.option ?? null)
            : null;
        return leaf(only, PUBLIC);
      },
      known: (id, again) => {
        const v = mailOf(id).entity.values;
        const from = String(v.f_de ?? "");
        const inv =
          typeof v.f_evento_uid === "string" && v.f_evento_uid
            ? String(v.f_evento_titulo ?? "")
            : "";
        const known = [
          ...(inv ? [inv.slice(0, 200)] : []),
          ...(from && !again ? this.known(store(), from) : []),
        ].slice(0, 20);
        return list(
          known.map((k) => leaf(k, PUBLIC)),
          PUBLIC,
        );
      },
      invitation: async (id) => this.invitationOf(account, mailOf(id)),
      relations: (id, keys) => rec(this.relationsOf(account, store(), mailOf(id), keys), CODE),
      fold: (id, again, proposals, days) =>
        leaf(again ? 0 : this.foldThread(account, store(), mailOf(id), [...proposals], days), CODE),
      acceptAlone: async (proposals) => {
        const st = store();
        const made = proposals.filter((p) => st.journal.proposal(p)?.status !== "stale");
        if (!made.length || !autoOn(st, AUTO_AREA)) return leaf(0, CODE);
        return leaf(await acceptAlone(st, this.o.host.agent(account), made, this.now()), CODE);
      },
      reviewDecisions: (dry) => {
        const ctx = this.reviewCtx.get(account) ?? (dry ? this.reviewTry(account) : null);
        const names = ctx ? ctx.host.targets.map((t) => leaf(t.name, CODE)) : [];
        return rec(
          {
            lines: (ctx && reviewInput(ctx.host.ds, ctx.host.targets)) || leaf(null, CODE),
            options: list(names, CODE),
            decisions: leaf(ctx?.host.ds.length ?? 0, CODE),
            found: leaf(ctx?.host.candidates?.length ?? 0, CODE),
          },
          CODE,
        );
      },
      reviewMeasure: async (reading, dry) => {
        const ctx = this.reviewCtx.get(account) ?? (dry ? this.reviewTry(account) : null);
        if (!ctx) return leaf(null, CODE);
        const c = reviewCandidate(ctx.host, reading as ReviewerAnswer | null);
        ctx.candidate = c;
        const n = (x: number) => leaf(x, CODE);
        if (!c) return rec({ rules: n(0), examples: n(0) }, CODE);
        // «Probar»: how much mail it would read again, never read (a measure is many model calls).
        if (dry)
          return rec(
            {
              rules: n(c.rules.length),
              examples: n(c.examples.length),
              would: n(measuredMail(ctx.host.ds, c).length),
            },
            CODE,
          );
        const m = await measureCandidate(ctx.host, c);
        ctx.measured = m;
        return rec(
          {
            rules: n(c.rules.length),
            examples: n(c.examples.length),
            before: n(m.before),
            after: n(m.after),
            total: n(m.total),
          },
          CODE,
        );
      },
      reviewSuggest: (dry) => {
        const ctx = this.reviewCtx.get(account);
        const m = ctx?.measured;
        const better = !dry && !!ctx?.candidate && !!m && m.after > m.before;
        if (ctx && better) ctx.chosen = true;
        return leaf(better, CODE);
      },
      save: async (dry) => {
        // What the look at the mailbox found, once; in «Probar», or with nothing waiting (a run some other way),
        // nothing is brought.
        const bring = dry ? null : this.bringing.get(account);
        if (!bring) return leaf(0, CODE);
        this.bringing.delete(account);
        try {
          return leaf(await bring(), CODE);
        } catch (e) {
          // The run stops with the step's error (never left running); the look sets `lastError` as before.
          this.bringError.set(account, e);
          throw new ToolError("mail-fetch");
        }
      },
    };
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

  /** The mail extension's module ids for this account (the flow editor's, docs/flujos.md). */
  moduleIdsOf(account: number): string[] {
    return moduleIds(this.manifest(account));
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
    const withGuide = !!(g.instructions || g.examples.length);
    const m = this.manifest(account);
    const r = await this.o.host.agent(account).background(
      mailPlan([], {
        guide: withGuide,
        modules: moduleIds(m),
        boundModules: true,
        pieces: false,
      }),
      {
        modules: modulesOfManifest(m),
        ...(withGuide ? { guide: guideOf(g) } : {}),
        ...this.mailBindings(e, s.user),
        known: list([], PUBLIC),
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
      const host = {
        store,
        guide,
        targets,
        ds: theDs(),
        read: (mail: string, g: MailGuide) => this.readOnce(account, mail, g),
        now: this.now(),
        excluded,
        candidates: candidates(),
      };
      // «Revisar la guía» (docs/sistema.md §4.2, D-51): Boni's flow, its steps the pieces over this review; off, or
      // without models, the reviewer does not look. With too few decisions there is nothing to review (no run).
      const flow = this.reviewFlow(store);
      const agent = this.agentOf(account);
      let suggestion: Suggestion | null = null;
      if (flow?.enabled && agent && reviewInput(host.ds, host.targets)) {
        const ctx: ReviewCtx = { host };
        this.reviewCtx.set(account, ctx);
        let ran: Awaited<ReturnType<typeof agent.background>> | null = null;
        try {
          ran = await agent.background(flow.plan, {}, ["r"], undefined, {
            id: REVIEW_FLOW,
            version: flow.version,
            by: flow.by,
          });
        } finally {
          this.reviewCtx.delete(account);
        }
        // Kept only when «Sugerencia» chose it: the measured candidate that gets more of his decisions right.
        const c = ctx.candidate;
        const m = ctx.measured;
        if (ran && ctx.chosen && c && m && m.after > m.before)
          suggestion = {
            id: `g-${host.now}-${ran.run.slice(0, 8)}`,
            rules: c.rules,
            examples: c.examples,
            ...m,
            at: host.now,
            run: ran.run,
          };
      }
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
    if (original?.gmailThread && def.fields.some((f) => f.id === "f_gmail_hilo"))
      values.f_gmail_hilo = w(original.gmailThread);
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
      if (set.has(mailOfRun(j, p.run))) {
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
    // Boni's «Traer correo» (docs/sistema.md §4.2): turned off, the mailbox is not looked at and nothing is brought;
    // what waits to be read is read all the same («Leer correo» is a flow of its own).
    // A flow that cannot be kept current never stops the mail: it is brought as before, with no run.
    let fetching: FlowRow | null = null;
    try {
      fetching = this.fetchFlow(store);
    } catch (e) {
      console.warn(`mail ${account}: «Traer correo» not kept (${(e as Error).message})`);
    }
    // Off, or stopped at this version without bringing the mail (D-50): the mailbox is not looked at, Ajustes says
    // why, and no run is made until it is turned on or changed.
    const idle = !fetching
      ? null
      : !fetching.enabled
        ? "fetch-off"
        : st.fetchStopped === fetching.version
          ? "fetch-stopped"
          : null;
    if (idle) {
      st.lastError = idle;
      this.saveState(account, st);
      await this.propose(account, s, st);
      return st;
    }
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
      const reader = r;
      let rescanned = false;
      /** What «Guardar en Correos» does: the mail found, kept with its attachments, original, invitation and thread. */
      const bring = async (): Promise<number> => {
        for (const uid of rescan) {
          const f = await reader.fetch(uid, FETCH_MAX);
          if (!f) continue;
          const m = parseMessage(f.raw, f.raw.length < f.size, { keep: ATTACHMENT_MAX });
          // Without a Message-ID a mail cannot be told from one already in: left out.
          if (!m.messageId || known.has(m.messageId)) continue;
          const id = this.keepOne(account, store, def, m, f.internalDate, {
            raw: f.raw,
            size: f.size,
            gmailThread: f.gmailThread,
          });
          if (!id) continue;
          known.add(m.messageId);
          made.push(id);
          st.count++;
        }
        if (rescan.length) console.log(`mail ${account}: ${made.length} mails brought in again`);
        rescanned = true;
        for (const uid of uids.slice(0, this.o.perCheck ?? 50)) {
          const f = await reader.fetch(uid, FETCH_MAX);
          st.lastUid = Math.max(st.lastUid, uid);
          if (!f) continue;
          const m = parseMessage(f.raw, f.raw.length < f.size, { keep: ATTACHMENT_MAX });
          if (m.messageId && known.has(m.messageId)) continue;
          // One mail that cannot be kept never stops the others (task 34: it stopped the check, and was lost).
          const id = timed("a mail kept", 300, () =>
            this.keepOne(account, store, def, m, f.internalDate, {
              raw: f.raw,
              size: f.size,
              gmailThread: f.gmailThread,
            }),
          );
          if (!id) continue;
          made.push(id);
          st.count++;
        }
        return made.length;
      };
      // «Traer correo» (docs/sistema.md §4.2, D-50): only a look that finds new mail is a run of it, and its «Guardar
      // en Correos» brings the mail. Without the agent (no models for this account) the mail is brought all the same,
      // with no run; with the flow off, nothing is brought (above, before the mailbox is opened). The look back for
      // mail lost before (task 34's rescan, once) brings what it finds with no run of its own.
      const agent = uids.length && fetching ? this.agentOf(account) : null;
      let stopped = false;
      if (uids.length || rescan.length) {
        if (agent && fetching) {
          this.bringing.set(account, bring);
          let ran: Awaited<ReturnType<typeof agent.background>> | null = null;
          try {
            ran = await agent.background(fetching.plan, {}, [], undefined, {
              id: FETCH_FLOW,
              version: fetching.version,
              by: fetching.by,
            });
          } finally {
            // The piece never took what was found: the run stopped before «Guardar en Correos».
            stopped = this.bringing.delete(account);
          }
          const failed = this.bringError.get(account);
          this.bringError.delete(account);
          if (failed) throw failed;
          if (stopped) {
            st.fetchStopped = fetching.version;
            console.warn(
              `mail ${account}: «Traer correo» v${fetching.version} ran without bringing the mail (${ran?.status ?? "?"}): no run until it changes`,
            );
          } else delete st.fetchStopped;
        } else await bring();
      }
      // The look back of task 34, once: done when it ran (or there was nothing to look back at).
      if (!restart && (rescanned || !rescan.length))
        st.rescans = [...new Set([...(st.rescans ?? []), RESCAN.id])];
      st.lastError = stopped ? "fetch-stopped" : null;
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

  /** The targets of a store, each part kept while nothing it reads changes (mailTargets.ts; task 43). */
  private targetMemo = new TargetMemo();

  private targetsFor(store: UserStore, ids: readonly string[]): Target[] {
    return this.targetMemo.targetsFor(store, ids);
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
   * Boni's «Leer correo» kept current when «Flujos» is opened, not only when a mail is read: a new build or a change
   * of the configuration shows at once (2026-11-05: after the deploy of the pieces, the old version showed until the
   * next mail). A version the user saved stays as he left it. Nothing without a mailbox, a collection or the agent.
   */
  keepFlowCurrent(account: number): void {
    if (!this.o.host.on || !this.o.host.hasData) return;
    const s = this.settings(account);
    if (!s) return;
    try {
      this.fetchFlow(this.o.host.store(account));
      this.reviewFlow(this.o.host.store(account));
      const c = this.planContext(account, s);
      if (c) this.mailFlow(c);
    } catch (e) {
      console.warn(
        `mail ${account}: «Leer correo» not brought up to date (${(e as Error).message})`,
      );
    }
  }

  /**
   * Boni's «Traer correo» (docs/sistema.md §4.2, D-50): new mail in the mailbox, brought into the mail's collection by
   * its piece «Guardar en Correos». The latest version when the user saved one, else Boni's, saved only when it changed.
   */
  private fetchFlow(store: UserStore): FlowRow {
    return ensureFlow(
      store,
      {
        id: FETCH_FLOW,
        name: "Traer correo",
        trigger: { connector: "mail" },
        plan: {
          version: 1,
          steps: [{ id: "save", op: "call", tool: "mail.save", args: {} }],
        },
        by: "preset",
      },
      this.now(),
    );
  }

  /** Boni's «Revisar la guía» (D-51), kept as «Traer correo» is; null when it cannot be kept. */
  private reviewFlow(store: UserStore): FlowRow | null {
    try {
      return ensureFlow(
        store,
        {
          id: REVIEW_FLOW,
          name: "Revisar la guía",
          trigger: { learning: "mail" },
          plan: REVIEW_PLAN,
          by: "preset",
        },
        this.now(),
      );
    } catch (e) {
      console.warn(`mail: «Revisar la guía» not kept (${(e as Error).message})`);
      return null;
    }
  }

  /** «Probar» of «Revisar la guía»: what a review would work on now (nothing is kept, nothing measured). */
  private reviewTry(account: number): ReviewCtx | null {
    const s = this.settings(account);
    const st = this.state(account);
    if (!s || !st.type) return null;
    const store = this.o.host.store(account);
    const guide = this.guide(account);
    const targets = this.targets(store, s);
    const now = this.now();
    const tried = Object.entries(st.tried ?? {}).filter(([, at]) => now - at < TRIED_FOR);
    const excluded = new Set([...(st.refused ?? []), ...tried.map(([from]) => from)]);
    const ds = decisions(store, st.type, (v) => userIn(s.user, v.f_para, v.f_cc));
    return {
      host: {
        store,
        guide,
        targets,
        ds,
        read: (mail, g) => this.readOnce(account, mail, g),
        now,
        excluded,
        candidates: ruleCandidates(ds, targets, guide, excluded),
      },
    };
  }

  /** The account's agent, or null when it has no models (then «Traer correo» brings the mail with no run). */
  private agentOf(account: number): ReturnType<AgentHost["agent"]> | null {
    if (!this.o.host.on) return null;
    try {
      return this.o.host.agent(account);
    } catch {
      return null;
    }
  }

  /**
   * The flow «Leer correo» to run (docs/flujos.md): the latest version when the user saved it (his edit runs as he
   * left it), else Boni's plan for this configuration, saved as a new version only when it changed.
   */
  private mailFlow(c: PlanContext): FlowRow {
    return ensureFlow(
      c.store,
      {
        id: MAIL_FLOW,
        name: "Leer correo",
        trigger: { created: "correo" },
        plan: mailPlan(c.targets, {
          guide: c.withGuide,
          modules: moduleIds(c.m),
          boundModules: true,
          ...(c.m.routes ? { routes: c.m.routes } : {}),
          fixed: c.fixed,
          askWhenUnsure: true,
          invitation: eventModule(c.m),
        }),
        by: "preset",
      },
      this.now(),
    );
  }

  /**
   * What a mail binds to a flow of the mail (docs/flujos.md, its inputs): the reading's context (the modules, the
   * guide, the options), the guide's rule (`$only`), per collection the flow writes in (by its key) the fields its
   * reader fills and the relations the code found in the mail (task 51), and the mail itself (`mailBindings`): the
   * same for the live reading and for «Probar».
   */
  private async bindingsFor(
    account: number,
    c: PlanContext,
    e: NonNullable<ReturnType<UserStore["get"]>>,
    plan: unknown,
    o: { only: string | null; again: boolean; asked: boolean },
  ): Promise<Record<string, Val>> {
    const v = e.entity.values;
    const from = String(v.f_de ?? "");
    // What the plan reads from outside its own steps: a plan with Boni's pieces gets the old values from them
    // (`only`, `known`, `inv`, `prefill` are its steps); one saved before them still gets them bound here.
    const wants = new Set(inputsOf(plan).map((i) => i.id));
    const types = c.store.schema().types;
    // Per collection the flow writes in (by its key): the fields its reader fills.
    const known_ = [...c.targets, ...c.fixed];
    const fill: Record<string, Val> = {};
    for (const key of collectionKeysOf(plan)) {
      const def = Object.values(types).find((x) => x.key === key);
      const t =
        known_.find((x) => x.key === key) ??
        (def ? this.targetsFor(c.store, [def.id])[0] : undefined);
      fill[key] = fieldsValue(t?.fill ?? [], t?.fillRefs ?? []);
    }
    const old: Record<string, Val> = {};
    if (wants.has("prefill"))
      old.prefill = rec(this.relationsOf(account, c.store, e, collectionKeysOf(plan)), CODE);
    if (wants.has("only")) old.only = leaf(o.only, PUBLIC);
    if (wants.has("inv")) old.inv = await this.invitationOf(account, e);
    if (wants.has("known")) {
      const inv =
        typeof v.f_evento_uid === "string" && v.f_evento_uid ? String(v.f_evento_titulo ?? "") : "";
      const known = [
        ...(inv ? [inv.slice(0, 200)] : []),
        ...(from && !o.again ? this.known(c.store, from) : []),
      ].slice(0, 20);
      old.known = list(
        known.map((k) => leaf(k, PUBLIC)),
        PUBLIC,
      );
    }
    const own = new Set(stepsOf(plan).map((x) => x.id));
    const all: Record<string, Val> = {
      ...c.bound,
      options: optionsValue(c.targets),
      fill: rec(fill, CODE),
      writes: list(
        collectionKeysOf(plan).map((k) => leaf(k, CODE)),
        CODE,
      ),
      asked: leaf(o.asked, CODE),
      again: leaf(o.again, CODE),
      ...this.mailBindings(e, c.s.user),
      ...old,
    };
    // A name a step of the plan has is the step's, never bound.
    return Object.fromEntries(Object.entries(all).filter(([k]) => !own.has(k)));
  }

  /**
   * The relations the mail plainly names (task 51, phases B and C), for each collection key: the sender as a record
   * of a related collection by name, a record whose title the sender's own words carry; set by code, the reader's
   * choice first (`merge`). The piece «Buscar relaciones» and the bindings of a plan saved before the pieces.
   */
  private relationsOf(
    account: number,
    store: UserStore,
    e: NonNullable<ReturnType<UserStore["get"]>>,
    keys: readonly string[],
  ): Record<string, Val> {
    const v = e.entity.values;
    const types = store.schema().types;
    const titled = new Map<string, Named[]>();
    const recordsOf = (type: string): Named[] => {
      let list = titled.get(type);
      if (!list) {
        const tf = types[type]?.titleField ?? "";
        list = store.list(type).flatMap((x) => {
          const title = x.entity.values[tf];
          return typeof title === "string" && title.trim() ? [{ id: x.entity.id, title }] : [];
        });
        titled.set(type, list);
      }
      return list;
    };
    const words = {
      sender: String(v.f_de_nombre ?? ""),
      text: ownText(String(v.f_asunto ?? ""), e.entity.body ?? ""),
    };
    const out: Record<string, Val> = {};
    for (const key of keys) {
      const def = Object.values(types).find((x) => x.key === key);
      const found = def ? prefillOf(def, types, recordsOf, words) : [];
      if (found.length)
        console.log(
          `mail ${account}: by code for «${def?.name ?? key}»: ${found
            .map((p) => `${p.name} ← «${p.title.slice(0, 40)}» (${p.by})`)
            .join(", ")}`,
        );
      out[key] = prefillValue(found);
    }
    return out;
  }

  /**
   * A calendar invitation's event (task 45), read from its .ics by code into the mail's hidden fields, with the
   * mail's own labels; already in one of the account's external calendars, it comes without its uid and the plan
   * proposes no event. The piece «Leer invitación» and the bindings of a plan saved before the pieces.
   */
  private async invitationOf(
    account: number,
    e: NonNullable<ReturnType<UserStore["get"]>>,
  ): Promise<Val> {
    const inv = this.hiddenBindings(e).inv as Val;
    const v = e.entity.values;
    const uid = typeof v.f_evento_uid === "string" ? v.f_evento_uid : "";
    if (!uid || inv.t !== "rec") return inv;
    const already = await this.calendarWith(account, uid);
    if (!already) return inv;
    console.log(
      `mail ${account}: invitation «${String(v.f_evento_titulo ?? "").slice(0, 60)}» already in calendar «${already}»: not proposed`,
    );
    return rec({ ...inv.fields, uid: leaf(null, CODE) }, inv.label);
  }

  /**
   * A mail to try a flow with («Probar», docs/flujos.md F3): the one asked for, else the latest kept; what it binds to
   * that plan, as the live reading would. Null without a configured mailbox, a collection or a mail.
   */
  async sample(
    account: number,
    mail: string | null,
    plan: unknown,
  ): Promise<{ bind: Record<string, Val>; mail: string; subject: string } | null> {
    const s = this.settings(account);
    const st = this.state(account);
    if (!s || !st.type) return null;
    const c = this.planContext(account, s);
    if (!c) return null;
    const e = mail
      ? c.store.get(mail)
      : (c.store
          .list(st.type)
          .filter((x) => x.entity.deleted === undefined)
          .sort((a, b) => b.entity.created - a.entity.created)[0] ?? null);
    if (!e || e.entity.type !== st.type || e.entity.deleted !== undefined) return null;
    const rule = ruleFor(c.guide, String(e.entity.values.f_de ?? ""));
    const only =
      rule?.action === "collection"
        ? (c.targets.find((t) => t.id === rule.collection)?.option ?? null)
        : null;
    return {
      // As a new mail is read (`asked` false): a sender the guide never reads ends the try at its rule.
      bind: await this.bindingsFor(account, c, e, plan, { only, again: true, asked: false }),
      mail: e.entity.id,
      subject: String(e.entity.values.f_asunto ?? ""),
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
    // The flow «Leer correo» (docs/flujos.md): the version the user saved, or Boni's kept current with the
    // configuration. With Boni's pieces in it (docs/sistema.md §4.2) the guide's rules, the thread and «Aceptar
    // solas» are its steps; a version saved before them gets them from the code here, as it did.
    const flow = this.mailFlow(c);
    const pieces = usesPieces(flow.plan);
    const rule = ruleFor(c.guide, from);
    if (!pieces && rule?.action === "skip" && !asked) return none;
    // Asked from the conversation (task 54): what this mail already proposed is said, not made again; asked again,
    // its pending proposals give way and the mail is read afresh (Juan, 2026-11-04: «que el usuario pudiese
    // volver a proponerlo»).
    const mine = asked ? this.proposalsOf(c.store, id) : { pending: [], decided: [] };
    if (asked && !again && (mine.pending.length || mine.decided.length))
      return { ...none, already: mine.pending.length, decided: mine.decided.length };
    if (again) for (const p of mine.pending) c.store.journal.setProposal(p.id, "stale", this.now());
    // The guide's rule that sends this sender's mail to one collection: an input of the flow (`$only`).
    const only =
      rule?.action === "collection"
        ? (c.targets.find((t) => t.id === rule.collection)?.option ?? null)
        : null;
    // Off, the mail is kept and not read.
    if (!flow.enabled) {
      console.log(`mail ${account}: flow «${flow.name}» v${flow.version} is off: not read`);
      return { ...none, stopped: "flow-off" };
    }
    try {
      const bound = await this.bindingsFor(account, c, e, flow.plan, { only, again, asked });
      const r = await c.agent.background(flow.plan, bound, [], budgetOf(c.m), {
        id: flow.id,
        version: flow.version,
        input: id,
        by: flow.by,
      });
      const stopped = r.status === "stopped" ? (r.error ?? "stopped") : null;
      if (stopped && r.error) console.warn(`mail ${account}: plan stopped (${r.error})`);
      this.logRead(account, c.store, from, r.proposals);
      if (!pieces && !again) this.foldThread(account, c.store, e, r.proposals);
      // What stays after the thread's fold (a repeat gave way): the proposals this reading made.
      const made = r.proposals.filter((p) => c.store.journal.proposal(p)?.status !== "stale");
      // «Solo» on for the mail's proposals (docs/fiabilidad.md §3.4): the ones like those Juan always kept are
      // accepted here, each a decision he judges by leaving it or undoing it.
      if (!pieces && made.length && autoOn(c.store, AUTO_AREA))
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
  /**
   * Where a mail of the collection opens in its webmail (task 68; Juan, 2026-11-05: «quiero que se abra el correo, no
   * que me abra el buscador»): Gmail's address of its thread, in its account. A mail kept before Boni kept thread ids
   * has its thread found once by its Message-ID (one short IMAP session, remembered while the server runs); when it
   * cannot be found, Gmail's search by that id. Null for a mailbox that is not Gmail.
   */
  async webmail(account: number, id: string): Promise<string | null> {
    const st = this.state(account);
    const e = this.o.host.store(account).get(id);
    if (!st.type || !e || e.entity.deleted !== undefined || e.entity.type !== st.type)
      throw new MailError("not-found");
    const settings = this.settings(account);
    if (!settings) throw new MailError("not-configured");
    if (!/(^|\.)(gmail|googlemail)\.com$/i.test(settings.host.trim())) return null;
    const messageId = String(e.entity.values.f_id_mensaje ?? "")
      .trim()
      .replace(/^<|>$/g, "");
    const key = `${account}:${id}`;
    let thread = String(e.entity.values.f_gmail_hilo ?? "") || this.gmailThreads.get(key) || "";
    const missed = this.gmailMisses.get(key);
    if (!thread && messageId && !(missed && this.now() - missed < MISS_TTL)) {
      const r = await this.open(settings);
      try {
        await r.examine(settings.folder);
        thread = (await r.gmailThreadOf(messageId)) ?? "";
        // Archived out of the folder: in «Todos» (Gmail's All Mail, found by its flag), where every mail is.
        if (!thread) {
          const all = await r.allMailFolder();
          if (all && all !== settings.folder) {
            await r.examine(all);
            thread = (await r.gmailThreadOf(messageId)) ?? "";
          }
        }
      } finally {
        r.close();
      }
      if (thread) this.gmailThreads.set(key, thread);
      else this.gmailMisses.set(key, this.now());
    }
    const url = thread ? gmailThreadUrl(thread, settings.user) : null;
    if (url) return url;
    // Not even in «Todos» (deleted, say): Gmail's own search by its Message-ID, in its account.
    return messageId && !/[\s<>"']/.test(messageId)
      ? `https://mail.google.com/mail/?authuser=${encodeURIComponent(settings.user)}#search/rfc822msgid:${encodeURIComponent(messageId)}`
      : null;
  }
  /** Gmail threads found by Message-ID for mails kept before Boni kept them (`webmail`), by account and row. */
  private gmailThreads = new Map<string, string>();
  /** When a mail's thread was looked for and not found: not looked for again for a while (one IMAP session a click). */
  private gmailMisses = new Map<string, number>();

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
    // The flow «Leer correo» is off (docs/flujos.md): said, so the app can say where to turn it on.
    if (stopped === "flow-off") throw new MailError("flow-off");
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
  /**
   * What a mail binds to the flow «Leer correo» (docs/flujos.md, its inputs): the record, the mail as text, its
   * subject, where the user is among its recipients, what that sender has waiting, and the hidden fields. An
   * invitation already in a calendar of the account is bound without its uid: the flow then proposes no event.
   */
  private mailBindings(
    e: NonNullable<ReturnType<UserStore["get"]>>,
    mailbox: string,
  ): Record<string, Val> {
    const v = e.entity.values;
    const l = e.labels.f_asunto ?? e.labels.f_de ?? CODE;
    return {
      mail: leaf(e.entity.id, CODE),
      text: leaf(mailAsText(v, e.entity.body), l),
      subject: leaf(typeof v.f_asunto === "string" ? v.f_asunto : "", l),
      userIn: leaf(userIn(mailbox, v.f_para, v.f_cc), PUBLIC),
      adjuntos: this.hiddenBindings(e).adjuntos as Val,
    };
  }

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
   * proposals of the last `days` (60, or what the step «Plegar hilo» says), never by the reader.
   */
  private foldThread(
    account: number,
    store: UserStore,
    e: NonNullable<ReturnType<UserStore["get"]>>,
    made: string[],
    days = FOLD_DAYS,
  ): number {
    const hilo = e.entity.values.f_hilo;
    if (typeof hilo !== "string" || !hilo || !made.length) return 0;
    const since = this.now() - foldDays(days) * 86_400_000;
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
    if (!mails.size) return 0;
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
    if (!earlier.length) return 0;
    const now = this.now();
    let changed = 0;
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
        changed++;
        console.log(
          `mail ${account}: «${title.slice(0, 60)}» again in its thread (already ${same.status}): not proposed`,
        );
        continue;
      }
      const prev = [...like].sort((a, b) => b.created - a.created)[0] as (typeof like)[number];
      for (const o of like) if (o.status === "pending") j.setProposal(o.id, "stale", now);
      j.setProposalBefore(id, { proposal: prev.id, ...whenParts(rowsOf(prev)) });
      changed++;
      console.log(
        `mail ${account}: «${title.slice(0, 60)}» changed in its thread (was ${whenOf(rowsOf(prev)) || "without a day"}): the earlier proposal gives way`,
      );
    }
    if (changed) this.o.host.emit(account, "proposals", { n: 0 });
    return changed;
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
