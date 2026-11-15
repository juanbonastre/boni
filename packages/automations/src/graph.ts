/**
 * The graph of an automation read as a graph (docs/automatizaciones.md §5.1, §5.2): which steps hang from a trigger,
 * in which order they run, whether an arrow would close a cycle, and what each step touches. Everything here reads
 * the steps' ids and the arrows and nothing else, so two automations that differ only in where their boxes are
 * drawn, or in the order their steps and arrows were saved, give the same answers (AU-12).
 */
import { actionOf, isTrigger, outputsOf } from "./catalogue.ts";
import type { Arrow, Automation } from "./format.ts";

/** By code unit, never by locale: the same everywhere. */
export const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The steps each step's arrows go to, each list sorted and once. Arrows to or from a missing step are left out, and so
 * are arrows into a trigger, which has no input: they carry nothing (validation refuses them, `arrow.intoTrigger`).
 */
function successors(automation: Automation): Map<string, string[]> {
  const ids = new Set(automation.steps.map((s) => s.id));
  const triggers = new Set(automation.steps.filter(isTrigger).map((s) => s.id));
  const next = new Map<string, Set<string>>();
  for (const id of ids) next.set(id, new Set());
  for (const a of automation.arrows)
    if (ids.has(a.from.step) && ids.has(a.to.step) && !triggers.has(a.to.step))
      next.get(a.from.step)?.add(a.to.step);
  return new Map([...next].map(([id, to]) => [id, [...to].sort(byCodeUnit)]));
}

/** Every step reachable from `start` by arrows, `start` included. */
function reach(next: Map<string, string[]>, start: string): Set<string> {
  const seen = new Set([start]);
  const todo = [start];
  for (let id = todo.pop(); id !== undefined; id = todo.pop())
    for (const n of next.get(id) ?? []) {
      if (seen.has(n)) continue;
      seen.add(n);
      todo.push(n);
    }
  return seen;
}

/** The steps a step reaches by arrows, for every step: itself only through a cycle. */
export function downstream(automation: Automation): Map<string, Set<string>> {
  const next = successors(automation);
  return new Map(
    [...next.keys()].map((id) => {
      const down = new Set<string>();
      for (const n of next.get(id) ?? []) for (const x of reach(next, n)) down.add(x);
      return [id, down];
    }),
  );
}

/**
 * The steps that hang from a trigger (the trigger first), in the order a run decides them:
 * a step comes after every step an arrow reaches it from, and among the steps that are ready at once the one whose id
 * sorts first (by code unit, never by locale) goes first. Steps run one at a time, in this order.
 * A step no arrow path joins to this trigger is not in the list: for this run it has finished with no rows (AU-06,
 * AU-10). Throws when the automation has a cycle or the trigger is not one of its steps.
 */
export function executionOrder(automation: Automation, trigger: string): string[] {
  const next = successors(automation);
  if (!next.has(trigger)) throw new Error(`no step has the id ${trigger}`);
  const reached = reach(next, trigger);
  const waiting = new Map<string, number>([...reached].map((id) => [id, 0]));
  for (const id of reached)
    for (const n of next.get(id) ?? []) waiting.set(n, (waiting.get(n) ?? 0) + 1);
  const ready = [...reached].filter((id) => waiting.get(id) === 0);
  const order: string[] = [];
  while (ready.length) {
    ready.sort(byCodeUnit);
    const id = ready.shift() as string;
    order.push(id);
    for (const n of next.get(id) ?? []) {
      const left = (waiting.get(n) ?? 0) - 1;
      waiting.set(n, left);
      if (left === 0) ready.push(n);
    }
  }
  if (order.length < reached.size) throw new Error("the automation has a cycle");
  if (order[0] !== trigger) throw new Error(`${trigger} has an arrow into it`);
  return order;
}

/**
 * The order in which the rows that reach one input by several arrows are put together (AU-11): by the place of the
 * step they come from in `order`, and for two outputs of one step, by the place of the output in `outputsOf`.
 * Gives the arrows into `input` of `step` in that order.
 */
export function arrowsInto(
  automation: Automation,
  order: readonly string[],
  step: string,
  input: string,
): Arrow[] {
  const place = new Map(order.map((id, i) => [id, i]));
  const outputs = new Map(automation.steps.map((s) => [s.id, outputsOf(s)]));
  const key = (a: Arrow) => {
    const out = outputs.get(a.from.step) ?? [];
    const i = out.indexOf(a.from.output);
    return [place.get(a.from.step) ?? 0, i < 0 ? out.length : i] as const;
  };
  return automation.arrows
    .filter((a) => a.to.step === step && a.to.input === input && place.has(a.from.step))
    .sort((x, y) => {
      const [a, b] = [key(x), key(y)];
      return a[0] - b[0] || a[1] - b[1] || byCodeUnit(x.from.output, y.from.output);
    });
}

/** Whether adding this arrow would close a cycle (AU-07): what the canvas asks before it lets an arrow be dropped. */
export function wouldCycle(automation: Automation, arrow: Arrow): boolean {
  if (arrow.from.step === arrow.to.step) return true;
  return reach(successors(automation), arrow.to.step).has(arrow.from.step);
}

/** The steps of one cycle, in order, or null when there is none: what `validate` reports. */
export function findCycle(automation: Automation): string[] | null {
  const next = successors(automation);
  const state = new Map<string, "open" | "done">();
  const path: string[] = [];
  const visit = (id: string): string[] | null => {
    state.set(id, "open");
    path.push(id);
    for (const n of next.get(id) ?? []) {
      if (state.get(n) === "open") return path.slice(path.indexOf(n));
      if (!state.has(n)) {
        const found = visit(n);
        if (found) return found;
      }
    }
    path.pop();
    state.set(id, "done");
    return null;
  };
  for (const id of [...next.keys()].sort(byCodeUnit)) {
    if (state.has(id)) continue;
    const found = visit(id);
    if (found) return found;
  }
  return null;
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
export function touches(automation: Automation): Touch[] {
  const out: Touch[] = [];
  for (const step of [...automation.steps].sort((a, b) => byCodeUnit(a.id, b.id))) {
    const action = actionOf(step);
    const collection = step.params.collection;
    if (!action || action.effect === "none" || typeof collection !== "string") continue;
    out.push({
      step: step.id,
      collection,
      action: action.key,
      effect: action.effect,
      destroys: action.destroys,
    });
  }
  return out;
}
