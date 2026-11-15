/**
 * The words of «Automatizaciones» (docs/automatizaciones.md AU-25, AU-60, AU-85, AU-86): which key of `i18n.ts` says
 * each thing the catalogue names, the one key of each thing the editor does, and the names made from them (a new
 * step's, a result's). The catalogue has ids and no words (`@boni/automations` depends on no app): every word a
 * person reads is in `i18n.ts`, Spanish first, and a key the catalogue needs and `i18n.ts` lacks fails a test.
 */
import type { Automation, Step } from "@boni/automations";
import type { T } from "../i18n.ts";
import { notBuilt } from "./pending.ts";

/** The key that says each thing of the catalogue. */
export const KEY = {
  category: (category: string) => `auto.category.${category}`,
  step: (type: string) => `auto.step.${type}`,
  /** An action as a phrase («Buscar filas»): in the panel of adding, in the action's choice and in a step's name. */
  action: (type: string, action: string) => `auto.action.${type}.${action}`,
  param: (type: string, param: string) => `auto.param.${type}.${param}`,
  choice: (type: string, param: string, value: string) => `auto.choice.${type}.${param}.${value}`,
  output: (output: string) => `auto.output.${output}`,
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
} as const;

/** Every key of `i18n.ts` the catalogue needs as it is today: what a test asks `i18n.ts` for. */
export function catalogueKeys(): string[] {
  return notBuilt("catalogueKeys (AU-25)");
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
export function namer(_t: T, _collections: Readonly<Record<string, string>>): Namer {
  return notBuilt("namer (AU-86)");
}

/**
 * A name no other step of the draft has (AU-86): itself, or with the first free number from 2 («Filtrar 2»).
 * `but`: the step being named, which does not count.
 */
export function uniqueName(_draft: Automation, _name: string, _but?: string): string {
  return notBuilt("uniqueName (AU-86)");
}

/**
 * The names of the fields a step gives, by key, known without a test where the catalogue can say: a collection's
 * fields by their names; a result of «Agrupar» or «Contar o sumar» by its measure and its field's name («Suma de
 * Importe», «Número de filas»: AU-25, never the key `sum_importe`); a field Juan named, as he wrote it; the rest,
 * as the step before gives them. What chips, «Esquema», the tables' headers and the summaries read.
 */
export function fieldNames(
  _draft: Automation,
  _step: string,
  _shapes: Readonly<Record<string, Readonly<Record<string, string>>>>,
  _t: T,
): Record<string, string> {
  return notBuilt("fieldNames (AU-21, AU-25)");
}
