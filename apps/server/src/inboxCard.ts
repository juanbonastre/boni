import type { TypeDef } from "@boni/entities";
import type { ProposalRow, UserStore } from "@boni/store";
import { calendarDefs } from "./calendarStore.ts";
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
  source:
    | {
        kind: "mail";
        account: string | null;
        from: string;
        subject: string;
        excerpt: string;
        /** The mail's own row in Boni ("Ver correo" opens it: IMAP gives no link to a webmail). */
        open: { type: string; id: string };
      }
    | { kind: "note"; path: string }
    | null;
  /**
   * Why it was made: the reader's quote of the mail (`verbatim` when the code finds those very words in it; a
   * model's words are never trusted to be a quote).
   */
  why: { text: string; verbatim: boolean } | null;
  /** Proposals like it (same collection and source) Juan accepted before. */
  familiar: number;
  /** It has what an entry of its kind needs (a title; a day for tasks and events). */
  complete: boolean;
  mode: "compact" | "detailed";
  /** The day before, the day and the day after, with what is in the calendar on each. */
  context: { day: string; items: { title: string; start: string | null; end: string | null }[] }[];
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

/** Every calendar collection's entries by day, by their mapping (made once for all the cards of a request). */
function calendarByDay(store: UserStore): Map<string, Item[]> {
  const out = new Map<string, Item[]>();
  const schema = store.schema().types;
  for (const p of calendarDefs(store)) {
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
    for (const s of store.list(p.type)) {
      const day = s.entity.values[date.id];
      if (typeof day !== "string") continue;
      if (!out.has(day)) out.set(day, []);
      out.get(day)?.push({
        title: textOf(s.entity.values[def.titleField]).slice(0, 120),
        start: start ? textOf(s.entity.values[start.id]) || null : null,
        end: end ? textOf(s.entity.values[end.id]) || null : null,
      });
    }
  }
  for (const list of out.values())
    list.sort(
      (a, b) => (a.start ?? "").localeCompare(b.start ?? "") || a.title.localeCompare(b.title),
    );
  return out;
}

/**
 * What every card of one request shares, computed once (Juan, 2026-10-23: with many proposals the inbox took
 * seconds on the NAS): the calendar by day, and how many proposals like each one Juan accepted.
 */
export interface InboxContext {
  calendar: () => Map<string, Item[]>;
  accepted: () => Map<string, number>;
}
export function inboxContext(store: UserStore): InboxContext {
  let calendar: Map<string, Item[]> | null = null;
  let accepted: Map<string, number> | null = null;
  return {
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

/** The proposal's source as a key ("mail:<sender>", "vault:<path>"): what "like it" compares. */
const sourceKey = (p: ProposalRow) => (p.sources[0] ?? "").replace(/@[0-9a-f]{12}$/, "");
/** Proposals "like" each other: the same tool, source and collection. */
const likeKey = (p: ProposalRow) => {
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
  } else {
    const note = textOf(row("note")?.value);
    if (note) source = { kind: "note", path: note };
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
    start: times[0] ?? null,
    end: times[1] ?? null,
    source,
    why,
    familiar,
    complete,
    mode: complete && familiar >= 2 ? "compact" : "detailed",
    context: day
      ? [addDays(day, -1), day, addDays(day, 1)].map((d) => ({
          day: d,
          items: ctx.calendar().get(d) ?? [],
        }))
      : [],
  };
}
