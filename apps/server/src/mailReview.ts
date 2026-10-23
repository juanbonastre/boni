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
}

const MIN_DECISIONS = 10;
const MAX_DECISIONS = 60;
/** Mail read again to measure, with each guide. */
const MEASURE = 20;

/** The mail whose plan made a proposal (its first step reads it). */
export function mailOfRun(store: UserStore, run: string): string | null {
  const plan = store.journal.run(run)?.plan as
    | { steps?: { tool?: string; args?: { id?: { lit?: unknown } } }[] }
    | undefined;
  const first = plan?.steps?.[0];
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
}

/** One review: a suggestion that gets more of Juan's decisions right, or null. */
export async function review(h: ReviewHost): Promise<Suggestion | null> {
  const { ds } = h;
  if (ds.length < MIN_DECISIONS || !h.targets.length) return null;
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
  // Their text quotes other people's mail: external, like the mail itself.
  const input = leaf(
    lines.join("\n"),
    label("external", "personal", [{ kind: "mail", id: "review" }]),
  );
  const r = await h.agent.background(
    {
      version: 1,
      steps: [
        {
          id: "r",
          op: "read",
          reader: "review_reading",
          input: { ref: "$decisions" },
          params: { options: { fn: "list", args: h.targets.map((t) => ({ lit: t.name })) } },
        },
      ],
    },
    { decisions: input },
    ["r"],
  );
  const out = r.kept?.r as
    | { rules: { from: string; action: string; collection: string | null }[]; examples: string[] }
    | undefined;
  if (!out) return null;
  const rules = out.rules
    .map((x) => checkRule(x, ds, h.targets, h.guide, h.excluded))
    .filter((x): x is MailRule => !!x);
  const have = new Set(h.guide.examples.map((e) => e.id));
  const mails = [...new Set(out.examples.map((id) => ds.find((d) => d.id === id)?.mail))].filter(
    (m): m is string => !!m,
  );
  const examples = mails
    .map((m) => exampleOf(h.store, m, ds))
    .filter((e): e is GuideExample => !!e && !have.has(e.id) && !h.excluded.has(e.id));
  if (!rules.length && !examples.length) return null;
  const candidate: MailGuide = {
    ...h.guide,
    rules: [...h.guide.rules, ...rules],
    examples: [...h.guide.examples, ...examples].slice(-10),
  };
  // Measured on the latest decided mail, never on the mail the examples come from.
  const shown = new Set(examples.map((e) => e.id.slice(2)));
  const measured = [...new Set(ds.map((d) => d.mail).reverse())]
    .filter((m) => !shown.has(m))
    .slice(0, MEASURE);
  const on = ds.filter((d) => measured.includes(d.mail));
  const produce = async (g: MailGuide) => {
    const p = new Map<string, string[]>();
    for (const m of measured) p.set(m, (await h.read(m, g)) ?? []);
    return p;
  };
  const before = score(on, await produce(h.guide));
  const after = score(on, await produce(candidate));
  if (after <= before) return null;
  return {
    id: `g-${h.now}`,
    rules,
    examples,
    before,
    after,
    total: on.length,
    at: h.now,
  };
}
