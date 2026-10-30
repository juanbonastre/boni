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
