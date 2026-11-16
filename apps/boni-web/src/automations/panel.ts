/**
 * What the step's view and its card show of a step, as data (docs/automatizaciones.md §5.7, «Contra el mar de
 * opciones»): the rows of «Parámetros», the options left to add, the six rows of «Ajustes», the labels of what is
 * not at its default, the summary line, and why «Probar paso» cannot be pressed. The components paint these and
 * decide nothing: what a test counts on the screen (AU-75) is `rowsOf`.
 */
import {
  ACTION,
  type ParamSpec,
  type ParamValue,
  paramsOf,
  type Step,
  type StepFailure,
  type StepSettings,
} from "@boni/automations";
import type { StepTest } from "./client.ts";
import { notBuilt } from "./pending.ts";

/** A row of «Parámetros»: one parameter with its control. A «cosa» of AU-75. */
export interface PanelRow {
  param: ParamSpec;
  value: ParamValue | undefined;
  /** An option Juan added (AU-76): it has «Quitar». The action and the shown parameters never do. */
  added: boolean;
}

/**
 * The rows of «Parámetros»: the catalogue's `paramsOf(step)` in its own order (the type's parameters, such as the
 * collection; the action, for a type with several; the parameters of that action whose `when` holds), keeping the
 * ones whose place is `shown`, and then the options that are in `step.params` (the ones Juan added), in the
 * catalogue's order. A `hidden` parameter is never a row. Without added options there are never more than seven
 * (AU-75): the same count `catalogue.test.ts` makes. A list (conditions, the fields of a row, a list of rows) is
 * one row: what is inside one of its entries is painted only once that entry is opened.
 */
export function rowsOf(_step: Step): PanelRow[] {
  return notBuilt("rowsOf (AU-75, AU-76)");
}

/** What «Añadir opción» lists (AU-76): the action's options not added yet; empty hides the button. */
export function optionsLeft(_step: Step): ParamSpec[] {
  return notBuilt("optionsLeft (AU-76)");
}

/** «Ajustes» (AU-78): the same six rows for every step, in this order. */
export const SETTINGS_ROWS = [
  "onError",
  "retry",
  "continueEmpty",
  "firstRowOnly",
  "note",
  "off",
] as const satisfies readonly (keyof StepSettings)[];

/**
 * A short label on the card for each thing not at its default (AU-79): a setting, by its key and what it says
 * («Reintenta 2 veces» needs the number), or an added option, by its parameter. `changesRows` for the three that
 * change which rows come out («Solo la primera fila», «Sigue sin filas», «Apagado»): those are said above SALIDA too.
 */
export type CardLabel =
  | { kind: "onError"; value: "continue" | "errorOutput"; changesRows: false }
  | { kind: "retry"; times: number; changesRows: false }
  | { kind: "continueEmpty" | "firstRowOnly" | "off"; changesRows: true }
  | { kind: "note"; changesRows: false }
  | { kind: "option"; param: string; changesRows: false };

/** In the order of `SETTINGS_ROWS`, then the added options in the panel's order. */
export function labelsOf(_step: Step): CardLabel[] {
  return notBuilt("labelsOf (AU-79)");
}

/** How many settings are not at their default: what the tab «Ajustes» counts (AU-79). */
export function settingsChanged(_step: Step): number {
  return notBuilt("settingsChanged (AU-79)");
}

/**
 * The card's summary (AU-63): one part per shown parameter that has a value, in the panel's order, to be joined
 * with « · ». A choice is its word, a collection its name, a fixed value itself, a citation its field's name,
 * conditions how many. `say` words what needs i18n or a name (words.ts).
 */
export function summaryOf(
  step: Step,
  say: (param: ParamSpec, value: ParamValue) => string,
): string[] {
  const parts: string[] = [];
  for (const p of paramsOf(step)) {
    // The action is the step's name already (AU-86): the summary says what it works on.
    if (p.place !== "shown" || p.key === ACTION) continue;
    const v = step.params[p.key];
    if (v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0)) continue;
    const part = say(p, v);
    if (part) parts.push(part);
  }
  return parts;
}

/** The required parameters of the step that are empty, in the panel's order. */
export function missingOf(_step: Step): ParamSpec[] {
  return notBuilt("missingOf (AU-73, AU-83)");
}

/**
 * Which of them are marked (AU-83): none until Juan leaves one (`left`, by key) or a test is asked (`asked`); then
 * those he left, or all.
 */
export function markedOf(_step: Step, _left: readonly string[], _asked: boolean): ParamSpec[] {
  return notBuilt("markedOf (AU-83)");
}

/**
 * Why «Probar paso» cannot be pressed, said next to it (AU-73): required parameters are empty («Falta: Colección»,
 * by their names), or a test is running («Probando…»). Null: it can.
 */
export function cannotTest(
  _step: Step,
  _testing: boolean,
): { why: "missing"; params: ParamSpec[] } | { why: "testing" } | null {
  return notBuilt("cannotTest (AU-73)");
}

/**
 * What SALIDA says in place of rows (AU-72, AU-84): each with what to do next. `untested`: «Sin probar», with
 * «Probar paso». `skipped`: no rows came. `failed`: the reason whole (its code, said by i18n.ts; `other` when
 * the engine gave none), with the parameter at fault and «Ir al parámetro» when there is one. `empty`: «0 filas». Null: there are rows to show.
 */
export type OutputSays =
  | { kind: "untested" }
  | { kind: "skipped" }
  | { kind: "failed"; failure: StepFailure; param?: ParamSpec }
  | { kind: "empty" };

export function outputSays(_step: Step, _test: StepTest | undefined): OutputSays | null {
  return notBuilt("outputSays (AU-72, AU-84)");
}

/** A field a condition can name, with the type that gives its operators (as in a view). */
export interface ConditionField {
  key: string;
  name: string;
  type: string;
}

/**
 * The conditions control (AU-81) is the views' filter editor (components/DatabaseHead.tsx), not a new one: the
 * builder gives that editor a slot for the control of a value, so a value is «Fijo» or «Expresión» (AU-20), and
 * every parameter of control `conditions` is painted with it. What it edits is the format's `ConditionItem[]` (a
 * `FilterItem` of @boni/views whose value may be an expression): nothing converts between two shapes. This gives
 * it the fields a condition can name: the collection's when the parameter is `over` the collection, and those of
 * the rows that arrive by that input in any other step (from the last test; none before one).
 */
export function conditionFields(
  _param: ParamSpec,
  _shapes: {
    collection: readonly ConditionField[];
    input: Readonly<Record<string, readonly ConditionField[]>>;
  },
): ConditionField[] {
  return notBuilt("conditionFields (AU-81)");
}
