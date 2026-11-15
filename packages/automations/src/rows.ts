/**
 * What passes along an arrow: rows, objects with fields (docs/automatizaciones.md §5.1, §5.2, §6). A row knows which
 * saved row it was read from (AU-04), which row of its step's input it comes from (AU-13), the label of each of its
 * fields (AU-162) and the label of the path that brought it here (AU-164). Rows are never changed in place: a step
 * makes new ones, so a run can be read afterwards step by step.
 */
import type { Label, Labeled } from "@boni/entities";

/** A field's value: what JSON holds. A date is "YYYY-MM-DD", an instant epoch ms, money `{ amount, currency }`. */
export type Cell = string | number | boolean | null | Cell[] | { [key: string]: Cell };

/** The saved row a row was read from: enough to modify it or send it to the trash without searching again (AU-04). */
export interface RowOrigin {
  /** The collection's key. */
  collection: string;
  id: string;
  /** The version read, so a write can tell that the row changed since. */
  version: number;
}

/** A field whose label is not the row's, or that was calculated (never valid as a destination, P14). */
export interface FieldLabel {
  label: Label;
  derived: boolean;
}

export interface Row {
  /** Its fields by key (`$json` in an expression). With «Incluir relacionadas», a relation holds the related row. */
  json: Record<string, Cell>;
  /** The label of every field with no entry in `fields`: 3,000 rows of one collection share one object. */
  label: Label;
  /** Only the fields that differ: another label (a value cited from elsewhere), or derived. */
  fields?: Record<string, FieldLabel>;
  /**
   * The label of the path (AU-164, P15): of everything that decided that this row exists or came this way (the
   * values of the conditions it passed, of a search's filter, of a parameter that changes which rows come out).
   * Null when nothing did. The engine sets it, never a step; a write is judged with it (`PolicyCall.control`).
   */
  path: Label | null;
  /** Set when it was read from a collection and still stands for that saved row (dropped by a step that remakes rows). */
  origin?: RowOrigin;
  /**
   * The index, in the input of the step that made it, of the row it comes from; null when the step remade the rows
   * («Agrupar», «Juntar en una», «Combinar») or it is a trigger's. `$('Step').item` follows it back (AU-13).
   */
  parent: number | null;
}

/** A field of a row with its exact label (AU-162): `path` is the field's key and then keys inside it. */
export function cellOf(row: Row, path: readonly string[]): Labeled<Cell> | undefined {
  const [key, ...rest] = path;
  if (key === undefined || !Object.hasOwn(row.json, key)) return undefined;
  let v: Cell = row.json[key] as Cell;
  for (const k of rest) {
    if (typeof v !== "object" || v === null || Array.isArray(v) || !Object.hasOwn(v, k))
      return undefined;
    v = v[k] as Cell;
  }
  const own = row.fields?.[key];
  return { value: v, label: own?.label ?? row.label, derived: own?.derived ?? false };
}
