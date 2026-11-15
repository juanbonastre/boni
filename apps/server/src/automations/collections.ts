/**
 * The engine's `Collections` over the user's store (docs/automatizaciones.md §5.2, §6; phase F14b). F14a ran against
 * a fake; this is the real one, and the only way an automation reaches the saved rows. The engine asks the policy
 * before every call of it (`guard`, effects.ts): this module decides nothing, it reads and writes what it is told.
 *
 * What a read gives:
 * - `shape(key)`: the collection by its key, with each field's key, name, type and label; a collection in the trash,
 *   or one of Boni's own (made on each read, outside the schema), is undefined.
 * - Each row with the label of its record (`entityLabel`) and, in `fields`, only the fields whose own label differs
 *   (what the store keeps per field): a value that came from outside stays from outside, field by field (AU-162,
 *   AU-164). The label object is shared by the rows that have the same one: 3,000 rows do not make 3,000 labels.
 * - `origin`: the record's id and the version it was read at; `apply` refuses a change to a row that changed since.
 * - A fixed order: by the query's `sort`, then by id, so two runs over the same data give the same rows (AU-12).
 * - `related`: a relation holds the related row one level deep, with that row's own labels.
 * - The conditions are the views' filter (`FilterItem`), run by the same code as a view's, with its operators.
 *
 * What a write does: `apply` writes every change or none, as the actor and device it was made with, in one group of
 * the operation log; «trash» sends to the trash (AU-122). A test never calls it (AU-90): the gate answers `tested`.
 *
 * With Juan's volume (thousands of rows in a collection) a search is one query with its conditions and its limit,
 * never every row read and filtered here; `aggregate` counts and sums in the store (A-15, timed in its test).
 */
import type { Collections } from "@boni/automations";
import type { UserStore } from "@boni/store";
import { notBuilt } from "./pending.ts";

export interface CollectionsFor {
  /** Who writes: Juan's hand on a test never does; a run for real is F14d's. */
  actor: "user" | "agent";
  device: string | null;
}

export function storeCollections(_store: UserStore, _who: CollectionsFor): Collections {
  return notBuilt("storeCollections");
}
