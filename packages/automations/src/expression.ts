/**
 * Expressions: what an `{ expr }` says and what it cites (docs/automatizaciones.md §5.3, §6). Until F14c an expression
 * is text with simple citations between `{{ }}`: a field of the current row or of a step before, which is what
 * dragging a field writes (AU-21). The server resolves them with no sandbox, and a value that is one citation and
 * nothing else keeps the exact label of the field it cites (AU-162). JavaScript enters here in F14c (AU-22): the
 * `code` part is its place, and until then validation refuses it.
 *
 * The grammar of a simple citation (the names are n8n's where the thing is the same, §10):
 *
 *   $json.total                         a field of the current row
 *   $json.padre.nombre                  a field of a related row (one level, AU-120)
 *   $json["mi-campo"]                   a key that is not a JavaScript identifier (dots and brackets may mix)
 *   $('Buscar filas').item.total        the row of that step the current one comes from (AU-13)
 *   $('Buscar filas').first().total     its first row; `.last()`, its last
 *
 * A step's name is quoted with ' or ", with \ before a quote or a backslash inside it. Spaces around a citation,
 * inside `{{ }}`, do not count. Anything else between `{{ }}` is `code`: `.all()` too, which gives a list of rows
 * and not a field (it works from F14c; what the app says for `noPair` names it, AU-13).
 */
import type { Label, Labeled } from "@boni/entities";
import type { ParamValue } from "./format.ts";
import { notBuilt } from "./pending.ts";
import type { Cell, Row } from "./rows.ts";

export interface Citation {
  /** The step cited, by its name; null for the current row (`$json`). */
  step: string | null;
  /** Which of its rows: the one the current row comes from, the first or the last. `$json` is always `item`. */
  pick: "item" | "first" | "last";
  /** The field's key, then the keys inside it. Never empty: a citation names a field. */
  path: string[];
}

export type ExprPart =
  | { kind: "text"; text: string }
  | { kind: "cite"; cite: Citation }
  /** Not a simple citation. F14c: JavaScript for the sandbox. Until then, the problem `expr.code`. */
  | { kind: "code"; source: string };

/** An expression's text in parts, in order. Never throws: what it cannot read as a citation is `code`. */
export function parseExpression(_expr: string): ExprPart[] {
  return notBuilt("parseExpression");
}

/** A citation as it is written, in its shortest form (a dot where the key is an identifier, `["…"]` where not). */
export function printCitation(_cite: Citation): string {
  return notBuilt("printCitation");
}

/** Every citation in a parameter's value, however deep (a list's rows, a condition's values), in order. */
export function citationsIn(_value: ParamValue): Citation[] {
  return notBuilt("citationsIn");
}

/** An expression's text with every citation of the step named `from` citing `to` instead; the rest untouched (AU-02). */
export function renameInExpression(_expr: string, _from: string, _to: string): string {
  return notBuilt("renameInExpression");
}

// ---------------------------------------------------------------- resolving

/**
 * Why a citation gave no value: a key, and each app says it in its `i18n.ts`. What it says for `noPair` proposes
 * `.first()` or `.all()` (AU-13).
 */
export type CiteFailure =
  /** No step has that name (validation catches it first). */
  | "unknownStep"
  /** The step did not run in this execution, or was skipped. */
  | "notRun"
  /** `.first()` or `.last()` of a step that gave no rows. */
  | "noRows"
  /** `.item`: a step that remade the rows stands between, or the current row does not come from that step. */
  | "noPair"
  /** `$json` or `.item` where there is no current row: a step that works with all the rows, or one run with none. */
  | "noCurrentRow";

export class CiteError extends Error {
  readonly failure: CiteFailure;
  readonly cite: Citation;
  constructor(failure: CiteFailure, cite: Citation) {
    super(`${failure}: ${cite.step ?? "$json"}`);
    this.name = "CiteError";
    this.failure = failure;
    this.cite = cite;
  }
}

/** What an expression is resolved against: the engine builds one per step and per row (engine.ts). */
export interface Scope {
  /** The current row; null in a step that works with all the rows at once, or that runs with an empty list. */
  current: Row | null;
  /** The row a citation of a step picks. Throws `CiteError`. */
  row(step: string, pick: Citation["pick"]): Row;
  /** The label of what Juan wrote in the automation: its fixed values and the text around a citation. */
  literal: Label;
}

/**
 * A parameter's value for one row, with its label (AU-162):
 * - a fixed value: itself, with `scope.literal`, not derived;
 * - one citation and nothing else: the field's value with its type and its exact label, derived only if the field
 *   was; a field the row does not have is null with the row's label;
 * - text with citations: a string, with the joined label of `scope.literal` and of every field cited, derived (it
 *   can never be a destination, P14);
 * - a structure: each value inside it, resolved the same way; its label is the join of them all.
 * Throws `CiteError`, and an Error for a `code` part (F14c).
 */
export function resolve(_value: ParamValue, _scope: Scope): Labeled<Cell> {
  return notBuilt("resolve");
}
