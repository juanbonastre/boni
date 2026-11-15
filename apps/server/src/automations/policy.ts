/**
 * The engine's `Policy` over `decide` (docs/automatizaciones.md §6, AU-168; A-01, A-26; phase F14b). F14a asked a
 * test policy; this is the real one. Every read and every write of a step becomes one `Call` of the policy engine:
 *
 * - what is judged comes from the step's action in the catalogue (AU-19): whether it reads or writes and whether it
 *   destroys, and no other list. `decide` must answer for it what it answers for the action of the one list
 *   (`ACTIONS`) that does the same to a record (reading rows, creating, updating, sending to the trash, which the
 *   policy asks about: P5) with the same labelled arguments and origin: a test holds the two together, action by
 *   action, so nothing an automation does is judged by another rule than the same act anywhere else;
 * - the arguments are `PolicyCall.values`, each with its own label, and the collection by its key; `control` is the
 *   label of the path (AU-164); `rows`, how many rows the call writes (P11 counts each);
 * - `flow: true` (a saved automation, not a plan a model wrote) and `dry: PolicyCall.test`;
 * - the origin is who started the run. In F14b there is one: Juan's hand on «Probar» in his editor, `{ kind:
 *   "hand", trust, device }`. The origin of a run that starts alone arrives with F14d (AU-167).
 *
 * One `RunCounters` per run, kept here: the policy's own limits count over the whole run, test or not.
 * A decision is passed on as it is: this module never turns a «no» into a «sí», and adds no rule.
 */
import type { Trust } from "@boni/agent";
import type { Policy } from "@boni/automations";
import { notBuilt } from "./pending.ts";

export interface PolicyFor {
  trust: Trust;
  device: string;
}

/** The policy of one run started by Juan's hand: make one per run, never share it between two. */
export function handPolicy(_who: PolicyFor): Policy {
  return notBuilt("handPolicy");
}
