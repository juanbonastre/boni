/**
 * Why a step failed, as a key and not as a sentence (docs/automatizaciones.md AU-67, AU-84): the screen says each
 * code in its own words (`i18n.ts`) and marks the parameter at fault, as it does with a `Problem` of validation.
 * `StepError.message` stays what it is, English for the log. F14a's engine throws sentences; F14b's first engine PR
 * gives every failure one of these codes, and `other` is left for what no code names yet (the screen then shows a
 * general sentence and the step, never the English one).
 */
export const STEP_FAILURES = [
  /** A citation gave no value: one per `CiteFailure`. `detail.step` is the step cited, by name. */
  "cite.unknownStep",
  "cite.notRun",
  "cite.noRows",
  "cite.noPair",
  "cite.noCurrentRow",
  /** The policy said no; `StepError.rule` is its rule. */
  "policy.denied",
  /** A read that the policy would ask Juan about: a read cannot wait. */
  "policy.waits",
  /** The saved row changed since it was read (AU-04). */
  "row.changed",
  /** A value is not what the step needs. `detail.needs`: "number", "list", "whole", "sameCurrency". */
  "value.type",
  /** «Parar con error» stopped it: `detail.message` is what Juan wrote there, plain text. */
  "stopped",
  /** One of the run's limits was passed. `detail.limit`: the limit's key. */
  "limit",
  "other",
] as const;
export type StepFailureCode = (typeof STEP_FAILURES)[number];

export interface StepFailure {
  code: StepFailureCode;
  /** The parameter at fault, written as `Problem.param` writes one, when the failure is one parameter's. */
  param?: string;
  /** What the sentence needs, by fixed keys. Never text for a person, but `stopped`'s own message. */
  detail?: Record<string, string | number>;
}
