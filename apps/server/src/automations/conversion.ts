/**
 * The screens of the conversion (F16 P1; docs/automatizaciones.md AU-225, AU-221, decision 21): the band «Tus flujos
 * son ahora automatizaciones» and «⋯ → Conversión», which list each flow the conversion reached with «Lo que cambia»
 * and its runs since; and the editor's «Volver al flujo de antes» and «Convertir otra vez». What it reads is the
 * conversion's own rows (`flow_conversions`, packages/store/src/conversions.ts) and two counts per automation by the
 * runs' covering index (A-29: never a run read), so the band costs the same with a year of runs (A-15).
 *
 * Going back and forth is Juan's touch from a personal device only (decision 13), as the switch: a shared device and
 * the phone see the state and cannot change it. Neither way sets a «Sí» or gives a step more reach: «Volver al flujo
 * de antes» turns the automation off and leaves its versions as they are, and «Convertir otra vez» turns the same
 * versions on again (AU-228: one id, one engine). Closing the band is kept for the account (a store setting), so no
 * device shows it again; the list stays in «⋯ → Conversión».
 */
import type { Trust } from "@boni/agent";
import type { FlowConversionState, UserStore } from "@boni/store";
import { boniOf } from "./boni.ts";
import { reconvertFlow, revertFlow } from "./convert.ts";
import type { Refusal } from "./publish.ts";
import { cancelWaits } from "./runs.ts";
import { BAD, type Hand, NOT_FOUND, type ServiceError } from "./service.ts";

/** The setting that keeps when the band was closed: the epoch ms, or absent while it shows. */
export const BAND_CLOSED = "automations.conversion.closed";

/** The end of the counts' period: every run from the conversion on (a bound SQLite takes, unlike Infinity). */
const EVER = Number.MAX_SAFE_INTEGER;

/** One flow the conversion reached, as the band and «⋯ → Conversión» show it. */
export interface ConvertedItem {
  id: string;
  /** Its name, painted as plain text (A-01). */
  name: string;
  /** One of Boni's own (`De: Boni`, AU-221). */
  boni: boolean;
  state: FlowConversionState;
  /** When it was converted. */
  at: number;
  /** The keys of «Lo que cambia» (`CHANGES` of @boni/agent); none is «Hace lo mismo». */
  changes: string[];
  /** Versions of before that could not be converted. */
  skipped: number;
  /** Real runs of its automation since the conversion, and how many of them failed; 0 for a flow kept as it was. */
  runs: number;
  failed: number;
}

export interface ConversionList {
  /** When the band was closed, or null while it shows. */
  closed: number | null;
  items: ConvertedItem[];
}

/** The band's and «⋯ → Conversión»'s list: every flow the conversion reached, by name. */
export function conversionList(store: UserStore): ConversionList {
  const closed = Number(store.setting(BAND_CLOSED));
  const names = new Map<string, string>();
  for (const a of store.journal.automations()) names.set(a.id, a.name);
  const items: ConvertedItem[] = [];
  for (const c of store.journal.flowConversions()) {
    const automation = c.state === "kept" ? null : store.journal.automation(c.id);
    if (automation?.deleted) continue;
    const name = names.get(c.id) ?? store.journal.flow(c.id)?.name ?? "";
    items.push({
      id: c.id,
      name,
      boni: automation !== null && boniOf(store, c.id) !== undefined,
      state: c.state,
      at: c.at,
      changes: c.changes,
      skipped: c.skipped,
      runs: automation ? store.journal.automationRunsIn(c.id, c.at, EVER) : 0,
      failed: automation ? store.journal.automationFailedIn(c.id, c.at, EVER) : 0,
    });
  }
  items.sort((a, b) => a.name.localeCompare(b.name, "es") || a.id.localeCompare(b.id));
  return { closed: Number.isFinite(closed) && closed > 0 ? closed : null, items };
}

/** What the editor's «⋯» and the band ask: `back` «Volver al flujo de antes», `again` «Convertir otra vez». */
export type ConversionStep = "back" | "again";

/**
 * «Volver al flujo de antes» and «Convertir otra vez» (decision 21). Refused from a device that is not personal;
 * `changed` when the flow got a version while it ran as before (its automation does not have it).
 */
export function convertAgain(
  store: UserStore,
  id: string,
  step: ConversionStep,
  hand: Hand & { trust: Trust },
): { state: FlowConversionState } | Refusal | ServiceError {
  if (hand.trust !== "personal") return { refused: "not-personal" };
  if (step !== "back" && step !== "again") return BAD;
  const c = store.journal.flowConversion(id);
  const automation = store.journal.automation(id);
  if (!c || c.state === "kept" || !automation || automation.deleted) return NOT_FOUND;
  if (step === "back") {
    if (c.state === "reverted") return { state: "reverted" };
    revertFlow(store, id, hand.now);
    // Off, as with the switch: what waited for an answer is cancelled (AU-203).
    cancelWaits(store, id, hand.now);
    return { state: "reverted" };
  }
  if (c.state === "converted") return { state: "converted" };
  const r = reconvertFlow(store, id, hand.now);
  if (r === "changed") return { refused: "changed" };
  if (r === "no") return NOT_FOUND;
  return { state: "converted" };
}

/** «Cerrar» on the band: it is not shown again on any device; the list stays in «⋯ → Conversión». */
export function closeBand(
  store: UserStore,
  hand: Hand & { trust: Trust },
): { closed: number } | Refusal {
  if (hand.trust !== "personal") return { refused: "not-personal" };
  const before = Number(store.setting(BAND_CLOSED));
  if (Number.isFinite(before) && before > 0) return { closed: before };
  store.setSetting(BAND_CLOSED, String(hand.now));
  return { closed: hand.now };
}
