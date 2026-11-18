/**
 * Dragging a field into a parameter (docs/automatizaciones.md AU-20, AU-21): which citation it writes, what the
 * parameter's value becomes, and how an expression is painted and previewed. The citation's grammar and its
 * resolving are `@boni/automations`'s (`printCitation`, `parseExpression`, `resolve`); nothing here parses by hand.
 */
import {
  type Automation,
  actionOf,
  type Cell,
  type Citation,
  CiteError,
  type CiteFailure,
  inputsOf,
  isExpr,
  type ParamValue,
  parseExpression,
  printCitation,
  type Row,
  resolve,
  type Scope,
} from "@boni/automations";
import type { T } from "../i18n.ts";
import type { RowView, Sample } from "./client.ts";
import { type ConditionField, fieldsOutOf, stepsBefore } from "./panel.ts";
import { fieldNames } from "./words.ts";

/** The steps `into` hangs from, by id: the start of every arrow into it. */
const parentsOf = (draft: Automation, into: string): string[] => [
  ...new Set(draft.arrows.filter((a) => a.to.step === into).map((a) => a.from.step)),
];

/**
 * Whether some way along the arrows from `from` down to `into` passes a step that remakes the rows: then the row
 * `into` gets cannot be followed back to one of `from`'s (AU-13). The steps strictly between count; `from` and
 * `into` do not.
 */
function remadeBetween(draft: Automation, from: string, into: string): boolean {
  const byId = new Map(draft.steps.map((s) => [s.id, s]));
  // The steps that reach `into`: only those can be on a way from `from` to it.
  const reaches = new Set([into, ...stepsBefore(draft, into)]);
  const seen = new Set<string>();
  const walk = (id: string): boolean => {
    for (const a of draft.arrows) {
      if (a.from.step !== id || !reaches.has(a.to.step)) continue;
      const next = a.to.step;
      if (next === into) continue;
      const s = byId.get(next);
      if (s && actionOf(s)?.pairs === false) return true;
      if (seen.has(next)) continue;
      seen.add(next);
      if (walk(next)) return true;
    }
    return false;
  };
  return walk(from);
}

/**
 * The citation a dragged field writes (AU-21). `from` is the step whose output the field is of, `into` the step
 * being edited, both by id, `path` the field's key and the keys inside it:
 * - `from` is the step `into` hangs from by its only input: `$json.campo`;
 * - an earlier step with rows that pair one to one down to `into`: `$('Paso').item.campo`;
 * - a step that remakes the rows («Agrupar», «Juntar en una», «Combinar») stands between: `$('Paso').first().campo`;
 * - `into` has two inputs («Combinar»), so it has no current row: `$('Paso').first().campo`, whichever input.
 */
export function citationFor(
  draft: Automation,
  into: string,
  from: string,
  path: readonly string[],
): Citation {
  const here = draft.steps.find((s) => s.id === into);
  const source = draft.steps.find((s) => s.id === from);
  const name = source?.name ?? from;
  const p = [...path];
  if (here && inputsOf(here).length > 1) return { step: name, pick: "first", path: p };
  if (parentsOf(draft, into).includes(from)) return { step: null, pick: "item", path: p };
  return { step: name, pick: remadeBetween(draft, from, into) ? "first" : "item", path: p };
}

/**
 * The step whose fields a step's own input lets drag (AU-21), given the arrows into that input: the step they come
 * from, or, with several, the first of them when the step has one input, since a field of its row is cited as
 * `$json` whichever arrow brought it. Several arrows into one input of a step with two («Combinar») say no step:
 * its fields are cited by step, and that one is chosen in ENTRADA's header.
 */
export function dragFrom(
  draft: Automation,
  into: string,
  arrows: readonly { from: { step: string } }[],
) {
  const here = draft.steps.find((s) => s.id === into);
  if (arrows.length === 1 || (here && inputsOf(here).length === 1)) return arrows[0]?.from.step;
  return undefined;
}

/** A key that can follow a dot as it is. */
const IDENT = /^[\p{ID_Start}$_][\p{ID_Continue}$\u200c\u200d]*$/u;

/**
 * What a field dropped into a «Código»'s editor writes there (AU-25): its key, as the code reads it, in the form the
 * step's mode lets cite. «Una vez por fila» (`perRow`) has a current row, so it is the expression's own citation
 * (`$json.precio`, `$('Paso').item.precio`, `$('Paso').first().precio`). «Una vez con todas las filas» (`all`) has
 * none (`expr.noCurrentRow`): the input's first row or the step's (`$input.first().precio`,
 * `$('Paso').first().precio`). `before`: the code just before the drop; right after a dot (`fila.`) the key alone
 * goes there, so a row the code already holds is read by its key.
 */
export function codeCitation(
  draft: Automation,
  into: string,
  from: string,
  path: readonly string[],
  mode: "all" | "perRow",
  before = "",
): string {
  const [first, ...rest] = path;
  if (first !== undefined && IDENT.test(first) && /\.\s*$/.test(before))
    return first + printCitation({ step: null, pick: "item", path: rest }).slice("$json".length);
  const cite = citationFor(draft, into, from, path);
  if (mode === "perRow") return printCitation(cite);
  if (cite.step === null)
    return `$input.first()${printCitation(cite).slice("$json".length)}`;
  return printCitation({ ...cite, pick: cite.pick === "item" ? "first" : cite.pick });
}

/** A citation as it goes into an expression's text. */
const written = (cite: Citation) => `{{ ${printCitation(cite)} }}`;

/** A fixed value as an expression's text: a number or a date as its text, nothing as nothing. */
function asText(value: ParamValue | undefined): string {
  if (value === undefined || value === null) return "";
  if (isExpr(value)) return value.expr;
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/**
 * A parameter's value after a field is dropped on it (AU-20): on text, the citation goes in at the caret (replacing
 * what is selected) and the value becomes an expression if it was not one; on any other value (a number, a date, a
 * choice), the citation replaces the whole value. A text with no caret (it never had the focus) is given with
 * `start` and `end` at its length: the citation goes at the end.
 */
export function dropCitation(
  value: ParamValue | undefined,
  on: { text: true; start: number; end: number } | { text: false },
  cite: Citation,
): ParamValue {
  if (!on.text) return { expr: written(cite) };
  const text = asText(value);
  const start = Math.max(0, Math.min(on.start, text.length));
  const end = Math.max(start, Math.min(on.end, text.length));
  return { expr: text.slice(0, start) + written(cite) + text.slice(end) };
}

/**
 * «{ }» (AU-20), the small button inside every control of a value, always in sight. To «Expresión»: what was
 * written stays, as the expression's text (a number or a date as its text; nothing, an empty expression).
 */
export function toExpression(value: ParamValue | undefined): ParamValue {
  return isExpr(value) ? value : { expr: asText(value) };
}

/** «{ }» back to «Fijo»: the control is left empty (null). Both ways are changes like any other: undone (AU-68). */
export function toFixed(_value: ParamValue | undefined): ParamValue {
  return null;
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

/**
 * The fields a step makes itself, by key: those of its names that none of the steps it hangs from gives. A field
 * that only passes through («Filtrar» lets «Importe» by) is its maker's, not every step's after it.
 */
function ownFields(
  draft: Automation,
  id: string,
  names: Readonly<Record<string, Readonly<Record<string, string>>>>,
  nameOf: (id: string) => string | undefined,
): Map<string, string> {
  const mine = names[nameOf(id) ?? ""] ?? {};
  const passed = new Set(
    parentsOf(draft, id).flatMap((p) => Object.keys(names[nameOf(p) ?? ""] ?? {})),
  );
  return new Map(Object.entries(mine).filter(([k]) => !passed.has(k)));
}

/** The step a field comes from: back along the first arrow in while the field only passes through. */
function makerOf(
  draft: Automation,
  id: string,
  key: string,
  names: Readonly<Record<string, Readonly<Record<string, string>>>>,
  nameOf: (id: string) => string | undefined,
): string {
  const seen = new Set<string>();
  let at = id;
  while (!seen.has(at)) {
    seen.add(at);
    const up = parentsOf(draft, at).find((p) => key in (names[nameOf(p) ?? ""] ?? {}));
    if (!up) return at;
    at = up;
  }
  return at;
}

export function paint(
  expr: string,
  draft: Automation,
  /** The step being edited, by id: what `$json` is the row of. */
  into: string,
  /** Field names by step name, then by key: from the last test's rows and the collections' shapes. */
  names: Readonly<Record<string, Readonly<Record<string, string>>>>,
): Painted[] {
  const parts = parseExpression(expr);
  if (!parts.some((p) => p.kind === "cite")) return parts as Painted[];
  const byName = new Map(draft.steps.map((s) => [s.name, s.id]));
  const nameOf = (id: string) => draft.steps.find((s) => s.id === id)?.name;
  const path = stepsBefore(draft, into);
  // The names each step of the path makes itself, made once for the whole expression.
  const own = new Map(path.map((id) => [id, ownFields(draft, id, names, nameOf)]));
  return parts.map((p): Painted => {
    if (p.kind !== "cite") return p;
    const { cite } = p;
    const step = cite.step === null ? (parentsOf(draft, into)[0] ?? null) : byName.get(cite.step);
    const [key = "", ...rest] = cite.path;
    if (step === undefined)
      return {
        kind: "chip",
        cite,
        name: cite.path.join(" › "),
        step: null,
        withStep: true,
        broken: "step.unknown",
      };
    const known = step === null ? undefined : names[nameOf(step) ?? ""];
    const field = known?.[key];
    const name = [field ?? key, ...rest].join(" › ");
    // A field is missing only where the step's shape is known (a test, a collection): else its key is all there is.
    const missing = !!known && Object.keys(known).length > 0 && field === undefined;
    let withStep = false;
    if (step !== null && field !== undefined) {
      const maker = makerOf(draft, step, key, names, nameOf);
      for (const [id, fields] of own)
        if (id !== maker && [...fields.values()].includes(field)) withStep = true;
    }
    return {
      kind: "chip",
      cite,
      name,
      step,
      withStep,
      ...(missing ? { broken: "field.unknown" as const } : {}),
    };
  });
}

/** A row of the sample as the engine reads it: what a citation picks. */
const rowOf = (v: RowView): Row => ({
  json: v.json,
  label: v.label,
  ...(v.fields
    ? {
        fields: Object.fromEntries(
          Object.entries(v.fields).map(([k, label]) => [k, { label, derived: false }]),
        ),
      }
    : {}),
  path: null,
  parent: null,
});

/**
 * What an expression gives with the first row of the last test (AU-20), resolved here on every keystroke: the
 * value, with which row and of how many («= 5 · con la fila 1 de 128»); why not, as the engine says it, with the
 * step it cites; or null when the step has no test to preview with.
 */
export function preview(
  value: ParamValue,
  sample: Sample | null,
):
  | { value: Cell; row: 1; of: number }
  | { failure: CiteFailure | "expr.code"; step?: string }
  | null {
  if (!sample || !isExpr(value)) return null;
  const parts = parseExpression(value.expr);
  if (parts.some((p) => p.kind === "code")) return { failure: "expr.code" };
  const current = sample.current ? rowOf(sample.current) : null;
  const scope: Scope = {
    current,
    row(step, pick) {
      const at = sample.steps[step];
      const cite: Citation = { step, pick, path: ["_"] };
      if (!at) throw new CiteError("notRun", cite);
      const v = at[pick];
      if (v) return rowOf(v);
      throw new CiteError(pick === "item" && at.first ? "noPair" : "noRows", cite);
    },
    literal: sample.current?.label ?? {
      integrity: "user",
      sensitivity: "personal",
      thirdParty: false,
      sources: [],
    },
  };
  try {
    return { value: resolve(value, scope).value, row: 1, of: sample.total };
  } catch (e) {
    if (e instanceof CiteError)
      return { failure: e.failure, ...(e.cite.step !== null ? { step: e.cite.step } : {}) };
    return { failure: "expr.code" };
  }
}

/** Field names by step name, then by key: a table (`citeNames`) or asked one step at a time (`namesOnDemand`). */
type NamesOf =
  | Readonly<Record<string, Readonly<Record<string, string>>>>
  | ((step: string) => Readonly<Record<string, string>> | undefined);

/**
 * A citation alone said by its field's name, as its chip says it (`paint`): what a step's summary says (AU-21), in
 * the view's header and on the canvas's card. Only the step it cites is looked at, never the whole path as `paint`
 * does for its «Paso › campo»: the canvas asks it for each of its cards on every change (A-15).
 */
export function citedName(
  draft: Automation,
  into: string,
  names: NamesOf,
): (cite: Citation) => string | undefined {
  const namesOf = typeof names === "function" ? names : (step: string) => names[step];
  return (cite) => {
    const [key = "", ...rest] = cite.path;
    let step: string | null = cite.step;
    if (step === null) {
      const up = parentsOf(draft, into)[0];
      step = up === undefined ? null : (draft.steps.find((s) => s.id === up)?.name ?? null);
    } else if (!draft.steps.some((s) => s.name === step)) return undefined;
    const known = step === null ? undefined : namesOf(step);
    const field = known?.[key];
    // A field is missing only where the step's shape is known (a test, a collection): else its key is all there is.
    if (known && Object.keys(known).length > 0 && field === undefined) return undefined;
    return [field ?? key, ...rest].join(" › ");
  };
}

/**
 * The names each step's fields go by, as the draft knows them (`fieldsOut`, `fieldNames`), made for a step only when
 * a citation asks for it and once per draft: what the canvas's cards cite by, with no test's rows (A-15).
 */
export function namesOnDemand(
  t: T,
  draft: Automation,
  collection: (key: string) => readonly ConditionField[] | undefined,
): (step: string) => Readonly<Record<string, string>> | undefined {
  const out = fieldsOutOf(draft, collection);
  const byName = new Map(draft.steps.map((s) => [s.name, s.id]));
  const made = new Map<string, Record<string, string>>();
  return (name) => {
    const id = byName.get(name);
    if (id === undefined) return undefined;
    let names = made.get(name);
    if (!names) {
      names = fieldNames(t, out(id));
      made.set(name, names);
    }
    return names;
  };
}
