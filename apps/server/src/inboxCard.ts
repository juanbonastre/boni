import { randomUUID } from "node:crypto";
import { calibrate, historyConfidence, type Json, levelsOf, resolve } from "@boni/agent";
import { branch, rolesOf, type Schema, type TypeDef } from "@boni/entities";
import type { ProposalRow, UserStore } from "@boni/store";
import { decisionHistory, wouldAccept } from "./autoAccept.ts";
import { calendarDefs, taskDoneField } from "./calendarStore.ts";
import { mailOfRun } from "./mailReview.ts";

/**
 * What the inbox shows of a proposal, made by code from its real arguments (Juan, 2026-10-22): what it does in
 * words ("Añadir tarea a Docencia"), where it came from (the mailbox, the sender, the subject; or the note edited
 * by hand), its day and times, how many times Juan already accepted one like it, and what he has that day and the
 * days around it (the mini calendar). The card is compact when the source says everything and it happened before,
 * detailed otherwise; the code decides, never a model. Nothing here is followed or opened: text only.
 */
export interface InboxCard {
  action: "create" | "update" | "delete" | "other";
  collection: string | null;
  /** The collection's id (Juan may move the proposal to another one before accepting). */
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
    /** The mail's own row in Boni ("Ver correo" opens it: IMAP gives no link to a webmail). */
    open: { type: string; id: string };
  } | null;
  /**
   * Why it was made: the reader's quote of the mail (`verbatim` when the code finds those very words in it; a
   * model's words are never trusted to be a quote).
   */
  why: { text: string; verbatim: boolean } | null;
  /** Proposals like it (same collection and source) Juan accepted before. */
  familiar: number;
  /** It has what an entry of its kind needs (a title; a day for tasks and events). */
  complete: boolean;
  /** "Ya lo hice": its collection has a task column, so it can be made already done. */
  canMarkDone: boolean;
  /**
   * Boni would have accepted it alone (Juan, 2026-10-23: measured first, turned on by him later): the rule of
   * autoAccept.ts over his decisions on proposals like it.
   */
  wouldAccept: boolean;
  mode: "compact" | "detailed";
  /** The day before, the day and the day after, with what is in the calendar on each. */
  context: { day: string; items: { title: string; start: string | null; end: string | null }[] }[];
  /**
   * A time for a task the mail gave none for (Juan, 2026-11-02): the first free hour of its day in the calendar,
   * as a decision of the procedure (docs/fiabilidad.md, area «Horas», class A): asked on the card, or set alone
   * once his answers earn it («do»: the card's `start` and `end` already say it).
   */
  suggestedTime: SuggestedTime | null;
  /** What an earlier proposal of the same thread of mail said, when this one changed its day or hours (task 46). */
  before: { day: string | null; start: string | null; end: string | null } | null;
}
export interface SuggestedTime {
  start: string;
  end: string;
  /** The keys of the collection's fields playing `time` and `endTime`, where the time goes when taken. */
  startKey: string;
  endKey: string | null;
  outcome: "ask" | "do";
}

export const TIME_AREA = "time";
/** Asked from the first; set alone from 0.9 of his answers (calibrated), as a decision inside the proposal. */
export const TIME_THRESHOLDS = { ask: 0, do: 0.9 } as const;
const WORK = { from: 9 * 60, to: 20 * 60 };
const SLOT = 60;
const minutesOf = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const hhmm = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/**
 * The first free hour of a day, from 9:00 to 20:00, among what the calendar holds that day (an item without an end
 * takes an hour; one without a start, the whole day, takes none); at a half hour when that is the first gap.
 */
export function freeSlot(
  items: readonly { start: string | null; end: string | null }[],
): { start: string; end: string } | null {
  const busy = items
    .filter((i) => i.start && TIME.test(i.start))
    .map((i) => {
      const s = minutesOf(i.start as string);
      const e = i.end && TIME.test(i.end) ? minutesOf(i.end) : s + SLOT;
      return [s, Math.max(e, s + 1)] as const;
    });
  for (let s = WORK.from; s + SLOT <= WORK.to; s += 30) {
    const e = s + SLOT;
    if (!busy.some(([bs, be]) => bs < e && be > s)) return { start: hhmm(s), end: hhmm(e) };
  }
  return null;
}

/** The keys of a collection's fields that play `time` and `endTime` (its mother's roles count). */
function timeKeysOf(
  schema: Schema,
  def: TypeDef,
): { startKey: string | null; endKey: string | null } {
  const roles = rolesOf(schema, def.id);
  const key = (id: string | undefined) =>
    id ? (def.fields.find((f) => f.id === id)?.key ?? null) : null;
  return { startKey: key(roles.time), endKey: key(roles.endTime) };
}

interface TimeDetail {
  proposal: string;
  start: string;
  end: string;
  startKey: string;
  endKey: string | null;
}
const timeDecisionOf = (store: UserStore, p: ProposalRow) =>
  store.journal
    .decisionsOf(p.run)
    .find((d) => d.area === TIME_AREA && (d.detail as TimeDetail | null)?.proposal === p.id) ??
  null;

/**
 * The decision for a task's time, recorded once per proposal: `p` from how often Juan took the times suggested
 * before (cautious, calibrated by level); below 0.9 the card asks, from it the time is set alone (A-13: class A,
 * inside a proposal he still decides).
 */
function timeDecision(
  store: UserStore,
  p: ProposalRow,
  slot: { start: string; end: string },
  keys: { startKey: string; endKey: string | null },
  now: number,
): "ask" | "do" {
  const had = timeDecisionOf(store, p);
  if (had) return had.outcome === "do" ? "do" : "ask";
  const rows = store.journal.decisions(TIME_AREA, 200);
  const judged = rows.filter((d) => d.result);
  const conf = calibrate(
    historyConfidence(judged.filter((d) => d.result === "right").length, judged.length),
    levelsOf(rows),
  );
  const outcome = resolve(conf, "A", true, TIME_THRESHOLDS) === "do" ? "do" : "ask";
  const detail: TimeDetail = { proposal: p.id, ...slot, ...keys };
  store.journal.addDecision({
    id: randomUUID(),
    run: p.run,
    area: TIME_AREA,
    cost: "A",
    p: conf,
    outcome,
    detail,
    at: now,
  });
  return outcome;
}

/**
 * At acceptance: the time set alone when the decision said so and Juan gave none (his own value, or null, wins);
 * the proposal's values as they will be made.
 */
export function timeOnAccept<E extends { values?: Record<string, Json | null> }>(
  store: UserStore,
  p: ProposalRow,
  edits: E,
): E {
  const d = timeDecisionOf(store, p);
  const det = d?.detail as TimeDetail | null;
  if (!d || d.outcome !== "do" || !det || edits.values?.[det.startKey] !== undefined) return edits;
  return {
    ...edits,
    values: {
      ...(edits.values ?? {}),
      [det.startKey]: det.start,
      ...(det.endKey ? { [det.endKey]: det.end } : {}),
    },
  };
}

/** What Juan made of the suggested time, once he accepted the proposal: kept or taken is right; else wrong. */
export function judgeTime(
  store: UserStore,
  p: ProposalRow,
  values: Record<string, unknown>,
  now: number,
): void {
  const d = timeDecisionOf(store, p);
  const det = d?.detail as TimeDetail | null;
  if (!d || d.result || !det) return;
  store.journal.setDecisionResult(
    d.id,
    values[det.startKey] === det.start ? "right" : "wrong",
    now,
  );
}

type Row = { arg: string; value?: unknown; detail?: unknown; role?: string };
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const EXCERPT = 1200;

const rowsOf = (p: ProposalRow): Row[] =>
  ((p.view as { rows?: Row[] } | null)?.rows ?? []) as Row[];
const textOf = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));
/** Text compared for a quote: lower case, one space, no quote marks or ellipses around. */
const plain = (s: string) =>
  s
    .toLowerCase()
    .replace(/[«»"“”'‘’]/g, "")
    .replace(/(\.\.\.|…)/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** The proposal's reason as the agent stored it (`args.why`, a labelled value): its text, at most 300. */
function whyOf(p: ProposalRow): string | null {
  const w = (p.args as { why?: { t?: string; value?: unknown } } | null)?.why;
  return w?.t === "v" && typeof w.value === "string" && w.value.trim()
    ? w.value.trim().slice(0, 300)
    : null;
}

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** A collection's field by the property name a calendar definition uses (column id, or the field's name). */
function fieldOfProp(def: TypeDef, columns: { id: string; name: string }[], prop: string) {
  return def.fields.find((f) => (columns.find((c) => c.name === f.name)?.id ?? f.name) === prop);
}

type Item = { title: string; start: string | null; end: string | null };

/** How an item is read from a record of a calendar collection: its day, its times and its title. */
interface ItemSpec {
  date: string;
  start?: string;
  end?: string;
  title: string;
}
interface ByDay {
  version: number;
  defs: unknown;
  /** Per collection read, how its records give an item (the first calendar that read it). */
  spec: Map<string, ItemSpec>;
  /** Each record's item and the day it is in, to take it out when it changes. */
  items: Map<string, { day: string; item: Item }>;
  byDay: Map<string, Item[]>;
}

/**
 * The calendar by day as last made, per store, kept up to date with what changes (task 43: the inbox asks every
 * minute; making it read the Agenda once for each of its areas, and later once for each change, took half a second
 * on the NAS each time). Made again only when the definitions or the schema change.
 */
const byDayMemo = new WeakMap<UserStore, ByDay>();

const sortDay = (list: Item[]) =>
  list.sort(
    (a, b) => (a.start ?? "").localeCompare(b.start ?? "") || a.title.localeCompare(b.title),
  );
const itemOf = (
  spec: ItemSpec,
  values: Record<string, unknown>,
): { day: string; item: Item } | null => {
  const day = values[spec.date];
  if (typeof day !== "string") return null;
  return {
    day,
    item: {
      title: textOf(values[spec.title]).slice(0, 120),
      start: spec.start ? textOf(values[spec.start]) || null : null,
      end: spec.end ? textOf(values[spec.end]) || null : null,
    },
  };
};

/** What changed since the memo was made, put in it: each changed record's item out of its day and into its new one. */
function updateByDay(
  m: ByDay,
  changed: {
    entity: { id: string; type: string; values: Record<string, unknown>; deleted?: number };
  }[],
) {
  const touched = new Set<string>();
  for (const { entity: e } of changed) {
    const spec = m.spec.get(e.type);
    const was = m.items.get(e.id);
    if (!spec && !was) continue;
    if (was) {
      const list = m.byDay.get(was.day);
      if (list) {
        const at = list.indexOf(was.item);
        if (at >= 0) list.splice(at, 1);
        if (!list.length) m.byDay.delete(was.day);
      }
      m.items.delete(e.id);
    }
    const now = spec && e.deleted === undefined ? itemOf(spec, e.values) : null;
    if (!now) continue;
    m.items.set(e.id, now);
    const list = m.byDay.get(now.day) ?? [];
    list.push(now.item);
    m.byDay.set(now.day, list);
    touched.add(now.day);
  }
  for (const day of touched) sortDay(m.byDay.get(day) ?? []);
}

/**
 * Every calendar collection's entries by day, by their mapping (made once for all the cards of a request): each
 * record once, a split calendar's from its whole branch (its parts share the mapping), each collection read once.
 */
function calendarByDay(store: UserStore): Map<string, Item[]> {
  const defs = calendarDefs(store);
  const version = store.version();
  const was = byDayMemo.get(store);
  if (was && was.defs === defs) {
    if (was.version !== version) {
      const ch = store.changesSince(was.version);
      if (!ch.schemaChanged) {
        updateByDay(was, ch.entities);
        was.version = version;
      }
    }
    if (was.version === version) return was.byDay;
  }
  const m: ByDay = { version, defs, spec: new Map(), items: new Map(), byDay: new Map() };
  const schema = store.schema().types;
  for (const p of defs) {
    const def = schema[p.type];
    const when = p.def.mapping.when as {
      kind?: string;
      date?: string;
      startTime?: string;
      endTime?: string;
    };
    if (!def || when.kind !== "split" || !when.date) continue;
    const date = fieldOfProp(def, p.def.columns, when.date);
    const start = when.startTime ? fieldOfProp(def, p.def.columns, when.startTime) : undefined;
    const end = when.endTime ? fieldOfProp(def, p.def.columns, when.endTime) : undefined;
    if (!date) continue;
    const spec: ItemSpec = {
      date: date.id,
      ...(start ? { start: start.id } : {}),
      ...(end ? { end: end.id } : {}),
      title: def.titleField,
    };
    for (const t of p.where ? branch({ types: schema }, p.type) : [p.type]) {
      if (m.spec.has(t)) continue;
      m.spec.set(t, spec);
      for (const s of store.list(t)) {
        if (m.items.has(s.entity.id)) continue;
        const it = itemOf(spec, s.entity.values);
        if (!it) continue;
        m.items.set(s.entity.id, it);
        const list = m.byDay.get(it.day) ?? [];
        list.push(it.item);
        m.byDay.set(it.day, list);
      }
    }
  }
  for (const list of m.byDay.values()) sortDay(list);
  byDayMemo.set(store, m);
  return m.byDay;
}

/**
 * What every card of one request shares, computed once (Juan, 2026-10-23: with many proposals the inbox took
 * seconds on the NAS): the calendar by day, and how many proposals like each one Juan accepted.
 */
export interface InboxContext {
  calendar: () => Map<string, Item[]>;
  accepted: () => Map<string, number>;
  /** Juan's decisions on proposals like each one, oldest first (autoAccept.ts). */
  history: () => Map<string, boolean[]>;
}
export function inboxContext(store: UserStore): InboxContext {
  let calendar: Map<string, Item[]> | null = null;
  let accepted: Map<string, number> | null = null;
  let history: Map<string, boolean[]> | null = null;
  return {
    history: () => {
      if (!history) history = decisionHistory(store);
      return history;
    },
    calendar: () => {
      if (!calendar) calendar = calendarByDay(store);
      return calendar;
    },
    accepted: () => {
      if (!accepted) {
        accepted = new Map();
        for (const x of store.journal.proposals("accepted")) {
          const k = likeKey(x);
          if (k) accepted.set(k, (accepted.get(k) ?? 0) + 1);
        }
      }
      return accepted;
    },
  };
}

/** The proposal's source as a key ("mail:<sender>"): what "like it" compares. */
const sourceKey = (p: ProposalRow) => (p.sources[0] ?? "").replace(/@[0-9a-f]{12}$/, "");
/** Proposals "like" each other: the same tool, source and collection. */
export const likeKey = (p: ProposalRow) => {
  const src = sourceKey(p);
  return src
    ? `${p.tool}\u0000${src}\u0000${textOf(rowsOf(p).find((r) => r.arg === "type")?.value)}`
    : "";
};

export function inboxCard(
  store: UserStore,
  p: ProposalRow,
  o: { mailAccount?: string | null } = {},
  ctx: InboxContext = inboxContext(store),
): InboxCard {
  const rows = rowsOf(p);
  const row = (arg: string) => rows.find((r) => r.arg === arg);
  const schema = store.schema().types;
  const typeRow = row("type");
  const typeKey = textOf(typeRow?.value);
  const def = Object.values(schema).find((t) => t.key === typeKey || t.id === typeKey);
  const collection = textOf(typeRow?.detail) || def?.name || null;
  const action: InboxCard["action"] =
    p.tool === "entities.create"
      ? "create"
      : p.tool === "entities.update"
        ? "update"
        : p.tool === "entities.delete"
          ? "delete"
          : "other";
  // Day and times from the values by their field's type (any collection), else by their shape.
  let day: string | null = null;
  const times: string[] = [];
  for (const r of rows) {
    if (!r.arg.startsWith("values.")) continue;
    const key = r.arg.slice("values.".length);
    const f = def?.fields.find((x) => x.key === key || x.id === key);
    const v = textOf(r.value);
    if (!day && (f?.type === "date" || (!f && DAY.test(v))) && DAY.test(v)) day = v;
    else if ((f?.type === "time" || (!f && TIME.test(v))) && TIME.test(v)) times.push(v);
  }
  const title =
    textOf(
      row("values.title")?.value ??
        row(`values.${def?.fields.find((f) => f.id === def.titleField)?.key ?? ""}`)?.value,
    ) || null;
  const kind: InboxCard["kind"] = times.length ? "event" : day ? "task" : "item";
  // A task with a day and no time, in a collection that keeps times: the first free hour, as a decision.
  let suggestedTime: SuggestedTime | null = null;
  const keys = def && action === "create" ? timeKeysOf(store.schema(), def) : null;
  if (kind === "task" && day && keys?.startKey && p.status === "pending") {
    const slot = freeSlot(ctx.calendar().get(day) ?? []);
    if (slot) {
      const outcome = timeDecision(
        store,
        p,
        slot,
        { startKey: keys.startKey, endKey: keys.endKey },
        Date.now(),
      );
      suggestedTime = { ...slot, startKey: keys.startKey, endKey: keys.endKey, outcome };
    }
  }
  const alone = suggestedTime?.outcome === "do" ? suggestedTime : null;

  let source: InboxCard["source"] = null;
  const mail = p.run ? mailOfRun(store, p.run) : null;
  const m = mail ? store.get(mail) : null;
  const said = whyOf(p);
  let why: InboxCard["why"] = null;
  if (m) {
    const v = m.entity.values;
    source = {
      kind: "mail",
      account: o.mailAccount ?? null,
      from: textOf(v.f_de_nombre) || textOf(v.f_de),
      subject: textOf(v.f_asunto).slice(0, 200),
      excerpt: (m.entity.body ?? "").replace(/\s+/g, " ").trim().slice(0, EXCERPT),
      open: { type: m.entity.type, id: m.entity.id },
    };
    if (said) {
      const text = plain(`${textOf(v.f_asunto)} ${m.entity.body ?? ""}`);
      why = { text: said, verbatim: plain(said).length > 0 && text.includes(plain(said)) };
    }
  }

  const key = likeKey(p);
  const familiar = key ? (ctx.accepted().get(key) ?? 0) : 0;
  const complete = action !== "create" || (!!title && (kind === "item" || !!day));
  return {
    action,
    collection,
    collectionId: def?.id ?? null,
    kind,
    title,
    day,
    start: times[0] ?? alone?.start ?? null,
    end: times[1] ?? alone?.end ?? null,
    source,
    why,
    familiar,
    complete,
    canMarkDone: action === "create" && !!def && !!taskDoneField(store, def.id),
    wouldAccept:
      action === "create" &&
      complete &&
      source?.kind === "mail" &&
      wouldAccept(key ? (ctx.history().get(key) ?? []) : []),
    mode: complete && familiar >= 2 ? "compact" : "detailed",
    context: day
      ? [addDays(day, -1), day, addDays(day, 1)].map((d) => ({
          day: d,
          items: ctx.calendar().get(d) ?? [],
        }))
      : [],
    suggestedTime,
    before: p.before ? { day: p.before.day, start: p.before.start, end: p.before.end } : null,
  };
}
