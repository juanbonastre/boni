/**
 * What the step's view and its card show of a step, as data (docs/automatizaciones.md §5.7, «Contra el mar de
 * opciones»): the rows of «Parámetros», the options left to add, the six rows of «Ajustes», the labels of what is
 * not at its default, the summary line, and why «Probar paso» cannot be pressed. The components paint these and
 * decide nothing: what a test counts on the screen (AU-75) is `rowsOf`.
 */
import {
  ACTION,
  type Automation,
  actionOf,
  type CodeFailure,
  type FieldsOf,
  isExpr,
  isTrigger,
  MAIN,
  type ParamSpec,
  type ParamValue,
  paramsOf,
  paramValue,
  resultName,
  SETTINGS_DEFAULTS,
  type Step,
  type StepFailure,
  type StepSettings,
} from "@boni/automations";
import type { DataField } from "../core/agent.ts";
import type { StepTest } from "./client.ts";

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
export function rowsOf(step: Step): PanelRow[] {
  const all = paramsOf(step);
  const row = (param: ParamSpec, added: boolean): PanelRow => ({
    param,
    value: step.params[param.key],
    added,
  });
  return [
    ...all.filter((p) => p.place === "shown").map((p) => row(p, false)),
    ...all.filter((p) => p.place === "option" && p.key in step.params).map((p) => row(p, true)),
  ];
}

/** What «Añadir opción» lists (AU-76): the action's options not added yet; empty hides the button. */
export function optionsLeft(step: Step): ParamSpec[] {
  return paramsOf(step).filter((p) => p.place === "option" && !(p.key in step.params));
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
export function labelsOf(step: Step): CardLabel[] {
  const s = step.settings ?? {};
  const labels: CardLabel[] = [];
  for (const key of SETTINGS_ROWS) {
    if (!changed(s, key)) continue;
    if (key === "onError" && (s.onError === "continue" || s.onError === "errorOutput"))
      labels.push({ kind: "onError", value: s.onError, changesRows: false });
    else if (key === "retry" && s.retry)
      labels.push({ kind: "retry", times: s.retry.times, changesRows: false });
    else if (key === "note") labels.push({ kind: "note", changesRows: false });
    else if (key === "continueEmpty" || key === "firstRowOnly" || key === "off")
      labels.push({ kind: key, changesRows: true });
  }
  for (const r of rowsOf(step))
    if (r.added) labels.push({ kind: "option", param: r.param.key, changesRows: false });
  return labels;
}

/**
 * Whether a setting says something other than its default. A retry of no times retries nothing, and an empty or
 * blank note is no note, whatever the rest of it holds.
 */
function changed(s: StepSettings, key: keyof StepSettings): boolean {
  const v = s[key];
  if (v === undefined) return false;
  if (key === "retry") return (s.retry?.times ?? 0) > 0;
  if (key === "note") return typeof v === "string" && v.trim() !== "";
  return JSON.stringify(v) !== JSON.stringify(SETTINGS_DEFAULTS[key]);
}

/** How many settings are not at their default: what the tab «Ajustes» counts (AU-79). */
export function settingsChanged(step: Step): number {
  const s = step.settings ?? {};
  return SETTINGS_ROWS.filter((key) => changed(s, key)).length;
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
export function missingOf(step: Step): ParamSpec[] {
  return rowsOf(step)
    .map((r) => r.param)
    .filter((p) => {
      const v = paramValue(step, p);
      // A list under its «min» is as empty as a required one (the server's check refuses it too): a «Programada» with
      // no rule (AU-114).
      const few = p.control === "list" && (Array.isArray(v) ? v.length : 0) < (p.min ?? 0);
      return (p.required && isEmpty(v)) || few;
    });
}

/** Nothing written: no value, an empty text, an empty list. An expression is a value, even before it is resolved. */
export const isEmpty = (v: ParamValue | undefined): boolean =>
  v === undefined ||
  v === null ||
  (typeof v === "string" && v.trim() === "") ||
  (Array.isArray(v) && v.length === 0) ||
  (isExpr(v) && v.expr.trim() === "");

/**
 * Which of them are marked (AU-83): none until Juan leaves one (`left`, by key) or a test is asked (`asked`); then
 * those he left, or all.
 */
export function markedOf(step: Step, left: readonly string[], asked: boolean): ParamSpec[] {
  const missing = missingOf(step);
  return asked ? missing : missing.filter((p) => left.includes(p.key));
}

/**
 * Why «Probar paso» cannot be pressed, said next to it (AU-73): required parameters are empty («Falta: Colección»,
 * by their names), or a test is running («Probando…»). Null: it can.
 */
export function cannotTest(
  step: Step,
  testing: boolean,
): { why: "missing"; params: ParamSpec[] } | { why: "testing" } | null {
  if (testing) return { why: "testing" };
  const params = missingOf(step);
  return params.length ? { why: "missing", params } : null;
}

/**
 * What SALIDA says in place of rows (AU-72, AU-84): each with what to do next. `untested`: «Sin probar», with
 * «Probar paso». `skipped`: no rows came. `stopped`: the test stopped before it, in the step that failed («Parado: la
 * prueba paró en «Filtrar»», AU-67). `failed`: the reason whole (its code, said by i18n.ts; `other` when the engine
 * gave none), with the parameter at fault and «Ir al parámetro» when there is one. `empty`: «0 filas». Null: there
 * are rows to show.
 */
export type OutputSays =
  | { kind: "untested" }
  | { kind: "skipped" }
  | { kind: "stopped" }
  | { kind: "failed"; failure: StepFailure | CodeFailure; param?: ParamSpec }
  | { kind: "empty" };

export function outputSays(step: Step, test: StepTest | undefined): OutputSays | null {
  if (!test || test.state === "queued" || test.state === "running" || test.state === "waiting")
    return { kind: "untested" };
  if (test.state === "skipped") return { kind: "skipped" };
  if (test.state === "stopped") return { kind: "stopped" };
  if (test.state === "failed") {
    // A failure of JavaScript says which in `why` (`CodeFault`): that is what is said, not its general `other`.
    const failure: StepFailure | CodeFailure = test.error?.why ??
      test.error?.failure ?? { code: "other" };
    // `param` is written as a problem's is: the parameter's key, then the path inside it.
    const key = failure.param?.split(".")[0];
    const param = key ? paramsOf(step).find((p) => p.key === key) : undefined;
    return param ? { kind: "failed", failure, param } : { kind: "failed", failure };
  }
  return Object.values(test.out).some((n) => n > 0) ? null : { kind: "empty" };
}

/** A field a condition can name, with the type that gives its operators (as in a view). */
export interface ConditionField {
  key: string;
  name: string;
  type: string;
  /** A collection's field brings what the views' editor needs of it: a choice's options, a relation's target. */
  options?: { id: string; name: string; color?: string }[];
  relation?: { target: string; many: boolean };
  /**
   * A result of «Agrupar» or «Contar o sumar»: its measure and the name of the field it is of. Its name is made from
   * them in `i18n.ts` (`fieldName`, «Suma de Importe»), never its key `sum_importe` (AU-21, AU-25).
   */
  result?: { measure: string; of?: string };
}

/** A collection's fields as a condition and a citation name them: by its key, with a choice's options, a relation's target. */
export function conditionFieldsOf(collection: { fields: readonly DataField[] }): ConditionField[] {
  return collection.fields.map((f) => ({
    key: f.key ?? f.id,
    name: f.name,
    type: f.type,
    ...(f.options ? { options: f.options } : {}),
    ...(f.relation ? { relation: f.relation } : {}),
  }));
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
  param: ParamSpec,
  shapes: {
    collection: readonly ConditionField[];
    input: Readonly<Record<string, readonly ConditionField[]>>;
  },
): ConditionField[] {
  const over = fieldsOver(param);
  if (!over) return [];
  return [...(over.of === "collection" ? shapes.collection : (shapes.input[over.input] ?? []))];
}

/** What a parameter's fields are of: conditions and the fields of a row by `over`, a choice of a field by `options`. */
export function fieldsOver(param: ParamSpec): FieldsOf | null {
  if (param.control === "conditions" || param.control === "fields") return param.over;
  if (param.control === "choice" && !Array.isArray(param.options)) return param.options as FieldsOf;
  return null;
}

/** A row's field as the manual trigger asks it (its `type` column) in the views' types of a field. */
const ASKED: Readonly<Record<string, string>> = {
  text: "text",
  number: "number",
  checkbox: "checkbox",
  date: "date",
  datetime: "datetime",
};

/**
 * The fields of the rows that arrive by `input` at `step`, as far as the draft says before any test (what
 * `conditionFields` is given until «Probar» brings the real ones, E): walking back along the arrows, through the steps
 * that let the rows pass as they are, to where the rows are made: a «Colección» step that reads or writes rows (its
 * collection's fields, `collection`), the manual trigger (the fields it asks), «Editar campos» (the fields it sets,
 * and those before it unless it keeps none), «Fecha» (the field it writes), «Agrupar» (what it groups by and its
 * results) and «Combinar» (both inputs). Anything else: none known.
 */
export function knownFields(
  draft: Automation,
  step: string,
  input: string,
  collection: (key: string) => readonly ConditionField[] | undefined,
): ConditionField[] {
  return fieldWalk(draft, collection).into(step, input);
}

/** The fields of the rows `step` gives, as far as the draft says (a trigger's: the fields it asks, AU-70). */
export function fieldsOut(
  draft: Automation,
  step: string,
  collection: (key: string) => readonly ConditionField[] | undefined,
): ConditionField[] {
  return fieldsOutOf(draft, collection)(step);
}

/**
 * `fieldsOut` for many steps of one draft: each input is walked once, however many steps ask (the canvas's 200
 * cards, A-15).
 */
export function fieldsOutOf(
  draft: Automation,
  collection: (key: string) => readonly ConditionField[] | undefined,
): (step: string) => ConditionField[] {
  const walk = fieldWalk(draft, collection);
  const byId = new Map(draft.steps.map((s) => [s.id, s]));
  return (step) => {
    const s = byId.get(step);
    return s ? walk.outOf(s) : [];
  };
}

function fieldWalk(
  draft: Automation,
  collection: (key: string) => readonly ConditionField[] | undefined,
) {
  const byId = new Map(draft.steps.map((s) => [s.id, s]));
  /** What came into each input, once walked; empty while it is being walked (a loop gives nothing). */
  const walked = new Map<string, ConditionField[]>();
  const into = (id: string, inp: string): ConditionField[] => {
    const at = `${id}:${inp}`;
    const was = walked.get(at);
    if (was) return was;
    walked.set(at, []);
    const from = draft.arrows.filter((a) => a.to.step === id && a.to.input === inp);
    const fields = unique(
      from.flatMap((a) => {
        const s = byId.get(a.from.step);
        return s ? outOf(s) : [];
      }),
    );
    walked.set(at, fields);
    return fields;
  };
  /** What each step gives, once made. */
  const gives = new Map<string, ConditionField[]>();
  const outOf = (s: Step): ConditionField[] => {
    let fields = gives.get(s.id);
    if (!fields) {
      fields = make(s);
      gives.set(s.id, fields);
    }
    return fields;
  };
  const make = (s: Step): ConditionField[] => {
    const p = s.params;
    switch (s.type) {
      case "manual":
        return entries(p.fields).flatMap((f) =>
          typeof f.key === "string" && f.key
            ? [
                {
                  key: f.key,
                  name: typeof f.name === "string" && f.name ? f.name : f.key,
                  type: ASKED[String(f.type ?? "text")] ?? "text",
                },
              ]
            : [],
        );
      case "collection": {
        if (typeof p.collection !== "string") return [];
        const fields = collection(p.collection) ?? [];
        if (p.action !== "aggregate") return [...fields];
        // «Contar o sumar»: what it groups by, and its result.
        const measure = typeof p.measure === "string" ? p.measure : "count";
        const of = measure !== "count" && typeof p.field === "string" ? p.field : undefined;
        const by = typeof p.groupBy === "string" ? fields.filter((f) => f.key === p.groupBy) : [];
        return [...by, resultField(measure, of, fields)];
      }
      case "filter":
      case "sort":
      case "limit":
      case "dedupe":
      case "if":
      case "switch":
      case "split":
        return into(s.id, MAIN);
      case "edit": {
        const set = entries(p.fields).flatMap((f) =>
          typeof f.field === "string" && f.field
            ? [{ key: f.field, name: f.field, type: "text" }]
            : [],
        );
        return p.keep === "none" ? set : unique([...into(s.id, MAIN), ...set]);
      }
      case "date": {
        const before = into(s.id, MAIN);
        return typeof p.to === "string" && p.to
          ? unique([...before, { key: p.to, name: p.to, type: "text" }])
          : before;
      }
      case "group": {
        const before = into(s.id, MAIN);
        const by = entries(p.by).flatMap((b) =>
          typeof b.field === "string" ? before.filter((f) => f.key === b.field) : [],
        );
        const measures = entries(p.measures).flatMap((m) =>
          typeof m.measure === "string"
            ? [
                resultField(
                  m.measure,
                  m.measure !== "count" && typeof m.field === "string" ? m.field : undefined,
                  before,
                ),
              ]
            : [],
        );
        return [...by, ...measures];
      }
      case "combine":
        return unique([...into(s.id, "a"), ...into(s.id, "b")]);
      default:
        return [];
    }
  };
  return { into, outOf };
}

/** A result's field: keyed as the engine writes it, named by its measure and its field's name. */
function resultField(
  measure: string,
  of: string | undefined,
  among: readonly ConditionField[],
): ConditionField {
  const key = resultName(measure, of);
  const name = of === undefined ? undefined : (among.find((f) => f.key === of)?.name ?? of);
  return {
    key,
    name: key,
    type: measure === "list" ? "text" : "number",
    result: name === undefined ? { measure } : { measure, of: name },
  };
}

/** The rows of a list's value, the ones that are objects. */
const entries = (v: ParamValue | undefined): Record<string, ParamValue>[] =>
  Array.isArray(v)
    ? v.filter(
        (x): x is Record<string, ParamValue> =>
          typeof x === "object" && x !== null && !Array.isArray(x) && !isExpr(x),
      )
    : [];
const unique = (fields: ConditionField[]): ConditionField[] => {
  const by = new Map<string, ConditionField>();
  for (const f of fields) if (!by.has(f.key)) by.set(f.key, f);
  return [...by.values()];
};

/** The steps before `step` along the arrows, nearest first (AU-71: ENTRADA's «Ver los datos de»). */
export function stepsBefore(draft: Automation, step: string): string[] {
  const seen = new Set<string>([step]);
  const out: string[] = [];
  let ring = [step];
  while (ring.length) {
    const next: string[] = [];
    for (const id of ring)
      for (const a of draft.arrows)
        if (a.to.step === id && !seen.has(a.from.step)) {
          seen.add(a.from.step);
          out.push(a.from.step);
          next.push(a.from.step);
        }
    ring = next;
  }
  return out;
}

/**
 * The trigger a test starts from (AU-64, AU-91): for «Probar paso», the nearest one the arrows reach the step from;
 * for «Probar», or a step no trigger reaches, the draft's first. Null with no trigger.
 */
export function triggerFor(draft: Automation, step: string | null): string | null {
  const triggers = draft.steps.filter(isTrigger).map((s) => s.id);
  if (step !== null) {
    if (triggers.includes(step)) return step;
    const found = stepsBefore(draft, step).find((id) => triggers.includes(id));
    if (found) return found;
  }
  return triggers[0] ?? null;
}

/** A step that writes in a collection: in a test, its SALIDA shows «Haría esto» (AU-72). */
export const writesRows = (step: Step): boolean => actionOf(step)?.effect === "write";
