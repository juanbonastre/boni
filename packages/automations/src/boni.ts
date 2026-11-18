/**
 * The category «Boni» (docs/automatizaciones.md §5.9 and §5.10, phase F16): Boni's triggers, the pieces of its own four
 * automations as step types, and «Acción de Boni» and «Lector de Boni», which carry what the catalogue has no step of
 * its own for (AU-127, AU-137, AU-220, AU-223). They are outside `CATALOGUE`, as the AI and people steps are, so the
 * add panel never offers them; validation lets them in only with `ValidationContext.boni`, which a run has when it has
 * `RunDeps.boni`. A piece, and the three triggers that exist only in Boni's own automations, validate only inside
 * their automation, which the server says from where the automation is stored and never from the document (A-19): a
 * copy loses them, and says so (`step.unknownType`). What they do is Boni's code behind the port: this package knows
 * their types, parameters and outputs, and imports no app (A-02). The specs themselves are in catalogue.ts.
 */
import type { Label, Labeled } from "@boni/entities";
import type { Cell, Row } from "./rows.ts";

/** The steps of this file, under one group of their own. Not in `CATEGORIES`: no panel offers them in F16. */
export const BONI_CATEGORY = "boni";

/** Boni's own automations (AU-127, AU-221), by a key of code: the server maps each to the flow it is today. */
export const BONI_AUTOMATIONS = ["fetchMail", "readMail", "reviewGuide", "budgetNotice"] as const;
export type BoniAutomation = (typeof BONI_AUTOMATIONS)[number];

/** Boni's triggers (AU-220) and the chat's (AU-137), by type. */
export const BONI_TRIGGERS = {
  /** «Llega un correo»: any automation; one row, the mail, labelled whole as from outside. */
  mail: "boni.mail",
  /** «Llega correo al buzón»: only «Traer correo». */
  mailbox: "boni.mailbox",
  /** «Cuando tus decisiones lo piden»: only «Revisar la guía». */
  decisions: "boni.decisions",
  /** «El gasto llega al aviso»: only «Aviso del presupuesto». */
  spending: "boni.spending",
  /** «Mensaje de chat»: a page's chat (AU-137). */
  chat: "boni.chat",
} as const;

/** The trigger types that exist only in one automation of Boni's, and which. */
export const BONI_TRIGGER_OWNER: Readonly<Record<string, BoniAutomation>> = {
  [BONI_TRIGGERS.mailbox]: "fetchMail",
  [BONI_TRIGGERS.decisions]: "reviewGuide",
  [BONI_TRIGGERS.spending]: "budgetNotice",
};

/** «Acción de Boni» (AU-127, AU-223): one action of Boni's list, chosen as a literal, with its arguments. */
export const BONI_ACTION_TYPE = "boni.action";
/** «Lector de Boni»: one of the readers of the plan language that has no step of its own, with its input. */
export const BONI_READER_TYPE = "boni.reader";
/** The readers «Lector de Boni» may name (AU-223): the others have a step of their own, or a piece. */
export const BONI_READERS = ["extract_tasks", "answer_about"] as const;

/** The parameters of the Boni steps, by key. */
export const BONI_PARAMS = {
  /** «Acción de Boni»: the action's name, a literal (AU-26). */
  action: "action",
  /** Every Boni step but a trigger: a list of `{ key, value }`, each value fixed or an expression. */
  args: "args",
  /** «Acción de Boni» and a piece: why it is done, as the plan said it; plain text of whoever wrote it, never the «Nota». */
  why: "why",
  /** «Lector de Boni»: the reader, a literal. */
  reader: "reader",
  /** «Lector de Boni»: what it reads. */
  input: "input",
  /** A reader piece: the model it uses (empty: the account's default). */
  model: "model",
  /** «Decisora»: the collections it chooses among, by key, written in the step (D-48, decision 20). */
  collections: "collections",
  /** The invitation's «Crear»: the collection it creates in. */
  collection: "collection",
  /** «Plegar hilo»: how many days back a thread's earlier proposals count. */
  days: "days",
  /** «Aceptar solas»: «Solo». */
  alone: "alone",
  /** «Medir releyendo»: how many decided mails it reads again. */
  mails: "mails",
  /** «Cuando tus decisiones lo piden»: every how many decisions. */
  every: "every",
  /** «Mensaje de chat»: the page, its welcome and its buttons (`{ label, text }`). */
  page: "page",
  welcome: "welcome",
  buttons: "buttons",
  /** «Se ejecuta» of every Boni step that is not a trigger: once with all the rows (the first is its row), or per row. */
  mode: "mode",
} as const;

/** What a piece lets change stays within these (AU-127); its own caps are in its code, never a parameter. */
export const BONI_LIMITS = {
  every: { min: 10, max: 500, born: 50 },
  days: { min: 1, max: 366, born: 60 },
  mails: { min: 1, max: 20, born: 20 },
  welcome: 400,
  buttons: 6,
  label: 40,
  text: 300,
  why: 2000,
} as const;

/**
 * The pieces (AU-127): one per piece of `PIECES` (apps/server/src/pieces.ts), and the readers and «Crear» of «Leer
 * correo» and «Revisar la guía», so what they propose is still the mail's. `old` is the tool or the reader the flow
 * of before called; `owner`, the only automation the piece validates in.
 */
export interface BoniPieceDef {
  type: string;
  old: string;
  owner: BoniAutomation;
  /** The parameters it lets change, by key: what catalogue.ts gives it. */
  params: readonly (keyof typeof BONI_PARAMS)[];
}
export const BONI_PIECES: readonly BoniPieceDef[] = [
  // «Traer correo»
  { type: "boni.mailSave", old: "mail.save", owner: "fetchMail", params: [] },
  // «Leer correo», in its order
  { type: "boni.mailRule", old: "mail.rule", owner: "readMail", params: [] },
  { type: "boni.mailKnown", old: "mail.known", owner: "readMail", params: [] },
  { type: "boni.mailInvitation", old: "mail.invitation", owner: "readMail", params: [] },
  { type: "boni.mailReader", old: "read_message", owner: "readMail", params: ["model"] },
  {
    type: "boni.mailDecider",
    old: "classify",
    owner: "readMail",
    params: ["model", "collections"],
  },
  { type: "boni.mailFiller", old: "fill", owner: "readMail", params: ["model"] },
  { type: "boni.mailRelations", old: "mail.relations", owner: "readMail", params: [] },
  { type: "boni.createChosen", old: "entities.create", owner: "readMail", params: [] },
  { type: "boni.create", old: "entities.create", owner: "readMail", params: ["collection"] },
  { type: "boni.fold", old: "inbox.fold", owner: "readMail", params: ["days"] },
  { type: "boni.acceptAlone", old: "inbox.accept_alone", owner: "readMail", params: ["alone"] },
  // «Revisar la guía»
  { type: "boni.guideDecisions", old: "guide.decisions", owner: "reviewGuide", params: [] },
  { type: "boni.guideReviewer", old: "review_reading", owner: "reviewGuide", params: ["model"] },
  { type: "boni.guideMeasure", old: "guide.measure", owner: "reviewGuide", params: ["mails"] },
  { type: "boni.guideSuggest", old: "guide.suggest", owner: "reviewGuide", params: [] },
];

const PIECE_BY_TYPE = new Map(BONI_PIECES.map((p) => [p.type, p]));
/** The piece of a type, or undefined. */
export const boniPiece = (type: string): BoniPieceDef | undefined => PIECE_BY_TYPE.get(type);

/** Every type of the category, triggers included. */
export const BONI_TYPES: readonly string[] = [
  ...Object.values(BONI_TRIGGERS),
  BONI_ACTION_TYPE,
  BONI_READER_TYPE,
  ...BONI_PIECES.map((p) => p.type),
];
const ALL = new Set(BONI_TYPES);
export const isBoniType = (type: string): boolean => ALL.has(type);
/** The Boni types that are triggers. */
export const isBoniTrigger = (type: string): boolean =>
  (Object.values(BONI_TRIGGERS) as string[]).includes(type);

/** The automation a type validates only in, or undefined for one any automation may have. */
export const boniOwner = (type: string): BoniAutomation | undefined =>
  boniPiece(type)?.owner ?? BONI_TRIGGER_OWNER[type];

/** The field of the row a Boni step that is not a trigger gives: what Boni's code answered. */
export const BONI_VALUE = "value";

// ---------------------------------------------------------------- the port

/** One unit of a Boni step, as the engine hands it to Boni's code. */
export interface BoniCall {
  /** The automation's id and the step's. */
  automation: string;
  step: string;
  type: string;
  /** What it names: a piece's tool or reader of before, the action of «Acción de Boni», the reader of «Lector de Boni». */
  name: string;
  /** Its parameters for this unit, resolved, each with its label: a piece's settings, a reader's `input`, `why`. */
  values: Record<string, Labeled<Cell>>;
  /** Each argument by its key, resolved, with its label. */
  args: Record<string, Labeled<Cell>>;
  /** The row it works on: the one it gets row by row, or the first of all when it runs once; null with none. */
  row: Row | null;
  /** «Probar»: Boni's code changes nothing and answers what it would do (A-19, D-43). */
  test: boolean;
}

/**
 * What Boni's code answered: one value and its label, which the step's row carries as `BONI_VALUE`, derived. The port
 * gives the label of what its code made the answer from, as the tool or the reader of before labelled it (a reader's
 * text is a model's, what came by mail is from outside); the engine joins it with every value and row it sent, so an
 * answer is never more trusted than what it was made from (AU-230), and the label the port gives can only lower it.
 */
export interface BoniAnswer {
  value: Cell;
  label: Label;
}

/**
 * How a Boni step reaches Boni's code (AU-127): the server's port, which runs today's code and asks `decide` for every
 * act with the background origin of its automation (P7: what it creates is proposed; P28 is not for it); a test's
 * scripted one. Without it the Boni steps do not run: validation refuses them (`step.unknownType`).
 */
export interface BoniPort {
  /**
   * Which of Boni's automations this run is, as the server knows it from where the automation is stored (its author),
   * never from the document: absent for every other automation, where no piece and no owned trigger validates.
   */
  readonly automation?: BoniAutomation;
  run(call: BoniCall): Promise<BoniAnswer>;
}
