/**
 * «Revisar instrucciones» (docs/automatizaciones.md §5.17, AU-211; phase F16): Boni's one reviewer of the steps that
 * read with a model, as one of its automations. Here, what needs no mail code: its drawing, and the change it suggests
 * to «Leer correo» while it waits for Juan — a notice in the Bandeja with «Ver el cambio», its before and after, that
 * his hand takes into the draft (every «Sí» lowered, `lowerYes`) or turns down. The review itself (what it learns
 * from, what is measured) is the mail's code (mail.ts `reviewNow`), run as the steps' pieces.
 *
 * A suggestion never touches a published version and never sets a «Sí»: taking it writes the draft, which Juan
 * publishes himself. Only a personal device takes it or turns it down (decision 13). One turned down is not suggested
 * again for a week, item by item. What it keeps is one setting of his store (D-02).
 */
import type { Trust } from "@boni/agent";
import {
  type Arrow,
  type Automation,
  BONI_LIMITS,
  BONI_PARAMS,
  BONI_TRIGGERS,
  FORMAT,
  lowerYes,
  MAIN,
  type ParamValue,
  type Step,
} from "@boni/automations";
import type { UserStore } from "@boni/store";
import { DAY, GUIDE_AREA, learningOn } from "../learning.ts";
import { boniEnabled } from "./boni.ts";
import { isError, keepDraft, open, publishedOf } from "./service.ts";

/** Its name as Boni draws it (decision 31: proposed; he can change it). */
export const REVIEW_NAME = "Revisar instrucciones";
/** A suggestion turned down: none of its items is suggested again for this long (as `TRIED_FOR`). */
export const PARKED_FOR = 7 * DAY;
/** The step types of «Leer correo» a suggestion changes: «Regla del remitente» and the «Lectora». */
export const RULE_TYPE = "boni.mailRule";
export const READER_TYPE = "boni.mailReader";

/** «Revisar instrucciones» drawn by hand (AU-211): five steps, each what its panel says. */
export function drawReview(o: { id: string; every: number; mails: number }): Automation {
  const step = (id: string, name: string, type: string, params: Step["params"]): Step => ({
    id,
    name,
    type,
    params,
  });
  const value = (name: string, path = ""): ParamValue => ({
    expr: `{{ $('${name}').first().value${path} }}`,
  });
  const steps: Step[] = [
    step("trigger", "Cuando tus decisiones lo piden", BONI_TRIGGERS.decisions, {
      [BONI_PARAMS.every]: o.every,
    }),
    step("p-decisions", "Tus decisiones", "boni.guideDecisions", {}),
    step("p-reviewer", "Revisora", "boni.guideReviewer", {
      [BONI_PARAMS.model]: "",
      [BONI_PARAMS.args]: [
        { key: "input", value: value("Tus decisiones", ".lines") },
        { key: "options", value: value("Tus decisiones", ".options") },
      ],
    }),
    step("p-measure", "Medir repitiendo", "boni.guideMeasure", {
      [BONI_PARAMS.mails]: o.mails,
      [BONI_PARAMS.args]: [{ key: "reading", value: value("Revisora") }],
    }),
    step("p-suggest", "Sugerencia", "boni.guideSuggest", {}),
  ];
  const arrow = (from: string, to: string): Arrow => ({
    from: { step: from, output: MAIN },
    to: { step: to, input: MAIN },
  });
  return {
    format: FORMAT,
    id: o.id,
    version: 0,
    name: REVIEW_NAME,
    steps,
    arrows: [
      arrow("trigger", "p-decisions"),
      arrow("p-decisions", "p-reviewer"),
      arrow("p-reviewer", "p-measure"),
      arrow("p-measure", "p-suggest"),
    ],
    // Measuring repeats up to 20 cases twice, each a reading of its own: more than the default minute.
    settings: { limits: { ms: 300_000 } },
  };
}

/** A row of «Regla del remitente» as its table holds it, the collection by key. */
export interface SuggestedRule {
  sender: string;
  do: "skip" | "collection";
  collection: string | null;
}
/** An example for the «Lectora»'s «Ejemplos»: the mail cited (someone else's text) and what it should give. */
export interface SuggestedExample {
  /** `x-<mail id>`: what a «No» parks. */
  id: string;
  subject: string;
  mail: string;
  /** As the panel holds it: the JSON of what he accepted from that mail. */
  want: string;
}
/** What waits for Juan: the change, measured, of one automation's draft. */
export interface InstructionsSuggestion {
  id: string;
  /** The automation it changes («Leer correo»). */
  automation: string;
  rules: SuggestedRule[];
  examples: SuggestedExample[];
  /** How many of his decisions measured get it right now, with the change, and of how many. */
  before: number;
  after: number;
  total: number;
  at: number;
  run: string | null;
}
interface ReviewState {
  pending: InstructionsSuggestion | null;
  /** What a «No» turned down, by rule (its sender) and example id, with when. */
  parked: Record<string, number>;
}
const STATE = "automations/review";

function stateOf(store: UserStore): ReviewState {
  try {
    const v = JSON.parse(store.setting(STATE) ?? "null") as Partial<ReviewState> | null;
    return {
      pending: v?.pending ?? null,
      parked: v?.parked && typeof v.parked === "object" ? v.parked : {},
    };
  } catch {
    return { pending: null, parked: {} };
  }
}
const saveState = (store: UserStore, s: ReviewState) => store.setSetting(STATE, JSON.stringify(s));

/** The suggestion that waits, or null. */
export const pendingSuggestion = (store: UserStore): InstructionsSuggestion | null =>
  stateOf(store).pending;

/** What a «No» parked and is not suggested yet (rules by sender, examples by id). */
export function parkedItems(store: UserStore, now: number): Set<string> {
  return new Set(
    Object.entries(stateOf(store).parked)
      .filter(([, at]) => now - at < PARKED_FOR)
      .map(([k]) => k),
  );
}
/** A rule's item, as the review excludes it: its sender (mail.ts `excluded`, as a rule refused before). */
export const ruleItem = (sender: string) => sender.trim().toLowerCase();

/** A review's suggestion kept to wait for him (the mail's code made and measured it). */
export function keepSuggestion(store: UserStore, s: InstructionsSuggestion): void {
  const state = stateOf(store);
  saveState(store, { ...state, pending: s });
}

/** The document a suggestion changes: the draft, which is what he publishes. */
function baseOf(store: UserStore, automation: string): Automation | null {
  return open(store, automation)?.automation ?? publishedOf(store, automation)?.automation ?? null;
}

/**
 * The document with the suggestion added: its rules at the end of the table, its examples after his, within what the
 * panels hold (`BONI_LIMITS`): what does not fit is left out, so the draft stays one he can publish.
 */
export function withSuggestion(doc: Automation, s: InstructionsSuggestion): Automation {
  const steps = doc.steps.map((step) => {
    if (step.type === RULE_TYPE && step.id === firstOf(doc, RULE_TYPE)) {
      const rows = rowsOf(step.params[BONI_PARAMS.rules]);
      const have = new Set(rows.map((r) => ruleItem(String(r.sender ?? ""))));
      const added = s.rules
        .filter((r) => !have.has(ruleItem(r.sender)))
        .slice(0, Math.max(0, BONI_LIMITS.rules - rows.length))
        .map((r) => ({
          sender: r.sender,
          do: r.do,
          ...(r.do === "collection" && r.collection ? { collection: r.collection } : {}),
        }));
      return added.length
        ? { ...step, params: { ...step.params, [BONI_PARAMS.rules]: [...rows, ...added] } }
        : step;
    }
    if (step.type === READER_TYPE && step.id === firstOf(doc, READER_TYPE)) {
      const rows = rowsOf(step.params[BONI_PARAMS.examples]);
      const have = new Set(rows.map((r) => String(r.mail ?? "")));
      const added = s.examples
        .filter((e) => !have.has(e.mail))
        .slice(0, Math.max(0, BONI_LIMITS.examples - rows.length))
        .map((e) => ({ mail: e.mail, want: e.want }));
      return added.length
        ? { ...step, params: { ...step.params, [BONI_PARAMS.examples]: [...rows, ...added] } }
        : step;
    }
    return step;
  });
  return steps.every((x, i) => x === doc.steps[i]) ? doc : { ...doc, steps };
}
const firstOf = (doc: Automation, type: string) => doc.steps.find((x) => x.type === type)?.id;
const rowsOf = (v: unknown): Record<string, ParamValue>[] =>
  Array.isArray(v)
    ? v.filter((x): x is Record<string, ParamValue> => !!x && typeof x === "object")
    : [];

/** «Aceptar» or «No» from the Bandeja (AU-211): only a personal device; nothing, or another one, waits. */
export type InstructionsRefusal = { refused: "not-personal" } | { refused: "nothing" };

/**
 * «Aceptar» in «Ver el cambio»: the change goes into the automation's draft, every «Sí» lowered against the draft
 * it is written over (`lowerYes`: his own stay, none is added), and waits there for him to publish. The suggestion's
 * decision is judged right.
 */
export function takeInstructions(
  store: UserStore,
  id: string,
  hand: { trust: Trust; device: string; now: number },
): InstructionsRefusal | { automation: string } {
  if (hand.trust !== "personal") return { refused: "not-personal" };
  const state = stateOf(store);
  const s = state.pending;
  if (!s || s.id !== id) return { refused: "nothing" };
  const base = baseOf(store, s.automation);
  if (!base) return { refused: "nothing" };
  const next = lowerYes(withSuggestion(base, s), base);
  const kept = keepDraft(store, s.automation, next, hand);
  if (isError(kept)) return { refused: "nothing" };
  judge(store, s, "right", hand.now);
  saveState(store, { ...state, pending: null });
  return { automation: s.automation };
}

/** «No»: nothing changes; its items are not suggested again for a week, and its decision is judged wrong. */
export function dropInstructions(
  store: UserStore,
  id: string,
  hand: { trust: Trust; now: number },
): InstructionsRefusal | null {
  if (hand.trust !== "personal") return { refused: "not-personal" };
  const state = stateOf(store);
  const s = state.pending;
  if (!s || s.id !== id) return { refused: "nothing" };
  const parked = Object.fromEntries(
    Object.entries(state.parked).filter(([, at]) => hand.now - at < PARKED_FOR),
  );
  for (const r of s.rules) parked[ruleItem(r.sender)] = hand.now;
  for (const e of s.examples) parked[e.id] = hand.now;
  judge(store, s, "wrong", hand.now);
  saveState(store, { pending: null, parked });
  return null;
}

/** A suggestion is a decision of docs/fiabilidad.md (class B, asked): his answer judges it. */
function judge(store: UserStore, s: InstructionsSuggestion, result: "right" | "wrong", at: number) {
  const d = store.journal
    .decisions(GUIDE_AREA, 50)
    .find((x) => !x.result && (x.detail as { suggestion?: string } | null)?.suggestion === s.id);
  if (d) store.journal.setDecisionResult(d.id, result, at);
}

/** A row of a rule as the notice says it: the collection by its name now (his text). */
export interface RuleView {
  sender: string;
  do: "skip" | "collection";
  collection: string | null;
}
/** An example as the notice says it: the mail's subject (someone else's text) and the titles he kept. */
export interface ExampleView {
  subject: string;
  want: string[];
}
/**
 * The suggestion waiting in the Bandeja (AU-211), as «Ver el cambio» shows it: the draft's rules and examples before,
 * and what the change adds. The app words it; every text is his or someone else's, painted as plain text.
 */
export interface InstructionsNotice {
  kind: "instructions";
  id: string;
  automation: string;
  name: string;
  rules: { before: RuleView[]; added: RuleView[] };
  examples: { before: ExampleView[]; added: ExampleView[] };
  before: number;
  after: number;
  total: number;
  at: number;
}

/**
 * The suggestion that waits, or none: with «Aprender» off, or «Revisar instrucciones» off, nothing is listed (it is
 * kept, and comes back with them).
 */
export function instructionsNotices(store: UserStore, reviewer: string): InstructionsNotice[] {
  const s = stateOf(store).pending;
  if (!s || !learningOn(store) || !boniEnabled(store, reviewer)) return [];
  const base = baseOf(store, s.automation);
  if (!base) return [];
  const types = Object.values(store.schema().types);
  const nameOf = (key: string | null) =>
    key === null ? null : (types.find((t) => t.key === key)?.name ?? key);
  const ruleView = (r: Record<string, ParamValue> | SuggestedRule): RuleView => ({
    sender: String(r.sender ?? ""),
    do: r.do === "collection" ? "collection" : "skip",
    collection: r.do === "collection" ? nameOf(String(r.collection ?? "")) : null,
  });
  const after = withSuggestion(base, s);
  const stepOf = (doc: Automation, type: string) => doc.steps.find((x) => x.type === type);
  const rulesBefore = rowsOf(stepOf(base, RULE_TYPE)?.params[BONI_PARAMS.rules]);
  const rulesAfter = rowsOf(stepOf(after, RULE_TYPE)?.params[BONI_PARAMS.rules]);
  const examplesBefore = rowsOf(stepOf(base, READER_TYPE)?.params[BONI_PARAMS.examples]);
  const examplesAfter = rowsOf(stepOf(after, READER_TYPE)?.params[BONI_PARAMS.examples]);
  const subjectOf = (mail: string) =>
    s.examples.find((e) => e.mail === mail)?.subject ?? subjectLine(mail);
  const exampleView = (r: Record<string, ParamValue>): ExampleView => ({
    subject: subjectOf(String(r.mail ?? "")),
    want: titlesOf(r.want),
  });
  return [
    {
      kind: "instructions",
      id: s.id,
      automation: s.automation,
      name: base.name,
      rules: {
        before: rulesBefore.map(ruleView),
        added: rulesAfter.slice(rulesBefore.length).map(ruleView),
      },
      examples: {
        before: examplesBefore.map(exampleView),
        added: examplesAfter.slice(examplesBefore.length).map(exampleView),
      },
      before: s.before,
      after: s.after,
      total: s.total,
      at: s.at,
    },
  ];
}

/** The «Asunto:» line of a mail as the reader read it (mailReview.ts `mailText`), for an example he wrote. */
function subjectLine(mail: string): string {
  const line = mail.split("\n").find((l) => l.startsWith("Asunto: "));
  return line ? line.slice("Asunto: ".length).slice(0, 200) : "";
}
/** The titles an example's answer keeps (its JSON, as the panel holds it); none when it does not read. */
function titlesOf(want: unknown): string[] {
  try {
    const v = typeof want === "string" ? JSON.parse(want) : want;
    return Array.isArray(v)
      ? v
          .map((x) => (x && typeof x === "object" ? (x as { title?: unknown }).title : null))
          .filter((t): t is string => typeof t === "string")
          .slice(0, 20)
      : [];
  } catch {
    return [];
  }
}
