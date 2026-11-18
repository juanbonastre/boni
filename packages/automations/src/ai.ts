// The AI steps' side of the engine (docs/automatizaciones.md §5.6, AU-57, AU-166, F15 E2): the port the engine calls a
// model by, what goes wrong as keys, and the four readers' work over a step's rows, in batches, before any unit runs.
//
// The port is the server's (S1: providers, «Modelos», the month's budget, the readers of packages/agent and their
// schemas); a test gives a scripted one. Nothing here imports a provider of models (A-02), and nothing a reader answers
// is trusted: the engine checks it again against the step's own closed shape (`answerOf`).
import { join, type Label, label as makeLabel } from "@boni/entities";
import type { AgentCall, AgentReply } from "./agent.ts";
import {
  BONI_LIMITS,
  BONI_MODULES,
  BONI_PARAMS,
  BONI_USER_IN,
  type PieceRead,
  type PieceReader,
  type PieceReply,
} from "./boni.ts";
import { citationsIn, type Scope } from "./expression.ts";
import { StepFault } from "./failures.ts";
import type { ParamValue, Step } from "./format.ts";
import { type Cell, cellOf, type Row } from "./rows.ts";

// ---------------------------------------------------------------- the port

/** The readers the four steps call (`packages/agent/src/readers.ts`), by the names the port knows them. */
export const READER_NAMES = [
  "fill",
  "classify",
  "label_each",
  "summarize",
  "summarize_each",
  "rewrite",
] as const;
export type ReaderName = (typeof READER_NAMES)[number];

/** A field «Extraer datos» asks for (AU-53): its key, its type, and a line saying what it is for. */
export interface ReaderField {
  key: string;
  type: (typeof EXTRACT_TYPES)[number];
  /** What the field is for, as Juan wrote it: it goes to the reader next to the field. */
  line: string;
  /** An «options» field's options: the reader answers one of them or nothing. */
  options?: string[];
}
export const EXTRACT_TYPES = ["text", "number", "date", "boolean", "options"] as const;
/** At most this many fields in «Extraer datos» (AU-53). */
export const EXTRACT_FIELDS_MAX = 12;

/**
 * One call to a reader: one call to a model (AU-206 counts it before it is made). It carries the texts and what Juan
 * set in the step, and nothing else: no other field of the rows, no row of a collection, no run (`docs/nucleo.md`
 * §7.4: a reader never gets the user's own data next to a text from outside).
 */
export interface ReaderCall {
  /** The use of «Modelos» it spends (AU-57, AU-199): the step's type fixes it, the four readers spend «Lector». */
  use: "reader";
  /** The step's «Modelo»: the id of the choice it keeps, or null for «El de la cuenta» (AU-199). */
  model: string | null;
  reader: ReaderName;
  /** The texts, in the order of the rows: one for a reader of one text, up to `READER_BATCH` for a list reader. */
  texts: string[];
  /** «Clasificar»'s options. */
  options?: string[];
  /**
   * «Extraer datos»'s fields. Typed (text, number, date, yes or no, options): the port holds the model to
   * `extractSchema` of packages/agent, not to `fill`'s own shape of choices and checks.
   */
  fields?: ReaderField[];
  /** «Escribir texto»'s instructions. */
  instructions?: string;
  /** «Resumir»'s «Largo» when it is not the short one. */
  length?: "medium" | "long";
  /**
   * The second and last call of AU-59, after an answer that did not fit (`fault` names the rule it broke, a key): the
   * port asks again with the input shortened, as the readers do (`shortenInput`).
   */
  again?: { fault: string };
}

/**
 * What the port answers. `answer`: what the model gave, after the port's own checks; the engine checks it again.
 * `refused`: the call was not answered (no key, no model, the month's budget, the provider said no): a key the screen
 * can say (`docs/nucleo.md` §7.4). `transient`: the port's word that the call timed out or the provider failed on its
 * own side (a 5xx), the only refusals «Reintentar si el modelo falla» asks again after (`AI_RETRY`); any other is never
 * retried. `model`: the name of the model that answered, as «Modelos» shows it.
 */
export type ReaderReply =
  | { answer: unknown; model: string }
  | { refused: string; model?: string; transient?: true };

/**
 * «Reintentar si el modelo falla» (Juan, 2026-11-18, decision 28 of §10), behind «Añadir opción» in the five AI steps: how many
 * times a call is asked again after the port says it timed out or the provider failed on its side (`transient`), never
 * after a refusal of the policy, of the budget or of a key, a limit of the run, or an answer that does not fit (that
 * one has its own second call, AU-59). Born 0 (no retry, as before), at most 2. Before retry `n` the run waits `n`
 * times `waitMs` by its own clock (2 s, then 4 s), then counts the call against «Llamadas a modelos» and checks its
 * time (AU-17, AU-206): a retry the run cannot pay stops it with `run.limit`, as any call would.
 */
export const AI_RETRY = { born: 0, max: 2, waitMs: 2000 } as const;
/** The key of «Reintentar si el modelo falla» in the four readers and in «Agente» (`AGENT_PARAMS.retries`). */
export const RETRY_PARAM = "retries";
/** A step's «Reintentar si el modelo falla» as the engine reads it: a whole number from 0 to `AI_RETRY.max`. */
export function retriesOf(step: Step): number {
  const v = step.params[RETRY_PARAM];
  return typeof v === "number" && Number.isInteger(v)
    ? Math.min(Math.max(v, 0), AI_RETRY.max)
    : AI_RETRY.born;
}

/**
 * How the engine calls a model (`RunDeps.ai`, §7): one reader call at a time, and one «Agente»'s unit of work, whose
 * rounds the port runs with packages/agent's `runRounds` (each round's call through `AgentCall.modelCall`). A port
 * without `agent` runs no «Agente»: its units fail with `ai.unavailable`.
 */
export interface AiPort {
  read(call: ReaderCall): Promise<ReaderReply>;
  agent?(call: AgentCall): Promise<AgentReply>;
  /** A piece of Boni's (AU-249, AU-255): one call of its reader. A port without it runs no piece that reads. */
  piece?(call: PieceCall): Promise<ReaderReply>;
}

/**
 * One call of a piece's reader (AU-255), as the engine hands it to the port after its checks: what it reads, which the
 * port puts between markers, all of it as from outside (the step's row, what that sender has waiting, «Ejemplos»);
 * and, outside the markers, only the step's panel and closed lists the code checked. Nothing else of his.
 */
export interface PieceCall {
  /** The kind of call (§5.16): the «Decisora» decides, the other two read. */
  use: "reading" | "decision";
  model: string | null;
  reader: PieceReader;
  texts: string[];
  /** «Ejemplos» of the «Lectora»: each a mail cited and what it should give, read between markers. */
  examples?: { mail: string; want: string }[];
  /** «Busca» and «Indicaciones» of the «Lectora». */
  modules?: string[];
  instructions?: string;
  /** The «Decisora»'s options: its panel's collections, with their names and descriptions as defined. */
  options?: { key: string; name: string; description?: string }[];
  /** The «Rellenadora»'s collection, by key. */
  collection?: string;
  userIn?: (typeof BONI_USER_IN)[number];
  again?: { fault: string };
  /** When and where the run is: for the days a reader writes («mañana»). */
  now: number;
  zone: string;
}

// ---------------------------------------------------------------- what goes wrong

/**
 * Why an AI step failed, as keys, apart from `STEP_FAILURES` as `CODE_FAILURES` are (the screen gets their words in
 * P2; until then it shows the general sentence of `other` and the step).
 */
export const AI_FAILURES = [
  /**
   * A value no model may receive (AU-166: its label carries `noModel`) arrived at what a reader would get. `detail.field`:
   * the field of the row that held it, or the parameter when it came from elsewhere; `detail.collection`, the
   * collection it was read from, when the row says it. Never the value.
   */
  "ai.private",
  /** The reader's answer did not fit its shape twice (AU-59). `detail.reader`; `detail.why`: the rule, a key. */
  "ai.reply",
  /** The port did not answer the call: `detail.why` is its key (no key, no model, the budget). Not retried. */
  "ai.refused",
  /** There is no port to call a model by: nothing was called. */
  "ai.unavailable",
  /**
   * What Juan set is not what the step takes. `detail.why`: "options" (not a list of texts, or none), "fields" (none,
   * more than `EXTRACT_FIELDS_MAX`, a key twice or a type it does not know), "instructions" (empty).
   */
  "ai.params",
  /** An «Agente»'s plan was not one twice in a round (AU-198). `detail.errors`: how many problems the last had. */
  "agent.plan",
  /** «Rondas máximas» (AU-58) passed with no answer: nothing of the unit is saved (AU-198). */
  "agent.rounds",
  /** An «Agente»'s answer did not fit «Respuesta» twice (AU-53). */
  "agent.reply",
] as const;
export type AiFailureCode = (typeof AI_FAILURES)[number];
export interface AiFailure {
  code: AiFailureCode;
  param?: string;
  detail?: Record<string, string | number>;
}

/** A failure of an AI step: a `StepFault` with code `other`, and `ai` saying which (as `CodeFault` does with `why`). */
export class AiFault extends StepFault {
  readonly ai: AiFailure;
  constructor(message: string, ai: AiFailure) {
    super(message, { code: "other", ...(ai.param ? { param: ai.param } : {}) });
    this.name = "AiFault";
    this.ai = ai;
  }
}

// ---------------------------------------------------------------- the four steps

/** The four reader steps' types (AU-57), and the field each leaves its answer in. */
export const READER_TYPES = {
  extract: { reader: "fill", out: null },
  classify: { reader: "label_each", out: "clase" },
  summarize: { reader: "summarize_each", out: "resumen" },
  write: { reader: "rewrite", out: "texto" },
} as const;
export type ReaderType = keyof typeof READER_TYPES;
export const isReaderType = (type: string): type is ReaderType => Object.hasOwn(READER_TYPES, type);

/**
 * What a step's «Modelo» holds (AU-238): nothing («El de la cuenta»), a model's id of «Modelos»
 * (`connection:model`, with `:zdr`) or `tag:` and a tag's id; never a key, a route or a setting (AU-50). Which model
 * answers is the server's (`resolveModel`): this is only the value's shape.
 */
export const MODEL_VALUE =
  /^(?:tag:[a-z0-9]{6,32}|(?!tag:)[a-z]+:[A-Za-z0-9._/~-][A-Za-z0-9._:/~-]{0,123})$/;
export const isModelValue = (v: unknown): boolean =>
  v === undefined || v === "" || (typeof v === "string" && MODEL_VALUE.test(v));

/**
 * A model does not choose a model (AU-243): the steps of a document a model proposed (the assistant, the MCP,
 * «Pedir a Boni») keep the «Modelo» the person gave them, and a new step, or one whose «Modelo» the proposal
 * changed, comes with none («El de la cuenta»). `before` is the document the proposal starts from (null: a new
 * one). Where the text goes and what it costs stays the person's.
 */
export function keepOwnModels(before: readonly Step[] | null, proposed: Step[]): Step[] {
  const own = new Map((before ?? []).map((s) => [s.id, s.params[READER_PARAMS.model]]));
  return proposed.map((s) => {
    const m = s.params[READER_PARAMS.model];
    if (m === undefined || m === null || m === "" || own.get(s.id) === m) return s;
    const { [READER_PARAMS.model]: _chosen, ...params } = s.params;
    return { ...s, params };
  });
}

/** The parameters of the four, by their keys (catalogue.ts paints them). */
export const READER_PARAMS = {
  text: "text",
  model: "model",
  fields: "fields",
  options: "options",
  length: "length",
  instructions: "instructions",
  retries: RETRY_PARAM,
} as const;

/**
 * At most this many rows to a list reader in one call (AU-57): the `maxItems` of `labelEachSchema` and
 * `summarizeEachSchema` in packages/agent, which the provider holds the model to. Measured with 3,000 rows behind a
 * scripted reader (ai-steps.test.ts): what costs is the calls, not the engine.
 */
export const READER_BATCH = 50;
/** A text longer than this (in characters) is cut before it goes to a reader, and the step's record says how many. */
export const READER_TEXT_CHARS = 4000;

/** What an AI step's record keeps of its calls (AU-54): how many, the models that answered, how long, what was cut. */
export interface AiRecord {
  calls: number;
  /** The names of the models that answered, once each, in the order they first did. */
  models: string[];
  ms: number;
  /** Texts cut to `READER_TEXT_CHARS`. */
  cut: number;
  /**
   * Of `calls`, the ones «Reintentar si el modelo falla» asked again after a timeout or a provider's 5xx (`AI_RETRY`).
   */
  retried?: number;
}

/** What a reader step gives for one row of its input: the output row's new values, or its failure. */
export type ReaderOutcome = { values: Record<string, Cell>; label: Label } | { fault: AiFault };

interface ReaderInput {
  step: Step;
  rows: readonly Row[];
  /** The scope of each row (by its place in the step's input), to resolve the step's parameters with. */
  scope(row: Row, index: number): Scope;
  resolve(value: ParamValue, scope: Scope): { value: Cell; label: Label };
  port: AiPort | undefined;
  /** Before each call (AU-206); throws `LimitPassed`, which stops the run. */
  modelCall(): void;
  /**
   * Before retry `n` of «Reintentar si el modelo falla» (`AI_RETRY`): waits, then counts the call and checks the run's
   * time; throws `LimitPassed`, which stops the run. Without it, no call is retried.
   */
  retry?(n: number): Promise<void>;
  now(): number;
  /** The label of what a model wrote, for this step. */
  model: Label;
  /** Where the calls are counted as they are made, so a run that stops halfway still says what it spent (AU-54). */
  record?: AiRecord;
}

const isText = (v: unknown): v is string => typeof v === "string";
const textOf = (v: Cell): string =>
  v === null || v === undefined
    ? ""
    : isText(v)
      ? v
      : typeof v === "object"
        ? JSON.stringify(v)
        : String(v);

/** The keys of the current row a parameter cites (`$json.<key>`): where a private value would come from. */
function citedFields(value: ParamValue): string[] {
  return citationsIn(value)
    .filter((c) => c.step === null && c.path.length > 0)
    .map((c) => String(c.path[0]));
}

/** AU-166: a value that no model may receive fails its row, naming the field and, when the row says it, the collection. */
function privateFault(row: Row, param: string, value: ParamValue): AiFault {
  const field = citedFields(value).find((k) => cellOf(row, [k])?.label.noModel) ?? param;
  const fromRow = field !== param;
  const detail: Record<string, string> = { field };
  if (fromRow && row.origin) detail.collection = row.origin.collection;
  return new AiFault(`a value no model may receive is in «${field}»`, {
    code: "ai.private",
    param,
    detail,
  });
}

/** Juan's options for «Clasificar»: a list of texts, as written or as an expression gave it. */
function optionsOf(v: Cell): string[] | null {
  if (!Array.isArray(v) || !v.length) return null;
  const out = v.map((o) => (isText(o) ? o.trim() : "")).filter(Boolean);
  return out.length === v.length && new Set(out).size === out.length ? out : null;
}

/** «Extraer datos»'s fields, and an «Agente»'s «Campos», as Juan wrote them: null when they are not what AU-53 says. */
export function fieldsOf(v: Cell): ReaderField[] | null {
  if (!Array.isArray(v) || !v.length || v.length > EXTRACT_FIELDS_MAX) return null;
  const out: ReaderField[] = [];
  for (const f of v) {
    if (typeof f !== "object" || f === null || Array.isArray(f)) return null;
    const key = isText(f.key) ? f.key.trim() : "";
    const type = f.type;
    if (!key || !(EXTRACT_TYPES as readonly unknown[]).includes(type)) return null;
    const field: ReaderField = {
      key,
      type: type as ReaderField["type"],
      line: isText(f.line) ? f.line : "",
    };
    if (type === "options") {
      const options = optionsOf(f.options as Cell);
      if (!options) return null;
      field.options = options;
    }
    out.push(field);
  }
  return new Set(out.map((f) => f.key)).size === out.length ? out : null;
}

/** A link or HTML: what a reader's text never holds (packages/agent's readers refuse it too). */
const LINK_OR_HTML = /(https?:\/\/|www\.|<\s*\/?\s*[a-z!]|\]\(|javascript:|data:)/i;
/** Plain text of at most `max` characters: no link, no HTML (painted as text anyway, never as HTML). */
const plain = (v: unknown, max: number): v is string =>
  typeof v === "string" && [...v].length <= max && !LINK_OR_HTML.test(v);
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const fits = (f: ReaderField, v: unknown): boolean =>
  v === null ||
  (f.type === "text"
    ? plain(v, READER_TEXT_CHARS)
    : f.type === "number"
      ? typeof v === "number" && Number.isFinite(v)
      : f.type === "date"
        ? typeof v === "string" && DAY.test(v) && !Number.isNaN(Date.parse(v))
        : f.type === "boolean"
          ? typeof v === "boolean"
          : typeof v === "string" && (f.options ?? []).includes(v));

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * A reader's answer checked again by the engine against the step's own shape: one value per text, in order, or the
 * rule it broke (a key). «Clasificar» answers one of its options or nothing (null).
 */
export function answerOf(
  call: Pick<ReaderCall, "reader" | "options" | "fields">,
  answer: unknown,
  count: number,
): { values: Cell[] } | { fault: string } {
  if (!isObj(answer)) return { fault: "not-an-object" };
  const keys = Object.keys(answer).sort().join();
  const options = call.options ?? [];
  const choice = (c: unknown) => c === null || (typeof c === "string" && options.includes(c));
  switch (call.reader) {
    case "label_each": {
      const choices = answer.choices;
      if (keys !== "choices" || !Array.isArray(choices)) return { fault: "keys" };
      if (choices.length !== count) return { fault: "count" };
      return choices.every(choice) ? { values: choices as Cell[] } : { fault: "choice" };
    }
    case "classify":
      if (keys !== "choice") return { fault: "keys" };
      return choice(answer.choice) ? { values: [answer.choice as Cell] } : { fault: "choice" };
    case "summarize_each": {
      const items = answer.items;
      if (keys !== "items" || !Array.isArray(items)) return { fault: "keys" };
      if (items.length !== count) return { fault: "count" };
      const lines: Cell[] = [];
      for (const it of items) {
        if (!isObj(it) || Object.keys(it).join() !== "line" || !plain(it.line, 200))
          return { fault: "item" };
        lines.push(it.line);
      }
      return { values: lines };
    }
    case "summarize":
    case "rewrite": {
      const max = call.reader === "rewrite" ? READER_TEXT_CHARS : 2000;
      if (keys !== "text") return { fault: "keys" };
      return plain(answer.text, max) ? { values: [answer.text] } : { fault: "text" };
    }
    case "fill": {
      const fields = call.fields ?? [];
      if (
        keys !==
        fields
          .map((f) => f.key)
          .sort()
          .join()
      )
        return { fault: "keys" };
      for (const f of fields) if (!fits(f, answer[f.key])) return { fault: `field-${f.type}` };
      return { values: [Object.fromEntries(fields.map((f) => [f.key, answer[f.key] as Cell]))] };
    }
  }
}

/** A plain-text parameter Juan set, or null. */
const set = (step: Step, key: string): ParamValue | undefined => step.params[key];

/**
 * The work of a reader step over all its rows, before any unit runs (as a «Código»'s evaluation is, AU-38): each row's
 * text resolved and checked (AU-166), cut where it is long, sent in batches to a list reader or one by one to the
 * others, each answer checked again and asked once more when it does not fit (AU-59). Gives one outcome per row, in
 * order, and what the calls cost (in `input.record` as they are made). What Juan set that the step cannot take
 * (`ai.params`) fails each row, so «Si falla» decides; it throws only what stops the run (`LimitPassed`) or what
 * fails the whole step (no port, `ai.unavailable`).
 */
export async function readRows(
  input: ReaderInput,
): Promise<{ outcomes: ReaderOutcome[]; record: AiRecord }> {
  const { step, rows } = input;
  const type = step.type as ReaderType;
  const spec = READER_TYPES[type];
  const record: AiRecord = input.record ?? { calls: 0, models: [], ms: 0, cut: 0 };
  const outcomes: (ReaderOutcome | undefined)[] = rows.map(() => undefined);
  if (!input.port) throw new AiFault("there is no model to call", { code: "ai.unavailable" });
  const port = input.port;
  const P = READER_PARAMS;
  const model = step.params[P.model];
  const modelId = typeof model === "string" && model ? model : null;
  const length = step.params[P.length];
  const long = length === "medium" || length === "long" ? length : undefined;
  const retries = retriesOf(step);

  // What each row sends: its text, and what Juan set (fixed, or an expression over the row). Labels of what is sent
  // become the output's: what comes out of a text from outside is from outside (AU-57).
  type Sent = {
    index: number;
    text: string;
    label: Label;
    call: Omit<ReaderCall, "texts" | "use" | "model">;
  };
  const sent: Sent[] = [];
  for (const [index, row] of rows.entries()) {
    const scope = input.scope(row, index);
    const labels: Label[] = [];
    const take = (key: string, required: boolean): Cell | undefined => {
      const v = set(step, key);
      if (v === undefined) {
        if (required)
          throw new AiFault(`«${key}» is missing`, {
            code: "ai.params",
            param: key,
            detail: { why: key },
          });
        return undefined;
      }
      const got = input.resolve(v, scope);
      if (got.label.noModel) throw privateFault(row, key, v);
      labels.push(got.label);
      return got.value;
    };
    try {
      const text = textOf(take(P.text, type !== "write") ?? null);
      const call: Sent["call"] = { reader: spec.reader };
      if (type === "classify") {
        const options = optionsOf(take(P.options, true) as Cell);
        if (!options)
          throw new AiFault("«Opciones» is not a list of texts", {
            code: "ai.params",
            param: P.options,
            detail: { why: "options" },
          });
        call.options = options;
      }
      if (type === "extract") {
        const fields = fieldsOf(take(P.fields, true) as Cell);
        if (!fields)
          throw new AiFault("«Campos» is not a list of fields", {
            code: "ai.params",
            param: P.fields,
            detail: { why: "fields" },
          });
        call.fields = fields;
      }
      if (type === "write") {
        const instructions = textOf(take(P.instructions, true) as Cell).trim();
        if (!instructions)
          throw new AiFault("«Instrucciones» is empty", {
            code: "ai.params",
            param: P.instructions,
            detail: { why: "instructions" },
          });
        call.instructions = instructions;
      }
      if (type === "summarize" && long) {
        call.reader = "summarize";
        call.length = long;
      }
      const chars = [...text];
      if (chars.length > READER_TEXT_CHARS) record.cut++;
      sent.push({
        index,
        text: chars.length > READER_TEXT_CHARS ? chars.slice(0, READER_TEXT_CHARS).join("") : text,
        label: join(input.model, ...labels),
        call,
      });
    } catch (e) {
      if (e instanceof AiFault) outcomes[index] = { fault: e };
      else throw e;
    }
  }

  // Nothing to read gives nothing, with no call: an empty text is a field left empty.
  const toRead = sent.filter((s) => {
    if (s.text.trim() || type === "write") return true;
    outcomes[s.index] = { values: emptyValues(type, s.call), label: s.label };
    return false;
  });

  // Batches: a list reader takes up to READER_BATCH texts with the same options; the others one text a call.
  const batches: Sent[][] = [];
  if (spec.reader === "label_each" || (spec.reader === "summarize_each" && !long)) {
    const byCall = new Map<string, Sent[]>();
    for (const s of toRead) {
      const k = JSON.stringify(s.call);
      byCall.set(k, [...(byCall.get(k) ?? []), s]);
    }
    for (const group of byCall.values())
      for (let i = 0; i < group.length; i += READER_BATCH)
        batches.push(group.slice(i, i + READER_BATCH));
  } else for (const s of toRead) batches.push([s]);

  for (const batch of batches) {
    const first = batch[0] as Sent;
    const reader: ReaderName =
      first.call.reader === "label_each" && batch.length === 1 ? "classify" : first.call.reader;
    const call: ReaderCall = {
      ...first.call,
      reader,
      use: "reader",
      model: modelId,
      texts: batch.map((s) => s.text),
    };
    let fault = "";
    let values: Cell[] | undefined;
    const read = async (asked: ReaderCall): Promise<ReaderReply> => {
      const start = input.now();
      const reply = await port.read(asked);
      record.ms += input.now() - start;
      if (reply.model && !record.models.includes(reply.model)) record.models.push(reply.model);
      return reply;
    };
    for (let attempt = 0; attempt < 2 && !values; attempt++) {
      input.modelCall();
      record.calls++;
      const asked = attempt ? { ...call, again: { fault } } : call;
      let reply = await read(asked);
      // «Reintentar si el modelo falla»: only after a timeout or a provider's 5xx, each retry waited, counted and timed
      // first.
      for (let n = 1; "refused" in reply && reply.transient && input.retry && n <= retries; n++) {
        await input.retry(n);
        record.calls++;
        record.retried = (record.retried ?? 0) + 1;
        reply = await read(asked);
      }
      if ("refused" in reply) {
        fault = "";
        const f = new AiFault(`the model was not called: ${reply.refused}`, {
          code: "ai.refused",
          detail: { why: reply.refused },
        });
        for (const s of batch) outcomes[s.index] = { fault: f };
        break;
      }
      const checked = answerOf(call, reply.answer, batch.length);
      if ("values" in checked) values = checked.values;
      else fault = checked.fault;
    }
    if (values)
      for (const [k, s] of batch.entries())
        outcomes[s.index] = {
          values: spec.out
            ? { [spec.out]: values[k] as Cell }
            : (values[k] as Record<string, Cell>),
          label: s.label,
        };
    else if (fault) {
      const f = new AiFault(`«${step.name}»'s reader gave no answer that fits, twice`, {
        code: "ai.reply",
        detail: { reader: reader, why: fault },
      });
      for (const s of batch) outcomes[s.index] = { fault: f };
    }
  }
  return { outcomes: outcomes as ReaderOutcome[], record };
}

/** What a reader step gives for an empty text: its fields, empty. */
function emptyValues(
  type: ReaderType,
  call: Omit<ReaderCall, "texts" | "use" | "model">,
): Record<string, Cell> {
  const out = READER_TYPES[type].out;
  if (out) return { [out]: null };
  return Object.fromEntries((call.fields ?? []).map((f) => [f.key, null]));
}

/** The label of what a model wrote in a step of an automation (`docs/nucleo.md` §7.4: never a destination). */
export const modelLabelOf = (automation: string, step: string): Label =>
  makeLabel("model", "public", [{ kind: "model", id: `${automation}:${step}` }]);

// ---------------------------------------------------------------- Boni's pieces

/** At most this many texts to a piece's reader in one call, and options to the «Decisora». */
export const PIECE_TEXTS = 40;
export const PIECE_OPTIONS = 50;

/** A label for what is read as from outside: an «Ejemplo» cites a mail (AU-249, AU-255), whoever wrote it. */
const EXAMPLE_LABEL: Label = makeLabel(
  "external",
  "personal",
  [{ kind: "mail", id: "example" }],
  true,
);

interface PieceInput {
  reader: PieceReader;
  read: PieceRead;
  /** The step's parameter, resolved with its label, or undefined when the step has none. */
  param(key: string): { value: Cell; label: Label } | undefined;
  /** The collection's definition (its name and description), or undefined for one that is not there. */
  collection(key: string): { name?: string; description?: string } | undefined;
  port: AiPort | undefined;
  modelCall(): void;
  now(): number;
  zone: string;
  /** The label of what a model wrote, for this step. */
  model: Label;
  record: AiRecord;
}

const privateParam = (param: string): AiFault =>
  new AiFault(`a value no model may receive is in «${param}»`, {
    code: "ai.private",
    param,
    detail: { field: param },
  });

/**
 * One call of a piece's reader (AU-249, AU-255, AU-206): counted before it is made; refused with `ai.private` when a
 * text no model may receive arrives, when a parameter of its panel is not his own words fixed in the step, or when a
 * closed list holds what its panel does not; and its answer labelled with everything it read, the model's label
 * first. Nothing here lowers a label: what came from outside stays from outside (AU-230).
 */
export async function pieceRead(input: PieceInput): Promise<PieceReply> {
  const { reader, read: r, port, record } = input;
  if (!port?.piece)
    throw new AiFault("there is no port to call a model by", { code: "ai.unavailable" });
  const read: Label[] = [];
  if (!Array.isArray(r.texts) || r.texts.length > PIECE_TEXTS)
    throw new AiFault("a piece's reader got no list of texts", {
      code: "ai.params",
      detail: { why: "texts" },
    });
  const texts: string[] = [];
  for (const t of r.texts) {
    if (typeof t?.value !== "string" || !t.label) throw privateParam("texts");
    // What it reads is what came from outside, between markers (AU-255): never a row of his, nor what no model gets.
    if (t.label.noModel || t.label.integrity !== "external") throw privateParam("texts");
    read.push(t.label);
    const text = t.value.length > READER_TEXT_CHARS ? t.value.slice(0, READER_TEXT_CHARS) : t.value;
    if (text !== t.value) record.cut++;
    texts.push(text);
  }
  // The panel: his own words, fixed in the step (`shape`), so nothing of a row or of outside is ever one of them.
  const own = (key: string): Cell | undefined => {
    const got = input.param(key);
    if (got === undefined) return undefined;
    if (got.label.noModel || !atLeastOwn(got.label)) throw privateParam(key);
    read.push(got.label);
    return got.value;
  };
  const model = own(BONI_PARAMS.model);
  const call: PieceCall = {
    use: reader === "decide" ? "decision" : "reading",
    model: typeof model === "string" && model ? model : null,
    reader,
    texts,
    now: input.now(),
    zone: input.zone,
  };
  if (reader === "read_message") {
    const modules = own(BONI_PARAMS.modules);
    const list = Array.isArray(modules) ? modules : [...BONI_MODULES];
    if (!list.length || !list.every((m) => (BONI_MODULES as readonly unknown[]).includes(m)))
      throw privateParam(BONI_PARAMS.modules);
    call.modules = list as string[];
    const instructions = own(BONI_PARAMS.instructions);
    if (instructions !== undefined && instructions !== null && instructions !== "") {
      if (typeof instructions !== "string" || instructions.length > BONI_LIMITS.instructions)
        throw privateParam(BONI_PARAMS.instructions);
      call.instructions = instructions;
    }
    // «Ejemplos» cite mails: read between markers, as from outside, whoever wrote them (AU-249).
    const examples = input.param(BONI_PARAMS.examples);
    if (examples && Array.isArray(examples.value) && examples.value.length) {
      if (examples.label.noModel) throw privateParam(BONI_PARAMS.examples);
      const out: { mail: string; want: string }[] = [];
      for (const e of examples.value.slice(0, BONI_LIMITS.examples)) {
        const o = e as Record<string, unknown> | null;
        const mail = typeof o?.mail === "string" ? o.mail.slice(0, BONI_LIMITS.example) : "";
        const want = typeof o?.want === "string" ? o.want.slice(0, BONI_LIMITS.example) : "";
        if (mail) out.push({ mail, want });
      }
      if (out.length) {
        call.examples = out;
        read.push(examples.label, EXAMPLE_LABEL);
      }
    }
  }
  if (r.userIn !== undefined) {
    if (!(BONI_USER_IN as readonly unknown[]).includes(r.userIn)) throw privateParam("userIn");
    call.userIn = r.userIn;
  }
  if (reader === "decide") {
    // The options are collections of the panel, by key; their names and descriptions come from their definitions.
    const panel = own(BONI_PARAMS.collections);
    const keys = new Set(
      (Array.isArray(panel) ? panel : []).map((c) =>
        typeof c === "object" && c !== null && !Array.isArray(c)
          ? (c as Record<string, unknown>).collection
          : c,
      ),
    );
    const options = r.options ?? [];
    if (!Array.isArray(options) || !options.length || options.length > PIECE_OPTIONS)
      throw privateParam("options");
    call.options = options.map((key) => {
      const def = typeof key === "string" && keys.has(key) ? input.collection(key) : undefined;
      if (!def) throw privateParam("options");
      return {
        key,
        name: def.name ?? key,
        ...(def.description ? { description: def.description } : {}),
      };
    });
  }
  if (reader === "fill") {
    if (typeof r.collection !== "string" || !input.collection(r.collection))
      throw privateParam("collection");
    call.collection = r.collection;
  }
  if (r.again) call.again = { fault: String(r.again.fault).slice(0, 60) };
  input.modelCall();
  record.calls++;
  const start = input.now();
  const reply = await port.piece(call);
  record.ms += input.now() - start;
  if (reply.model && !record.models.includes(reply.model)) record.models.push(reply.model);
  if ("refused" in reply) return { refused: reply.refused };
  return { answer: reply.answer, label: join(input.model, ...read) };
}

const atLeastOwn = (l: Label): boolean => l.integrity === "own" || l.integrity === "user";
