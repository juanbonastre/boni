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
import {
  ACTION,
  type Arrow,
  type Automation,
  actionOf,
  inputsOf,
  isTrigger,
  newConnection,
  outputsOf,
  type ParamSpec,
  type ParamValue,
  renameStep,
  SETTINGS_DEFAULTS,
  type Step,
  type StepSettings,
  specOf,
  wouldCycle,
} from "@boni/automations";
import { isEmpty, rowsOf } from "./panel.ts";
import type { AddAt } from "./state.ts";
import { type Namer, uniqueName } from "./words.ts";

export const sameArrow = (a: Arrow, b: Arrow) =>
  a.from.step === b.from.step &&
  a.from.output === b.from.output &&
  a.to.step === b.to.step &&
  a.to.input === b.to.input;

/** What makes an id for a new step: never shown, unique in the automation (AU-02). */
export type NewId = () => string;

/**
 * A new step of `type` (with `action`, for a type that has several), where `at` says (AU-65): hung from an output,
 * between the two ends of an arrow (the arrow becomes two: into the step's first input, out of its first output),
 * or connected to nothing. Its parameters are the catalogue's defaults and nothing else: no option is added for
 * Juan (AU-87). Gives the draft and the step's id, to select and open it (AU-69).
 */
export function addStep(
  draft: Automation,
  type: string,
  action: string | undefined,
  at: AddAt,
  names: Namer,
  newId: NewId,
): { draft: Automation; step: string } {
  const spec = specOf(type);
  if (!spec) throw new Error(`automations: no step type ${type}`);
  // A type with several actions holds the one chosen, or its first: without one it would have no output to hang
  // the next step from. Nothing else: every other parameter is its default until Juan sets it (AU-87).
  const params: Record<string, ParamValue> =
    spec.actions.length > 1
      ? {
          [ACTION]:
            spec.actions.find((a) => a.key === action)?.key ?? (spec.actions[0]?.key as string),
        }
      : {};
  const bare: Step = { id: newId(), name: "", type, params };
  const step: Step = { ...bare, name: uniqueName(draft, names.auto(bare)) };
  const arrows = [...draft.arrows];
  // A trigger is connected to nothing, wherever it was asked from (AU-65).
  const input = inputsOf(step)[0];
  const output = outputsOf(step)[0];
  if (!isTrigger(step) && input !== undefined) {
    if (at.from === "output" && draft.steps.some((s) => s.id === at.step))
      arrows.push({ from: { step: at.step, output: at.output }, to: { step: step.id, input } });
    if (at.from === "arrow") {
      const i = arrows.findIndex((a) => sameArrow(a, at.arrow));
      if (i >= 0) {
        arrows.push({ from: at.arrow.from, to: { step: step.id, input } });
        // A step with no output («Parar con error») ends the way; the arrow it sat on stays.
        if (output !== undefined) {
          arrows.splice(i, 1);
          arrows.push({ from: { step: step.id, output }, to: at.arrow.to });
        }
      }
    }
  }
  return { draft: { ...draft, steps: [...draft.steps, step], arrows }, step: step.id };
}

/** Why an arrow cannot be drawn: a key, said by i18n.ts. */
export type ArrowRefusal = "cycle" | "same" | "toTrigger" | "noSuchEnd";

/** An arrow from an output to an input: the draft with it, or why not (a cycle: `wouldCycle`). */
export function connect(draft: Automation, arrow: Arrow): Automation | { refused: ArrowRefusal } {
  if (arrow.from.step === arrow.to.step) return { refused: "same" };
  const from = draft.steps.find((s) => s.id === arrow.from.step);
  const to = draft.steps.find((s) => s.id === arrow.to.step);
  if (!from || !to || !outputsOf(from).includes(arrow.from.output)) return { refused: "noSuchEnd" };
  if (isTrigger(to)) return { refused: "toTrigger" };
  if (!inputsOf(to).includes(arrow.to.input)) return { refused: "noSuchEnd" };
  if (draft.arrows.some((a) => sameArrow(a, arrow))) return draft;
  if (wouldCycle(draft, arrow)) return { refused: "cycle" };
  return { ...draft, arrows: [...draft.arrows, arrow] };
}

export function disconnect(draft: Automation, arrow: Arrow): Automation {
  const arrows = draft.arrows.filter((a) => !sameArrow(a, arrow));
  return arrows.length === draft.arrows.length ? draft : { ...draft, arrows };
}

/**
 * The steps out, with their arrows (AU-66). A step with exactly one arrow in and one out leaves its two neighbours
 * joined by one arrow, from the output and into the input those two used; in every other case its arrows go.
 */
export function removeSteps(draft: Automation, steps: readonly string[]): Automation {
  let out = draft;
  for (const id of steps) {
    if (!out.steps.some((s) => s.id === id)) continue;
    const ins = out.arrows.filter((a) => a.to.step === id);
    const outs = out.arrows.filter((a) => a.from.step === id);
    const left: Automation = {
      ...out,
      steps: out.steps.filter((s) => s.id !== id),
      arrows: out.arrows.filter((a) => a.from.step !== id && a.to.step !== id),
    };
    const [i] = ins;
    const [o] = outs;
    out = left;
    if (ins.length === 1 && outs.length === 1 && i && o) {
      const joined = connect(left, { from: i.from, to: o.to });
      if (!("refused" in joined)) out = joined;
    }
  }
  return out;
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
  draft: Automation,
  steps: readonly string[],
  places: Readonly<Record<string, { x: number; y: number }>>,
): Clip {
  const chosen = new Set(steps);
  const copied = draft.steps.filter((s) => chosen.has(s.id));
  const first = copied[0] ? places[copied[0].id] : undefined;
  const offsets: Clip["offsets"] = {};
  for (const s of copied) {
    const p = places[s.id];
    offsets[s.id] = p && first ? { x: p.x - first.x, y: p.y - first.y } : { x: 0, y: 0 };
  }
  return {
    format: draft.format,
    steps: structuredClone(copied),
    arrows: structuredClone(
      draft.arrows.filter((a) => chosen.has(a.from.step) && chosen.has(a.to.step)),
    ),
    offsets,
  };
}

/**
 * A clip pasted, here or in another automation (AU-68): each step with a new id and, where its name is taken, the
 * name with a number («Filtrar 2»); the citations inside the clip follow the new names, and one of a step that is
 * not in the clip stays as written (validation says if it is broken). «Duplicar» is copy and paste in one.
 * Gives the draft and the new steps' ids, by the id each had in the clip.
 */
export function pasteSteps(
  draft: Automation,
  clip: Clip,
  newId: NewId,
): { draft: Automation; steps: Record<string, string> } {
  const ids: Record<string, string> = {};
  // The clip on its own, so a rename rewrites only the citations inside it. Each name goes first to a mark no step
  // has and then to its own, so «Filtrar» → «Filtrar 2» never meets a «Filtrar 2» of the clip on the way.
  let alone: Automation = { ...draft, steps: structuredClone(clip.steps), arrows: [] };
  const finals: string[] = [];
  let names: Automation = draft;
  for (const s of clip.steps) {
    const name = uniqueName(names, s.name);
    finals.push(name);
    names = { ...names, steps: [...names.steps, { ...s, id: `\u0000${s.id}`, name }] };
  }
  alone.steps.forEach((s, i) => {
    alone = renameStep(alone, s.id, `__pegado_${i}__`);
  });
  clip.steps.forEach((s, i) => {
    alone = renameStep(alone, s.id, finals[i] as string);
  });
  const pasted = alone.steps.map((s) => {
    const id = newId();
    ids[s.id] = id;
    return { ...s, id };
  });
  const arrows = clip.arrows
    .filter((a) => ids[a.from.step] && ids[a.to.step])
    .map((a) => ({
      from: { step: ids[a.from.step] as string, output: a.from.output },
      to: { step: ids[a.to.step] as string, input: a.to.input },
    }));
  return {
    draft: { ...draft, steps: [...draft.steps, ...pasted], arrows: [...draft.arrows, ...arrows] },
    steps: ids,
  };
}

/**
 * A «Código» connected to a collection it cites (AU-31): reading it with no limits and nothing else (`newConnection`);
 * one it already has is left as it is.
 */
export function connectCollection(draft: Automation, step: string, collection: string): Automation {
  const before = draft.steps.find((s) => s.id === step);
  if (!before || (before.connections ?? []).some((c) => c.collection === collection)) return draft;
  const after: Step = {
    ...before,
    connections: [...(before.connections ?? []), newConnection(collection)],
  };
  return { ...draft, steps: draft.steps.map((s) => (s.id === step ? after : s)) };
}

/** A parameter's value. An option that is not in `step.params` is added by setting it (AU-76). */
export function setParam(
  draft: Automation,
  step: string,
  key: string,
  value: ParamValue,
  names: Namer,
): Automation {
  const before = draft.steps.find((s) => s.id === step);
  if (!before) return draft;
  return followed(draft, before, { ...before, params: { ...before.params, [key]: value } }, names);
}

/**
 * The draft with `after` in place of `before`, and its name following it while it is still the automatic one, with
 * its number if it took one (AU-86).
 */
function followed(draft: Automation, before: Step, after: Step, names: Namer): Automation {
  let out: Automation = {
    ...draft,
    steps: draft.steps.map((s) => (s.id === before.id ? after : s)),
  };
  const was = names.auto(before);
  const next = names.auto(after);
  // A change that is not in the name leaves it, number and all («Limitar 2» stays «Limitar 2»).
  if (next === was) return out;
  const automatic =
    before.name === was ||
    (before.name.startsWith(`${was} `) && /^\d+$/.test(before.name.slice(was.length + 1)));
  if (automatic) {
    const now = uniqueName(out, next, before.id);
    if (now !== before.name) out = renamed(out, before.id, now);
  }
  return out;
}

/**
 * `renameStep`, keeping each step it did not change as it was: a card is drawn again only when its step changes
 * (A-15: a rename in an automation of 200 steps redraws the steps that cite it, not all of them).
 */
function renamed(draft: Automation, step: string, name: string): Automation {
  const out = renameStep(draft, step, name);
  return {
    ...out,
    steps: out.steps.map((s, i) => {
      const was = draft.steps[i];
      return was && JSON.stringify(was) === JSON.stringify(s) ? was : s;
    }),
  };
}

/** An added option taken away (AU-76): its key leaves `step.params`, so it is its default again. */
export function removeOption(draft: Automation, step: string, key: string): Automation {
  const before = draft.steps.find((s) => s.id === step);
  if (!before || !(key in before.params)) return draft;
  const { [key]: _gone, ...params } = before.params;
  return { ...draft, steps: draft.steps.map((s) => (s.id === step ? { ...s, params } : s)) };
}

/** One of the six settings (AU-78); set to its default, it leaves `step.settings`. */
export function setSetting<K extends keyof StepSettings>(
  draft: Automation,
  step: string,
  key: K,
  value: StepSettings[K],
): Automation {
  return {
    ...draft,
    steps: draft.steps.map((s) => {
      if (s.id !== step) return s;
      const settings: StepSettings = { ...s.settings };
      if (value === undefined || JSON.stringify(value) === JSON.stringify(SETTINGS_DEFAULTS[key]))
        delete settings[key];
      else settings[key] = value;
      const { settings: _gone, ...rest } = s;
      return Object.keys(settings).length ? { ...rest, settings } : rest;
    }),
  };
}

/**
 * Another action for a step (AU-82): the parameters the two actions share by key and control keep their values,
 * the rest go, and `dropped` names the ones that had a value Juan wrote, in the panel's order, for the notice.
 */
export function changeAction(
  draft: Automation,
  step: string,
  action: string,
  names: Namer,
): { draft: Automation; dropped: string[] } {
  const before = draft.steps.find((s) => s.id === step);
  const spec = before && specOf(before.type);
  const next = spec?.actions.find((a) => a.key === action);
  if (!before || !spec || !next || before.params[ACTION] === action) return { draft, dropped: [] };
  const was = [...spec.params, ...(actionOf(before)?.params ?? [])];
  const now = [...spec.params, ...next.params];
  const params: Record<string, ParamValue> = { [ACTION]: action };
  const gone = new Set<string>();
  for (const [key, value] of Object.entries(before.params)) {
    if (key === ACTION) continue;
    const p = was.find((q) => q.key === key);
    const q = now.find((x) => x.key === key);
    if (p && q && sameKind(p, q)) params[key] = value;
    else if (!isEmpty(value)) gone.add(key);
  }
  // In the panel's order; what the panel did not show (no parameter of the action it had) after it.
  const shown = rowsOf(before).map((r) => r.param.key);
  const dropped = [
    ...shown.filter((k) => gone.has(k)),
    ...[...gone].filter((k) => !shown.includes(k)),
  ];
  return { draft: followed(draft, before, { ...before, params }, names), dropped };
}

/** Whether a value of `p` is a value of `q`: the same control over the same things («Límite» in two actions). */
function sameKind(p: ParamSpec, q: ParamSpec): boolean {
  const kind = (x: ParamSpec) =>
    JSON.stringify({
      control: x.control,
      of: "of" in x ? x.of : undefined,
      options: "options" in x ? x.options : undefined,
      over: "over" in x ? x.over : undefined,
      columns: "columns" in x ? x.columns.map((c) => [c.key, c.control]) : undefined,
    });
  return kind(p) === kind(q);
}

/**
 * A name Juan wrote (AU-86): trimmed; refused when empty; where another step has it, with a number. The citations
 * that named the step name it still (`renameStep`).
 */
export function rename(draft: Automation, step: string, name: string): Automation {
  const trimmed = name.trim();
  const target = draft.steps.find((s) => s.id === step);
  if (!trimmed || !target) return draft;
  const unique = uniqueName(draft, trimmed, step);
  return unique === target.name ? draft : renamed(draft, step, unique);
}
