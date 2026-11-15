/**
 * What the canvas does to a draft, as pure functions (docs/automatizaciones.md §5.7): add a step in the four ways,
 * connect and disconnect, remove, duplicate, copy and paste, change a parameter, a setting or the action, rename.
 * Each takes a draft and gives a new one (state.ts's `change` makes it undoable and owed to the server). The server
 * validates what it is given; nothing here decides what is allowed.
 *
 * A step's name (AU-86): a new step is named by words.ts's `autoName`, and the name follows its parameters while it
 * is still the automatic one: before a change of a parameter, if the name equals what `autoName` gives for the step
 * as it was (with its number, if it had one), it becomes what `autoName` gives for the step as it is. No mark is
 * kept apart: a name Juan wrote is one that is not the automatic one. Every rename, Juan's or this one, goes through
 * `renameStep` of `@boni/automations`, which rewrites the citations (AU-02).
 */
import type { Arrow, Automation, ParamValue, StepSettings } from "@boni/automations";
import { notBuilt } from "./pending.ts";
import type { AddAt } from "./state.ts";
import type { Namer } from "./words.ts";

/** What makes an id for a new step: never shown, unique in the automation (AU-02). */
export type NewId = () => string;

/**
 * A new step of `type` (with `action`, for a type that has several), where `at` says (AU-65): hung from an output,
 * between the two ends of an arrow (the arrow becomes two: into the step's first input, out of its first output),
 * or connected to nothing. Its parameters are the catalogue's defaults and nothing else: no option is added for
 * Juan (AU-87). Gives the draft and the step's id, to select and open it (AU-69).
 */
export function addStep(
  _draft: Automation,
  _type: string,
  _action: string | undefined,
  _at: AddAt,
  _names: Namer,
  _newId: NewId,
): { draft: Automation; step: string } {
  return notBuilt("addStep (AU-65)");
}

/** Why an arrow cannot be drawn: a key, said by i18n.ts. */
export type ArrowRefusal = "cycle" | "same" | "toTrigger" | "noSuchEnd";

/** An arrow from an output to an input: the draft with it, or why not (a cycle: `wouldCycle`). */
export function connect(_draft: Automation, _arrow: Arrow): Automation | { refused: ArrowRefusal } {
  return notBuilt("connect (AU-03)");
}

export function disconnect(_draft: Automation, _arrow: Arrow): Automation {
  return notBuilt("disconnect (AU-66)");
}

/**
 * The steps out, with their arrows (AU-66). A step with exactly one arrow in and one out leaves its two neighbours
 * joined by one arrow, from the output and into the input those two used; in every other case its arrows go.
 */
export function removeSteps(_draft: Automation, _steps: readonly string[]): Automation {
  return notBuilt("removeSteps (AU-66)");
}

/** Steps as they are copied (AU-68): with the arrows between them, and no id of the automation they came from. */
export interface Clip {
  format: number;
  steps: Automation["steps"];
  arrows: Arrow[];
  /** Where each was, relative to the first: pasted, they keep their shape. */
  offsets: Record<string, { x: number; y: number }>;
}

export function copySteps(
  _draft: Automation,
  _steps: readonly string[],
  _places: Readonly<Record<string, { x: number; y: number }>>,
): Clip {
  return notBuilt("copySteps (AU-68)");
}

/**
 * A clip pasted, here or in another automation (AU-68): each step with a new id and, where its name is taken, the
 * name with a number («Filtrar 2»); the citations inside the clip follow the new names, and one of a step that is
 * not in the clip stays as written (validation says if it is broken). «Duplicar» is copy and paste in one.
 * Gives the draft and the new steps' ids, by the id each had in the clip.
 */
export function pasteSteps(
  _draft: Automation,
  _clip: Clip,
  _newId: NewId,
): { draft: Automation; steps: Record<string, string> } {
  return notBuilt("pasteSteps (AU-68)");
}

/** A parameter's value. An option that is not in `step.params` is added by setting it (AU-76). */
export function setParam(
  _draft: Automation,
  _step: string,
  _key: string,
  _value: ParamValue,
  _names: Namer,
): Automation {
  return notBuilt("setParam (AU-86)");
}

/** An added option taken away (AU-76): its key leaves `step.params`, so it is its default again. */
export function removeOption(_draft: Automation, _step: string, _key: string): Automation {
  return notBuilt("removeOption (AU-76)");
}

/** One of the six settings (AU-78); set to its default, it leaves `step.settings`. */
export function setSetting<K extends keyof StepSettings>(
  _draft: Automation,
  _step: string,
  _key: K,
  _value: StepSettings[K],
): Automation {
  return notBuilt("setSetting (AU-78)");
}

/**
 * Another action for a step (AU-82): the parameters the two actions share by key and control keep their values,
 * the rest go, and `dropped` names the ones that had a value Juan wrote, in the panel's order, for the notice.
 */
export function changeAction(
  _draft: Automation,
  _step: string,
  _action: string,
  _names: Namer,
): { draft: Automation; dropped: string[] } {
  return notBuilt("changeAction (AU-82)");
}

/**
 * A name Juan wrote (AU-86): trimmed; refused when empty; where another step has it, with a number. The citations
 * that named the step name it still (`renameStep`).
 */
export function rename(_draft: Automation, _step: string, _name: string): Automation {
  return notBuilt("rename (AU-86)");
}
