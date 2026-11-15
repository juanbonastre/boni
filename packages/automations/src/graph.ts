/**
 * The graph of an automation read as a graph (docs/automatizaciones.md §5.1, §5.2): which steps hang from a trigger,
 * in which order they run, whether an arrow would close a cycle, and what each step touches. Everything here reads
 * the steps' ids and the arrows and nothing else, so two automations that differ only in where their boxes are
 * drawn, or in the order their steps and arrows were saved, give the same answers (AU-12).
 */
import type { Arrow, Automation } from "./format.ts";
import { notBuilt } from "./pending.ts";

/**
 * The steps that hang from a trigger (the trigger first), in the order a run decides them:
 * a step comes after every step an arrow reaches it from, and among the steps that are ready at once the one whose id
 * sorts first (by code unit, never by locale) goes first. Steps run one at a time, in this order.
 * A step no arrow path joins to this trigger is not in the list: for this run it has finished with no rows (AU-06,
 * AU-10). Throws when the automation has a cycle or the trigger is not one of its steps.
 */
export function executionOrder(_automation: Automation, _trigger: string): string[] {
  return notBuilt("executionOrder");
}

/**
 * The order in which the rows that reach one input by several arrows are put together (AU-11): by the place of the
 * step they come from in `order`, and for two outputs of one step, by the place of the output in `outputsOf`.
 * Gives the arrows into `input` of `step` in that order.
 */
export function arrowsInto(
  _automation: Automation,
  _order: readonly string[],
  _step: string,
  _input: string,
): Arrow[] {
  return notBuilt("arrowsInto");
}

/** Whether adding this arrow would close a cycle (AU-07): what the canvas asks before it lets an arrow be dropped. */
export function wouldCycle(_automation: Automation, _arrow: Arrow): boolean {
  return notBuilt("wouldCycle");
}

/** The steps of one cycle, in order, or null when there is none: what `validate` reports. */
export function findCycle(_automation: Automation): string[] | null {
  return notBuilt("findCycle");
}

/** What a step does to a collection, known without running it: from the catalogue and the step's fixed parameters. */
export interface Touch {
  /** The step's id. */
  step: string;
  /** The collection's key. */
  collection: string;
  action: string;
  effect: "read" | "write";
  destroys: boolean;
}

/**
 * What each step of an automation reads and writes, in the steps' id order (AU-19, AU-26): the effect comes from the
 * catalogue's action and the collection from the step's parameter, which is never an expression. The policy's call,
 * the map (F14d) and the list of actions read this; there is no other list.
 */
export function touches(_automation: Automation): Touch[] {
  return notBuilt("touches");
}
