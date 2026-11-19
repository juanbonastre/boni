/**
 * «Leer correo»'s pieces on the server (docs/automatizaciones.md §5.17, AU-249, AU-250, AU-252, AU-255; phase F16
 * S2b): Boni's code over the row the engine hands each one, never a plan of the old engine. Every row a piece gives
 * is made here, by code, from the mail as stored and from what its reader answered as checked; a row's `id` names
 * the mail it came from, and each piece reads that mail again from the store (it must be in the mail collection).
 *
 * - «Regla del remitente»: the table of its panel (`rules`). «No leer» drops the row unless his hand started the run;
 *   «A una colección» marks the row with the collection the «Decisora» takes then.
 * - «Leer invitación»: the row passes, and the .ics's event becomes a row of its own unless a calendar of his already
 *   holds it. It creates nothing.
 * - «Lectora»: one read of the mail (and of what that sender already has waiting, as outside text), one row per
 *   thing it found.
 * - «Plegar hilo»: what the thread already proposed the same is dropped; what it changed keeps the earlier one as
 *   `before`. Putting that «Antes» on the card and withdrawing the earlier card are the card's (AU-251, S2b part 2):
 *   a failed run must withdraw nothing, so nothing is withdrawn before the run's own card exists.
 * - «Decisora»: the rule's collection, or the only one, without a model; else two reads with the options in both
 *   orders, agreement and calibration as the old decider did (`decideChoice`), sure from 0.6; below it the row leaves
 *   by «Duda» (`BONI_DOUBT`).
 * - «Rellenadora»: the collection chosen (after «Preguntar», his answer, matched only against the «Decisora»'s own
 *   collections in the version that runs), its title, day and hours in their fields, and one read for the fields
 *   with closed values.
 * - «Buscar relaciones»: the relations the mail plainly names, found by code, in the fields still empty.
 *
 * `known` (AU-250) is his own decisions only: see `knownSender`.
 */
import {
  calibrate,
  checkFill,
  checkReadMessage,
  type FillField,
  levelsOf,
  modulesOf,
  resolve,
} from "@boni/agent";
import {
  ANSWER_FIELD,
  type Automation,
  BONI_DOUBT,
  BONI_PARAMS,
  type BoniAnswer,
  type BoniCall,
  type Cell,
  CHOSEN,
  EXAMPLE_SOURCE,
  type PieceReply,
  type Row,
} from "@boni/automations";
import { join, type Label, label } from "@boni/entities";
import { type AuthResult, authenticated } from "@boni/mail";
import type { ProposalRow, UserStore } from "@boni/store";
import { decisionHistory, wouldAccept } from "../autoAccept.ts";
import { likeTitle, whenOf, whenParts } from "../thread.ts";
import { ACCEPT_RUN } from "./acceptRunName.ts";
import { BoniFault } from "./boni.ts";
import type { RunProposalView } from "./proposal.ts";

/** What the mail's code gives the pieces of one store (mail.ts `Mails.hooksFor`): the connector's, never a row's. */
export interface MailHooks {
  /** The mail collection's type id. */
  type: string;
  /** His mailbox's address: where he is among a mail's recipients is worked out from it. */
  mailbox: string;
  /**
   * The authserv-id of his provider's own Authentication-Results, from the mailbox's stored settings (never from a
   * mail); null while unset, and then nobody is authenticated (`authenticatedMail`).
   */
  trustedAuthserv: string | null;
  /** The mail as the reader reads it: its headers that have a value, its text, its attachments' text. */
  text(values: Record<string, unknown>, body: string | undefined): string;
  /** `to`, `cc` or `group`. */
  userIn(values: Record<string, unknown>): "to" | "cc" | "group";
  /** Whether one of his external calendars already holds the invitation `uid`. */
  inCalendar(uid: string): Promise<boolean>;
  /** The relations the mail plainly names in a collection (by key): field key → record id, found by code. */
  relations(mail: string, collection: string): Record<string, string>;
  /** A collection (by key) as a target: its date, time and end-time fields by key, its fields to fill. */
  target(collection: string): {
    date: string | null;
    time: string | null;
    endTime: string | null;
    fill: FillField[];
  } | null;
  /** The other mails of the thread of `mail` kept in the last `days` days. */
  threadMails(mail: string, days: number): Set<string>;
  /** The mail an old engine's proposal came from (its run's input), or "". */
  mailOfProposal(p: ProposalRow): string;
}

/** The longest a pending title goes to the «Lectora», and how many (AU-255). */
export const PENDING_TITLES = { n: 20, chars: 200 } as const;
/** Sure enough to choose a collection: the old decider's threshold (`CHOICE_THRESHOLDS`). */
export const DECIDE_AT = 0.6;
const ADDRESS = /^[^\s@]+@[a-z0-9.-]+\.[a-z]{2,}$/i;
const DAY = 86_400_000;

/** A stored mail of the mail collection, by the id a row names; null for anything else. */
function mailOf(store: UserStore, hooks: MailHooks, id: Cell | undefined) {
  if (typeof id !== "string" || !id) return null;
  const e = store.get(id);
  if (!e || e.entity.deleted !== undefined || e.entity.type !== hooks.type) return null;
  return e;
}
type Mail = NonNullable<ReturnType<typeof mailOf>>;

/** The label of a stored mail: every field's, joined (from outside, its sender's). */
export function mailLabel(e: Mail): Label {
  const all = Object.values(e.labels);
  const [first, ...rest] = all;
  return first ? join(first, ...rest) : label("external", "personal", [], true);
}

/**
 * The sender of a stored mail as the connector kept it: the `mail:` source of its label, which must be its only one
 * and equal its `f_de` (a parsed address, lower-case). Null on any doubt. Never its display name, Reply-To or text.
 */
export function senderOf(e: Mail): string | null {
  const l = mailLabel(e);
  const mails = l.sources.filter((s) => s.kind === "mail");
  if (mails.length !== 1) return null;
  const from = e.entity.values.f_de;
  const id = (mails[0] as { id: string }).id.toLowerCase();
  if (typeof from !== "string" || from.toLowerCase() !== id || !ADDRESS.test(id)) return null;
  return id;
}

/**
 * Whether his provider authenticated the stored mail's sender (packages/mail `authenticated`, RFC 8601): the
 * provider's own Authentication-Results, by the trusted authserv-id of the mailbox's settings, as the connector kept
 * them (`f_autenticacion`, labelled as the rest of the mail, its only source the sender's). No trusted id, no header
 * kept, a header the mail brought under another id, a pass for another domain, anything unreadable: false.
 */
export function authenticatedMail(e: Mail, sender: string, trustedId: string | null): boolean {
  if (!trustedId) return false;
  const raw = e.entity.values.f_autenticacion;
  const l = e.labels.f_autenticacion;
  const srcs = l?.sources.filter((x) => x.kind === "mail") ?? [];
  if (typeof raw !== "string" || srcs.length !== 1 || srcs[0]?.id.toLowerCase() !== sender)
    return false;
  let headers: unknown;
  try {
    headers = JSON.parse(raw);
  } catch {
    return false;
  }
  if (!Array.isArray(headers)) return false;
  const clean = headers.flatMap((h) =>
    h && typeof h === "object" && typeof h.authserv === "string" && Array.isArray(h.results)
      ? [
          {
            authserv: h.authserv as string,
            results: (h.results as unknown[]).flatMap((r) =>
              r &&
              typeof r === "object" &&
              typeof (r as AuthResult).method === "string" &&
              typeof (r as AuthResult).result === "string"
                ? [r as AuthResult]
                : [],
            ),
          },
        ]
      : [],
  );
  return authenticated(clean, sender, trustedId);
}

/**
 * «Solo conocidos» (AU-250): whether `row` came from a mail whose sender his provider authenticated
 * (`authenticatedMail`) and whom Juan himself made known for `collection`. Fails closed: without the provider's
 * authentication nobody is known, however many decisions. Of his own decisions: `decisionHistory(store)` (autoAccept.ts, over `store.journal.proposals("accepted")`
 * and `store.journal.proposals("rejected")` of `entities.create` with a mail source) under the key
 * `entities.create\0mail:<sender>\0<collection>`, judged by `wouldAccept`. The sender is the stored mail's (`senderOf`,
 * by the row's `id`), and the row must carry that mail's source and no other; nothing a mail carries, a reader wrote
 * or a model answered decides it. Any doubt is false, which only narrows a «Sí» to a proposal.
 */
export function knownSender(
  store: UserStore,
  hooks: MailHooks | null,
  row: Row,
  collection: string,
): boolean {
  if (!hooks) return false;
  const e = mailOf(store, hooks, row.json.id);
  if (!e) return false;
  const sender = senderOf(e);
  if (!sender) return false;
  // The «Ejemplos» of the «Lectora»'s panel carry their own outside source, which names no sender: passed over.
  const mails = row.label.sources
    .filter((s) => s.kind === "mail" && s.id !== EXAMPLE_SOURCE.id)
    .map((s) => s.id.toLowerCase());
  if (!mails.length || mails.some((m) => m !== sender)) return false;
  if (!authenticatedMail(e, sender, hooks.trustedAuthserv)) return false;
  const prior = decisionHistory(store).get(
    `entities.create\u0000mail:${sender}\u0000${collection}`,
  );
  return !!prior && wouldAccept(prior);
}

/** The title field's key of a collection, by key. */
function titleKeyOf(store: UserStore, collection: string): string | null {
  const t = Object.values(store.schema().types).find((x) => x.key === collection);
  return t?.fields.find((f) => f.id === t.titleField)?.key ?? null;
}

/** The mail a run of the new engine read: its trigger's row's `id`. */
function mailOfRun(store: UserStore, run: string): string {
  const r = store.journal.automationRun(run);
  try {
    const id = (JSON.parse(r?.fields ?? "{}") as { id?: unknown }).id;
    return typeof id === "string" ? id : "";
  } catch {
    return "";
  }
}

/** One thing a proposal asks to create: its title and what its values say of its day and hours. */
interface Item {
  proposal: ProposalRow;
  title: string;
  rows: { arg: string; value?: unknown }[];
}

/** The things a proposal of a mail asks to create: the old engine's one, or the first of a run's. */
function itemsOf(store: UserStore, p: ProposalRow): Item[] {
  if (p.tool === "entities.create") {
    const rows = (p.view as { rows?: { arg: string; value?: unknown }[] }).rows ?? [];
    const t = rows.find((r) => r.arg === "values.title")?.value;
    return typeof t === "string" && t ? [{ proposal: p, title: t, rows }] : [];
  }
  if (p.tool !== ACCEPT_RUN) return [];
  const first = (p.view as Partial<RunProposalView>).run?.first ?? [];
  return first.flatMap((a) => {
    if (a.action !== "create") return [];
    const key = titleKeyOf(store, a.collection);
    const t = key ? a.values[key]?.value : undefined;
    if (typeof t !== "string" || !t) return [];
    const rows = Object.entries(a.values).map(([k, v]) => ({ arg: `values.${k}`, value: v.value }));
    return [{ proposal: p, title: t, rows }];
  });
}

/** The mail a proposal came from, on either engine. */
const mailOfProposal = (store: UserStore, hooks: MailHooks, p: ProposalRow) =>
  p.tool === ACCEPT_RUN
    ? mailOfRun(store, String((p.args as RunArgs).values?.run?.value ?? ""))
    : hooks.mailOfProposal(p);
interface RunArgs {
  values?: { run?: { value?: unknown } };
}

/**
 * What `sender` already has waiting (AU-255): the titles of the pending proposals whose every source of outside is
 * a mail of that sender, latest first, each once, at most 20 of 200 characters. Read from the journal's pending
 * proposals of both engines; one he corrected is never among them (a pending one has no edits).
 */
export function pendingTitles(store: UserStore, sender: string): string[] {
  const mine = `mail:${sender}`;
  const titles = store.journal
    .proposals("pending")
    .filter((p) => {
      if (p.edits) return false;
      const outside = p.sources.filter((s) => !s.startsWith("code:") && !s.startsWith("model:"));
      return outside.length > 0 && outside.every((s) => s.toLowerCase() === mine);
    })
    .sort((a, b) => b.created - a.created)
    .flatMap((p) => itemsOf(store, p).map((i) => i.title.slice(0, PENDING_TITLES.chars)));
  return [...new Set(titles)].slice(0, PENDING_TITLES.n);
}

/** A value of the step's panel, as resolved by the engine. */
const param = (call: BoniCall, key: string): Cell | undefined => call.values[key]?.value;

/** The rows of a table parameter. */
const tableOf = (v: Cell | undefined): Record<string, Cell>[] =>
  Array.isArray(v)
    ? v.filter(
        (r): r is Record<string, Cell> => typeof r === "object" && r !== null && !Array.isArray(r),
      )
    : [];

/** The collections of a «Decisora»'s panel, by key, each once. */
export function deciderKeys(v: Cell | undefined): string[] {
  const keys = (Array.isArray(v) ? v : []).flatMap((r) =>
    typeof r === "string"
      ? [r]
      : typeof r === "object" && r !== null && !Array.isArray(r) && typeof r.collection === "string"
        ? [r.collection]
        : [],
  );
  return [...new Set(keys)];
}

/** The row a piece gives on, made by code: the mail's id and only what code set. */
function out(json: Record<string, Cell>, output?: string): BoniAnswer & { rows: unknown[] } {
  return { rows: [{ ...(output ? { output } : {}), json }], label: CODE_LABEL };
}
const CODE_LABEL = label("own", "public", [{ kind: "code", id: "mail" }]);
const none = (): BoniAnswer => ({ rows: [], label: CODE_LABEL });

/** A day or hour as the reading gives it, or null. */
const textOr = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/** What a reader answered, checked, asked once more when its answer did not fit (AU-59). */
async function readChecked<T>(
  call: BoniCall,
  r: Parameters<NonNullable<BoniCall["read"]>>[0],
  check: (answer: unknown) => T | null,
): Promise<{ value: T; label: Label } | { refused: string }> {
  if (!call.read) throw new BoniFault("no-reader");
  let reply: PieceReply = await call.read(r);
  if ("refused" in reply) return reply;
  let value = check(reply.answer);
  if (value === null) {
    reply = await call.read({ ...r, again: { fault: "shape" } });
    if ("refused" in reply) return reply;
    value = check(reply.answer);
  }
  if (value === null) throw new BoniFault("model-bad-answer");
  return { value, label: reply.label };
}

/** The «Decisora» of the version that runs: its collections, by key. */
const panelOf = (doc: Automation | undefined): string[] => {
  const d = doc?.steps.find((s) => s.type === "boni.mailDecider");
  return d ? deciderKeys(d.params[BONI_PARAMS.collections] as Cell) : [];
};

/**
 * One unit of a «Leer correo» piece, or null when `call` is none of them (the port then runs it as before). `doc`:
 * the version that runs, as stored (the «Rellenadora» matches an answer only against its «Decisora»).
 */
export async function runMailPiece(
  store: UserStore,
  hooks: MailHooks | null,
  call: BoniCall,
  doc: Automation | undefined,
): Promise<BoniAnswer | null> {
  const run = PIECES[call.type];
  if (!run) return null;
  if (!hooks) throw new BoniFault("no-mailbox");
  const row = call.row;
  if (!row) return none();
  const e = mailOf(store, hooks, row.json.id);
  if (!e) throw new BoniFault("not-a-mail");
  return run({ store, hooks, call, doc, row, e });
}

interface Ctx {
  store: UserStore;
  hooks: MailHooks;
  call: BoniCall;
  doc: Automation | undefined;
  row: Row;
  e: Mail;
}

const PIECES: Record<string, (c: Ctx) => Promise<BoniAnswer>> = {
  "boni.mailRule": async ({ call, row, e }) => {
    const from = String(e.entity.values.f_de ?? "").toLowerCase();
    const rule = tableOf(param(call, BONI_PARAMS.rules)).find((r) => {
      const s = typeof r.sender === "string" ? r.sender.toLowerCase().trim() : "";
      return !!s && (s.startsWith("@") ? from.endsWith(s) : from === s);
    });
    if (rule?.do === "skip") return call.startedBy === "user" ? out({ ...row.json }) : none();
    const json: Record<string, Cell> = { id: e.entity.id };
    if (rule?.do === "collection" && typeof rule.collection === "string")
      json.rule = rule.collection;
    return out(json);
  },

  "boni.mailInvitation": async ({ hooks, row, e }) => {
    const v = e.entity.values;
    const rows: { json: Record<string, Cell> }[] = [{ json: { ...row.json } }];
    const uid = textOr(v.f_evento_uid);
    const title = textOr(v.f_evento_titulo);
    if (uid && title && !(await hooks.inCalendar(uid)))
      rows.push({
        json: {
          id: e.entity.id,
          ...(typeof row.json.rule === "string" ? { rule: row.json.rule } : {}),
          kind: "events",
          invitation: true,
          title: title.slice(0, 200),
          due: textOr(v.f_evento_dia),
          start: textOr(v.f_evento_inicio),
          end: textOr(v.f_evento_fin),
          quote: "",
        },
      });
    return { rows, label: CODE_LABEL };
  },

  "boni.mailReader": async ({ store, hooks, call, row, e }) => {
    if (typeof row.json.kind === "string") return out({ ...row.json });
    const v = e.entity.values;
    const mail = mailLabel(e);
    const sender = senderOf(e);
    // What that sender has waiting, and an invitation's title: from outside, in their own markers (AU-255).
    const aside = label("external", "personal", sender ? [{ kind: "mail", id: sender }] : [], true);
    const inv = textOr(v.f_evento_uid) ? textOr(v.f_evento_titulo) : null;
    const pending = sender ? pendingTitles(store, sender) : [];
    const known = [...(inv ? [inv.slice(0, PENDING_TITLES.chars)] : []), ...pending].slice(
      0,
      PENDING_TITLES.n,
    );
    const raw = param(call, BONI_PARAMS.modules);
    const mods = modulesOf(Array.isArray(raw) ? (raw as string[]) : ["tasks", "events"]);
    const got = await readChecked<NonNullable<ReturnType<typeof checkReadMessage>>>(
      call,
      {
        texts: [
          { value: hooks.text(v, e.entity.body), label: mail, derived: false },
          ...known.map((t) => ({ value: t, label: join(aside, mail), derived: false })),
        ],
        userIn: hooks.userIn(v),
      },
      (a) => checkReadMessage(a, mods),
    );
    if ("refused" in got) throw new BoniFault(got.refused);
    const base: Record<string, Cell> = { id: e.entity.id };
    if (typeof row.json.rule === "string") base.rule = row.json.rule;
    return {
      rows: got.value.all.map((i) => ({
        json: {
          ...base,
          kind: i.module,
          title: i.title,
          due: i.due ?? null,
          start: i.start ?? null,
          end: i.end ?? null,
          quote: i.quote ?? "",
        },
      })),
      label: join(got.label, mail),
    };
  },

  "boni.fold": async ({ store, hooks, call, row, e }) => {
    const title = typeof row.json.title === "string" ? row.json.title : "";
    if (!title) return out({ ...row.json });
    const days =
      typeof param(call, BONI_PARAMS.days) === "number"
        ? (param(call, BONI_PARAMS.days) as number)
        : 60;
    const mails = hooks.threadMails(e.entity.id, days);
    if (!mails.size) return out({ ...row.json });
    const since = Date.now() - days * DAY;
    const when = whenOf(
      ["due", "start", "end"].map((k) => ({ arg: `values.${k}`, value: row.json[k] })),
    );
    const earlier = store.journal
      .proposals()
      .filter(
        (p) =>
          p.created >= since &&
          p.status !== "stale" &&
          (p.tool === "entities.create" || p.tool === ACCEPT_RUN) &&
          mails.has(mailOfProposal(store, hooks, p)),
      )
      .flatMap((p) => itemsOf(store, p))
      .filter((i) => likeTitle(i.title, title));
    if (!earlier.length) return out({ ...row.json });
    // The same thing said the same: already proposed in its thread.
    if (earlier.some((i) => whenOf(i.rows) === when)) return none();
    const prev = [...earlier].sort((a, b) => b.proposal.created - a.proposal.created)[0] as Item;
    return out({ ...row.json, before: { proposal: prev.proposal.id, ...whenParts(prev.rows) } });
  },

  "boni.mailDecider": async ({ store, hooks, call, row, e }) => {
    const keys = deciderKeys(param(call, BONI_PARAMS.collections));
    const title = typeof row.json.title === "string" ? row.json.title : "";
    const rule = typeof row.json.rule === "string" ? row.json.rule : null;
    if (!keys.length || !title) return none();
    const chosen = (key: string) => out({ ...row.json, [CHOSEN.collection]: key });
    if (rule && keys.includes(rule)) return chosen(rule);
    if (keys.length === 1) return chosen(keys[0] as string);
    const quote = typeof row.json.quote === "string" ? row.json.quote : "";
    const text = `${hooks.text(e.entity.values, e.entity.body)}\n\nElemento: ${title}${quote ? `\n«${quote}»` : ""}`;
    const ask = async (options: string[]) => {
      if (!call.read) throw new BoniFault("no-reader");
      const r = await call.read({
        texts: [{ value: text, label: mailLabel(e), derived: false }],
        options,
      });
      if ("refused" in r) return r;
      const a = r.answer as { choice?: unknown; confidence?: unknown };
      return typeof a?.choice === "string" && typeof a.confidence === "number"
        ? { choice: a.choice, confidence: a.confidence }
        : { refused: "model-bad-answer" };
    };
    const doubt = () => out({ ...row.json }, BONI_DOUBT);
    const c = await ask(keys);
    // No decision model in «Modelos»: nobody decides, he is asked.
    if ("refused" in c)
      return c.refused === "no-model" ? doubt() : Promise.reject(new BoniFault(c.refused));
    const r = await ask([...keys].reverse());
    if ("refused" in r)
      return r.refused === "no-model" ? doubt() : Promise.reject(new BoniFault(r.refused));
    // As the old decider (agent.ts `decideChoice`): sure only when both orders agree, with the lesser confidence,
    // calibrated by what came of its earlier choices.
    const p =
      c.choice === r.choice && keys.includes(c.choice) ? Math.min(c.confidence, r.confidence) : 0;
    const sure = calibrate(p, levelsOf(store.journal.decisions("choice", 200)));
    return resolve(sure, "A", true, { ask: 0, do: DECIDE_AT }) === "do"
      ? chosen(c.choice)
      : doubt();
  },

  "boni.mailFiller": async ({ store, hooks, call, row, e, doc }) => {
    const panel = panelOf(doc);
    const types = Object.values(store.schema().types);
    const answer = row.json[ANSWER_FIELD];
    // After «Preguntar», his answer names the collection: by key or by its name now, only among the «Decisora»'s.
    const key =
      answer !== undefined
        ? typeof answer === "string"
          ? panel.find((k) => k === answer || types.find((t) => t.key === k)?.name === answer)
          : undefined
        : typeof row.json[CHOSEN.collection] === "string" &&
            panel.includes(row.json[CHOSEN.collection] as string)
          ? (row.json[CHOSEN.collection] as string)
          : undefined;
    const title = typeof row.json.title === "string" ? row.json.title : "";
    if (!key || !title) return none();
    const t = hooks.target(key);
    const titleKey = titleKeyOf(store, key);
    if (!t || !titleKey) return none();
    const values: Record<string, Cell> = { [titleKey]: title };
    const due = textOr(row.json.due);
    const start = textOr(row.json.start);
    const end = textOr(row.json.end);
    if (t.date && due) values[t.date] = due;
    if (t.time && start) values[t.time] = start;
    if (t.endTime && end) values[t.endTime] = end;
    const fields = fillOf(store, key, t.fill);
    let lab = CODE_LABEL;
    if (fields.length) {
      const got = await readChecked<NonNullable<ReturnType<typeof checkFill>>>(
        call,
        {
          texts: [
            {
              value: `${hooks.text(e.entity.values, e.entity.body)}\n\nElemento: ${title}`,
              label: mailLabel(e),
              derived: false,
            },
          ],
          collection: key,
        },
        (a) => checkFill(a, fields),
      );
      if ("refused" in got) throw new BoniFault(got.refused);
      for (const [k, v] of Object.entries(got.value.values))
        if (values[k] === undefined) values[k] = v as Cell;
      lab = got.label;
    }
    const json: Record<string, Cell> = {
      ...row.json,
      [CHOSEN.collection]: key,
      [CHOSEN.values]: values,
    };
    delete json[ANSWER_FIELD];
    return { rows: [{ json }], label: lab };
  },

  "boni.mailRelations": async ({ hooks, row, e }) => {
    const key = row.json[CHOSEN.collection];
    const given = row.json[CHOSEN.values];
    if (
      typeof key !== "string" ||
      typeof given !== "object" ||
      given === null ||
      Array.isArray(given)
    )
      return out({ ...row.json });
    const values = { ...(given as Record<string, Cell>) };
    for (const [k, id] of Object.entries(hooks.relations(e.entity.id, key)))
      if (values[k] === undefined || values[k] === null) values[k] = id;
    return out({ ...row.json, [CHOSEN.values]: values });
  },
};

/**
 * The fields the «Rellenadora» fills in a collection: its closed choices and checkboxes from its definition, never
 * a relation (whose options are his records' titles: «Buscar relaciones» sets those by code).
 */
export function fillOf(store: UserStore, key: string, fill?: FillField[]): FillField[] {
  const t = Object.values(store.schema().types).find((x) => x.key === key);
  if (!t) return [];
  const relation = new Set(t.fields.filter((f) => f.type === "relation").map((f) => f.key));
  return (fill ?? []).filter((f) => !relation.has(f.key));
}
