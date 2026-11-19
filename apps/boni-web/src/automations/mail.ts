/**
 * What the panels of «Leer correo»'s steps show, as data (docs/automatizaciones.md §5.17, AU-249, AU-250, AU-253): the
 * day's cap said in the trigger, the rows of «Regla del remitente» as a hand changes them, and the rows of «Crear en
 * la elegida», one per collection the «Decisora» chooses among, each with its «Crear» cell. Nothing here sets a «Sí»:
 * a cell is what the step's connections hold, and a collection with none is «No» (AU-250).
 */
import {
  type Automation,
  BONI_PARAMS,
  boniPiece,
  MAIL_CAP,
  type ParamValue,
  type RULE_DOES,
  type Step,
} from "@boni/automations";
import type { T } from "../i18n.ts";
import type { WriteCell } from "./connections.ts";

/** The cap of «Llega un correo» (AU-253), in its panel: in the code, never a parameter, so only said. */
export const capWords = (t: T): string =>
  t("auto.boni.capLine", {
    perDay: MAIL_CAP.perDay,
    perSender: MAIL_CAP.perSender,
    queue: MAIL_CAP.queue,
  });

/** A row of «Regla del remitente»'s table (AU-249): the sender, what to do, and the collection «A una colección» names. */
export type RuleRow = Readonly<Record<string, ParamValue>>;
type RuleDo = (typeof RULE_DOES)[number];

/** The rows of the table as the step holds them; anything that is not a row is left out. */
export const rulesOf = (v: ParamValue | undefined): RuleRow[] =>
  Array.isArray(v)
    ? v.filter(
        (x): x is RuleRow => !!x && typeof x === "object" && !Array.isArray(x) && !("expr" in x),
      )
    : [];

/** A new row: no sender yet and «No leer», which names no collection. */
export const newRule = (): RuleRow => ({ sender: "", do: "skip" });

/**
 * One row changed: its sender, what it does, or its collection. «No leer» names no collection, so changing to it takes
 * the collection out; the other rows stay the same objects (what lets a long table repaint only the row changed).
 */
export function setRule(
  rows: readonly RuleRow[],
  at: number,
  change: { sender: string } | { do: RuleDo } | { collection: string },
): RuleRow[] {
  return rows.map((r, i) => {
    if (i !== at) return r;
    if ("do" in change && change.do === "skip") {
      const { collection: _gone, ...rest } = r;
      return { ...rest, do: "skip" };
    }
    if ("collection" in change && change.collection === "") {
      const { collection: _gone, ...rest } = r;
      return rest;
    }
    return { ...r, ...change };
  });
}

/** A row of «Crear en la elegida» (AU-250): a collection and its «Crear» cell. */
export interface ChosenRow {
  collection: string;
  cell: WriteCell;
}

/**
 * The collections the draft's «Decisora» chooses among, in its order (a piece that `reads` «decide»): the rows of
 * «Crear en la elegida» and what «A una colección» of «Regla del remitente» may name.
 */
export function chosenAmong(draft: Automation): string[] {
  const keys: string[] = [];
  for (const s of draft.steps) {
    if (boniPiece(s.type)?.reads !== "decide") continue;
    const list = s.params[BONI_PARAMS.collections];
    if (!Array.isArray(list)) continue;
    for (const x of list) {
      const key =
        x && typeof x === "object" && !Array.isArray(x)
          ? (x as Record<string, unknown>).collection
          : undefined;
      if (typeof key === "string" && key && !keys.includes(key)) keys.push(key);
    }
  }
  return keys;
}

/**
 * The rows of «Crear en la elegida»'s table: each collection of the «Decisora», then any other its connections hold,
 * each with its «Crear» cell as the step has it. A collection with no connection is «No»: nothing is created there
 * until his hand sets «Preguntar» or «Sí» (AU-250); no row is born «Sí».
 */
export function chosenRows(draft: Automation, step: Step): ChosenRow[] {
  const connections = step.connections ?? [];
  const keys = chosenAmong(draft);
  for (const c of connections) if (!keys.includes(c.collection)) keys.push(c.collection);
  return keys.map((collection) => {
    const create = connections.find((c) => c.collection === collection)?.create;
    return { collection, cell: create ? create.mode : false };
  });
}
