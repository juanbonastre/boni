/**
 * Where the boxes go when nobody has put them anywhere (docs/automatizaciones.md AU-05, which replaces I-26 for the
 * new format: a step stays where Juan leaves it, and nothing moves on its own). Pure: the same draft and the same
 * places give the same answer. A box Juan placed is never moved here except by «Ordenar», which he presses.
 */
import type { Automation } from "@boni/automations";
import { notBuilt } from "./pending.ts";

export type Places = Readonly<Record<string, { x: number; y: number }>>;

/** A card's size and the room between two, in the canvas's units (AU-63: the card has a fixed width). */
export const CARD = { width: 220, height: 72, gapX: 80, gapY: 32 } as const;

/**
 * The place of a step that has none: to the right of the step it hangs from, in its row; below it when that place
 * is taken (the next free one downwards). A trigger goes below the last trigger. A step that hangs from nothing,
 * added from the top «+», goes to the right of the rightmost box of the first row.
 */
export function placeFor(
  _draft: Automation,
  _places: Places,
  _step: string,
): { x: number; y: number } {
  return notBuilt("placeFor (AU-05)");
}

/** Every step of the draft with a place: the ones it has, and `placeFor` for the rest, in the draft's order. */
export function withPlaces(_draft: Automation, _places: Places): Places {
  return notBuilt("withPlaces (AU-05)");
}

/**
 * «Ordenar» (AU-64): every box placed again, left to right from each trigger, one column per step of distance, the
 * outputs of a step downwards in the catalogue's order, no two boxes on each other and no arrow backwards.
 */
export function tidy(_draft: Automation): Places {
  return notBuilt("tidy (AU-05, AU-64)");
}
