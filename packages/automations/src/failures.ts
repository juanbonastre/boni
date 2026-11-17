/**
 * Why a step failed, as a key and not as a sentence (docs/automatizaciones.md AU-67, AU-84): the screen says each
 * code in its own words (`i18n.ts`) and marks the parameter at fault, as it does with a `Problem` of validation.
 * `StepError.message` stays what it is, English for the log. The engine gives every failure one of these codes
 * (`StepError.failure`): an executor or the collections throw `StepFault` with theirs, and the engine names the rest
 * (a citation, the policy, «Parar con error»). `other` is left for what no code names yet (the screen then shows a
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
  /** «Leer una fila»: no row of the collection has that id (AU-120). `detail.collection`. */
  "row.missing",
  /** «Crear o modificar»: more than one row matches, and it never picks one (AU-121). `detail.count`. */
  "row.many",
  /** «Las filas que llegan»: the row that arrives is not a saved row of the step's collection. `detail.collection`. */
  "row.notSaved",
  /** «Crear o modificar»: a field to match by is not among the fields it writes. `detail.field`. */
  "row.matchUnwritten",
  /**
   * A value is not what the step needs. `detail.needs`: "number", "list", "whole", "sameCurrency", "rowId";
   * `detail.field`, the field of the row that held it, when it is one.
   */
  "value.type",
  /** «Parar con error» stopped it: `detail.message` is what Juan wrote there, plain text. */
  "stopped",
  /**
   * One of the run's limits stopped it (AU-17), whatever «Si falla» says. `detail.limit`: its key in
   * `AUTOMATION_LIMITS`; `detail.max`, the limit; `detail.got`, what the run reached or was about to reach.
   */
  "run.limit",
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

/**
 * A failure that knows its code: what an executor or the collections throw when they can say why. The message is
 * the English sentence for the log; the engine puts `failure` in `StepError.failure`.
 */
export class StepFault extends Error {
  readonly failure: StepFailure;
  constructor(message: string, failure: StepFailure) {
    super(message);
    this.name = "StepFault";
    this.failure = failure;
  }
}
