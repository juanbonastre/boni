/**
 * The cells of an automation's writes as Boni learns from them (docs/automatizaciones.md §5.15, AU-207, AU-210): each
 * step's collection and action with its mode, the step's print that starts another count when the step changes, and
 * a version with some cells lowered from «Sí» to «Preguntar» (the pause). Pure: the server keeps the decisions and the
 * pauses (apps/server/src/automations/learning.ts), and nothing here writes a document anyone keeps (decision 10).
 */

import { actionOf, PERMISSION } from "./catalogue.ts";
import { CODE_TYPE, WRITE_ACTIONS, type WriteAction } from "./code.ts";
import { hasConnections } from "./connections.ts";
import type { Automation, Step } from "./format.ts";
import { canonical } from "./steps.ts";
import { stepChanges, type WriteMode } from "./writes.ts";

/** One cell: what a step may do in one collection, and whether it asks first. */
export interface StepCell {
  step: string;
  /** The collection's key. */
  collection: string;
  action: WriteAction;
  mode: WriteMode;
}

/** No collection by name: a «Colección» step names its collection by key. */
const NO_NAMES = { collectionNamed: () => undefined };

/**
 * A step's cells: a «Código»'s or an «Agente»'s connections, each action not in «No»; a «Colección» step's write
 * action with its «Permiso» (an «Crear o modificar» is two cells with one «Permiso»). A step that only reads has none.
 */
export function cellsOfStep(step: Step): StepCell[] {
  if (hasConnections(step.type))
    return (step.connections ?? []).flatMap((c) =>
      WRITE_ACTIONS.flatMap((action) => {
        const cell = c[action];
        return cell ? [{ step: step.id, collection: c.collection, action, mode: cell.mode }] : [];
      }),
    );
  return stepChanges(step, NO_NAMES).flatMap((change) =>
    change.actions.flatMap((a) =>
      a.mode
        ? [{ step: step.id, collection: change.collection, action: a.action, mode: a.mode }]
        : [],
    ),
  );
}

export const writeCells = (a: Automation): StepCell[] => a.steps.flatMap(cellsOfStep);

/** The cell of a step for one collection and action, or undefined when the step has none. */
export const stepCell = (
  a: Automation,
  step: string,
  collection: string,
  action: WriteAction,
): StepCell | undefined => {
  const s = a.steps.find((x) => x.id === step);
  return s
    ? cellsOfStep(s).find((c) => c.collection === collection && c.action === action)
    : undefined;
};

/** A step with no write mode in it: each cell's mode and a «Colección»'s «Permiso» left out, the rest as it is. */
function withoutModes(step: Step): unknown {
  const { [PERMISSION]: _permission, ...params } = step.params;
  const writes = actionOf(step)?.effect === "write";
  return {
    ...step,
    params: writes && step.type !== CODE_TYPE ? params : step.params,
    ...(step.connections
      ? {
          connections: step.connections.map((c) => {
            const next: Record<string, unknown> = { ...c };
            for (const a of WRITE_ACTIONS) {
              const cell = c[a];
              if (cell) {
                const { mode: _mode, ...rest } = cell;
                next[a] = rest;
              }
            }
            return next;
          }),
        }
      : {}),
  };
}

/**
 * The print of a step for its counts (AU-207): what `lowerYes` compares to keep a «Sí» (the step and the arrows into
 * it), without the write modes. Changing its instructions, its code, its connections' limits or where its rows come
 * from gives another print and starts another count, because what was accepted was of another step; turning a cell
 * from «Preguntar» to «Sí» keeps it, since that is what the count is for. `digest` is the server's (SHA-256).
 */
export function cellPrint(a: Automation, step: string, digest: (text: string) => string): string {
  const s = a.steps.find((x) => x.id === step);
  if (!s) return "";
  const into = a.arrows
    .filter((r) => r.to.step === step)
    .map((r) => `${r.from.step}:${r.from.output}>${r.to.input}`)
    .sort();
  return digest(canonical({ step: withoutModes(s), into }));
}

/**
 * The version with the cells `paused` says lowered from «Sí» to «Preguntar» (AU-210): only lowers, never raises, and
 * leaves every other cell and every other thing as it is. A «Colección» step has one «Permiso» for its actions, so
 * pausing one of an «Crear o modificar» asks for both. The same document comes back when nothing is lowered.
 */
export function lowerCells(
  a: Automation,
  paused: (step: string, collection: string, action: WriteAction) => boolean,
): Automation {
  let changed = false;
  const steps = a.steps.map((step) => {
    if (hasConnections(step.type)) {
      if (!step.connections?.length) return step;
      let mine = false;
      const connections = step.connections.map((c) => {
        const next = { ...c };
        for (const action of WRITE_ACTIONS) {
          const cell = c[action];
          if (cell && cell.mode === "yes" && paused(step.id, c.collection, action)) {
            Object.assign(next, { [action]: { ...cell, mode: "ask" } });
            mine = true;
          }
        }
        return next;
      });
      if (!mine) return step;
      changed = true;
      return { ...step, connections };
    }
    const hit = cellsOfStep(step).some(
      (c) => c.mode === "yes" && paused(step.id, c.collection, c.action),
    );
    if (!hit) return step;
    changed = true;
    return { ...step, params: { ...step.params, [PERMISSION]: "ask" } };
  });
  return changed ? { ...a, steps } : a;
}
