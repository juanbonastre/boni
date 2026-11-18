/**
 * The words of «Automatizaciones» (docs/automatizaciones.md AU-25, AU-60, AU-85, AU-86): which key of `i18n.ts` says
 * each thing the catalogue names, the one key of each thing the editor does, and the names made from them (a new
 * step's, a result's). The catalogue has ids and no words (`@boni/automations` depends on no app): every word a
 * person reads is in `i18n.ts`, Spanish first, and a key the catalogue needs and `i18n.ts` lacks fails a test.
 */
import {
  ACTION,
  AI_CATEGORY,
  type Automation,
  actionOf,
  CATALOGUE,
  CATEGORIES,
  type Cell,
  type Citation,
  CODE_FAILURES,
  CODE_LIMITS,
  CODE_PROBLEMS,
  HARD_LIMITS,
  isExpr,
  OUT,
  type ParamSpec,
  type ParamValue,
  PEOPLE_CATEGORY,
  PEOPLE_FAILURES,
  PROBLEMS,
  parseExpression,
  RUN_LIMIT_KEYS,
  SCHEDULE_DAYS,
  SETTINGS_DEFAULTS,
  STEP_FAILURES,
  type Step,
  specOf,
  WRITE_ACTIONS,
} from "@boni/automations";
import type { T } from "../i18n.ts";
import { BESIDE_CATALOGUE } from "./adding.ts";
import type { RowView } from "./client.ts";
import { type CardLabel, type ConditionField, isEmpty } from "./panel.ts";
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
  /** A limit of the box by its key in `CODE_LIMITS` (AU-35): «el tiempo de una llamada». */
  limit: (limit: string) => `auto.limit.${limit}`,
  /** An action of saving as a detail names it (AU-176): «crear filas», «modificar filas», «eliminar filas». */
  writeAction: (action: string) => `auto.writeAction.${action}`,
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
  /** «‹ ›» under an expression: the row before and after the one it is worked out with (AU-23). */
  rowBefore: "auto.do.rowBefore",
  rowAfter: "auto.do.rowAfter",
  /** «Conecta «Gastos» a este paso» (AU-31): connects the collection the code cites. */
  connect: "auto.do.connect",
  allow: "auto.do.allow",
  disconnect: "auto.do.disconnect",
  /** F14d P1: «Publicar», «Ejecutar» and the button of a run stopped by a limit (AU-95, AU-97, AU-17). */
  publish: "auto.do.publish",
  publishVersion: "auto.do.publishVersion",
  run: "auto.do.run",
  changeLimit: "auto.do.changeLimit",
  /** F14d P2, in a run of «Ejecuciones» (AU-100, AU-18) and SALIDA's head (AU-93). «Reintentar» is `retrySave`'s. */
  undoRun: "auto.do.undoRun",
  undoRetry: "auto.do.undoRetry",
  openWithData: "auto.do.openWithData",
  pin: "auto.do.pin",
  unpin: "auto.do.unpin",
  moreRuns: "auto.do.moreRuns",
  /** F14d P3b-1: «⋯ → Versiones» and its «Volver a esta» (AU-98), «Eliminadas» and «Recuperar» (AU-191). */
  versions: "auto.do.versions",
  restoreVersion: "auto.do.restoreVersion",
  backToEditor: "auto.do.backToEditor",
  deletedList: "auto.do.deletedList",
  recover: "auto.do.recover",
  /** «Cambiar a «Compras»» under a code that cites a renamed collection by its name of before (AU-192). */
  renameCited: "auto.do.renameCited",
} as const;

/** Every key of `i18n.ts` the catalogue needs as it is today: what a test asks `i18n.ts` for. */
export function catalogueKeys(): string[] {
  const keys = new Set<string>();
  for (const c of [...CATEGORIES, AI_CATEGORY, PEOPLE_CATEGORY]) keys.add(KEY.category(c));
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
  // «Código», «Agente» and the three that talk to Juan (AU-30, AU-50, AU-69): in the panel beside the catalogue
  // (adding.ts), worded the same.
  for (const spec of [...CATALOGUE, ...BESIDE_CATALOGUE]) {
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
  for (const k of saidKeys()) keys.add(k);
  return [...keys];
}

/**
 * The names an entry of the panel is found by (AU-69): its type's and its actions' as the step's view says them;
 * an entry of one action («Buscar filas») by that action's and its type's.
 */
export function entryNames(t: T, entry: { type: string; action?: string }): string[] {
  const spec = specOf(entry.type);
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
 * A rule of «Programada» (AU-114) as the flows of before say theirs (`triggerText`, the same words): «Cada hora»,
 * «Cada hora a y 15», «Cada día a las 08:00», «Cada lunes a las 09:00». The day counts only with «Cada semana».
 */
export function ruleWords(t: T, rule: Readonly<Record<string, ParamValue>>): string {
  const at = typeof rule.at === "string" && /^\d\d:\d\d$/.test(rule.at) ? rule.at : "08:00";
  if (rule.every === "hour")
    return at.slice(3) === "00" ? t("flows.on.hour") : t("flows.on.hourAt", { m: at.slice(3) });
  if (rule.every === "week") {
    const i = SCHEDULE_DAYS.indexOf(rule.day as (typeof SCHEDULE_DAYS)[number]);
    return t("flows.on.week", { day: t(`flows.day.${(Math.max(i, 0) + 1) % 7}`), at });
  }
  return t("flows.on.day", { at });
}

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
        // «Programada»'s hours in words (AU-114): the first, and how many more.
        if (step.type === "schedule" && Array.isArray(v) && v.length > 0) {
          const first = ruleWords(t, v[0] as Record<string, ParamValue>);
          return v.length === 1 ? first : t("auto.summary.more", { first, n: v.length - 1 });
        }
        return t("auto.summary.count", { name: name(p), n: Array.isArray(v) ? v.length : 1 });
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
 * A row of a list parameter in one line, the head of its entry: its columns' values joined by « · »; a «Programada»'s
 * rule as a person says it («Cada lunes a las 09:00», AU-114).
 */
export function entryWords(
  t: T,
  step: Step,
  columns: readonly ParamSpec[],
  row: Readonly<Record<string, ParamValue>>,
): string {
  if (step.type === "schedule") return ruleWords(t, row);
  const say = summaryWords(t, {}, step);
  return columns
    .map((c) => {
      const x = row[c.key];
      return x === undefined || isEmpty(x) ? "" : say(c, x);
    })
    .filter(Boolean)
    .join(" · ");
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
 * The line of «Registro» (AU-64): «Sin probar»; «2 problemas»; «Última prueba hace 2 min · completada · 6 pasos · 4,1 s ·
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
  if (line.kind === "waiting")
    return `${t("auto.log.last", { ago: agoWords(t, line.at, now) })} · ${t("auto.log.waiting")}`;
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
      const spec = specOf(step.type);
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
/**
 * A value worked out by the box (a preview, AU-23) with each option said by its name, as a row's are (AU-21): the box
 * read the rows as they are kept, with ids, and what it gave is not tied to a field, so any text that is an option's
 * id of a step before is said by that option's name, also inside a list or an object.
 */
export function namedCell(value: Cell, choices: Readonly<Record<string, Choices>>): Cell {
  const names = new Map<string, string>();
  for (const byField of Object.values(choices))
    for (const opts of Object.values(byField))
      for (const [id, name] of Object.entries(opts)) names.set(id, name);
  if (!names.size) return value;
  const walk = (v: Cell): Cell =>
    typeof v === "string"
      ? (names.get(v) ?? v)
      : Array.isArray(v)
        ? v.map(walk)
        : v && typeof v === "object"
          ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]))
          : v;
  return walk(value);
}
export const namedRow = (r: RowView, choices: Choices | undefined): RowView =>
  choices
    ? {
        ...r,
        json: namedValues(r.json, choices),
        ...(r.before ? { before: namedValues(r.before, choices) } : {}),
      }
    : r;

// ---------------------------------------------------------------- what JavaScript's problems and failures say

/**
 * The codes of JavaScript that are said one way per reason (AU-24, AU-33, AU-35, AU-183): the detail that says which
 * reason, and every reason it can be. Each is its own key, `auto.problem.<code>.<reason>` or
 * `auto.failure.<code>.<reason>`, so a reason the engine gives and the screen has no words for fails a test.
 */
export const REASONS: Readonly<
  Record<"problem" | "failure", Readonly<Record<string, { by: string; of: readonly string[] }>>>
> = {
  problem: {
    "code.computed": { by: "what", of: ["step", "collection"] },
    "code.cannotWait": { by: "what", of: ["await", "import", "async", "generator"] },
    "connection.limits": { by: "why", of: ["field", "where", "limit"] },
    "code.colUse": { by: "why", of: ["kept", "computed", "unknown"] },
    "limit.over": { by: "limit", of: RUN_LIMIT_KEYS },
  },
  failure: {
    "run.limit": { by: "limit", of: RUN_LIMIT_KEYS },
    "code.result": { by: "why", of: ["nothing", "notRows", "notJson", "promise"] },
    "code.read.query": {
      by: "why",
      of: ["where", "sort", "limit", "id", "field", "hidden", "op", "notNumber"],
    },
    "code.unavailable": { by: "why", of: ["unavailable", "busy"] },
    "code.write.unseen": { by: "where", of: ["code", "expression"] },
    "code.write.outside": { by: "why", of: ["row", "created"] },
    "code.write.request": { by: "why", of: ["id", "fields", "field", "empty"] },
  },
};

/**
 * The codes said one way when a detail is there and another without it: a code's error with or without its line,
 * a limit with or without what it reached (time, operations and memory are cut at the limit, AU-35).
 */
const WITH: Readonly<Record<"problem" | "failure", Readonly<Record<string, string>>>> = {
  problem: {},
  failure: { "code.threw": "line", "code.limit": "got" },
};

/**
 * The codes said by reason only for some reasons, and by their own key otherwise: a collection no model may read
 * connected to an «Agente» (AU-166, `why: "private"`), and a request past «Como mucho» or naming a field the
 * connection leaves out (AU-196, AU-48: `why: "many"`, `why: "field"`).
 */
const SOME: Readonly<
  Record<"problem" | "failure", Readonly<Record<string, { by: string; of: readonly string[] }>>>
> = {
  problem: { "connection.notAllowed": { by: "why", of: ["private"] } },
  failure: { "code.write.notAllowed": { by: "why", of: ["many", "field"] } },
};

/** Every key the words of JavaScript need: what `catalogueKeys` adds, so both languages must have them. */
function saidKeys(): string[] {
  const keys: string[] = [];
  for (const [kind, codes] of [
    ["problem", CODE_PROBLEMS],
    ["failure", CODE_FAILURES],
  ] as const) {
    const key = kind === "problem" ? KEY.problem : KEY.failure;
    for (const code of codes) {
      const reasons = REASONS[kind][code];
      if (reasons) for (const r of reasons.of) keys.push(`${key(code)}.${r}`);
      else keys.push(key(code));
      const w = WITH[kind][code];
      if (w) keys.push(`${key(code)}.${w}`);
    }
  }
  // The codes of the run said by reason (AU-17): their reasons are the run's limits.
  for (const kind of ["problem", "failure"] as const)
    for (const [code, r] of Object.entries(REASONS[kind]))
      for (const reason of r.of)
        keys.push(`${(kind === "problem" ? KEY.problem : KEY.failure)(code)}.${reason}`);
  for (const kind of ["problem", "failure"] as const)
    for (const [code, r] of Object.entries(SOME[kind]))
      for (const reason of r.of)
        keys.push(`${(kind === "problem" ? KEY.problem : KEY.failure)(code)}.${reason}`);
  // Why «Preguntar», «Avisar» or «Responder» failed (people.ts): one key each.
  for (const code of PEOPLE_FAILURES) keys.push(KEY.failure(code));
  for (const l of HARD_LIMITS) keys.push(KEY.limit(l));
  for (const a of WRITE_ACTIONS) keys.push(KEY.writeAction(a));
  return keys;
}

/**
 * What a detail names, said as Juan reads it: a collection by its name (a detail gives its key, or the name as the
 * code wrote it), a field by its name. Whatever it cannot name is said as the detail has it.
 */
export interface SaidNames {
  collection?: (keyOrName: string) => string | undefined;
  field?: (collection: string, key: string) => string | undefined;
}

const KB = 1024;
const MB = 1024 * KB;
/** The limits measured in bytes; `ms` is time; every other is a count (AU-35). */
const BYTES = new Set<string>([
  "memoryBytes",
  "stackBytes",
  "inputBytes",
  "outputBytes",
  "readBytes",
  "stepReadBytes",
  "writeBytes",
  "stepWriteBytes",
]);

/** The locale numbers and dates are written in, by the app's language. */
export const localeOf = (lang: string): string => (lang === "en" ? "en-GB" : "es-ES");

/** A limit's amount with its unit: «5 s», «8 MB», «256 KB», «10.000». */
export function amountOf(limit: string, n: number, locale: string): string {
  const num = (x: number) => x.toLocaleString(locale, { maximumFractionDigits: 1 });
  if (limit === "ms") return `${num(n / 1000)} s`;
  if (BYTES.has(limit))
    return n >= MB ? `${num(n / MB)} MB` : n >= KB ? `${num(n / KB)} KB` : `${num(n)} B`;
  return num(n);
}

/**
 * A problem of validation or a step's failure in words (A-34): its key, by reason where it has one, with its detail
 * as variables, a collection and a field said by name, an action of saving and a limit by their words and an amount
 * with its unit. What a code wrote (an error's message, the parser's) stays as it came: the caller paints it as plain
 * text (A-01).
 */
export function said(
  t: T,
  kind: "problem" | "failure",
  x: { code: string; detail?: Record<string, string | number> },
  locale: string,
  names: SaidNames = {},
): string {
  const d = x.detail ?? {};
  const base = (kind === "problem" ? KEY.problem : KEY.failure)(x.code);
  const reason = REASONS[kind][x.code];
  const w = WITH[kind][x.code];
  const some = SOME[kind][x.code];
  const why = some ? d[some.by] : undefined;
  const key = reason
    ? `${base}.${String(d[reason.by] ?? reason.of[0])}`
    : w && d[w] !== undefined
      ? `${base}.${w}`
      : some && typeof why === "string" && some.of.includes(why)
        ? `${base}.${why}`
        : base;
  // A read's limit of rows, which a few say without a detail naming it.
  const vars: Record<string, string | number> = {
    readRows: amountOf("readRows", CODE_LIMITS.readRows, locale),
  };
  for (const [k, v] of Object.entries(d))
    vars[k] = typeof v === "number" ? v.toLocaleString(locale) : v;
  const collection = typeof d.collection === "string" ? d.collection : undefined;
  if (collection !== undefined) vars.collection = names.collection?.(collection) ?? collection;
  if (typeof d.field === "string" && collection !== undefined)
    vars.field = names.field?.(collection, d.field) ?? d.field;
  if (typeof d.action === "string") {
    vars.action = t(KEY.writeAction(d.action));
    // The action as a verb alone («Quiso eliminar 240 filas en Tareas», AU-196).
    if ((WRITE_ACTIONS as readonly string[]).includes(d.action))
      vars.verb =
        d.action === "remove" ? t(DO.remove).toLocaleLowerCase() : t(`auto.conn.to.${d.action}`);
  }
  if (typeof d.limit === "string") {
    // A code said by its limit names it in its own words; the box's limits are named in a common sentence.
    if (reason?.by !== "limit") vars.limit = t(KEY.limit(d.limit));
    for (const n of ["max", "got"] as const)
      if (typeof d[n] === "number") vars[n] = amountOf(d.limit, d[n] as number, locale);
  }
  // What a waiting run keeps (AU-203) is said in bytes: «pasa de 2 MB».
  if (x.code === "ask.kept" && typeof d.max === "number")
    vars.max = amountOf("memoryBytes", d.max, locale);
  return t(key, vars);
}
