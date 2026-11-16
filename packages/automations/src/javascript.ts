/**
 * Reading JavaScript before it runs (docs/automatizaciones.md AU-24, AU-31, AU-36, AU-163): what an expression or a
 * «Código» cites (steps, fields, collections, the clock), where, and what is wrong with it. The server decides with it
 * what an evaluation receives, validation refuses what cannot be read beforehand, the editor marks and completes with
 * it, and a step's rename rewrites it (AU-02). It reads the code's shape and never runs it. It is not what keeps the
 * code in: that is the box, which gets only what the server sends it (box.ts). Contracts of F14c: not built yet.
 */
import type { CodeProblem } from "./code.ts";
import type { Automation, Step } from "./format.ts";
import { notBuilt } from "./pending.ts";
import type { ValidationContext } from "./validate.ts";

/**
 * Everything code can name that is not JavaScript's own, the same in an expression and in «Código» (AU-24); `$col`
 * only in «Código» (AU-46). The names are n8n's where the thing is the same (§10).
 */
export const CODE_GLOBALS = [
  /** The current row's fields, by key (AU-25). Not in «Una vez con todas las filas». */
  "$json",
  /** The step's input: `.all()`, `.first()`, `.last()` and `.item` (the current row). Rows are their fields. */
  "$input",
  /** `$('Step name')`: `.all()`, `.first()`, `.last()` and `.item` (the row this one comes from, AU-13). */
  "$",
  /** `$col('Collection name')`: `.find({ where, sort, limit })`, `.get(id)`, `.count({ where })`, `.sum(field, { where })` (AU-31). */
  "$col",
  /** The run's instant, the same in every step and every row of the run (AU-34), as a date of `DATE_HELP`. */
  "$now",
  /** The run's day in Juan's time zone, at 00:00. */
  "$today",
  /** `{ test, startedBy }`: whether it is a test, and what started it ("user" in F14c). Never a name or an id. */
  "$run",
  /** The values of the page that started it (F17). `null` until then. */
  "$page",
  /** `$date(value)`: a date of `DATE_HELP` from a field's value ("YYYY-MM-DD" or an instant in ms). */
  "$date",
  /** `console.log`, `.info`, `.warn`, `.error`: lines of «Consola» (AU-33). */
  "console",
] as const;
export type CodeGlobal = (typeof CODE_GLOBALS)[number];

/**
 * The dates' help, small and its own (AU-28): what `$now`, `$today` and `$date(…)` have. Wall-clock math is
 * `packages/calendar/src/time.ts`'s, in Juan's time zone; the box has no `Intl`, so the server sends with each call
 * the zone's offsets it will need, and `format` takes only the patterns listed. Units: `DateUnit` of effects.ts.
 */
export const DATE_HELP = {
  /** `.plus({ days: 7 })`, `.minus({ months: 1 })`, `.startOf('month')`, `.endOf('week')`, `.diff(other, 'days')`. */
  methods: ["plus", "minus", "startOf", "endOf", "diff", "format", "toISO", "toDay", "toMillis"],
  /** Read-only numbers: `.weekday` is 1 (Monday) to 7. */
  parts: ["year", "month", "day", "weekday", "hour", "minute"],
  /** What `.format(…)` takes: these tokens and plain text between them. Month and day names in the run's language. */
  tokens: ["yyyy", "yy", "MMMM", "MMM", "MM", "M", "dd", "d", "EEEE", "EEE", "HH", "H", "mm"],
} as const;

/**
 * The help with text and lists is JavaScript's own (`String`, `Array`, `Object`, `Math`, `JSON`), which the box has
 * whole, and nothing added to their prototypes: n8n's extra methods on values are not promised (AU-24, AU-37).
 */
export const OWN_HELP = [
  "String",
  "Array",
  "Object",
  "Math",
  "JSON",
  "Number",
  "RegExp",
  "Map",
  "Set",
] as const;

/** A place in the source: offsets, and the line and column of `from` (1-based). */
export interface Span {
  from: number;
  to: number;
  line: number;
  column: number;
}

/** Which fields of some rows the code reads: their keys when every use names one (`$json.precio`), else all. */
export type FieldsRead = readonly string[] | "all";

export interface CodeReading {
  /** `$json` and `$input`: what it reads of the step's own input; null when it reads none. */
  input: { fields: FieldsRead; current: boolean; all: boolean; at: readonly Span[] } | null;
  /** `$('Name')`: one entry per step cited, by name. `item`: it asks for the paired row (AU-13). */
  steps: readonly {
    name: string;
    fields: FieldsRead;
    item: boolean;
    all: boolean;
    at: readonly Span[];
  }[];
  /** `$col('Name')`: one entry per collection cited, by the name written. */
  collections: readonly { name: string; at: readonly Span[] }[];
  /** `$now`, `$today` or `$date`; `$run`; `$page`. */
  uses: { clock: boolean; run: boolean; page: boolean };
  /** What is wrong in the code by itself: syntax, a computed name, an unknown `$name`, code that waits. */
  problems: readonly CodeProblem[];
}

/**
 * Reads one piece of JavaScript: the inside of a `{{ }}` (an expression that gives a value) or a «Código» (a
 * function's body that returns). Total: code that is not JavaScript gives `code.syntax` and no citations.
 */
export function readCode(source: string, as: "expression" | "code"): CodeReading {
  return notBuilt(`readCode(${as}, ${source.length})`);
}

/** `ValidationContext` plus what code needs: a collection by the name Juan sees, since `$col` cites it by name. */
export interface CodeContext extends ValidationContext {
  /** The key of the collection with that name, as it is now. */
  collectionNamed(name: string): string | undefined;
}

/**
 * Everything wrong with a step's JavaScript and its connections (`CODE_PROBLEMS`, and the citations' own codes of
 * validate.ts), for `validate` to add to its list: nothing with an error here is tested or published (AU-31).
 */
export function codeProblems(
  step: Step,
  automation: Automation,
  context: CodeContext,
): CodeProblem[] {
  return notBuilt(`codeProblems(${step.id}, ${automation.steps.length}, ${typeof context})`);
}

/**
 * The source with every `$('from')` written as `$('to')`, and nothing else touched: not a text that happens to say
 * the same, not a comment (AU-02). `renameStep` calls it for every `{{ }}` and every «Código» of the automation.
 */
export function renameInCode(source: string, from: string, to: string): string {
  return notBuilt(`renameInCode(${source.length}, ${from}, ${to})`);
}

/**
 * What the editor completes at a place of the source (AU-36): the names of `CODE_GLOBALS`, the steps before this one,
 * the fields of a step's rows (by key, with the name to show: AU-25) and the collections connected. A model the
 * editor paints; the fields of a step are the ones its last test gave.
 */
export interface Completion {
  kind: "global" | "step" | "field" | "collection" | "method";
  /** What is written into the code. */
  insert: string;
  /** What is shown: a field's name, a step's name. Absent when it is the same. */
  label?: string;
}
