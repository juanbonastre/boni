/**
 * Validation: whether an automation makes sense, said as a list of problems that each point at their step and their
 * parameter (docs/automatizaciones.md §5.1, §5.3, §5.10). The canvas paints them on the box and on the control
 * (F14b), publishing refuses an automation with an error (F14d), and the engine refuses to run one. A draft with
 * problems is still an automation: it is read, saved and edited.
 *
 * It needs no run and no data: only the automation, the catalogue and the shape of the collections it names.
 */
import type { CollectionShape } from "./effects.ts";
import type { Automation } from "./format.ts";
import { notBuilt } from "./pending.ts";

/**
 * Every problem there is. A code is a key: each app says it to Juan in its `i18n.ts`, with what `detail` carries.
 * Adding one is a change of the contract: the canvas has a text for each.
 */
export const PROBLEMS = [
  // The automation
  "trigger.none", // no step is a trigger
  // A step
  "step.duplicateId",
  "step.emptyName",
  "step.duplicateName", // names are what expressions cite (AU-02). detail: name
  "step.unknownType", // not in the catalogue (AU-08). detail: type
  "step.settings", // a setting out of range (more than MAX_RETRIES tries, a negative wait). param: the setting
  // An arrow (`arrow` is its index)
  "arrow.unknownStep",
  "arrow.unknownOutput", // the step has no such output as it is now (AU-03). detail: output
  "arrow.unknownInput", // detail: input
  "arrow.intoTrigger", // a trigger has no input
  "arrow.duplicate",
  "arrow.cycle", // AU-07: on every arrow of the cycle
  // A parameter (`param` is its key, or the path to the value inside it)
  "param.required",
  "param.unknown", // a key its type's action does not declare, or one whose `when` does not hold (AU-126)
  "param.shape", // a `shape` parameter holds an expression (AU-26)
  "param.value", // not what its control takes: not one of the options, not a number, a list with too few rows
  "param.condition", // «Las que cumplan…» with no condition (AU-121)
  // An expression (`param` is the path to it)
  "expr.code", // not a simple citation: JavaScript arrives in F14c (AU-22)
  "expr.unknownStep", // cites a name no step has. detail: name
  "expr.notBefore", // cites a step that does not always run before this one. detail: name
  "expr.cannotPair", // `.item` across a step that remakes the rows (AU-13). detail: name, by (the step between)
  "expr.noCurrentRow", // `$json` or `.item` in a parameter of a step that works with all the rows
  // The collections
  "collection.unknown", // detail: collection
  "field.unknown", // a field its collection does not have. detail: field
  // Warnings: it runs, and something is probably missing
  "step.unreachable", // no trigger reaches it
  "output.unconnected", // «sí» or «no» of a «Si», or a rule of «Elegir rama», goes nowhere. detail: output
] as const;
export type ProblemCode = (typeof PROBLEMS)[number];

/** The codes that are only warnings; every other is an error. */
export const WARNINGS: readonly ProblemCode[] = ["step.unreachable", "output.unconnected"];

export interface Problem {
  code: ProblemCode;
  /** An error stops publishing and running; a warning does neither. */
  severity: "error" | "warning";
  /** The id of the step it is about: the box the canvas marks. Absent for a problem of the automation as a whole. */
  step?: string;
  /**
   * Where in the step: a parameter's key («where»), or the path to the value inside it with dots («rules.2.where.0.
   * value», «fields.3.value»): the control the canvas marks. For `step.settings`, the setting's key.
   */
  param?: string;
  /** The index of the arrow it is about, in `automation.arrows`. With `step`, the step the arrow leaves from. */
  arrow?: number;
  /** What the message needs, by fixed keys (the ones each code lists above). Never text for a person. */
  detail?: Record<string, string | number>;
}

/** What validation may ask about the data: the shape of a collection by its key, or undefined when there is none. */
export interface ValidationContext {
  collection(key: string): CollectionShape | undefined;
}

/**
 * Every problem of an automation, in a fixed order (the automation's, then each step's in the steps' id order with
 * its parameters in the catalogue's order, then the arrows' by index), the same for the same automation whatever
 * the order its steps were saved in. Empty when it can be published. Never throws on an automation `parseAutomation`
 * gave.
 */
export function validate(_automation: Automation, _context: ValidationContext): Problem[] {
  return notBuilt("validate");
}

/** Whether a list of problems lets the automation run: no errors (warnings do not count). */
export const canRun = (problems: readonly Problem[]): boolean =>
  problems.every((p) => p.severity !== "error");
