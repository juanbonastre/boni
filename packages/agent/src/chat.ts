/**
 * A page's chat (docs/sistema.md §4.6 point 6, docs/conversacion.md §3.2, D-61): a flow whose trigger is «Chat» (the
 * page it is on, its welcome and its buttons) and whose plan is one «Agente» step (its instructions and the actions it
 * may use, from a fixed list). Typing in the chat is a turn of Juan's in that mode: the planner writes its plan with
 * only those actions, over only that page and the collections it shows (P26), and what it answers carries the figures
 * code computed, never a number of the model's own (`chatPlanErrors`).
 */
import type { Plan } from "./plan.ts";

/**
 * What a page's chat may do, at most: read the page's figures as the server computes them (with its values), read
 * and count the collections it shows, and change the page's values. A chat's step names some of these; nothing else
 * is ever offered or allowed to it (P26).
 */
export const CHAT_ACTIONS = [
  "pages.figures",
  "entities.query",
  "entities.aggregate",
  "pages.set_value",
] as const;
export type ChatAction = (typeof CHAT_ACTIONS)[number];

export const CHAT_LIMITS = {
  welcome: 400,
  buttons: 6,
  label: 40,
  text: 300,
  instructions: 2000,
} as const;

/** A button of the chat: its label, and what pressing it writes in the chat as Juan's message. */
export interface ChatButton {
  label: string;
  text: string;
}
/** The «Chat» trigger: the page it is on, what it says before anything is written, and its buttons. */
export interface ChatTrigger {
  page: string;
  welcome: string;
  buttons: ChatButton[];
}
/** The «Agente» step: what it is told (English or Juan's words) and the actions it may use. */
export interface AgentStep {
  id: string;
  op: "agent";
  instructions: string;
  actions: ChatAction[];
}

const PAGE_ID = /^[A-Za-z0-9_-]{1,80}$/;
const STEP_ID = /^[A-Za-z][A-Za-z0-9_]{0,30}$/;
const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const only = (o: Record<string, unknown>, keys: string[]) =>
  Object.keys(o).every((k) => keys.includes(k));
const short = (v: unknown, max: number, empty = false) =>
  typeof v === "string" && v.length <= max && (empty || v.trim().length > 0);

/** The chat a trigger is, or null when it is no chat or not a well-formed one. */
export function chatTrigger(trigger: unknown): ChatTrigger | null {
  if (!isObj(trigger) || !only(trigger, ["chat"]) || !isObj(trigger.chat)) return null;
  const c = trigger.chat;
  if (!only(c, ["page", "welcome", "buttons"])) return null;
  if (typeof c.page !== "string" || !PAGE_ID.test(c.page)) return null;
  if (!short(c.welcome ?? "", CHAT_LIMITS.welcome, true)) return null;
  const buttons = c.buttons ?? [];
  if (!Array.isArray(buttons) || buttons.length > CHAT_LIMITS.buttons) return null;
  for (const b of buttons)
    if (
      !isObj(b) ||
      !only(b, ["label", "text"]) ||
      !short(b.label, CHAT_LIMITS.label) ||
      !short(b.text, CHAT_LIMITS.text)
    )
      return null;
  return {
    page: c.page,
    welcome: (c.welcome as string | undefined) ?? "",
    buttons: (buttons as ChatButton[]).map((b) => ({ label: b.label, text: b.text })),
  };
}

/** A chat flow's plan: exactly one «Agente» step, with its instructions and actions of the list; else null. */
export function agentStepOf(plan: unknown): AgentStep | null {
  if (!isObj(plan) || plan.version !== 1 || !Array.isArray(plan.steps) || plan.steps.length !== 1)
    return null;
  const s = plan.steps[0];
  if (!isObj(s) || !only(s, ["id", "op", "instructions", "actions"]) || s.op !== "agent")
    return null;
  if (typeof s.id !== "string" || !STEP_ID.test(s.id)) return null;
  if (!short(s.instructions, CHAT_LIMITS.instructions, true)) return null;
  if (
    !Array.isArray(s.actions) ||
    !s.actions.length ||
    new Set(s.actions).size !== s.actions.length ||
    !s.actions.every((a) => (CHAT_ACTIONS as readonly unknown[]).includes(a))
  )
    return null;
  return {
    id: s.id,
    op: "agent",
    instructions: s.instructions as string,
    actions: [...(s.actions as ChatAction[])],
  };
}

/** Whether a trigger and a plan are a page's chat: a «Chat» trigger and one «Agente» step. */
export const chatFlowOk = (trigger: unknown, plan: unknown): boolean =>
  !!chatTrigger(trigger) && !!agentStepOf(plan);

/**
 * What a new chat is told (AI-facing, English): Boni's default, which Juan may change in the chat's panel. The rules
 * that matter are the code's (P26, `chatPlanErrors`); this only guides the plan.
 */
export const CHAT_INSTRUCTIONS =
  "You answer in the chat of one of Juan's pages. To answer a question about what the page shows, first set the page's controls with pages.set_value (by the control's name, as the screen lists them) so the page shows what he asks, then read the figure with pages.figures (the block whose numbers answer it, by its id) and reply with that figure by ref. Never write a number yourself.";

/** A chat flow's plan, with its one «Agente» step. */
export const chatPlan = (
  instructions: string = CHAT_INSTRUCTIONS,
  actions: readonly ChatAction[] = CHAT_ACTIONS,
) => ({
  version: 1 as const,
  steps: [{ id: "agente", op: "agent" as const, instructions, actions: [...actions] }],
});

/**
 * Where a chat's run is decided (policy P26): the actions its step gives, the page it is on and the collections that
 * page shows (by id). The agent resolves each `type` argument to its collection's id for the policy.
 */
export interface ChatScope {
  actions: readonly string[];
  page: string;
  types: readonly string[];
}

const DIGIT = /\p{Nd}/u;
/** Whether an expression holds a literal that is a number, or a text with a digit in it, anywhere. */
function numberLiteral(e: unknown, depth = 0): boolean {
  if (!isObj(e) || depth > 6) return false;
  if ("lit" in e)
    return typeof e.lit === "number" || (typeof e.lit === "string" && DIGIT.test(e.lit));
  if ("fn" in e && Array.isArray(e.args)) return e.args.some((a) => numberLiteral(a, depth + 1));
  return false;
}

/**
 * What a chat's plan may not do beyond what `validatePlan` checks, as errors the planner is given to try again (fixed
 * codes, never data): no reader (a model's words would carry its own numbers), and no number of the model's own in
 * what it says (a reply's data or a question): a figure comes by ref from what the code computed (`pages.figures`,
 * `entities.aggregate`), or from Juan's own words (`quote`).
 */
export function chatPlanErrors(plan: Plan): string[] {
  const errors: string[] = [];
  plan.steps.forEach((s, i) => {
    const where = `steps[${i}]`;
    if (s.op === "read") errors.push(`${where}: no-reader-in-chat`);
    if (s.op === "reply")
      for (const [k, e] of Object.entries(s.data))
        if (numberLiteral(e)) errors.push(`${where}.data.${k}: number-not-computed`);
    if (s.op === "ask" && (numberLiteral(s.prompt) || numberLiteral(s.options)))
      errors.push(`${where}: number-not-computed`);
  });
  return errors;
}
