// The steps that talk to Juan (docs/automatizaciones.md §5.6, AU-125, AU-201, AU-202, AU-203, F15 E4): «Preguntar»
// asks him and the run waits for his answer, «Avisar» sends him a notice, «Responder» sets the run's answer. Their
// parameters, their limits, what a waiting run keeps of a question, and the port the engine tells through.
//
// None of them has a recipient (P2, P14): a notice and a question go to Juan, on his own devices, and «Dónde» is a
// closed list fixed in the step as saved, never an expression, so nothing from outside and no model chooses to whom.
// What they say is the step's own text, or the code's words for what the code counts («y 12 más»), and it travels as
// plain text: nothing here is HTML, Markdown or a link.
import type { Label } from "@boni/entities";
import { StepFault } from "./failures.ts";
import type { Cell } from "./rows.ts";

// ---------------------------------------------------------------- the steps

/** Their types, reachable like the AI steps only with their port (`ValidationContext.people`, `RunDeps.people`). */
export const ASK_TYPE = "ask";
export const NOTIFY_TYPE = "notify";
export const REPLY_TYPE = "reply";
export const PEOPLE_TYPES = [ASK_TYPE, NOTIFY_TYPE, REPLY_TYPE] as const;
export const isPeopleType = (type: string): boolean =>
  (PEOPLE_TYPES as readonly string[]).includes(type);

/**
 * «Preguntar»'s parameters by key (catalogue.ts paints them): the three of AU-125; behind «Añadir opción» «Una vez por
 * fila» and «Solo desde un dispositivo personal» (`personal`, decision 26 of §10: off when born, any device signed in
 * to the account answers).
 */
export const ASK_PARAMS = {
  question: "question",
  answer: "answer",
  options: "options",
  waitDays: "waitDays",
  mode: "mode",
  personal: "personal",
} as const;
/** «Respuesta» (AU-125): the controls the Bandeja already has (`FLOW_ASKS`: a choice or a text). */
export const ASK_ANSWERS = ["yesNo", "one", "several", "text"] as const;
export type AskAnswer = (typeof ASK_ANSWERS)[number];
/** «Se ejecuta»: once with all the rows (born), or «Una vez por fila». */
export const PEOPLE_MODES = ["all", "perRow"] as const;
/** The output a question leaves by when its wait limit passes or it gets no answer (AU-125). */
export const NO_ANSWER = "noAnswer";
/** The field a row gains with the answer (AU-125). */
export const ANSWER_FIELD = "respuesta";

/**
 * «Preguntar»'s limits (AU-125, AU-203): 20 questions per run, 20 runs of an automation waiting at once, a wait of 1
 * to 30 days (born 1: a day is 24 hours of instants, not of the wall clock), and 2 MB of what a waiting run keeps
 * (reasoned, not measured).
 */
export const ASK_LIMITS = {
  questions: 20,
  waiting: 20,
  waitDays: { born: 1, max: 30 },
  keptBytes: 2 * 1024 * 1024,
} as const;
export const DAY_MS = 86_400_000;

/** «Avisar»'s parameters (AU-201): **Texto**, and behind «Añadir opción» «Una vez por fila» and «Dónde». */
export const NOTIFY_PARAMS = { text: "text", mode: "mode", where: "where" } as const;
/**
 * «Dónde» (AU-201, decision 17 of §10): Juan's own devices, never one named. `all` (born) is the desktop app and the
 * phone; `desktop` only the app; `phone` only the phone.
 */
export const NOTIFY_WHERE = ["all", "desktop", "phone"] as const;
export type NotifyWhere = (typeof NOTIFY_WHERE)[number];
/** «Avisar»'s limits (AU-201): 5 notices per step and run, then one that groups the rest; 300 characters each. */
export const NOTIFY_LIMITS = { notices: 5, chars: 300 } as const;

/** «Responder»'s parameter (AU-202): **Respuesta**. */
export const REPLY_PARAMS = { text: "text" } as const;
/** What the run's line shows of its answer (AU-202): its first 200 characters. The answer itself is kept whole. */
export const REPLY_LINE = 200;

// ---------------------------------------------------------------- what a run keeps

/** One option of a question, with the label of where it came from: the automation's, or its expression's. */
export interface AskOption {
  value: string;
  label: Label;
}

/**
 * One question of a «Preguntar» (AU-125): its text as plain text, with the label of what it cites, and for «Una
 * opción» and «Varias opciones» its options (an expression may give each row its own).
 */
export interface AskQuestion {
  text: string;
  label: Label;
  options?: AskOption[];
}

/**
 * What a «Preguntar» keeps while its run waits (AU-203): the questions it made (one, or one per row), what kind of
 * answer each takes, its options, and until when it waits. Its rows are not here: they are the outputs of the steps
 * before it, kept in the run.
 */
export interface AskRecord {
  answer: AskAnswer;
  /** `all`: one question with every row. `perRow`: one per row, in the order they arrived. */
  mode: (typeof PEOPLE_MODES)[number];
  questions: AskQuestion[];
  /** Epoch ms: past it, the question has no answer (AU-203). */
  until: number;
  /**
   * «Solo desde un dispositivo personal» was on in the step as it ran (decision 26 of §10): only a personal device
   * answers its cards. Absent, any device signed in to the account does.
   */
  personal?: true;
  /** How it ended, once it did: answered, or left by «sin respuesta». Absent while it waits. */
  ended?: "answered" | "noAnswer";
}

/**
 * An answer as the one who answers gives it (AU-203): a tap on a device signed in to the account (decision 26 of §10).
 * `by` is the label of that hand, which the server gives by the device's trust; an answer he writes carries it, and
 * one he chooses carries the option's (AU-125). Null: that question had no answer, and its row leaves by «sin
 * respuesta».
 */
export interface GivenAnswer {
  value: Cell;
  by: Label;
}

/** What the run counted before it waited, carried across the wait (AU-203): only its running time adds up. */
export interface RunCounts {
  ran: number;
  written: number;
  models: number;
  /** «Como mucho» (AU-196), by `${step}\0${collection}\0${action}`. */
  actionRows: Record<string, number>;
}

/** The run's answer (AU-202): the text of the last «Responder» that ran, whole and plain, with its label. */
export interface RunReply {
  step: string;
  text: string;
  label: Label;
}

/** A notice «Avisar» sends, or in a test would send (AU-201). The server says which run it opens. */
export interface Notice {
  automation: string;
  step: string;
  /** The step's text, plain, cut to `NOTIFY_LIMITS.chars`. Empty in the notice that groups the rest. */
  text: string;
  label: Label;
  where: NotifyWhere;
  /** The notice that groups the rest: how many more there were («y 12 más»: the app's words). */
  more?: number;
}

/** What an «Avisar» did in its run: each notice, sent or (in a test) what it would send. */
export interface NoticeRecord {
  notices: Notice[];
  sent: boolean;
}

// ---------------------------------------------------------------- the port

/**
 * How the steps that talk to Juan reach him (S2: the server's `notify` and its Bandeja; a test's recorder). Without
 * one, «Preguntar», «Avisar» and «Responder» do not run: validation refuses them (`step.unknownType`).
 */
export interface PeoplePort {
  /** Sends a notice to Juan's own devices that `where` says. Never called in a test. */
  notify(notice: Notice): Promise<void>;
  /** How many runs of this automation wait for an answer now, this one not counted (AU-203). */
  waiting(automation: string): number | Promise<number>;
}

// ---------------------------------------------------------------- failures

/** Why one of these steps failed, while `failure.code` is `other` (as `AiFailure` for an AI step). */
export const PEOPLE_FAILURES = [
  /** «Una vez por fila» with more questions than `ASK_LIMITS.questions`. `detail.got`, `detail.max`. */
  "ask.questions",
  /** The automation already has `ASK_LIMITS.waiting` runs waiting. `detail.max`. */
  "ask.waiting",
  /** What the run would keep to wait passes `ASK_LIMITS.keptBytes`. `detail.max`. */
  "ask.kept",
  /** The options are not a list of texts, or none: `param` is `options`. */
  "ask.options",
  /** No port: the step cannot reach Juan. */
  "people.unavailable",
] as const;
export type PeopleFailureCode = (typeof PEOPLE_FAILURES)[number];
export interface PeopleFailure {
  code: PeopleFailureCode;
  param?: string;
  detail?: Record<string, string | number>;
}

/** A failure of one of these steps: a `StepFault` with code `other`, and `people` saying which. */
export class PeopleFault extends StepFault {
  readonly people: PeopleFailure;
  constructor(message: string, people: PeopleFailure) {
    super(message, { code: "other", ...(people.param ? { param: people.param } : {}) });
    this.name = "PeopleFault";
    this.people = people;
  }
}

/** A value as text, the way a question, a notice or an answer says it: plain, never markup. */
export const asPlainText = (v: Cell): string =>
  v === null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);

/** At most `n` characters, by code points (a cut never splits one). */
export function cut(text: string, n: number): string {
  const points = Array.from(text);
  return points.length <= n ? text : points.slice(0, n).join("");
}

/**
 * Whether an answer fits the question (AU-125): «Sí o no» a boolean, «Una opción» one of the options, «Varias
 * opciones» distinct options (at least one), «Texto» a text. Anything else is refused before the run goes on.
 */
export function answerFits(question: AskQuestion, kind: AskAnswer, value: Cell): boolean {
  const offered = new Set((question.options ?? []).map((o) => o.value));
  switch (kind) {
    case "yesNo":
      return typeof value === "boolean";
    case "one":
      return typeof value === "string" && offered.has(value);
    case "several":
      return (
        Array.isArray(value) &&
        value.length > 0 &&
        new Set(value).size === value.length &&
        value.every((v) => typeof v === "string" && offered.has(v))
      );
    case "text":
      return typeof value === "string";
  }
}
