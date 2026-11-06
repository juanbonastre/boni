import { type Agent, leaf } from "@boni/agent";
import { label } from "@boni/entities";
import type { UserStore } from "@boni/store";
import type { GuideExample, MailGuide, MailRule, Target } from "./mail.ts";

/**
 * The reviewer (docs/nucleo.md 7.4b, point 3): it learns from Juan's decisions on the proposals that came
 * from his mail, and only proposes. A reader (`review_reading`) sees those decisions (someone else's text,
 * between markers) and may answer only rules from the guide's catalogue and ids of decisions; the code
 * checks every rule against the decisions themselves, builds the examples from Juan's own choices, and
 * measures the candidate guide by reading again mail he already decided. A suggestion is kept only if it
 * gets more of his decisions right; Juan accepts or rejects it.
 */

/** One of Juan's decisions on a proposal that came from a mail. */
export interface Decision {
  id: string;
  proposal: string;
  mail: string;
  sender: string;
  userIn: string;
  collection: string;
  title: string;
  due: string | null;
  accepted: boolean;
  /**
   * What the reading proposed when Juan corrected it before accepting (Juan, 2026-10-23): a prediction error,
   * like a rejection; `title` and `collection` above are then his.
   */
  corrected?: { title?: string; collection?: string };
  at: number;
  /** When the proposal was made (orders decisions taken at the same moment). */
  made: number;
}

export interface Suggestion {
  id: string;
  rules: MailRule[];
  examples: GuideExample[];
  /** Decisions the current guide and the suggested one get right, out of `total` (mail read again). */
  before: number;
  after: number;
  total: number;
  at: number;
  /** The background run that measured it (its decision of docs/fiabilidad.md hangs from it). */
  run?: string;
}

const MIN_DECISIONS = 10;
const MAX_DECISIONS = 60;
/** Mail read again to measure, with each guide. */
const MEASURE = 20;

/** The mail whose plan made a proposal (its first step reads it). */
export function mailOfRun(store: UserStore, run: string): string | null {
  const r = store.journal.run(run);
  return r?.input ?? mailOfPlan(r?.plan);
}

/** The mail a plan reads first (a mail's reading starts by reading it), or null. */
export function mailOfPlan(plan: unknown): string | null {
  const first = (plan as { steps?: { tool?: string; args?: { id?: { lit?: unknown } } }[] } | null)
    ?.steps?.[0];
  return first?.tool === "entities.get" && typeof first.args?.id?.lit === "string"
    ? first.args.id.lit
    : null;
}

/** Juan's decisions on proposals from mail of the collection `type`, oldest first (the latest 60). */
export function decisions(
  store: UserStore,
  type: string,
  userInOf: (values: Record<string, unknown>) => string,
): Decision[] {
  const out: Decision[] = [];
  const schema = store.schema().types;
  for (const status of ["accepted", "rejected"] as const)
    for (const p of store.journal.proposals(status)) {
      if (p.tool !== "entities.create" || p.decided === null) continue;
      const mail = mailOfRun(store, p.run);
      const m = mail ? store.get(mail) : null;
      if (!m || m.entity.type !== type) continue;
      const rows = (p.view as { rows?: { arg: string; value: unknown }[] }).rows ?? [];
      const row = (a: string) => rows.find((r) => r.arg === a)?.value;
      const key = String(row("type") ?? "");
      const title = row("values.title");
      if (typeof title !== "string") continue;
      const due = rows.find(
        (r) => r.arg.startsWith("values.") && /^\d{4}-\d{2}-\d{2}$/.test(String(r.value)),
      );
      const nameOf = (k: string) => Object.values(schema).find((t) => t.key === k)?.name ?? k;
      // Juan's corrections: his title and collection, and what was proposed.
      const e = p.edits;
      const fixedTitle = e?.values?.title?.to;
      const myTitle = typeof fixedTitle === "string" && fixedTitle !== title ? fixedTitle : null;
      const myKey = e?.type && e.type.to !== key ? e.type.to : null;
      out.push({
        id: "",
        proposal: p.id,
        mail: m.entity.id,
        sender: String(m.entity.values.f_de ?? "").toLowerCase(),
        userIn: userInOf(m.entity.values),
        collection: nameOf(myKey ?? key),
        title: myTitle ?? title,
        ...(myTitle || myKey
          ? {
              corrected: {
                ...(myTitle ? { title } : {}),
                ...(myKey ? { collection: nameOf(key) } : {}),
              },
            }
          : {}),
        due: due ? String(due.value) : null,
        accepted: status === "accepted",
        at: p.decided,
        made: p.created,
      });
    }
  return out
    .sort((a, b) => a.at - b.at || a.made - b.made)
    .slice(-MAX_DECISIONS)
    .map((d, i) => ({ ...d, id: `d${i + 1}` }));
}

const matches = (rule: string, sender: string) =>
  rule.startsWith("@") ? sender.endsWith(rule) : sender === rule;

/**
 * A rule the reviewer suggested, kept only if Juan's decisions show it: "skip" when at least 3 decisions
 * match the sender and he rejected every one of them; "collection" when he accepted at least 2 of its
 * proposals and the collection is one of those marked. Never one the guide already has.
 */
export function checkRule(
  r: { from: string; action: string; collection: string | null },
  ds: readonly Decision[],
  targets: readonly Target[],
  guide: MailGuide,
  excluded: ReadonlySet<string> = new Set(),
): MailRule | null {
  const from = r.from.trim().toLowerCase();
  if (guide.rules.some((g) => g.from === from) || excluded.has(from)) return null;
  const mine = ds.filter((d) => matches(from, d.sender));
  if (r.action === "skip") {
    if (mine.length < 3 || mine.some((d) => d.accepted)) return null;
    return { id: `s-${from}`, from, action: "skip" };
  }
  const t = targets.find((x) => x.name === r.collection);
  if (!t?.id || mine.filter((d) => d.accepted).length < 2) return null;
  return { id: `s-${from}`, from, action: "collection", collection: t.id };
}

/**
 * The rules Juan's own corrections show, found by code and nothing else (docs/fiabilidad.md F4: the same change
 * repeated): a sender, or its domain, whose proposals he rejected three or more times and never accepted is
 * skipped; one whose proposals he moved to the same collection twice or more, and never kept elsewhere, goes
 * there. Each passes `checkRule` like a rule the model proposes, and is measured the same way before it is
 * suggested. A domain's rule covers its senders' own.
 */
export function ruleCandidates(
  ds: readonly Decision[],
  targets: readonly Target[],
  guide: MailGuide,
  excluded: ReadonlySet<string> = new Set(),
): MailRule[] {
  const senders = new Set<string>();
  for (const d of ds) {
    const s = d.sender.trim().toLowerCase();
    const at = s.indexOf("@");
    if (at <= 0) continue;
    senders.add(s);
    senders.add(s.slice(at));
  }
  const out: MailRule[] = [];
  for (const from of senders) {
    const mine = ds.filter((d) => matches(from, d.sender));
    if (mine.length >= 3 && mine.every((d) => !d.accepted)) {
      const r = checkRule({ from, action: "skip", collection: null }, ds, targets, guide, excluded);
      if (r) out.push(r);
      continue;
    }
    const kept = mine.filter((d) => d.accepted);
    const moved = kept.filter((d) => d.corrected?.collection);
    const to = moved[0]?.collection;
    if (moved.length >= 2 && to && kept.every((d) => d.collection === to)) {
      const r = checkRule(
        { from, action: "collection", collection: to },
        ds,
        targets,
        guide,
        excluded,
      );
      if (r) out.push(r);
    }
  }
  return out.filter(
    (r) =>
      r.from.startsWith("@") ||
      !out.some((o) => o.from.startsWith("@") && o.action === r.action && r.from.endsWith(o.from)),
  );
}

/** A mail as the reader reads it (headers, then text), cut to what an example may hold. */
export function mailText(values: Record<string, unknown>, body: string | undefined): string {
  const v = (k: string) => (typeof values[`f_${k}`] === "string" ? String(values[`f_${k}`]) : "");
  const lines = [
    v("de") ? `De: ${v("de_nombre") ? `${v("de_nombre")} ` : ""}<${v("de")}>` : "",
    v("para") ? `Para: ${v("para")}` : "",
    v("cc") ? `Cc: ${v("cc")}` : "",
    v("asunto") ? `Asunto: ${v("asunto")}` : "",
  ].filter(Boolean);
  return `${lines.join("\n")}\n\n${body ?? ""}`.slice(0, 1500);
}

/** An example from one mail Juan decided: what he accepted from it (nothing, if he rejected it all). */
export function exampleOf(
  store: UserStore,
  mail: string,
  ds: readonly Decision[],
): GuideExample | null {
  const m = store.get(mail);
  if (!m) return null;
  const of = ds.filter((d) => d.mail === mail);
  return {
    id: `x-${mail}`,
    subject: String(m.entity.values.f_asunto ?? ""),
    from: String(m.entity.values.f_de ?? ""),
    mail: mailText(m.entity.values, m.entity.body),
    want: of
      .filter((d) => d.accepted)
      .map((d) => ({ module: d.due ? "events" : "tasks", title: d.title, due: d.due })),
  };
}

const words = (s: string) =>
  new Set(
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2),
  );
/** Whether two titles name the same thing (most of the shorter one's words are in the other). */
export function sameThing(a: string, b: string): boolean {
  const x = words(a);
  const y = words(b);
  if (!x.size || !y.size) return a.trim().toLowerCase() === b.trim().toLowerCase();
  let common = 0;
  for (const w of x) if (y.has(w)) common++;
  return common / Math.min(x.size, y.size) >= 0.6;
}

/**
 * How many of Juan's decisions on these mails a reading gets right: an accepted proposal is right if the
 * reading gives it again, a rejected one if it does not.
 */
export function score(ds: readonly Decision[], produced: Map<string, string[]>): number {
  let right = 0;
  for (const d of ds) {
    const got = (produced.get(d.mail) ?? []).some((t) => sameThing(t, d.title));
    if (got === d.accepted) right++;
  }
  return right;
}

/** The context the reviewer needs from Mails. */
export interface ReviewHost {
  store: UserStore;
  agent: Agent;
  guide: MailGuide;
  targets: Target[];
  ds: Decision[];
  /** Reads one mail with a guide (null: as the code would skip it) and gives the titles it keeps. */
  read: (mail: string, guide: MailGuide) => Promise<string[] | null>;
  now: number;
  /** Rules (by sender) and examples (by id) Juan rejected before: never suggested again. */
  excluded: ReadonlySet<string>;
  /** Rules his corrections already show, found by code (`ruleCandidates`): suggested even if the model finds nothing. */
  candidates?: readonly MailRule[];
}

/** The reviewer's answer as its reader gives it: rules from the catalogue and the ids of decisions to learn from. */
export interface ReviewerAnswer {
  rules: { from: string; action: string; collection: string | null }[];
  examples: string[];
}

/** What a review would suggest before it is measured: its rules and examples, and the guide they make. */
export interface ReviewCandidate {
  rules: MailRule[];
  examples: GuideExample[];
  guide: MailGuide;
}

/**
 * «Tus decisiones» (the flow «Revisar la guía», docs/sistema.md §4.2): Juan's decisions as the reviewer reads them,
 * one line each. Their text quotes other people's mail: external, like the mail itself. Null with too few decisions
 * or no collection to send mail to (nothing to review).
 */
export function reviewInput(ds: readonly Decision[], targets: readonly Target[]) {
  if (ds.length < MIN_DECISIONS || !targets.length) return null;
  const lines = ds.map((d) =>
    [
      d.id,
      d.sender,
      d.userIn,
      d.title,
      d.collection,
      d.accepted ? "accepted" : "rejected",
      ...(d.corrected
        ? [
            `corrected from: ${[d.corrected.title, d.corrected.collection].filter(Boolean).join(" | ")}`,
          ]
        : []),
    ].join(" | "),
  );
  return leaf(lines.join("\n"), label("external", "personal", [{ kind: "mail", id: "review" }]));
}

/**
 * What the reviewer's answer and the rules found by code make (each rule checked against the decisions, the examples
 * built from Juan's own choices), or null when there is nothing to measure.
 */
export function reviewCandidate(
  h: Pick<ReviewHost, "store" | "guide" | "targets" | "ds" | "excluded" | "candidates">,
  out: ReviewerAnswer | null | undefined,
): ReviewCandidate | null {
  const { ds } = h;
  const found = h.candidates ?? [];
  if (!out && !found.length) return null;
  const rules = [
    ...found,
    ...(out?.rules ?? [])
      .map((x) => checkRule(x, ds, h.targets, h.guide, h.excluded))
      .filter((x): x is MailRule => !!x && !found.some((c) => c.from === x.from)),
  ];
  const have = new Set(h.guide.examples.map((e) => e.id));
  const mails = [
    ...new Set((out?.examples ?? []).map((id) => ds.find((d) => d.id === id)?.mail)),
  ].filter((m): m is string => !!m);
  const examples = mails
    .map((m) => exampleOf(h.store, m, ds))
    .filter((e): e is GuideExample => !!e && !have.has(e.id) && !h.excluded.has(e.id));
  if (!rules.length && !examples.length) return null;
  return {
    rules,
    examples,
    guide: {
      ...h.guide,
      rules: [...h.guide.rules, ...rules],
      examples: [...h.guide.examples, ...examples].slice(-10),
    },
  };
}

/** The mail a candidate is measured on: the latest decided, never the mail its examples come from. */
export function measuredMail(ds: readonly Decision[], c: ReviewCandidate): string[] {
  const shown = new Set(c.examples.map((e) => e.id.slice(2)));
  return [...new Set(ds.map((d) => d.mail).reverse())]
    .filter((m) => !shown.has(m))
    .slice(0, MEASURE);
}

/** «Medir releyendo»: how many of Juan's decisions today's guide and the candidate get right, reading that mail again. */
export async function measureCandidate(
  h: Pick<ReviewHost, "ds" | "guide" | "read">,
  c: ReviewCandidate,
): Promise<{ before: number; after: number; total: number }> {
  const measured = measuredMail(h.ds, c);
  const on = h.ds.filter((d) => measured.includes(d.mail));
  const produce = async (g: MailGuide) => {
    const p = new Map<string, string[]>();
    for (const m of measured) p.set(m, (await h.read(m, g)) ?? []);
    return p;
  };
  const before = score(on, await produce(h.guide));
  const after = score(on, await produce(c.guide));
  return { before, after, total: on.length };
}

/** The reviewer's own plan: its reader over the decisions, the collections it may name as options. */
export const reviewPlan = (targets: readonly Target[]) => ({
  version: 1,
  steps: [
    {
      id: "r",
      op: "read",
      reader: "review_reading",
      input: { ref: "$decisions" },
      params: { options: { fn: "list", args: targets.map((t) => ({ lit: t.name })) } },
    },
  ],
});

/** One review: a suggestion that gets more of Juan's decisions right, or null (the stages above, in a row). */
export async function review(h: ReviewHost): Promise<Suggestion | null> {
  const input = reviewInput(h.ds, h.targets);
  if (!input) return null;
  const r = await h.agent.background(reviewPlan(h.targets), { decisions: input }, ["r"]);
  const c = reviewCandidate(h, r.kept?.r as ReviewerAnswer | undefined);
  if (!c) return null;
  const m = await measureCandidate(h, c);
  if (m.after <= m.before) return null;
  return {
    id: `g-${h.now}-${r.run.slice(0, 8)}`,
    rules: c.rules,
    examples: c.examples,
    ...m,
    at: h.now,
    run: r.run,
  };
}
