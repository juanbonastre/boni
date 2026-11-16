/**
 * The words of «Automatizaciones» (docs/automatizaciones.md AU-25, AU-60, AU-85, AU-86): which key of `i18n.ts` says
 * each thing the catalogue names, the one key of each thing the editor does, and the names made from them (a new
 * step's, a result's). The catalogue has ids and no words (`@boni/automations` depends on no app): every word a
 * person reads is in `i18n.ts`, Spanish first, and a key the catalogue needs and `i18n.ts` lacks fails a test.
 */
import {
  ACTION,
  type Automation,
  actionOf,
  CATALOGUE,
  CATEGORIES,
  type Cell,
  type Citation,
  isExpr,
  OUT,
  type ParamSpec,
  type ParamValue,
  PROBLEMS,
  parseExpression,
  SETTINGS_DEFAULTS,
  STEP_FAILURES,
  type Step,
  stepType,
} from "@boni/automations";
import type { T } from "../i18n.ts";
import type { RowView } from "./client.ts";
import type { CardLabel, ConditionField } from "./panel.ts";
import type { LogLine } from "./state.ts";

/** The key that says each thing of the catalogue. */
export const KEY = {
  category: (category: string) => `auto.category.${category}`,
  step: (type: string) => `auto.step.${type}`,
  /** An action as a phrase («Buscar filas»): in the panel of adding, in the action's choice and in a step's name. */
  action: (type: string, action: string) => `auto.action.${type}.${action}`,
  param: (type: string, param: string) => `auto.param.${type}.${param}`,
  choice: (type: string, param: string, value: string) => `auto.choice.${type}.${param}.${value}`,
  output: (output: string) => `auto.output.${output}`,
  /** An input, said only where a step has more than one («Combinar»: A and B). */
  input: (input: string) => `auto.input.${input}`,
  setting: (setting: string) => `auto.setting.${setting}`,
  /** A result's name: «Suma de {field}»; `count` takes no field («Número de filas»). */
  measure: (measure: string) => `auto.measure.${measure}`,
  /** A problem of validation and a step's failure, each with its `detail` as variables. */
  problem: (code: string) => `auto.problem.${code}`,
  failure: (code: string) => `auto.failure.${code}`,
} as const;

/**
 * What the editor does, each with its one key (AU-85): a component takes these words from here and from nowhere
 * else, and no other key of `auto.` says the same in either language.
 */
export const DO = {
  test: "auto.do.test",
  testStep: "auto.do.testStep",
  addOption: "auto.do.addOption",
  removeOption: "auto.do.removeOption",
  tidy: "auto.do.tidy",
  open: "auto.do.open",
  turnOff: "auto.do.turnOff",
  turnOn: "auto.do.turnOn",
  rename: "auto.do.rename",
  duplicate: "auto.do.duplicate",
  copy: "auto.do.copy",
  remove: "auto.do.remove",
  undo: "auto.do.undo",
  retrySave: "auto.do.retrySave",
  goToParam: "auto.do.goToParam",
  testBefore: "auto.do.testBefore",
  moreRows: "auto.do.moreRows",
  /** An entry of a list, added and erased in the step's view. */
  addRow: "auto.do.addRow",
  eraseRow: "auto.do.eraseRow",
  /** «{ }» in a value of the step's view: a fixed value becomes an expression and back (AU-20). */
  exprOn: "auto.do.exprOn",
  exprOff: "auto.do.exprOff",
} as const;

/** Every key of `i18n.ts` the catalogue needs as it is today: what a test asks `i18n.ts` for. */
export function catalogueKeys(): string[] {
  const keys = new Set<string>();
  for (const c of CATEGORIES) keys.add(KEY.category(c));
  const params = (type: string, list: readonly ParamSpec[]) => {
    for (const p of list) {
      if (p.place === "hidden") continue;
      keys.add(KEY.param(type, p.key));
      if (p.control === "choice" && Array.isArray(p.options) && p.key !== ACTION)
        for (const o of p.options) keys.add(KEY.choice(type, p.key, o));
      if (p.control === "list") params(type, p.columns);
    }
  };
  const measures = new Set<string>();
  for (const spec of CATALOGUE) {
    keys.add(KEY.step(spec.type));
    params(spec.type, spec.params);
    if (spec.actions.length > 1) {
      keys.add(KEY.param(spec.type, ACTION));
      for (const a of spec.actions) keys.add(KEY.action(spec.type, a.key));
    }
    if (spec.inputs.length > 1) for (const i of spec.inputs) keys.add(KEY.input(i));
    for (const a of spec.actions) {
      params(spec.type, a.params);
      if (Array.isArray(a.outputs)) for (const o of a.outputs) keys.add(KEY.output(o));
      for (const p of [
        ...a.params,
        ...a.params.flatMap((q) => (q.control === "list" ? q.columns : [])),
      ])
        if (p.key === "measure" && p.control === "choice" && Array.isArray(p.options))
          for (const m of p.options) measures.add(m);
    }
  }
  for (const o of Object.values(OUT)) keys.add(KEY.output(o));
  for (const s of Object.keys(SETTINGS_DEFAULTS)) keys.add(KEY.setting(s));
  for (const m of measures) keys.add(KEY.measure(m));
  for (const p of PROBLEMS) keys.add(KEY.problem(p));
  for (const f of STEP_FAILURES) keys.add(KEY.failure(f));
  return [...keys];
}

/**
 * The names an entry of the panel is found by (AU-69): its type's and its actions' as the step's view says them;
 * an entry of one action («Buscar filas») by that action's and its type's.
 */
export function entryNames(t: T, entry: { type: string; action?: string }): string[] {
  const spec = stepType(entry.type);
  const own = t(KEY.step(entry.type));
  if (entry.action) return [t(KEY.action(entry.type, entry.action)), own];
  return spec && spec.actions.length > 1
    ? [own, ...spec.actions.map((a) => t(KEY.action(entry.type, a.key)))]
    : [own];
}

/** How many conditions a value of `conditions` holds: a group counts its own (AU-81: one level). */
const conditionCount = (v: ParamValue): number =>
  Array.isArray(v)
    ? v.reduce<number>((n, c) => {
        const rules =
          c && typeof c === "object" && !Array.isArray(c) && !isExpr(c)
            ? (c as { rules?: unknown }).rules
            : undefined;
        return n + (Array.isArray(rules) ? rules.length : 1);
      }, 0)
    : 0;

/**
 * How the card's summary says each value of `step` (AU-63, `summaryOf` of panel.ts): a choice by its word, a
 * collection by its name, a citation by its field's name (`fieldNames`; its key where the draft does not know it), any other
 * expression as written, a number with its parameter's name («Límite 10»), a text as it is, a toggle on by its
 * parameter's name, a list and a row's fields by how many, conditions by how many. A toggle off says nothing.
 */
export function summaryWords(
  t: T,
  collections: Readonly<Record<string, string>>,
  step: Step,
  /** A citation's field's name, where the draft knows it (`paint` of cite.ts). */
  cited?: (cite: Citation) => string | undefined,
): (param: ParamSpec, value: ParamValue) => string {
  const name = (p: ParamSpec) => t(KEY.param(step.type, p.key));
  return (p, v) => {
    if (isExpr(v)) {
      const parts = parseExpression(v.expr);
      const only = parts.length === 1 ? parts[0] : undefined;
      return only?.kind === "cite"
        ? (cited?.(only.cite) ?? only.cite.path.join("."))
        : v.expr.trim();
    }
    switch (p.control) {
      case "picker":
        return p.of === "collection" && typeof v === "string" ? (collections[v] ?? v) : String(v);
      case "choice":
        return typeof v === "string" && Array.isArray(p.options)
          ? t(KEY.choice(step.type, p.key, v))
          : String(v);
      case "toggle":
        return v === true ? name(p) : "";
      case "conditions": {
        const n = conditionCount(v);
        return n === 1 ? t("auto.summary.conditions.one") : t("auto.summary.conditions", { n });
      }
      case "list":
      case "fields":
        return t("auto.summary.count", { name: name(p), n: Array.isArray(v) ? v.length : 1 });
      default:
        return typeof v === "number"
          ? t("auto.summary.number", { name: name(p), value: v })
          : typeof v === "string"
            ? v
            : "";
    }
  };
}

/**
 * A label of the card and of SALIDA in words (AU-79): «Si falla: seguir», «Reintenta 2 veces», «Sigue sin filas»;
 * «Solo la primera fila», «Nota» and «Apagado» by their setting's name; an added option by its parameter's.
 */
export function labelWord(t: T, step: Step, label: CardLabel): string {
  switch (label.kind) {
    case "onError":
      return t(`auto.label.onError.${label.value}`);
    case "retry":
      return label.times === 1
        ? t("auto.label.retry.one")
        : t("auto.label.retry", { n: label.times });
    case "continueEmpty":
      return t("auto.label.continueEmpty");
    case "option":
      return t(KEY.param(step.type, label.param));
    default:
      return t(KEY.setting(label.kind));
  }
}

/** When, said from now (AU-64, AU-72): «hace un momento», «hace 2 min», «hace 3 h», «hace 2 días». */
export function agoWords(t: T, at: number, now: number): string {
  const min = Math.floor(Math.max(0, now - at) / 60_000);
  if (min < 1) return t("auto.ago.now");
  if (min < 60) return t("auto.ago.min", { n: min });
  const h = Math.floor(min / 60);
  if (h < 24) return t("auto.ago.h", { n: h });
  return t("auto.ago.d", { n: Math.floor(h / 24) });
}

/** How long, in seconds with one decimal as each language writes it: «4,1 s», «4.1 s». */
export function secsWords(t: T, lang: "es" | "en", ms: number): string {
  const s = new Intl.NumberFormat(lang === "en" ? "en-GB" : "es-ES", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(Math.max(0, ms) / 1000);
  return t("auto.secs", { s });
}

/** How many rows: «128 filas», «1 fila», with the thousands as the language writes them. */
export function rowsWords(t: T, lang: "es" | "en", n: number): string {
  return t("auto.rows", { n: n.toLocaleString(lang === "en" ? "en-GB" : "es-ES") });
}

/**
 * The line of «Registro» (AU-64): «Sin probar»; «2 problemas»; «Última prueba hace 2 min · bien · 6 pasos · 4,1 s ·
 * no escribió nada»; «… · falló en «Filtrar»». `nameOf`: a step's name by its id.
 */
export function logWords(
  t: T,
  lang: "es" | "en",
  line: LogLine,
  nameOf: (step: string) => string,
  now: number,
): string {
  if (line.kind === "untested") return t("auto.view.untested");
  if (line.kind === "problems") return t("auto.log.problems", { n: line.count });
  const parts = [
    t("auto.log.last", { ago: agoWords(t, line.at, now) }),
    line.ok ? t("auto.log.ok") : t("auto.log.failedAt", { step: nameOf(line.failedAt) }),
    t("auto.log.steps", { n: line.steps }),
    secsWords(t, lang, line.ms),
  ];
  if (line.ok) {
    parts.push(t("auto.log.wroteNothing"));
    if (line.wouldWrite > 0) parts.push(t("auto.log.wouldWrite", { n: line.wouldWrite }));
  }
  return parts.join(" · ");
}

/** What names a step on its own (AU-86). */
export interface Namer {
  /**
   * The automatic name of a step as it is: its action's phrase and, when it has a collection, «en» and the
   * collection's name («Buscar filas en Gastos»); without one, the phrase alone. Not yet unique.
   */
  auto(step: Step): string;
}

/** `collections`: each collection's name by its key, as the app has them. */
export function namer(t: T, collections: Readonly<Record<string, string>>): Namer {
  return {
    auto(step) {
      const spec = stepType(step.type);
      if (!spec) return step.type;
      const action = spec.actions.length > 1 ? actionOf(step) : undefined;
      const phrase = action ? t(KEY.action(spec.type, action.key)) : t(KEY.step(spec.type));
      const picker = spec.params.find((p) => p.control === "picker" && p.of === "collection");
      const key = picker ? step.params[picker.key] : undefined;
      if (typeof key !== "string" || !key) return phrase;
      return t("auto.name.in", { action: phrase, collection: collections[key] ?? key });
    },
  };
}

/**
 * A name no other step of the draft has (AU-86): itself, or with the first free number from 2 («Filtrar 2»).
 * `but`: the step being named, which does not count.
 */
export function uniqueName(draft: Automation, name: string, but?: string): string {
  const taken = new Set(draft.steps.filter((s) => s.id !== but).map((s) => s.name));
  if (!taken.has(name)) return name;
  // «Filtrar 2» pasted again is «Filtrar 3», not «Filtrar 2 2».
  const base = name.replace(/ \d+$/, "") || name;
  for (let n = 2; ; n++) if (!taken.has(`${base} ${n}`)) return `${base} ${n}`;
}

/**
 * A field's name as Juan reads it (AU-21, AU-25): a result of «Agrupar» or «Contar o sumar» by its measure and its
 * field's name («Suma de Importe», «Número de filas», never the key `sum_importe`); a collection's field by its
 * name; a field Juan named, as he wrote it.
 */
export const fieldName = (t: T, f: ConditionField): string =>
  f.result ? t(KEY.measure(f.result.measure), { field: f.result.of ?? "" }) : f.name;

/**
 * The names of a step's fields by key, as `fieldName` says each: what chips, «Esquema», the tables' headers and the
 * summaries read. The fields are those the draft knows (`knownFields`, `fieldsOut` of panel.ts).
 */
export function fieldNames(t: T, fields: readonly ConditionField[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of fields) out[f.key] = fieldName(t, f);
  return out;
}

/**
 * The names of a step's options by field and by id, for the fields that are a choice: a row's value is said by its
 * option's name, never its id (`namedRow`).
 */
export function choiceNames(
  fields: readonly ConditionField[],
): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  for (const f of fields)
    if (f.options?.length) out[f.key] = Object.fromEntries(f.options.map((o) => [o.id, o.name]));
  return out;
}

/** A choice's options by field and id: what a value is said by. */
export type Choices = Readonly<Record<string, Readonly<Record<string, string>>>>;

/** The fields of a row with each choice said by its option's name: what Juan reads (F). */
export function namedValues(
  json: Record<string, Cell>,
  choices: Choices | undefined,
): Record<string, Cell> {
  if (!choices) return json;
  let out: Record<string, Cell> | null = null;
  for (const [k, opts] of Object.entries(choices)) {
    const v = json[k];
    const named =
      typeof v === "string" && opts[v] !== undefined
        ? opts[v]
        : Array.isArray(v) && v.some((x) => typeof x === "string" && opts[x] !== undefined)
          ? v.map((x) => (typeof x === "string" && opts[x] !== undefined ? opts[x] : x))
          : undefined;
    if (named === undefined) continue;
    out ??= { ...json };
    out[k] = named;
  }
  return out ?? json;
}
export const namedRow = (r: RowView, choices: Choices | undefined): RowView =>
  choices
    ? {
        ...r,
        json: namedValues(r.json, choices),
        ...(r.before ? { before: namedValues(r.before, choices) } : {}),
      }
    : r;
