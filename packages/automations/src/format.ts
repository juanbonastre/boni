/**
 * The format of an automation (docs/automatizaciones.md §5.1): a graph of steps joined by arrows, kept as data. A step
 * is its fixed id; its name is what Juan sees and what expressions cite (AU-02). Where each box is drawn is not here
 * (AU-05: the layout is kept apart, F14b), so nothing that reads this format can depend on the drawing (AU-12).
 *
 * Contracts of phase F14a: the types are final, the functions marked «not built» are the builder's.
 */
import type { FILTER_OPS } from "@boni/views";
import { renameInExpression } from "./expression.ts";

/**
 * The version of this format. A saved automation carries the one it was written with, and a deploy migrates it to
 * this one (`MIGRATIONS`): a step never carries a version of its own, so there are no steps «of an earlier version»
 * (AU-08).
 */
export const FORMAT = 1;

export interface Automation {
  /** The format it is written in (`FORMAT` once read by `parseAutomation`). */
  format: number;
  id: string;
  /** Which version of the automation this is (AU-01); 0 for one never published. Publishing is F14d (AU-95). */
  version: number;
  name: string;
  steps: Step[];
  arrows: Arrow[];
  settings: AutomationSettings;
}

/**
 * A box of the canvas. A closed shape: a saved step with any other key does not validate, so «Solo si», «Para cada»
 * and «Junto con» cannot come back as fields of every step (AU-126). F14c adds `connections` (§5.5).
 */
export interface Step {
  /** Fixed and never shown: what arrows and everything saved use (AU-02). */
  id: string;
  /** Unique in the automation; shown, and what expressions cite. `renameStep` changes it. */
  name: string;
  /** One entry of the catalogue (catalogue.ts): each type exists once (AU-08). */
  type: string;
  /** By the keys its type's action declares; `ACTION` chooses the action where a type has several. */
  params: Record<string, ParamValue>;
  /** The same six for every type (AU-78); a missing one is its default (`SETTINGS_DEFAULTS`). */
  settings?: StepSettings;
}

/** From one output of a step to one input of another, by their ids and the names the catalogue gives them (AU-03). */
export interface Arrow {
  from: { step: string; output: string };
  to: { step: string; input: string };
}

/** The input of every step but «Combinar», and the output of every step with one way out. */
export const MAIN = "main";
/** Outputs with a meaning the engine knows: «sí» and «no» of «Si», «otras» of «Elegir rama», «error» (AU-16). */
export const OUT = { main: MAIN, yes: "yes", no: "no", other: "other", error: "error" } as const;
/** The key of the parameter that chooses the action, in a type with several («Colección», «Fecha»). */
export const ACTION = "action";

// ---------------------------------------------------------------- values

/**
 * A value calculated when the step runs. Until F14c it is text with simple citations between `{{ }}`
 * (expression.ts), which the server resolves with no sandbox (AU-162); F14c lets JavaScript in (AU-22).
 */
export interface Expr {
  expr: string;
}

/**
 * What a parameter holds: a fixed value, an expression, or a structure of them (a list's rows, conditions, the
 * fields of a row). An object whose only key is `expr` is always an expression, at any depth: `isExpr`.
 */
export type ParamValue =
  | string
  | number
  | boolean
  | null
  | Expr
  | ParamValue[]
  | { [key: string]: ParamValue };

export const isExpr = (v: unknown): v is Expr =>
  typeof v === "object" &&
  v !== null &&
  !Array.isArray(v) &&
  Object.keys(v).length === 1 &&
  typeof (v as { expr?: unknown }).expr === "string";

/**
 * Conditions are the views' filter (`FilterItem` of @boni/views: «todas» by default, groups «y» or «o» one level
 * deep, the same twelve operators), with one difference: a value may be an expression. Once its values are resolved
 * a condition is a `FilterItem`, and it is matched with the views' `matchesFilters`: one filter in all of Boni (§3.2).
 */
export interface ConditionRule {
  /** A field's key: of the collection (a «Colección» step) or of the rows that arrive (every other step). */
  field: string;
  op: (typeof FILTER_OPS)[number];
  value?: string | number | Expr;
}
export interface ConditionGroup {
  join: "and" | "or";
  rules: ConditionRule[];
}
export type ConditionItem = ConditionRule | ConditionGroup;

/** One field of «the fields of a row» (create, modify, «Editar campos»): only the fields Juan adds (AU-121). */
export interface FieldValue {
  field: string;
  value: ParamValue;
}

// ---------------------------------------------------------------- settings

/** «Ajustes»: the same six rows in every step (AU-78). */
export interface StepSettings {
  /** «Si falla» (AU-16): stop the run, go on without the rows that failed, or send them out by «error». */
  onError?: "stop" | "continue" | "errorOutput";
  /** «Reintentar» (AU-16): up to `MAX_RETRIES` more tries, waiting `waitMs` before each. */
  retry?: { times: number; waitMs: number };
  /** «Seguir sin filas» (AU-14): an output of this step that carries no rows still starts what follows. */
  continueEmpty?: boolean;
  /** «Solo la primera fila»: the step works with the first row that arrives and not with the rest. */
  firstRowOnly?: boolean;
  /** «Nota»: Juan's own text. */
  note?: string;
  /** «Apagado»: the step does not run and its rows pass as they are. */
  off?: boolean;
}

export const MAX_RETRIES = 5;
export const SETTINGS_DEFAULTS = {
  onError: "stop",
  retry: { times: 0, waitMs: 0 },
  continueEmpty: false,
  firstRowOnly: false,
  note: "",
  off: false,
} as const satisfies Required<StepSettings>;

/** A run's limits (AU-17, F14d: their careful defaults and the code's ceiling arrive with that phase). */
export interface RunLimits {
  steps: number;
  modelCalls: number;
  rowsWritten: number;
  ms: number;
}
export interface AutomationSettings {
  limits?: Partial<RunLimits>;
}

// ---------------------------------------------------------------- reading and changing

/** What was saved is not an automation of this format: `path` says where («steps.2.params»). */
export class FormatError extends Error {
  readonly path: string;
  constructor(path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = "FormatError";
    this.path = path;
  }
}

/** One change of the format: what a deploy applies to every saved automation written in `from` (AU-08). */
export interface Migration {
  from: number;
  apply(saved: Record<string, unknown>): Record<string, unknown>;
}
/** In order, one per format version left behind. Empty while `FORMAT` is 1. */
export const MIGRATIONS: readonly Migration[] = [];

/**
 * Reads what was saved (parsed JSON): applies the migrations from its `format` up to the newest (`migrations` is
 * `MIGRATIONS` but in a test, which passes its own to show a format left behind being migrated), then checks the closed
 * shape (the keys of an automation, a step, an arrow and the settings, and their types; nothing else). Throws
 * `FormatError`. It does not judge whether the automation makes sense: that is `validate`, and a draft that does not
 * validate is still read and saved. What it returns survives `JSON.stringify` and reads back equal (AU-01).
 * A migration's result is taken as written in `from + 1`.
 */
export function parseAutomation(
  saved: unknown,
  migrations: readonly Migration[] = MIGRATIONS,
): Automation {
  let obj = record(saved, "");
  const format = obj.format;
  if (typeof format !== "number" || !Number.isInteger(format) || format < 0)
    throw new FormatError("format", "not a format version");
  if (format > FORMAT) throw new FormatError("format", `newer than this code (${FORMAT})`);
  for (let at = format; at < FORMAT; at++) {
    const m = migrations.find((x) => x.from === at);
    if (!m) throw new FormatError("format", `no migration from ${at}`);
    obj = record(m.apply(structuredClone(obj)), "");
  }
  closed(obj, "", ["format", "id", "version", "name", "steps", "arrows", "settings"], []);
  const version = obj.version;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 0)
    throw new FormatError("version", "not a version");
  return {
    format: FORMAT,
    id: text(obj.id, "id"),
    version,
    name: text(obj.name, "name"),
    steps: list(obj.steps, "steps").map((s, i) => parseStep(s, `steps.${i}`)),
    arrows: list(obj.arrows, "arrows").map((a, i) => parseArrow(a, `arrows.${i}`)),
    settings: parseSettings(obj.settings, "settings"),
  };
}

const at = (path: string, key: string | number) => (path ? `${path}.${key}` : String(key));

function record(v: unknown, path: string): Record<string, unknown> {
  if (typeof v !== "object" || v === null || Array.isArray(v))
    throw new FormatError(path || "(root)", "not an object");
  return v as Record<string, unknown>;
}

/** The keys of `v` are among `required` and `optional`, and every one of `required` is there. */
function closed(
  v: Record<string, unknown>,
  path: string,
  required: readonly string[],
  optional: readonly string[],
): void {
  for (const k of Object.keys(v))
    if (!required.includes(k) && !optional.includes(k))
      throw new FormatError(at(path, k), "not a key of this format");
  for (const k of required) if (v[k] === undefined) throw new FormatError(at(path, k), "missing");
}

function text(v: unknown, path: string): string {
  if (typeof v !== "string") throw new FormatError(path, "not a text");
  return v;
}

function list(v: unknown, path: string): unknown[] {
  if (!Array.isArray(v)) throw new FormatError(path, "not a list");
  return v;
}

function count(v: unknown, path: string): number {
  if (typeof v !== "number" || !Number.isFinite(v)) throw new FormatError(path, "not a number");
  return v;
}

function parseStep(v: unknown, path: string): Step {
  const s = record(v, path);
  closed(s, path, ["id", "name", "type", "params"], ["settings"]);
  const params = record(s.params, at(path, "params"));
  const step: Step = {
    id: text(s.id, at(path, "id")),
    name: text(s.name, at(path, "name")),
    type: text(s.type, at(path, "type")),
    params: Object.fromEntries(
      Object.entries(params).map(([k, p]) => [k, parseParam(p, at(at(path, "params"), k))]),
    ),
  };
  if (s.settings !== undefined) step.settings = parseStepSettings(s.settings, at(path, "settings"));
  return step;
}

function parseParam(v: unknown, path: string): ParamValue {
  if (v === null || typeof v === "string" || typeof v === "boolean") return v;
  if (typeof v === "number") return count(v, path);
  if (Array.isArray(v)) return v.map((x, i) => parseParam(x, at(path, i)));
  const o = record(v, path);
  return Object.fromEntries(Object.entries(o).map(([k, x]) => [k, parseParam(x, at(path, k))]));
}

const ON_ERROR = ["stop", "continue", "errorOutput"] as const;

function parseStepSettings(v: unknown, path: string): StepSettings {
  const s = record(v, path);
  closed(s, path, [], ["onError", "retry", "continueEmpty", "firstRowOnly", "note", "off"]);
  const out: StepSettings = {};
  if (s.onError !== undefined) {
    if (!ON_ERROR.includes(s.onError as (typeof ON_ERROR)[number]))
      throw new FormatError(at(path, "onError"), "not one of its options");
    out.onError = s.onError as StepSettings["onError"];
  }
  if (s.retry !== undefined) {
    const r = record(s.retry, at(path, "retry"));
    closed(r, at(path, "retry"), ["times", "waitMs"], []);
    out.retry = {
      times: count(r.times, at(path, "retry.times")),
      waitMs: count(r.waitMs, at(path, "retry.waitMs")),
    };
  }
  for (const k of ["continueEmpty", "firstRowOnly", "off"] as const) {
    if (s[k] === undefined) continue;
    if (typeof s[k] !== "boolean") throw new FormatError(at(path, k), "not true or false");
    out[k] = s[k] as boolean;
  }
  if (s.note !== undefined) out.note = text(s.note, at(path, "note"));
  return out;
}

function parseArrow(v: unknown, path: string): Arrow {
  const a = record(v, path);
  closed(a, path, ["from", "to"], []);
  const from = record(a.from, at(path, "from"));
  closed(from, at(path, "from"), ["step", "output"], []);
  const to = record(a.to, at(path, "to"));
  closed(to, at(path, "to"), ["step", "input"], []);
  return {
    from: {
      step: text(from.step, at(path, "from.step")),
      output: text(from.output, at(path, "from.output")),
    },
    to: { step: text(to.step, at(path, "to.step")), input: text(to.input, at(path, "to.input")) },
  };
}

const LIMITS = ["steps", "modelCalls", "rowsWritten", "ms"] as const;

function parseSettings(v: unknown, path: string): AutomationSettings {
  const s = record(v, path);
  closed(s, path, [], ["limits"]);
  if (s.limits === undefined) return {};
  const l = record(s.limits, at(path, "limits"));
  closed(l, at(path, "limits"), [], LIMITS);
  const limits: Partial<RunLimits> = {};
  for (const k of LIMITS) if (l[k] !== undefined) limits[k] = count(l[k], at(path, `limits.${k}`));
  return { limits };
}

/**
 * The same automation with a step renamed: every expression that cites the old name cites the new one (through
 * `renameInExpression`; F14c adds the code of «Código» steps), and nothing else changes: arrows use ids (AU-02).
 * Throws when no step has that id; the new name's uniqueness is `validate`'s.
 */
export function renameStep(automation: Automation, step: string, name: string): Automation {
  const target = automation.steps.find((s) => s.id === step);
  if (!target) throw new Error(`no step has the id ${step}`);
  const from = target.name;
  const rewrite = (v: ParamValue): ParamValue => {
    if (isExpr(v)) return { expr: renameInExpression(v.expr, from, name) };
    if (Array.isArray(v)) return v.map(rewrite);
    if (typeof v === "object" && v !== null)
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, rewrite(x)]));
    return v;
  };
  return {
    ...automation,
    steps: automation.steps.map((s) => ({
      ...s,
      ...(s.id === step ? { name } : {}),
      params: Object.fromEntries(Object.entries(s.params).map(([k, v]) => [k, rewrite(v)])),
    })),
  };
}
