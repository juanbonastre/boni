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
  /** «Plegar hilo»: how many days back a thread's earlier proposals count. */
  days: "days",
  /** «Regla del remitente»: its table, one row per sender (`{ sender, do, collection }`, AU-249). */
  rules: "rules",
  /** «Lectora»: «Busca», what kinds of thing it looks for (`BONI_MODULES`). */
  modules: "modules",
  /** «Lectora»: «Indicaciones», his text for the reader, fixed in the step. */
  instructions: "instructions",
  /** «Lectora»: «Ejemplos», behind «Añadir opción»: `{ mail, want }`, a mail cited and what it should give. */
  examples: "examples",
  /** «Crear en la elegida»: «Solo conocidos», behind «Añadir opción»: it only narrows a «Sí» (AU-250). */
  onlyKnown: "onlyKnown",
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
  /** «Regla del remitente»: rows of its table; a sender's address. */
  rules: 500,
  sender: 320,
  /** «Indicaciones»: as the guide's instructions were (`docs/correo.md` §4.1). */
  instructions: 4000,
  /** «Ejemplos»: how many, and each mail's and answer's length. */
  examples: 20,
  example: 4000,
  welcome: 400,
  buttons: 6,
  label: 40,
  text: 300,
  why: 2000,
} as const;

/** What «Regla del remitente» does with a sender (AU-249): not read, or always to one collection. */
export const RULE_DOES = ["skip", "collection"] as const;
/** «Busca» of the «Lectora»: the kinds of thing it looks for (packages/agent `MODULES` ids). */
export const BONI_MODULES = ["tasks", "events"] as const;
/** Where his address is among a mail's recipients: a closed list the code works out (AU-255). */
export const BONI_USER_IN = ["to", "cc", "group"] as const;
/** The output a «Decisora» sends a row it doubts about by (AU-252): the row and its options. */
export const BONI_DOUBT = "doubt";

/** The readers a piece may call, through the port of the models (AU-249, AU-255). */
export const PIECE_READERS = ["read_message", "decide", "fill"] as const;
export type PieceReader = (typeof PIECE_READERS)[number];

/**
 * The pieces (AU-127, AU-249): «Traer correo»'s «Guardar en Correos», the ten steps of «Leer correo» that are Boni's
 * (§5.17: «Preguntar» is the catalogue's), and «Revisar la guía»'s four. `old` is the tool or the reader the flow of
 * before called; `owner`, the only automation the piece validates in. `params` are in sight, `options` behind «Añadir
 * opción»; `reads`, the reader its code calls through `RunDeps.ai` (never a plan of the old engine); `outputs`, its
 * ways out when it has more than one; `writes`: it creates through its cells (AU-250), as a «Colección» step does.
 */
export interface BoniPieceDef {
  type: string;
  old: string;
  owner: BoniAutomation;
  params: readonly (keyof typeof BONI_PARAMS)[];
  options?: readonly (keyof typeof BONI_PARAMS)[];
  reads?: PieceReader;
  outputs?: readonly string[];
  writes?: true;
}
export const BONI_PIECES: readonly BoniPieceDef[] = [
  // «Traer correo»
  { type: "boni.mailSave", old: "mail.save", owner: "fetchMail", params: [] },
  // «Leer correo», in its order (§5.17)
  { type: "boni.mailRule", old: "mail.rule", owner: "readMail", params: ["rules"] },
  { type: "boni.mailInvitation", old: "mail.invitation", owner: "readMail", params: [] },
  {
    type: "boni.mailReader",
    old: "read_message",
    owner: "readMail",
    params: ["modules", "instructions", "model"],
    options: ["examples"],
    reads: "read_message",
  },
  { type: "boni.fold", old: "inbox.fold", owner: "readMail", params: ["days"] },
  {
    type: "boni.mailDecider",
    old: "classify",
    owner: "readMail",
    params: ["collections", "model"],
    reads: "decide",
    outputs: ["main", BONI_DOUBT],
  },
  { type: "boni.mailFiller", old: "fill", owner: "readMail", params: ["model"], reads: "fill" },
  { type: "boni.mailRelations", old: "mail.relations", owner: "readMail", params: [] },
  {
    type: "boni.createChosen",
    old: "entities.create",
    owner: "readMail",
    params: [],
    options: ["onlyKnown"],
    writes: true,
  },
  // «Revisar la guía»
  { type: "boni.guideDecisions", old: "guide.decisions", owner: "reviewGuide", params: [] },
  { type: "boni.guideReviewer", old: "review_reading", owner: "reviewGuide", params: ["model"] },
  { type: "boni.guideMeasure", old: "guide.measure", owner: "reviewGuide", params: ["mails"] },
  { type: "boni.guideSuggest", old: "guide.suggest", owner: "reviewGuide", params: [] },
];
/** «Crear en la elegida» (AU-250). */
export const CREATE_CHOSEN = "boni.createChosen";
/**
 * The fields of a row «Crear en la elegida» creates from: the collection's key (one of its cells) and the values by
 * field id. Boni's code («Rellenadora») writes them; the engine reads them and asks its cell.
 */
export const CHOSEN = { collection: "collection", values: "values" } as const;

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

/**
 * What a piece's code asks its reader to read (AU-255), through the engine: `texts` is what it reads, each with its
 * label, which the port puts between markers (the step's row, and for the «Lectora» its «Ejemplos» and what that
 * sender has waiting). Outside the markers it gets only its panel, which the engine resolves from the step itself
 * («Busca», «Indicaciones», «Modelo»), and the closed lists its code computed: the «Decisora»'s options, the
 * «Rellenadora»'s fields (from the collection's definition), where he is among the recipients. Nothing else of his.
 */
export interface PieceRead {
  texts: Labeled<string>[];
  /** The «Decisora»'s options: collections by key, each one of its panel's «Colecciones». */
  options?: string[];
  /**
   * The «Rellenadora»'s collection, by key: the port reads its fields from the collection's definition (plain data,
   * no value of his).
   */
  collection?: string;
  userIn?: (typeof BONI_USER_IN)[number];
  /** The second call of AU-59, after an answer its code refused: the rule it broke, a key. */
  again?: { fault: string };
}

/** What the reader gave: its answer, with the label of everything it read (from outside in, from outside out). */
export type PieceReply = { answer: unknown; label: Label } | { refused: string };

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
  /**
   * How the run started (AU-195, AU-253): `user` when his hand started it («Proponer tarea», «Otra vez», a run by
   * hand), so «Regla del remitente» does not skip it; `schedule` when Boni's code did, for a mail that arrived.
   */
  startedBy: "user" | "schedule";
  /**
   * A piece that reads (`BoniPieceDef.reads`): its one way to a model, through `RunDeps.ai` (AU-249, AU-255). The
   * engine counts each call first (AU-206), refuses a value no model may receive or one of his outside the panel
   * (`ai.private`), and labels the answer with all it read; it never lowers a label.
   */
  read?(r: PieceRead): Promise<PieceReply>;
}

/**
 * What Boni's code answered. `value`: one value and its label, which the step's row carries as `BONI_VALUE`, derived.
 * `rows`: a piece's rows (AU-249), each by its way out (`main` when absent; the «Decisora»'s `BONI_DOUBT`), none to
 * drop the row. The port gives the label of what its code made the answer from, as the tool or the reader of before
 * labelled it (a reader's text is a model's, what came by mail is from outside); the engine joins it with every value
 * and row it sent, so an answer is never more trusted than what it was made from (AU-230), and the label the port
 * gives can only lower it.
 */
export type BoniAnswer =
  | { value: Cell; label: Label }
  | { rows: { output?: string; json: Record<string, Cell> }[]; label: Label };

/**
 * How a Boni step reaches Boni's code (AU-127): the server's port, which runs Boni's code over the row and asks
 * `decide` for every act; a test's scripted one. Without it the Boni steps do not run: validation refuses them
 * (`step.unknownType`).
 */
export interface BoniPort {
  /**
   * Which of Boni's automations this run is, as the server knows it from where the automation is stored (its author),
   * never from the document: absent for every other automation, where no piece and no owned trigger validates.
   */
  readonly automation?: BoniAutomation;
  run(call: BoniCall): Promise<BoniAnswer>;
  /**
   * «Solo conocidos» (AU-250): whether the sender of the mail a row came from is known for `collection`, from his own
   * decisions (`wouldAccept`), never from the mail or a model. Absent: nobody is known, and a «Sí» it narrows asks.
   */
  known?(row: Row, collection: string): Promise<boolean>;
}
