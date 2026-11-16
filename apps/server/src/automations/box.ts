/**
 * The engine's box, made of the real one (docs/automatizaciones.md §7, AU-160): the `Box` that `RunDeps` takes, over
 * the socket of the sandbox container (sandbox.ts), speaking protocol 2. It turns a job into a request (the limits of
 * `CODE_LIMITS`, the zone's table and the names of months and days, which the box cannot compute) and an answer into
 * what the engine reads, each fault with its code. It reads no collection and asks no policy: the engine does both
 * (`evaluate`, through the gate). Contract of F14c: not built yet; nothing calls it until service.ts passes it.
 */
import type { Box } from "@boni/automations";
import type { DateNames, ZoneTable } from "@boni/sandbox";

export interface SandboxBoxOptions {
  /** The box's socket; `sandboxSocket()` when absent. */
  socket?: string;
}

/** The box behind the socket. With no box listening, a job rejects with `CodeFault` (`code.unavailable`). */
export function sandboxBox(opts: SandboxBoxOptions = {}): Box {
  throw new Error(`sandboxBox(${typeof opts.socket}) is not built yet (F14c)`);
}

/**
 * A time zone's changes of offset over `ZONE_YEARS`, computed once per zone with `packages/calendar/src/time.ts` and
 * kept: what a date in the box does must be what the same date does in Boni (AU-28).
 */
export function zoneTable(zone: string): ZoneTable {
  throw new Error(`zoneTable(${zone}) is not built yet (F14c)`);
}

/** The names of months and days in a language, from `time.ts`. */
export function dateNames(locale: string): DateNames {
  throw new Error(`dateNames(${locale}) is not built yet (F14c)`);
}
