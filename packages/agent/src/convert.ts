/**
 * The translator from the plan language to an automation (docs/automatizaciones.md AU-143, AU-223, AU-224, phase F16):
 * `planToAutomation`, one pure function with three uses (the conversion of each saved flow's versions, a turn's plan,
 * «Guardar como automatización»). It reads a plan and its trigger, and writes the document of an automation of
 * @boni/automations: the same steps in a line, in their order, each joined to the one before. It never runs anything,
 * never reads a store and never calls a model: the same input gives the same document, byte for byte.
 *
 * Everything the language can say has its row in `TRANSLATION`: the step it becomes or, when it has none here, the
 * reason, from a closed list. Nothing is dropped: what has no step is in `untranslated`, by step and by what, and a
 * conversion with anything there is not `complete`. Where the new step behaves differently, `changes` says it, from
 * the closed list of AU-224.
 *
 * The floor (AU-230, decision 13): a step that writes is born «Preguntar» (`permission: "ask"`), and the document
 * goes through `lowerYes` before it is returned, so no path from a plan, a model, a package or a conversion reaches a
 * «Sí». What came from outside keeps its label: a reference becomes a simple citation whenever it can, which carries
 * the exact label of what it cites (AU-162), and JavaScript only where a function is needed, which the engine labels
 * with the worst of what it sent (AU-169). The plan is checked before it is translated, as today (`validatePlan`,
 * `checkPlan`, A-01): this function trusts no field of it and gives a row of `untranslated` for any shape it does not
 * know.
 *
 * How a step that ran once keeps running once (AU-223): the plan's interpreter ran each step once whatever the one
 * before gave. A step that works row by row and has no effect is not called with no rows (AU-14), so every step but
 * the first hangs from a «Juntar en una» whenever what precedes it may give other than one row: that step always
 * gives one row. «Seguir sin filas» is on everywhere but on the «Si» and the «Separar una lista» of a `when` and an
 * `each`, whose empty outputs must stop the guarded step; what follows hangs from their other way too.
 */
import {
  ACTION,
  ANSWER_FIELD,
  type Arrow,
  ASK_LIMITS,
  ASK_TYPE,
  type Automation,
  type Step as AutoStep,
  BONI_ACTION_TYPE,
  BONI_LIMITS,
  BONI_PARAMS,
  BONI_PIECES,
  BONI_READER_TYPE,
  BONI_READERS,
  BONI_TRIGGERS,
  BONI_VALUE,
  type BoniAutomation,
  type BoniPieceDef,
  type ConditionRule,
  FORMAT,
  lowerYes,
  MAIN,
  NOTIFY_TYPE,
  OUT,
  type ParamValue,
  READER_TYPES,
  REPLY_TYPE,
  resultName,
  type StepSettings,
} from "@boni/automations";
import { type AgentStep, chatTrigger } from "./chat.ts";
import {
  ASK_CONTROLS,
  type Expr,
  FNS,
  type Plan,
  READERS,
  REPLY_COMPONENTS,
  type Step,
} from "./plan.ts";
import { manualInputs } from "./trigger.ts";

// ---------------------------------------------------------------- the table

/** Why something of a plan has no step here: a closed list, which the conversion's notice says in words (AU-225). */
export const UNTRANSLATED_REASONS = [
  /** The new step needs the collection, and the plan names only a row (`entities.get` · `update` · `delete`, `field`). */
  "noCollection",
  /** A `case` that chooses a collection, an action or a step: «Elegir rama», not built yet (AU-223). */
  "chooses",
  /** Its step comes in a later piece of F16 (AU-222: the new answers of «Preguntar», «Se ve como»; AU-137's chat). */
  "laterPhase",
  /** Only a turn's plan says it (a quote of what Juan wrote, the rehearsal, a run drawn): never a saved flow. */
  "turnOnly",
  /** A piece of Boni outside its own automation, or a name only Boni's code binds: a copy loses it (AU-127). */
  "pieceNotHere",
  /** What the plan says has no expression that does the same (a reference to something that gives no value). */
  "notExpressible",
] as const;
export type UntranslatedReason = (typeof UNTRANSLATED_REASONS)[number];

/** What has no step, said by its plan step (null: the trigger or the plan), what it is and why. */
export interface Untranslated {
  step: string | null;
  /** The row of `TRANSLATION` («tool:entities.update», «ask:number»), or a part of a step («classify.question»). */
  what: string;
  reason: UntranslatedReason;
}

/** «Lo que cambia» (AU-224): where the converted automation does something its flow of before did not. */
export const CHANGES = [
  /** «Antes escribía sin preguntar cuando la iniciabas tú; ahora pregunta» (AU-230, decision 11). */
  "asksNow",
  /** «Los textos de más de 4.000 caracteres se recortan» (AU-57). */
  "textsCut",
  /**
   * «Antes elegía la Decisora; ahora clasifica el modelo lector» (AU-224, task 130 S1): a flow's `classify` was
   * answered by the account's decider, asked twice with its options in both orders; «Clasificar» asks the reader once.
   */
  "readerClassifies",
  /** «Lo que escribe una ejecución se deshace entero» (AU-18). */
  "undoWhole",
  /** «Sus límites son los de una automatización» (AU-17). */
  "automationLimits",
] as const;
export type Change = (typeof CHANGES)[number];

/**
 * One row per thing the plan language can say (AU-223): by its kind and its name, the step type it becomes, or
 * `untranslated:<reason>`. The test walks the language (`READERS`, `ASK_CONTROLS`, `REPLY_COMPONENTS`, `FNS`, the
 * triggers, the four operations and every action of the list) and fails when something has no row. `tool:*` is
 * every action of the list without a row of its own: «Acción de Boni». A piece's row says where it is a step; in
 * any other automation it is `pieceNotHere`.
 */
export const TRANSLATION: Readonly<Record<string, string>> = {
  // The four operations, and the forms of a step.
  "op:call": "by its tool",
  "op:read": "by its reader",
  "op:ask": "by its control",
  "op:reply": "by its component",
  "op:agent": "untranslated:laterPhase",
  "form:when": "if",
  "form:each": "split",
  "form:zip": "combine",
  "form:why": "why of its step (Boni's steps) · untranslated:laterPhase elsewhere",
  // The atoms.
  "atom:lit": "the value",
  "atom:ref": "an expression citing the step by its name",
  "atom:quote": "the value (a turn) · untranslated:turnOnly (a flow)",
  // The triggers.
  "trigger:manual": "manual",
  "trigger:schedule": "schedule",
  "trigger:created": BONI_TRIGGERS.mail,
  "trigger:connector": BONI_TRIGGERS.mailbox,
  "trigger:learning": BONI_TRIGGERS.decisions,
  "trigger:spending": BONI_TRIGGERS.spending,
  "trigger:chat": BONI_TRIGGERS.chat,
  "trigger:none": "manual",
  // The actions.
  "tool:entities.query": "collection · find",
  "tool:entities.get":
    "collection · get · untranslated:noCollection (but the mail that started it)",
  "tool:entities.aggregate": "collection · aggregate",
  "tool:entities.create":
    "collection · create, «Preguntar» · boni.create / boni.createChosen in «Leer correo»",
  "tool:entities.update": "untranslated:noCollection",
  "tool:entities.delete": "untranslated:noCollection",
  "tool:notify": NOTIFY_TYPE,
  ...Object.fromEntries(
    BONI_PIECES.filter((p) => !READERS.includes(p.old as never) && p.old !== "entities.create").map(
      (p) => [`tool:${p.old}`, p.type],
    ),
  ),
  "tool:*": BONI_ACTION_TYPE,
  // The readers.
  "reader:fill":
    "extract · boni.mailFiller in «Leer correo» · untranslated:notExpressible (fields not fixed)",
  "reader:classify": "classify · boni.mailDecider in «Leer correo»",
  "reader:label_each": "split → classify",
  "reader:summarize": "summarize",
  "reader:summarize_each": "split → summarize",
  "reader:rewrite": "write",
  "reader:read_message": "boni.mailReader",
  "reader:review_reading": "boni.guideReviewer",
  "reader:extract_tasks": BONI_READER_TYPE,
  "reader:answer_about": BONI_READER_TYPE,
  // The questions.
  "ask:yesno": ASK_TYPE,
  "ask:choice": ASK_TYPE,
  "ask:several": ASK_TYPE,
  "ask:text": ASK_TYPE,
  "ask:number": "untranslated:laterPhase",
  "ask:date": "untranslated:laterPhase",
  "ask:file": "untranslated:laterPhase",
  "ask:rehearsal": "untranslated:turnOnly",
  "ask:field": "untranslated:noCollection",
  // The answers.
  "reply:text": REPLY_TYPE,
  "reply:number": "untranslated:laterPhase",
  "reply:list": "untranslated:laterPhase",
  "reply:table": "untranslated:laterPhase",
  "reply:chart": "untranslated:laterPhase",
  "reply:run": "untranslated:turnOnly",
  // The functions: one JavaScript expression each (`FN_JS`), `case` choosing a collection excepted.
  ...Object.fromEntries(Object.keys(FNS).map((f) => [`fn:${f}`, "expression"])),
  "fn:case@type": "untranslated:chooses",
};

/** The names the four triggers of before and the four of Boni's give their step: what citations name. */
export const TRIGGER_NAMES: Readonly<Record<string, string>> = {
  manual: "Disparado por el usuario",
  schedule: "Programada",
  [BONI_TRIGGERS.mail]: "Llega un correo",
  [BONI_TRIGGERS.mailbox]: "Llega correo al buzón",
  [BONI_TRIGGERS.decisions]: "Cuando tus decisiones lo piden",
  [BONI_TRIGGERS.spending]: "El gasto llega al aviso",
  [BONI_TRIGGERS.chat]: "Mensaje de chat",
};
/** The helpers a plan step may bring before it, by the suffix of their name («r · si»). Data of the document. */
const HELPERS = {
  cond: "condición",
  if: "si",
  items: "lista",
  split: "separar",
  zip: "combinar",
  join: "juntar",
} as const;
/** The field a `when`'s condition is set in, and the one an `each`'s list is (AU-223). */
export const WHEN_FIELD = "cumple";
export const ITEMS_FIELD = "items";

// ---------------------------------------------------------------- the input and the result

export interface ConvertInput {
  /** The automation's id: the flow's, which buttons, blocks and the map keep naming (AU-225). */
  id: string;
  name: string;
  /** Checked before (`validatePlan`, `checkPlan`): a flow's or a turn's plan, or a page's chat's «Agente». */
  plan: Plan | { version: 1; steps: AgentStep[] };
  /** The flow's trigger (`triggerOk`); a turn's plan has none (`undefined`): «Disparado por el usuario». */
  trigger: unknown;
  /** Where the plan comes from: a saved flow, or a turn of the conversation (AU-143). */
  from: "flow" | "turn";
  /** Which of Boni's own automations this is, as the server knows it from where the flow is stored (A-19). */
  boni?: BoniAutomation;
  /**
   * The names Boni's code binds for this flow besides its trigger's (`$text`, `$subject`, `$fill`…): each is a field
   * of the trigger's row, which the server gives (S1). A name neither bound nor a step is `pieceNotHere`.
   */
  bound?: readonly string[];
  /** «Leer correo»'s «Decisora»: the collections it chooses among today, by key (decision 20). */
  decides?: readonly string[];
}

export interface Conversion {
  /** Version 0: a draft until the server keeps it as the flow's version (AU-225). Every «Sí» lowered. */
  automation: Automation;
  untranslated: Untranslated[];
  /** «Lo que cambia» (AU-224), in the order of `CHANGES`. */
  changes: Change[];
  /** Nothing is untranslated: the automation does what the plan did, but for `changes`. */
  complete: boolean;
}

// ---------------------------------------------------------------- expressions

/** A plan expression as the new one: a value (a literal, or a whole `{{ }}`), and, for a reference, its citation. */
interface Translated {
  /** JavaScript that gives the same value. */
  js: string;
  /** A simple citation (AU-162), when the value is one: it keeps the exact label of what it cites. */
  cite?: string;
  /** A literal, when the value is one. */
  lit?: string | number | boolean | null;
}

/** How a reference to a plan step's result reads in the new document. */
type Out =
  /** Rows of a collection (`entities.query`): `$('n').all()`. */
  | { kind: "rows"; name: string }
  /** One row whose fields the plan read: `entities.get` of the mail that started it (the trigger's row). */
  | { kind: "row"; name: string }
  /** One field of the step's first row («Contar o sumar»'s result, «Preguntar»'s answer). */
  | { kind: "leaf"; name: string; field: string }
  /** A reader's record of before (`{ text }`, `{ choice }`), whose keys are fields of the new step's row. */
  | { kind: "record"; name: string; keys: Readonly<Record<string, string>> }
  /** What Boni's code answered: `$('n').first().value`. */
  | { kind: "value"; name: string }
  /** A list reader of before: its one key is the list of a field of every row (`{ choices }`, `{ items }`). */
  | { kind: "listOf"; name: string; key: string; js: (r: string) => string }
  /** A step that ran per item: the list of what each gave. */
  | { kind: "each"; name: string; inner: Out }
  /** Nothing a plan can read (a write, a notice, an answer). */
  | { kind: "none" };

const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const q = (name: string) => `'${name.replace(/[\\']/g, (c) => `\\${c}`)}'`;
const prop = (k: string) => (IDENT.test(k) ? `.${k}` : `[${JSON.stringify(k)}]`);
/** The old language's truthiness (values.ts `truthy`): an empty list is false, a record is true. */
const TRUTHY = "((v) => (Array.isArray(v) ? v.length > 0 : !!v))";
/** A number as the old functions took it (fns.ts `num`): a money value's amount; anything else stops the step. */
const NUM =
  "((v) => { if (typeof v === 'number' && Number.isFinite(v)) return v; if (v !== null && typeof v === 'object' && typeof v.amount === 'number') return v.amount; throw new Error('not-a-number'); })";
/** A list as the old functions took it (fns.ts `items`): anything else stops the step. */
const LIST = "((v) => { if (!Array.isArray(v)) throw new Error('not-a-list'); return v; })";
/** A text as the old functions joined it (fns.ts `text`): null is "". */
const TEXT = "((v) => (v === null || v === undefined ? '' : String(v)))";
/** A value that says something (fns.ts `present`): not null, not "", not an empty list. */
const PRESENT =
  "((v) => !(v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0)))";

/** Each function of the plan language as JavaScript over its arguments' JavaScript (AU-223: one row per function). */
export const FN_JS: Readonly<Record<keyof typeof FNS, (a: string[]) => string>> = {
  count: ([a]) => `${LIST}(${a}).length`,
  sum: ([a, b]) =>
    `Math.round(${LIST}(${a}).reduce((s, x) => s + ${NUM}(${b ? `x?.[${b}]` : "x"}), 0) * 100) / 100`,
  min: ([a, b]) =>
    `((xs) => (xs.length ? Math.min(...xs) : null))(${LIST}(${a}).map((x) => ${NUM}(${b ? `x?.[${b}]` : "x"})))`,
  max: ([a, b]) =>
    `((xs) => (xs.length ? Math.max(...xs) : null))(${LIST}(${a}).map((x) => ${NUM}(${b ? `x?.[${b}]` : "x"})))`,
  pick: ([a, b]) => `((${a})?.[${b}] ?? null)`,
  item: ([a, b]) => `(${LIST}(${a})[${b}] ?? null)`,
  field: ([a, b]) => `${LIST}(${a}).map((x) => x?.[${b}] ?? null)`,
  filter_eq: ([a, b, c]) =>
    `${LIST}(${a}).filter((x) => JSON.stringify(x?.[${b}] ?? null) === JSON.stringify(${c}))`,
  first: (a) => `([${a.join(", ")}].find(${TRUTHY}) ?? null)`,
  concat: (a) => `[${a.join(", ")}].map(${TEXT}).join('')`,
  list: (a) => `[${a.join(", ")}]`,
  obj: (a) => {
    const pairs: string[] = [];
    for (let i = 0; i + 1 < a.length; i += 2) pairs.push(`[${a[i]}, ${a[i + 1]}]`);
    return `Object.fromEntries([${pairs.join(", ")}].filter(([k]) => k !== null))`;
  },
  case: ([v, ...rest]) => {
    let out = "null";
    for (let i = rest.length - 2; i >= 0; i -= 2)
      out = `(JSON.stringify(w) === JSON.stringify(${rest[i]}) ? ${rest[i + 1]} : ${out})`;
    return `((w) => ${out})(${v})`;
  },
  merge: (a) =>
    `Object.assign({}, ...[${a.join(", ")}].map((x) => Object.fromEntries(Object.entries(x ?? {}).filter(([, v]) => ${PRESENT}(v)))))`,
  length: ([a]) => `((v) => (Array.isArray(v) ? v.length : [...${TEXT}(v)].length))(${a})`,
  eq: ([a, b]) => `(JSON.stringify(${a}) === JSON.stringify(${b}))`,
  ne: ([a, b]) => `(JSON.stringify(${a}) !== JSON.stringify(${b}))`,
  gt: ([a, b]) => `(${NUM}(${a}) > ${NUM}(${b}))`,
  lt: ([a, b]) => `(${NUM}(${a}) < ${NUM}(${b}))`,
  and: (a) => `[${a.join(", ")}].every(${TRUTHY})`,
  or: (a) => `[${a.join(", ")}].some(${TRUTHY})`,
  not: ([a]) => `!${TRUTHY}(${a})`,
  today: () => "$today.toDay()",
  add_days: ([a, n]) => `$date(${a}).plus({ days: ${n} }).toDay()`,
};

/** The trigger's row: what its citations start with. */
const triggerRow = (name: string) => `$(${q(name)}).first()`;

// ---------------------------------------------------------------- the translator

/** A plan step's own step, how its result reads, whether it gives one row, and other ends what follows hangs from. */
interface Made {
  step: AutoStep;
  out: Out;
  one: boolean;
  also?: Arrow["from"][];
}

/**
 * A plan and its trigger as an automation (AU-143, AU-223). Pure: the same input gives the same document. It never
 * throws on a checked plan; anything it cannot translate is in `untranslated`, and the rest is still translated, so
 * the screen can show it whole (AU-225).
 */
export function planToAutomation(input: ConvertInput): Conversion {
  return new Translator(input).run();
}

class Translator {
  private readonly steps: AutoStep[] = [];
  private readonly arrows: Arrow[] = [];
  private readonly untranslated: Untranslated[] = [];
  private readonly outs = new Map<string, Out>();
  /** The names a reference may start with and the trigger's row gives. */
  private readonly fromTrigger = new Set<string>();
  private triggerName = TRIGGER_NAMES.manual as string;
  private schedule = false;
  private mailTrigger = false;
  private writes = false;
  private readers = false;
  /** A `classify` became «Clasificar» (not the «Decisora» of «Leer correo»). */
  private classifies = false;
  /** What the step being translated is inside: its plan step, and whether it walks a list (`$item`, `$zip`). */
  private current: { id: string; each: boolean; zip: Out | null } = {
    id: "",
    each: false,
    zip: null,
  };

  private readonly input: ConvertInput;

  constructor(input: ConvertInput) {
    this.input = input;
  }

  run(): Conversion {
    const trigger = this.trigger();
    let tail: Arrow["from"][] = [{ step: trigger.id, output: MAIN }];
    let one = true;
    const steps: unknown[] = Array.isArray(this.input.plan?.steps) ? this.input.plan.steps : [];
    for (const s of steps) {
      // A shape this function does not know is said, never thrown (AU-223): what the step had added is taken back.
      const at = {
        steps: this.steps.length,
        arrows: this.arrows.length,
        missed: this.untranslated.length,
      };
      const flags = { writes: this.writes, readers: this.readers, classifies: this.classifies };
      try {
        const r = this.planStep(s as Step | AgentStep, tail, one);
        tail = r.tail;
        one = r.one;
      } catch {
        this.steps.length = at.steps;
        this.arrows.length = at.arrows;
        this.untranslated.length = at.missed;
        this.writes = flags.writes;
        this.readers = flags.readers;
        this.classifies = flags.classifies;
        const o = s && typeof s === "object" ? (s as { id?: unknown; op?: unknown }) : {};
        this.miss(
          `op:${typeof o.op === "string" ? o.op : "?"}`,
          "notExpressible",
          typeof o.id === "string" ? o.id : null,
        );
      }
    }
    const automation = lowerYes({
      format: FORMAT,
      id: this.input.id,
      version: 0,
      name: this.input.name,
      steps: this.steps,
      arrows: this.arrows,
      settings: {},
    });
    const changes = new Set<Change>();
    const manual = this.input.from === "flow" && isManual(this.input.trigger);
    if (manual && this.writes) changes.add("asksNow");
    if (this.readers) changes.add("textsCut");
    if (this.classifies) changes.add("readerClassifies");
    if (this.writes) changes.add("undoWhole");
    if (this.input.from === "flow") changes.add("automationLimits");
    return {
      automation,
      untranslated: this.untranslated,
      changes: CHANGES.filter((c) => changes.has(c)),
      complete: this.untranslated.length === 0,
    };
  }

  private miss(what: string, reason: UntranslatedReason, step: string | null = this.current.id) {
    this.untranslated.push({ step: step || null, what, reason });
  }

  /** Takes out the helpers whose id starts so, and their arrows. */
  private drop(prefix: string) {
    const gone = new Set(this.steps.filter((x) => x.id.startsWith(prefix)).map((x) => x.id));
    for (let i = this.steps.length - 1; i >= 0; i--)
      if (gone.has((this.steps[i] as AutoStep).id)) this.steps.splice(i, 1);
    for (let i = this.arrows.length - 1; i >= 0; i--) {
      const a = this.arrows[i] as Arrow;
      if (gone.has(a.from.step) || gone.has(a.to.step)) this.arrows.splice(i, 1);
    }
  }

  private add(step: AutoStep, from: readonly Arrow["from"][], input: string = MAIN): AutoStep {
    this.steps.push(step);
    for (const f of from) this.arrows.push({ from: f, to: { step: step.id, input } });
    return step;
  }

  // ------------------------------------------------------------ the trigger

  private trigger(): AutoStep {
    const t = this.input.trigger as Record<string, unknown> | undefined | null;
    const at = (type: string, params: Record<string, ParamValue> = {}): AutoStep => {
      this.triggerName = TRIGGER_NAMES[type] ?? type;
      return this.add({ id: "trigger", name: this.triggerName, type, params }, []);
    };
    for (const b of this.input.bound ?? []) this.fromTrigger.add(b);
    if (!t || t.manual === true) {
      const names = t ? manualInputs(t) : [];
      for (const n of names) this.fromTrigger.add(n);
      return at("manual", {
        fields: names.map((n) => ({ key: n, name: n, type: "text" })),
      });
    }
    if (t.schedule && typeof t.schedule === "object") {
      const s = t.schedule as { every?: string; at?: string; day?: number };
      this.schedule = true;
      return at("schedule", {
        rules: [
          {
            key: "r1",
            every: s.every ?? "day",
            // The scheduler of before: «08:00» when not given (flowScheduler.ts); a week starts on Monday.
            at: s.at ?? "08:00",
            ...(s.every === "week" ? { day: WEEK_DAYS[s.day ?? 1] ?? "monday" } : {}),
          },
        ],
      });
    }
    if (typeof t.created === "string") {
      this.mailTrigger = true;
      this.fromTrigger.add("mail");
      return at(BONI_TRIGGERS.mail);
    }
    if (t.connector !== undefined) return at(BONI_TRIGGERS.mailbox);
    if (t.learning !== undefined) {
      // «Cada cuántas decisiones» keeps the old number when it is within the step's limits; one outside them is said,
      // and the step keeps the value it is born with, so the document still validates.
      const every = typeof t.every === "number" ? t.every : undefined;
      const fits =
        every !== undefined &&
        Number.isInteger(every) &&
        every >= BONI_LIMITS.every.min &&
        every <= BONI_LIMITS.every.max;
      if (every !== undefined && !fits)
        this.miss("trigger:decisions.every", "notExpressible", null);
      return at(BONI_TRIGGERS.decisions, fits ? { [BONI_PARAMS.every]: every } : {});
    }
    if (t.spending !== undefined) return at(BONI_TRIGGERS.spending);
    const chat = chatTrigger(t);
    if (chat)
      return at(BONI_TRIGGERS.chat, {
        [BONI_PARAMS.page]: chat.page,
        [BONI_PARAMS.welcome]: chat.welcome,
        [BONI_PARAMS.buttons]: chat.buttons.map((b) => ({ label: b.label, text: b.text })),
      });
    this.miss("trigger", "notExpressible", null);
    return at("manual", { fields: [] });
  }

  // ------------------------------------------------------------ a plan step and its form

  private planStep(
    s: Step | AgentStep,
    tail: Arrow["from"][],
    one: boolean,
  ): { tail: Arrow["from"][]; one: boolean } {
    const id = s.id;
    this.current = { id, each: false, zip: null };
    if (s.op === "agent") {
      this.miss("op:agent", "laterPhase");
      return { tail, one };
    }
    // What precedes may give other than one row: «Juntar en una» makes it one (AU-223).
    let feed = tail;
    if (!one) {
      const j = this.add(
        helper(id, "join", "join", { into: "fields" }, { continueEmpty: true }),
        tail,
      );
      feed = [{ step: j.id, output: MAIN }];
    }
    const next: Arrow["from"][] = [];
    if (s.when !== undefined) {
      const cond = this.expr(s.when);
      const c = this.add(
        helper(id, "cond", "edit", {
          fields: [{ field: WHEN_FIELD, value: { expr: `{{ ${TRUTHY}(${cond.js}) }}` } }],
          keep: "all",
        }),
        feed,
      );
      const i = this.add(
        helper(
          id,
          "if",
          "if",
          { where: [{ field: WHEN_FIELD, op: "checked" }] },
          { continueEmpty: false },
        ),
        [{ step: c.id, output: MAIN }],
      );
      feed = [{ step: i.id, output: OUT.yes }];
      next.push({ step: i.id, output: OUT.no });
    }
    let each = false;
    if (s.each !== undefined || s.zip !== undefined) {
      if (s.zip !== undefined && s.each === undefined) this.miss("form:zip", "notExpressible");
      else {
        const list = this.expr(s.each as { ref: string });
        const l = this.add(
          helper(id, "items", "edit", {
            fields: [{ field: ITEMS_FIELD, value: { expr: `{{ ${list.js} }}` } }],
            keep: "none",
          }),
          feed,
        );
        const sp = this.add(
          helper(
            id,
            "split",
            "split",
            { field: ITEMS_FIELD, keep: "none" },
            { continueEmpty: false },
          ),
          [{ step: l.id, output: MAIN }],
        );
        feed = [{ step: sp.id, output: MAIN }];
        // Nothing to walk: what follows still runs, from the list's step.
        next.push({ step: l.id, output: MAIN });
        each = true;
        if (s.zip !== undefined) {
          const zipped = this.refOut(s.zip.ref);
          if (zipped?.kind === "each") {
            const z = this.add(
              helper(id, "zip", "combine", { by: "position", keep: "a" }, { continueEmpty: false }),
              [],
            );
            this.arrows.push({
              from: { step: sp.id, output: MAIN },
              to: { step: z.id, input: "a" },
            });
            this.arrows.push({
              from: { step: stepIdOf(zipped.name, this.steps), output: MAIN },
              to: { step: z.id, input: "b" },
            });
            feed = [{ step: z.id, output: MAIN }];
            this.current.zip = zipped.inner;
          } else this.miss("form:zip", "notExpressible");
        }
      }
    }
    this.current.each = each;
    const made = this.op(s, feed);
    if (!made) {
      // Nothing of its own (`untranslated` says why, or it is the trigger's row): its form goes too, and what
      // follows hangs from where this step would have.
      this.drop(`p-${id}-`);
      return { tail, one };
    }
    if (each) {
      if (made.out.kind !== "none")
        this.outs.set(id, { kind: "each", name: made.step.name, inner: made.out });
      else this.outs.set(id, made.out);
    } else this.outs.set(id, made.out);
    const out: Arrow["from"][] = [
      { step: made.step.id, output: MAIN },
      ...(made.also ?? []),
      ...next,
    ];
    return { tail: out, one: out.length === 1 && made.one && !each };
  }

  /** The step itself, joined to `feed`; null when it has none (and `untranslated` says why). */
  private op(s: Step, feed: Arrow["from"][]): Made | null {
    switch (s.op) {
      case "call":
        return this.call(s, feed);
      case "read":
        return this.read(s, feed);
      case "ask":
        return this.ask(s, feed);
      case "reply":
        return this.reply(s, feed);
      default:
        this.miss(`op:${(s as { op: string }).op}`, "notExpressible");
        return null;
    }
  }

  /** The step of a plan step, by its id and its name, which is the plan step's id: what citations name. */
  private main(
    s: Step,
    type: string,
    params: Record<string, ParamValue>,
    feed: Arrow["from"][],
  ): AutoStep {
    const each = this.current.each;
    return this.add(
      {
        id: `p-${s.id}`,
        name: s.id,
        type,
        params,
        settings: { continueEmpty: true, ...(each ? {} : { firstRowOnly: true }) },
      },
      feed,
    );
  }

  // ------------------------------------------------------------ calls

  private call(s: Extract<Step, { op: "call" }>, feed: Arrow["from"][]): Made | null {
    const piece = BONI_PIECES.find((p) => p.old === s.tool && !READERS.includes(p.old as never));
    const inMail = this.input.boni === "readMail";
    if (s.tool === "entities.create" && inMail) return this.createPiece(s, feed);
    if (piece && piece.old !== "entities.create") return this.piece(s, piece, s.args, feed);
    // «Colección» and «Avisar» have no place for a why yet (a later piece of F16); Boni's steps keep it. And an
    // argument their step has no parameter for is said, never dropped.
    const whyLost = () => {
      if (s.why !== undefined) this.miss("form:why", "laterPhase");
      for (const k of Object.keys(s.args ?? {}).sort())
        if (!(KNOWN_ARGS[s.tool] ?? []).includes(k))
          this.miss(`tool:${s.tool}.${k}`, "notExpressible");
    };
    switch (s.tool) {
      case "entities.query":
        whyLost();
        return this.query(s, feed);
      case "entities.aggregate":
        whyLost();
        return this.aggregate(s, feed);
      case "entities.get": {
        const id = s.args.id;
        if (this.mailTrigger && id && "ref" in id && id.ref === "$mail") {
          // The mail that started it is the trigger's row (AU-220): no step reads it again.
          this.outs.set(s.id, { kind: "row", name: this.triggerName });
          return null;
        }
        this.miss("tool:entities.get", "noCollection");
        return null;
      }
      case "entities.create":
        whyLost();
        return this.create(s, feed);
      case "entities.update":
      case "entities.delete":
        this.miss(`tool:${s.tool}`, "noCollection");
        return null;
      case "notify":
        whyLost();
        return {
          step: this.main(
            s,
            NOTIFY_TYPE,
            this.people({ text: s.args.text ? this.value(s.args.text) : "" }),
            feed,
          ),
          out: { kind: "none" },
          one: true,
        };
      default:
        return this.action(s, feed);
    }
  }

  /** «Una vez por fila» for a «Personas» step that walks a list; the rest as they are born. */
  private people(params: Record<string, ParamValue>): Record<string, ParamValue> {
    return this.current.each ? { ...params, mode: "perRow" } : params;
  }

  private action(s: Extract<Step, { op: "call" }>, feed: Arrow["from"][]): Made {
    const params: Record<string, ParamValue> = {
      [BONI_PARAMS.action]: s.tool,
      [BONI_PARAMS.args]: this.args(s.args),
      ...(s.why !== undefined ? { [BONI_PARAMS.why]: this.value(s.why) } : {}),
    };
    const step = this.main(s, BONI_ACTION_TYPE, this.boniMode(params), feed);
    return { step, out: { kind: "value", name: step.name }, one: true };
  }

  private boniMode(params: Record<string, ParamValue>): Record<string, ParamValue> {
    return this.current.each ? { ...params, [BONI_PARAMS.mode]: "perRow" } : params;
  }

  private args(args: Record<string, Expr> | undefined): ParamValue {
    return Object.keys(args ?? {})
      .sort()
      .map((k) => ({ key: k, value: this.value((args as Record<string, Expr>)[k] as Expr) }));
  }

  private piece(
    s: Step,
    piece: BoniPieceDef,
    args: Record<string, Expr>,
    feed: Arrow["from"][],
    extra: Record<string, ParamValue> = {},
  ): Made | null {
    if (this.input.boni !== piece.owner) {
      this.miss(s.op === "read" ? `reader:${piece.old}` : `tool:${piece.old}`, "pieceNotHere");
      return null;
    }
    const params: Record<string, ParamValue> = { ...extra };
    const rest: Record<string, Expr> = {};
    for (const [k, v] of Object.entries(args)) {
      // What the piece lets change, fixed in the plan: its parameter (AU-127); anything else, an argument.
      if ((piece.params as readonly string[]).includes(k) && "lit" in v && v.lit !== null)
        params[k] = v.lit;
      else rest[k] = v;
    }
    params[BONI_PARAMS.args] = this.args(rest);
    const why = s.op === "call" ? s.why : undefined;
    if (why !== undefined) params[BONI_PARAMS.why] = this.value(why);
    const step = this.main(s, piece.type, this.boniMode(params), feed);
    return { step, out: { kind: "value", name: step.name }, one: true };
  }

  /** «Leer correo»'s «Crear» (AU-127): in the collection the plan names, or in the one the «Decisora» chose. */
  private createPiece(s: Extract<Step, { op: "call" }>, feed: Arrow["from"][]): Made | null {
    this.writes = true;
    const type = s.args.type;
    const fixed = type && "lit" in type && typeof type.lit === "string" ? type.lit : null;
    const def = BONI_PIECES.find((p) => p.type === (fixed ? "boni.create" : "boni.createChosen"));
    const { type: _t, ...rest } = s.args;
    return this.piece(
      s,
      def as BoniPieceDef,
      fixed ? rest : s.args,
      feed,
      fixed ? { [BONI_PARAMS.collection]: fixed } : {},
    );
  }

  /** The collection a call names: a literal key, or untranslated. */
  private collectionOf(s: Extract<Step, { op: "call" }>): string | null {
    const t = s.args.type;
    if (t && "lit" in t && typeof t.lit === "string") return t.lit;
    this.miss(
      t && "fn" in t && t.fn === "case" ? "fn:case@type" : `tool:${s.tool}`,
      t && "fn" in t && t.fn === "case" ? "chooses" : "notExpressible",
    );
    return null;
  }

  /** `field` with `equals` or `contains` (tools.ts `matching`) as one condition of the step; null with neither. */
  private where(s: Extract<Step, { op: "call" }>): ConditionRule[] | null {
    const { field, equals, contains } = s.args;
    if (equals === undefined && contains === undefined) return [];
    if (!field || !("lit" in field) || typeof field.lit !== "string") {
      this.miss(`tool:${s.tool}.field`, "notExpressible");
      return null;
    }
    const f = field.lit;
    if (contains !== undefined) {
      const v = this.condValue(contains);
      return v === undefined ? null : [{ field: f, op: "contains", value: v }];
    }
    const e = equals as Expr;
    if ("lit" in e && e.lit === null) return [{ field: f, op: "empty" }];
    if ("lit" in e && typeof e.lit === "boolean")
      return [{ field: f, op: e.lit ? "checked" : "unchecked" }];
    const v = this.condValue(e);
    return v === undefined ? null : [{ field: f, op: "is", value: v }];
  }

  private condValue(e: Expr): ConditionRule["value"] | undefined {
    if ("lit" in e && (typeof e.lit === "string" || typeof e.lit === "number")) return e.lit;
    const v = this.value(e);
    if (typeof v === "object" && v !== null && !Array.isArray(v) && "expr" in v)
      return v as { expr: string };
    if (typeof v === "string" || typeof v === "number") return v;
    this.miss(`tool:entities.query.equals`, "notExpressible");
    return undefined;
  }

  private query(s: Extract<Step, { op: "call" }>, feed: Arrow["from"][]): Made | null {
    const collection = this.collectionOf(s);
    const where = this.where(s);
    if (collection === null || where === null) return null;
    const limit = s.args.limit;
    const step = this.main(
      s,
      "collection",
      {
        collection,
        [ACTION]: "find",
        where: where as unknown as ParamValue,
        // The default of before (50) and its ceiling (200), as `optNum` read it.
        limit:
          limit && "lit" in limit && typeof limit.lit === "number"
            ? Math.min(Math.max(Math.trunc(limit.lit), 1), 200)
            : limit
              ? this.value(limit)
              : 50,
      },
      feed,
    );
    return { step, out: { kind: "rows", name: step.name }, one: false };
  }

  private aggregate(s: Extract<Step, { op: "call" }>, feed: Arrow["from"][]): Made | null {
    const collection = this.collectionOf(s);
    const where = this.where(s);
    if (collection === null || where === null) return null;
    const op = s.args.op;
    const of = s.args.of;
    const sum = op && "lit" in op && op.lit === "sum";
    const field = of && "lit" in of && typeof of.lit === "string" ? of.lit : undefined;
    if ((op && !("lit" in op)) || (sum && field === undefined)) {
      this.miss("tool:entities.aggregate.op", "notExpressible");
      return null;
    }
    const measure = sum ? "sum" : "count";
    const step = this.main(
      s,
      "collection",
      {
        collection,
        [ACTION]: "aggregate",
        where: where as unknown as ParamValue,
        measure,
        ...(sum ? { field: field as string } : {}),
      },
      feed,
    );
    return {
      step,
      out: { kind: "leaf", name: step.name, field: resultName(measure, sum ? field : undefined) },
      one: true,
    };
  }

  private create(s: Extract<Step, { op: "call" }>, feed: Arrow["from"][]): Made | null {
    const collection = this.collectionOf(s);
    if (collection === null) return null;
    const values = s.args.values;
    if (!values || !("fn" in values) || values.fn !== "obj") {
      this.miss("tool:entities.create.values", "notExpressible");
      return null;
    }
    const fields: { field: string; value: ParamValue }[] = [];
    for (let i = 0; i + 1 < values.args.length; i += 2) {
      const k = values.args[i] as Expr;
      if (!("lit" in k) || typeof k.lit !== "string") {
        this.miss("tool:entities.create.values", "notExpressible");
        return null;
      }
      fields.push({ field: k.lit, value: this.value(values.args[i + 1] as Expr) });
    }
    this.writes = true;
    // Born «Preguntar» (AU-230, decision 13): a conversion never gives a «Sí».
    const step = this.main(
      s,
      "collection",
      { collection, [ACTION]: "create", fields, permission: "ask" },
      feed,
    );
    return { step, out: { kind: "none" }, one: false };
  }

  // ------------------------------------------------------------ readers

  private read(s: Extract<Step, { op: "read" }>, feed: Arrow["from"][]): Made | null {
    const params = s.params ?? {};
    const pieceOf = (old: string) =>
      BONI_PIECES.find((p) => p.old === old && p.owner === this.input.boni);
    const asPiece = (old: string, extra: Record<string, ParamValue> = {}) => {
      const p = pieceOf(old) ?? BONI_PIECES.find((x) => x.old === old);
      return this.piece(s, p as BoniPieceDef, { input: s.input, ...params }, feed, extra);
    };
    if (this.input.boni === "readMail" && s.reader === "classify") {
      const decides = this.input.decides ?? [];
      if (!decides.length) {
        this.miss("reader:classify.collections", "noCollection");
        return null;
      }
      return asPiece("classify", {
        [BONI_PARAMS.collections]: decides.map((c) => ({ collection: c })),
      });
    }
    if (this.input.boni === "readMail" && s.reader === "fill") return asPiece("fill");
    if (s.reader === "read_message" || s.reader === "review_reading") return asPiece(s.reader);
    if ((BONI_READERS as readonly string[]).includes(s.reader)) {
      const step = this.main(
        s,
        BONI_READER_TYPE,
        this.boniMode({
          [BONI_PARAMS.reader]: s.reader,
          [BONI_PARAMS.input]: this.value(s.input),
          [BONI_PARAMS.args]: this.args(params),
        }),
        feed,
      );
      return { step, out: { kind: "value", name: step.name }, one: true };
    }
    const lost = (keys: readonly string[]) => {
      for (const k of keys)
        if (params[k] !== undefined) this.miss(`${s.reader}.${k}`, "laterPhase");
    };
    this.readers = true;
    switch (s.reader) {
      case "summarize": {
        const step = this.main(
          s,
          "summarize",
          { text: this.value(s.input), length: "short" },
          feed,
        );
        return { step, out: record(step.name, { text: READER_TYPES.summarize.out }), one: true };
      }
      case "rewrite": {
        const step = this.main(
          s,
          "write",
          {
            instructions: params.instruction ? this.value(params.instruction) : "",
            text: this.value(s.input),
          },
          feed,
        );
        return { step, out: record(step.name, { text: READER_TYPES.write.out }), one: true };
      }
      case "classify": {
        lost(["question", "ask", "given"]);
        this.classifies = true;
        const step = this.main(
          s,
          "classify",
          { text: this.value(s.input), options: params.options ? this.value(params.options) : [] },
          feed,
        );
        return { step, out: record(step.name, { choice: READER_TYPES.classify.out }), one: true };
      }
      case "label_each":
      case "summarize_each":
        return this.listReader(s, feed);
      case "fill":
        this.miss("reader:fill", "notExpressible");
        return null;
      default:
        this.miss(`reader:${s.reader}`, "notExpressible");
        return null;
    }
  }

  /** `label_each` and `summarize_each`: the list's texts as rows, then the reader on each (AU-57 batches them). */
  private listReader(s: Extract<Step, { op: "read" }>, feed: Arrow["from"][]): Made | null {
    const params = s.params ?? {};
    if (this.current.each) {
      this.miss(`reader:${s.reader}@each`, "notExpressible");
      return null;
    }
    for (const k of ["question", ...(s.reader === "summarize_each" ? ["options"] : [])])
      if (params[k] !== undefined) this.miss(`${s.reader}.${k}`, "laterPhase");
    const list = this.expr(s.input);
    const l = this.add(
      helper(s.id, "items", "edit", {
        fields: [{ field: ITEMS_FIELD, value: { expr: `{{ ${list.js} }}` } }],
        keep: "none",
      }),
      feed,
    );
    const sp = this.add(
      helper(
        s.id,
        "split",
        "split",
        { field: ITEMS_FIELD, keep: "none" },
        { continueEmpty: false },
      ),
      [{ step: l.id, output: MAIN }],
    );
    const text = { expr: `{{ $json.${ITEMS_FIELD} }}` };
    const label = s.reader === "label_each";
    const step = this.main(
      s,
      label ? "classify" : "summarize",
      label
        ? { text, options: params.options ? this.value(params.options) : [] }
        : { text, length: "short" },
      [{ step: sp.id, output: MAIN }],
    );
    // Every row of the list, not the first only.
    step.settings = { continueEmpty: true };
    const out: Out = label
      ? {
          kind: "listOf",
          name: step.name,
          key: "choices",
          js: (r) => `${r}.${READER_TYPES.classify.out}`,
        }
      : {
          kind: "listOf",
          name: step.name,
          key: "items",
          js: (r) => `({ line: ${r}.${READER_TYPES.summarize.out} })`,
        };
    // A list of nothing still goes on, from the list's step.
    return { step, out, one: false, also: [{ step: l.id, output: MAIN }] };
  }

  // ------------------------------------------------------------ questions and answers

  private ask(s: Extract<Step, { op: "ask" }>, feed: Arrow["from"][]): Made | null {
    if (s.field !== undefined) {
      this.miss("ask:field", "noCollection");
      return null;
    }
    const answer = { yesno: "yesNo", choice: "one", several: "several", text: "text" }[
      s.control as "yesno"
    ];
    if (!answer) {
      this.miss(`ask:${s.control}`, s.control === "rehearsal" ? "turnOnly" : "laterPhase");
      return null;
    }
    const step = this.main(
      s,
      ASK_TYPE,
      this.people({
        question: this.value(s.prompt),
        answer,
        ...(s.options !== undefined ? { options: this.value(s.options) } : {}),
        // A question of before waited for its answer: the longest wait there is (AU-125).
        waitDays: ASK_LIMITS.waitDays.max,
      }),
      feed,
    );
    return { step, out: { kind: "leaf", name: step.name, field: ANSWER_FIELD }, one: true };
  }

  private reply(s: Extract<Step, { op: "reply" }>, feed: Arrow["from"][]): Made | null {
    if (s.component !== "text") {
      this.miss(`reply:${s.component}`, s.component === "run" ? "turnOnly" : "laterPhase");
      return null;
    }
    const template = s.data.template;
    if (!template || !("lit" in template) || typeof template.lit !== "string") {
      this.miss("reply:text.template", "notExpressible");
      return null;
    }
    // `{a}`…`{d}` filled with their values, as the reply of before did: text with `{{ }}` (AU-223).
    let text = "";
    for (const part of template.lit.split(/(\{[abcd]\})/)) {
      const m = /^\{([abcd])\}$/.exec(part);
      const e = m ? s.data[m[1] as string] : undefined;
      if (m && e) {
        const t = this.expr(e);
        text +=
          t.lit !== undefined
            ? escapeText(String(t.lit ?? ""))
            : `{{ ${t.cite ?? `${TEXT}(${t.js})`} }}`;
      } else text += escapeText(part);
    }
    const step = this.main(s, REPLY_TYPE, { text }, feed);
    return { step, out: { kind: "none" }, one: true };
  }

  // ------------------------------------------------------------ expressions

  /** A plan expression as a parameter's value: the literal, a simple citation, text with `{{ }}`, or JavaScript. */
  private value(e: Expr): ParamValue {
    if ("fn" in e && e.fn === "concat") {
      // Text with citations, each keeping its label (AU-223), when every part is a literal or a citation.
      const parts = e.args.map((a) => this.expr(a));
      if (parts.every((p) => p.lit !== undefined || p.cite))
        return {
          expr: parts
            .map((p) => (p.lit !== undefined ? escapeText(String(p.lit ?? "")) : `{{ ${p.cite} }}`))
            .join(""),
        };
    }
    const t = this.expr(e);
    if (t.lit !== undefined)
      return typeof t.lit === "string" && t.lit.includes("{{") ? { expr: `{{ ${t.js} }}` } : t.lit;
    return { expr: `{{ ${t.cite ?? t.js} }}` };
  }

  private expr(e: Expr): Translated {
    if ("lit" in e) return { js: JSON.stringify(e.lit), lit: e.lit };
    if ("quote" in e) {
      if (this.input.from === "flow") this.miss("atom:quote", "turnOnly");
      return { js: JSON.stringify(e.quote), lit: e.quote };
    }
    if ("ref" in e) return this.ref(e.ref);
    const fn = FN_JS[e.fn as keyof typeof FNS];
    if (!fn) {
      this.miss(`fn:${e.fn}`, "notExpressible");
      return { js: "null" };
    }
    return { js: fn(e.args.map((a) => this.expr(a).js)) };
  }

  /** The `Out` of a reference's head, when it names an earlier plan step. */
  private refOut(ref: string): Out | undefined {
    const m = /^\$([A-Za-z_][A-Za-z0-9_]*)/.exec(ref);
    return m ? this.outs.get(m[1] as string) : undefined;
  }

  private ref(ref: string): Translated {
    const m = /^\$([A-Za-z_][A-Za-z0-9_]*)((?:\.[A-Za-z_$][A-Za-z0-9_$]*|\[\d{1,4}\])*)$/.exec(ref);
    if (!m) {
      this.miss("atom:ref", "notExpressible");
      return { js: "null" };
    }
    const head = m[1] as string;
    const path = [...(m[2] ?? "").matchAll(/\.([A-Za-z_$][A-Za-z0-9_$]*)|\[(\d+)\]/g)].map((x) =>
      x[1] !== undefined ? (x[1] as string) : Number(x[2]),
    );
    if (head === "item" && this.current.each) return along(`$json.${ITEMS_FIELD}`, path);
    if (head === "zip" && this.current.zip)
      return this.through(this.current.zip, "$json", path, true);
    if (head === "today" && this.schedule && !this.fromTrigger.has("today"))
      return along("$today.toDay()", path, false);
    if (head === "mail" && this.mailTrigger) {
      // The mail that started it: its row's id when named alone (what the tools of before took).
      return path.length
        ? along(triggerRow(this.triggerName), path)
        : along(triggerRow(this.triggerName), ["id"]);
    }
    if (this.fromTrigger.has(head)) return along(triggerRow(this.triggerName), [head, ...path]);
    const out = this.outs.get(head);
    if (out) return this.through(out, `$(${q(nameOf(out) as string)})`, path, false);
    this.miss(`atom:ref:$${head}`, "pieceNotHere");
    return { js: "null" };
  }

  /** A reference into a step's result, by how that step's result reads (`Out`). `row`: already one row's fields. */
  private through(out: Out, base: string, path: (string | number)[], row: boolean): Translated {
    const first = row ? base : `${base}.first()`;
    switch (out.kind) {
      case "rows":
        return along(`${base}.all()`, path, false);
      case "row":
        return along(first, path);
      case "value":
        return along(`${first}.${BONI_VALUE}`, path);
      case "leaf":
        if (path.length) {
          this.miss("atom:ref", "notExpressible");
          return { js: "null" };
        }
        return along(first, [out.field]);
      case "record": {
        const [k, ...rest] = path;
        if (k === undefined) {
          const pairs = Object.entries(out.keys).map(([o, n]) => `${o}: ${first}${prop(n)}`);
          return { js: `({ ${pairs.join(", ")} })` };
        }
        const to = typeof k === "string" ? out.keys[k] : undefined;
        if (to === undefined) {
          this.miss("atom:ref", "notExpressible");
          return { js: "null" };
        }
        return along(first, [to, ...rest]);
      }
      case "listOf": {
        const [k, ...rest] = path;
        if (k !== out.key) {
          this.miss("atom:ref", "notExpressible");
          return { js: "null" };
        }
        return along(`${base}.all().map((r) => ${out.js("r")})`, rest, false);
      }
      case "each": {
        const [i, ...rest] = path;
        if (i === undefined) {
          const inner = this.through(out.inner, "r", [], true);
          return { js: `${base}.all().map((r) => ${inner.js})` };
        }
        if (typeof i !== "number") {
          this.miss("atom:ref", "notExpressible");
          return { js: "null" };
        }
        const inner = this.through(out.inner, "r", rest, true);
        return { js: `((r) => (r === undefined ? null : ${inner.js}))(${base}.all()[${i}])` };
      }
      default:
        this.miss("atom:ref", "notExpressible");
        return { js: "null" };
    }
  }
}

// ---------------------------------------------------------------- helpers

/** The arguments of before each «Colección» and «Avisar» step takes (tools.ts): any other is said, not dropped. */
const KNOWN_ARGS: Readonly<Record<string, readonly string[]>> = {
  "entities.query": ["type", "field", "equals", "contains", "limit"],
  "entities.aggregate": ["type", "op", "of", "field", "equals", "contains"],
  "entities.create": ["type", "values"],
  notify: ["text"],
};

const WEEK_DAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

const isManual = (t: unknown) =>
  !t || (typeof t === "object" && (t as { manual?: unknown }).manual === true);

const record = (name: string, keys: Record<string, string>): Out => ({
  kind: "record",
  name,
  keys,
});

const nameOf = (out: Out): string | undefined => ("name" in out ? out.name : undefined);

/** The id of the step with that name. */
const stepIdOf = (name: string, steps: readonly AutoStep[]) =>
  steps.find((s) => s.name === name)?.id ?? name;

/** A helper step a plan step brings before it: its id and name from the plan step's, and the helper's kind. */
function helper(
  id: string,
  kind: keyof typeof HELPERS,
  type: string,
  params: Record<string, ParamValue>,
  settings: StepSettings = { continueEmpty: true },
): AutoStep {
  return { id: `p-${id}-${kind}`, name: `${id} · ${HELPERS[kind]}`, type, params, settings };
}

/**
 * A path after a base: a simple citation when every part is a name and the base is one (`$('n').first()`,
 * `$json.items`), JavaScript otherwise.
 */
function along(base: string, path: readonly (string | number)[], citable = true): Translated {
  const js =
    base +
    path
      .map((p) =>
        typeof p === "number" ? `[${p}]` : `?.${IDENT.test(p) ? p : `[${JSON.stringify(p)}]`}`,
      )
      .join("");
  const simple = citable && path.length > 0 && path.every((p) => typeof p === "string");
  const cite = simple ? base + path.map((p) => prop(p as string)).join("") : undefined;
  return { js: cite ? `(${js} ?? null)` : js, ...(cite ? { cite } : {}) };
}

/** Text as a parameter keeps it: `{{` would start a citation, so it goes as JavaScript's string. */
function escapeText(text: string): string {
  return text.includes("{{") ? `{{ ${JSON.stringify(text)} }}` : text;
}

/** The plan language's own lists, as the coverage test walks them (AU-223). */
export const LANGUAGE = {
  ops: ["call", "read", "ask", "reply", "agent"],
  forms: ["when", "each", "zip", "why"],
  atoms: ["lit", "ref", "quote"],
  readers: READERS,
  asks: ASK_CONTROLS,
  replies: REPLY_COMPONENTS,
  fns: Object.keys(FNS),
  triggers: ["manual", "schedule", "created", "connector", "learning", "spending", "chat", "none"],
} as const;
