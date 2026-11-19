/**
 * The chat of a page as an automation (docs/automatizaciones.md AU-137, decision 19; phase F16): «Mensaje de chat» →
 * «Agente» → «Responder». Two things live here. The rule that nothing under a page's chat writes with a «Sí»: in an
 * automation that starts in «Mensaje de chat» every write asks, whatever a cell or a «Permiso» says, because a message
 * can carry text pasted from outside and the chat runs on any device the page is open on. Publishing refuses a «Sí»
 * there (`chatYesProblems`, through `validate`), and a run reads none (the server's `consentIn` asks `chatStarted`),
 * so an old version or a document that skipped validation writes nothing alone either. And the run a message starts
 * (`chatStart`): its trigger's row, with the message labelled as the server says (the person's own when typed) and
 * each value of the page with its own label. The conversation with Boni's assistant is not an automation and never
 * passes here (decision 19): its turns keep P4.
 */
import { join, type Label, type Labeled } from "@boni/entities";
import { BONI_TRIGGERS } from "./boni.ts";
import { actionOf, PERMISSION } from "./catalogue.ts";
import { type CodeProblem, WRITE_ACTIONS } from "./code.ts";
import { hasConnections } from "./connections.ts";
import type { RunInput } from "./engine.ts";
import type { Automation, Step } from "./format.ts";
import type { Cell, FieldLabel } from "./rows.ts";

/** Whether an automation starts in «Mensaje de chat»: then nothing in it writes with a «Sí» (AU-137). */
export const chatStarted = (a: Pick<Automation, "steps">): boolean =>
  a.steps.some((s) => s.type === BONI_TRIGGERS.chat);

/** The «Sí» a step holds: each connection cell of saving at «Sí», and a «Colección» step's «Permiso: Sí». */
export function yesesOf(
  step: Step,
): ({ collection: string; action: string } | { permission: true })[] {
  const out: ({ collection: string; action: string } | { permission: true })[] = [];
  for (const c of step.connections ?? [])
    for (const a of WRITE_ACTIONS) {
      const cell = c[a];
      if (cell && cell.mode === "yes") out.push({ collection: c.collection, action: a });
    }
  if (
    !hasConnections(step.type) &&
    actionOf(step)?.effect === "write" &&
    step.params[PERMISSION] === "yes"
  )
    out.push({ permission: true });
  return out;
}

/**
 * Every «Sí» of an automation that starts in «Mensaje de chat», as `connection.notAllowed` with `why: "chat"` (AU-137:
 * «No» and «Preguntar», never «Sí»): an error, so publishing refuses it on any step a trigger reaches. Any step, not
 * only the «Agente»: a «Colección» step after the chat would write alone too. Nothing for any other automation.
 */
export function chatYesProblems(a: Automation): CodeProblem[] {
  if (!chatStarted(a)) return [];
  return a.steps.flatMap((step) =>
    yesesOf(step).map(
      (y): CodeProblem =>
        "permission" in y
          ? {
              code: "connection.notAllowed",
              severity: "error",
              step: step.id,
              param: PERMISSION,
              detail: { why: "chat" },
            }
          : {
              code: "connection.notAllowed",
              severity: "error",
              step: step.id,
              param: "connections",
              detail: { collection: y.collection, action: y.action, why: "chat" },
            },
    ),
  );
}

/** One message of a page's chat, as the server gives it to start a run (AU-137). */
export interface ChatMessage {
  /**
   * What was typed, or the text of the button pressed, with the label the server read from the hand that sent it:
   * typed in a chat it is the person's own. Never a model's or a page's word for it.
   */
  text: Labeled<string>;
  /** The page's id. */
  page: string;
  /** The values the page's controls hold (D-61), each with its own label: one read from outside stays so. */
  values?: Readonly<Record<string, Labeled<Cell>>>;
}

/** The keys of the row «Mensaje de chat» gives. */
export const CHAT_ROW = { message: "message", page: "page", values: "values" } as const;

/**
 * The run a message starts (AU-137): its automation's «Mensaje de chat» trigger and the row it gives, `message`, `page`
 * and `values`. The row's label is the message's; `values` keeps the join of its values' labels, so what came from
 * outside is still from outside downstream (this only says the labels, it joins them as `@boni/entities` does). Null for
 * an automation with no such trigger: no message starts it.
 */
export function chatStart(a: Automation, m: ChatMessage, test = false): RunInput | null {
  const trigger = a.steps.find((s) => s.type === BONI_TRIGGERS.chat);
  if (!trigger) return null;
  const values = Object.entries(m.values ?? {});
  const json: Record<string, Cell> = {
    [CHAT_ROW.message]: m.text.value,
    [CHAT_ROW.page]: m.page,
    [CHAT_ROW.values]: Object.fromEntries(values.map(([k, v]) => [k, v.value])),
  };
  const fields: Record<string, FieldLabel> = {};
  if (values.length) {
    const labels: Label[] = values.map(([, v]) => v.label);
    const [first, ...rest] = labels as [Label, ...Label[]];
    fields[CHAT_ROW.values] = {
      label: join(first, ...rest),
      derived: values.some(([, v]) => v.derived),
    };
  }
  return {
    automation: a,
    trigger: trigger.id,
    fields: {
      json,
      label: m.text.label,
      ...(Object.keys(fields).length ? { fields } : {}),
    },
    test,
  };
}
