// Protocol 2: evaluating an automation's JavaScript (docs/automatizaciones.md §7).
export {
  type DateNames,
  EVAL_DEFAULT_LIMITS,
  EVAL_MAX_LIMITS,
  EVALUATE,
  type EvalFault,
  type EvalLimits,
  type EvalRequest,
  type EvalResponse,
  evalLimitsOf,
  evalRequestErrors,
  isEvalRequest,
  type Json,
  MAX_READ_BYTES,
  MAX_READ_KEY,
  type WireConsoleLine,
  type WireEvaluated,
  type WireRead,
  ZONE_YEARS,
  type ZoneTable,
} from "./evaluate.ts";
// The box's protocol and the schema subset, for Boni's server and the box itself (docs/extensiones.md §11).
export {
  DEFAULT_LIMITS,
  DEFAULT_SOCKET,
  type Limits,
  limitsOf,
  MAX_LIMITS,
  MAX_REQUEST_BYTES,
  type RunError,
  type RunRequest,
  type RunResponse,
  requestErrors,
  shortMessage,
} from "./protocol.ts";
export { type Schema, type SchemaType, schemaErrors, schemaShapeErrors } from "./schema.ts";
