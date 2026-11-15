/**
 * Dragging a field into a parameter (docs/automatizaciones.md AU-20, AU-21): which citation it writes, what the
 * parameter's value becomes, and how an expression is painted and previewed. The citation's grammar and its
 * resolving are `@boni/automations`'s (`printCitation`, `parseExpression`, `resolve`); nothing here parses by hand.
 */
import type { Automation, Cell, Citation, CiteFailure, ParamValue } from "@boni/automations";
import type { Sample } from "./client.ts";
import { notBuilt } from "./pending.ts";

/**
 * The citation a dragged field writes (AU-21). `from` is the step whose output the field is of, `into` the step
 * being edited, both by id, `path` the field's key and the keys inside it:
 * - `from` is the step `into` hangs from by its only input: `$json.campo`;
 * - an earlier step with rows that pair one to one down to `into`: `$('Paso').item.campo`;
 * - a step that remakes the rows («Agrupar», «Juntar en una», «Combinar») stands between: `$('Paso').first().campo`;
 * - `into` has two inputs («Combinar»), so it has no current row: `$('Paso').first().campo`, whichever input.
 */
export function citationFor(
  _draft: Automation,
  _into: string,
  _from: string,
  _path: readonly string[],
): Citation {
  return notBuilt("citationFor (AU-21)");
}

/**
 * A parameter's value after a field is dropped on it (AU-20): on text, the citation goes in at the caret (replacing
 * what is selected) and the value becomes an expression if it was not one; on any other value (a number, a date, a
 * choice), the citation replaces the whole value. A text with no caret (it never had the focus) is given with
 * `start` and `end` at its length: the citation goes at the end.
 */
export function dropCitation(
  _value: ParamValue | undefined,
  _on: { text: true; start: number; end: number } | { text: false },
  _cite: Citation,
): ParamValue {
  return notBuilt("dropCitation (AU-20)");
}

/**
 * «{ }» (AU-20), the small button inside every control of a value, always in sight. To «Expresión»: what was
 * written stays, as the expression's text (a number or a date as its text; nothing, an empty expression).
 */
export function toExpression(_value: ParamValue | undefined): ParamValue {
  return notBuilt("toExpression (AU-20)");
}

/** «{ }» back to «Fijo»: the control is left empty (null). Both ways are changes like any other: undone (AU-68). */
export function toFixed(_value: ParamValue | undefined): ParamValue {
  return notBuilt("toFixed (AU-20)");
}

/** An expression as it is painted: text as typed, and each citation a chip. */
export type Painted =
  | { kind: "text"; text: string }
  | {
      kind: "chip";
      cite: Citation;
      /** The field's name as the step view shows it; the key when no test has given its shape yet. */
      name: string;
      /**
       * The step the field is of, by id: its type gives the chip's icon. For the current row (`$json`) it is the
       * step `into` hangs from. Null when the citation names a step that is not there.
       */
      step: string | null;
      /**
       * The chip says the step too («Buscar gastos › Importe»): another step of `into`'s path has a field with the
       * same name.
       */
      withStep: boolean;
      /** Set when it cites a step or a field that is not there: painted red, with why (AU-84). */
      broken?: "step.unknown" | "field.unknown";
    }
  /** Not a simple citation: shown as typed until F14c (AU-22). */
  | { kind: "code"; source: string };

export function paint(
  _expr: string,
  _draft: Automation,
  /** The step being edited, by id: what `$json` is the row of. */
  _into: string,
  /** Field names by step name, then by key: from the last test's rows and the collections' shapes. */
  _names: Readonly<Record<string, Readonly<Record<string, string>>>>,
): Painted[] {
  return notBuilt("paint (AU-21)");
}

/**
 * What an expression gives with the first row of the last test (AU-20), resolved here on every keystroke: the
 * value, with which row and of how many («= 5 · con la fila 1 de 128»); why not, as the engine says it; or null
 * when the step has no test to preview with.
 */
export function preview(
  _value: ParamValue,
  _sample: Sample | null,
): { value: Cell; row: 1; of: number } | { failure: CiteFailure | "expr.code" } | null {
  return notBuilt("preview (AU-20)");
}
