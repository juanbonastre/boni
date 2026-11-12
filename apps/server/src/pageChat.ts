/**
 * A page's chat on the server (docs/sistema.md §4.6 point 6, D-61): the flow a «Chat» block names (its «Chat»
 * trigger and its «Agente» step, @boni/agent chat.ts), made, read and changed from the block's panel, and what a
 * message written in it runs with: the step's instructions, and where the policy lets it act (P26): its actions, its
 * page and the collections that page shows. The «Agente» step is never interpreted as a step: each message is a turn
 * of Juan's whose plan the planner writes within it.
 */
import {
  agentStepOf,
  CHAT_ACTIONS,
  CHAT_INSTRUCTIONS,
  type ChatAction,
  type ChatButton,
  type ChatScope,
  chatPlan,
  chatTrigger,
  newFlowId,
} from "@boni/agent";
import type { UserStore } from "@boni/store";
import type { PageBlock } from "@boni/views";
import { getPage } from "./pages.ts";

/** A chat as its panel and its block show it. */
export interface ChatView {
  flow: string;
  version: number;
  name: string;
  page: string;
  welcome: string;
  buttons: ChatButton[];
  instructions: string;
  actions: ChatAction[];
  /** Boni's default instructions (English), for «Restablecer». */
  defaults: { instructions: string; actions: readonly ChatAction[] };
  enabled: boolean;
}

/** The chat a flow is, or null when it is no page's chat. */
export function chatView(store: UserStore, flowId: string): ChatView | null {
  const f = store.journal.flow(flowId);
  const t = f ? chatTrigger(f.trigger) : null;
  const step = f ? agentStepOf(f.plan) : null;
  if (!f || !t || !step) return null;
  return {
    flow: f.id,
    version: f.version,
    name: f.name,
    page: t.page,
    welcome: t.welcome,
    buttons: t.buttons,
    instructions: step.instructions,
    actions: step.actions,
    defaults: { instructions: CHAT_INSTRUCTIONS, actions: CHAT_ACTIONS },
    enabled: f.enabled,
  };
}

/** A new chat for one of Juan's pages: its flow, on, with Boni's instructions and every action of the list. */
export function createChat(store: UserStore, page: string, now: number): ChatView | null {
  const p = getPage(store, page);
  if (!p || p.template) return null;
  const name = `Chat · ${p.title || page}`.slice(0, 80);
  const f = store.journal.saveFlow({
    id: newFlowId(`chat ${p.title || page}`),
    name,
    trigger: { chat: { page: p.id, welcome: "", buttons: [] } },
    inputs: [],
    plan: chatPlan(),
    layout: null,
    by: "user",
    enabled: true,
    created: now,
  });
  return chatView(store, f.id);
}

export type ChatEdit = {
  base: number;
  welcome?: unknown;
  buttons?: unknown;
  instructions?: unknown;
  actions?: unknown;
};

/**
 * Juan's change to a chat (its panel's «Guardar»): a new version of its flow over the one he started from, its page
 * kept; what does not fit the trigger or the step is refused whole.
 */
export function updateChat(
  store: UserStore,
  flowId: string,
  edit: ChatEdit,
  now: number,
): ChatView | "not-found" | "conflict" | "invalid" {
  const f = store.journal.flow(flowId);
  const was = chatView(store, flowId);
  if (!f || !was) return "not-found";
  if (f.version !== edit.base) return "conflict";
  const trigger = {
    chat: {
      page: was.page,
      welcome: edit.welcome ?? was.welcome,
      buttons: edit.buttons ?? was.buttons,
    },
  };
  const plan = chatPlan(
    (edit.instructions ?? was.instructions) as string,
    (edit.actions ?? was.actions) as ChatAction[],
  );
  if (!chatTrigger(trigger) || !agentStepOf(plan)) return "invalid";
  store.journal.saveFlow({
    id: f.id,
    name: f.name,
    trigger,
    inputs: [],
    plan,
    layout: null,
    by: "user",
    enabled: f.enabled,
    created: now,
  });
  return chatView(store, flowId) ?? "not-found";
}

/**
 * The collections a page shows (P26): what its numbers, lists, charts and tables read, what its controls choose from,
 * and the collection an option control's relation names (Gastos' «Categoría» names «Categorías»).
 */
export function pageTypes(store: UserStore, blocks: readonly PageBlock[]): string[] {
  const types = store.schema().types;
  const out = new Set<string>();
  for (const b of blocks) {
    if (b.type === "number" || b.type === "bars" || b.type === "graph") out.add(b.collection);
    if (b.type === "database") {
      out.add(b.source);
      for (const a of b.view.also ?? []) out.add(a);
    }
    if (b.type === "control" && b.collection) {
      out.add(b.collection);
      const f = types[b.collection]?.fields.find((x) => x.id === b.field);
      if (f?.relation?.target) out.add(f.relation.target);
    }
  }
  return [...out].filter((id) => types[id]);
}

/** What a message written in a page's chat runs with, or why it does not run. */
export type ChatTurn =
  | {
      flow: { id: string; version: number };
      page: string;
      instructions: string;
      scope: ChatScope;
    }
  | { error: "no-chat" | "chat-off" };

/**
 * A chat's turn, read from what is saved now: its flow (on), its page, and a «Chat» block of that page naming it.
 * A chat whose block was taken off its page, or whose page is gone, answers nothing more.
 */
export function chatTurnOf(store: UserStore, flowId: string): ChatTurn {
  const c = chatView(store, flowId);
  const p = c ? getPage(store, c.page) : null;
  if (
    !c ||
    !p ||
    !p.spec.blocks.some((b) => b.type === "chat" && b.flow === flowId) ||
    // Deleted in «Flujos»: its versions stay for its runs, and it answers nothing more.
    !store.journal.flows().some((f) => f.id === flowId)
  )
    return { error: "no-chat" };
  if (!c.enabled) return { error: "chat-off" };
  return {
    flow: { id: c.flow, version: c.version },
    page: c.page,
    instructions: c.instructions,
    scope: { actions: c.actions, page: c.page, types: pageTypes(store, p.spec.blocks) },
  };
}
