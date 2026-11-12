import type { PageBlock } from "./page.ts";
import { type ControlBlock, heldValue, refOf, VALUE_MAX } from "./pageValues.ts";

/**
 * A page's buttons (docs/sistema.md §4.6, F11; D-60): a button opens a screen's form (the first buttons, «Apuntar
 * gasto»), runs an action of the one list of actions, starts a flow (its form filled with values), or opens another
 * page carrying values, as a link does. What it passes is a literal saved with the button or `$<a control's id>` (what
 * that control of the page holds when it is pressed); the server reads both from the saved page (never what the app
 * says) and runs the action or the flow through the policy as Juan's touch, with the labels of whoever wrote the page.
 */

/** What a button does; none is «Formulario» (the first buttons). */
export const BUTTON_DOES = ["screen", "action", "flow", "page"] as const;
export type ButtonDoes = (typeof BUTTON_DOES)[number];

/**
 * The actions of the list a button may run: a record of one of the user's collections made, changed or deleted. Each
 * keeps its own confirmation and Undo (deleting is always confirmed, P5).
 */
export const BUTTON_ACTIONS = ["entities.create", "entities.update", "entities.delete"] as const;
export type ButtonAction = (typeof BUTTON_ACTIONS)[number];
/** The ones that work on a record, which a control of the page holds (an option over a relation). */
export const RECORD_ACTIONS: readonly ButtonAction[] = ["entities.update", "entities.delete"];
/** The ones that take values for the record's fields. */
export const VALUE_ACTIONS: readonly ButtonAction[] = ["entities.create", "entities.update"];

/** What a button passes, by a field's id or a form's name: a literal, or `$<a control's id>`. */
export type ButtonArg = string | number | boolean;
export type ButtonArgs = Record<string, ButtonArg>;
export const BUTTON_ARGS_MAX = 20;
const KEY = /^[a-z0-9_][a-z0-9_-]{0,63}$/i;

export type ButtonBlock = Extract<PageBlock, { type: "action" }>;
export const buttonDoes = (b: Pick<ButtonBlock, "does">): ButtonDoes => b.does ?? "screen";

/** Whether a button's values are well formed: a few, each by a key, a short text, a number or a yes/no. */
export function buttonArgsOk(v: unknown): v is ButtonArgs {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const all = Object.entries(v);
  return (
    all.length <= BUTTON_ARGS_MAX &&
    all.every(
      ([k, x]) =>
        KEY.test(k) &&
        ((typeof x === "string" && x.length <= VALUE_MAX) ||
          (typeof x === "number" && Number.isFinite(x)) ||
          typeof x === "boolean"),
    )
  );
}

/** The controls a button's values name (`$<id>`), as ids. */
export function buttonRefs(b: ButtonBlock): string[] {
  const out: string[] = [];
  const add = (v: unknown) => {
    const r = refOf(v);
    if (r) out.push(r);
  };
  add(b.record);
  for (const v of Object.values(b.set ?? {})) add(v);
  for (const v of Object.values(b.inputs ?? {})) add(v);
  for (const v of Object.values(b.pass ?? {})) add(v);
  return out;
}

/**
 * What a button's values are now, by their keys: a literal as saved, or what the control it names holds; a control
 * that holds nothing gives null. `from` says which control each came from.
 */
export function buttonValues(
  args: ButtonArgs | undefined,
  controls: readonly ControlBlock[],
): { values: Record<string, ButtonArg | null>; from: Record<string, string> } {
  const values: Record<string, ButtonArg | null> = {};
  const from: Record<string, string> = {};
  for (const [k, v] of Object.entries(args ?? {})) {
    const ref = refOf(v);
    if (!ref) {
      values[k] = v;
      continue;
    }
    from[k] = ref;
    values[k] = heldValue(controls.find((c) => c.id === ref)) ?? null;
  }
  return { values, from };
}
