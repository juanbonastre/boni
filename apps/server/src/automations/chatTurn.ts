/**
 * A message of a page's chat once that chat is an automation (docs/automatizaciones.md AU-137, F16 S2c, the switch):
 * the turn route sends it here instead of the engine of before. What runs is read from what is stored, never from the
 * request: the automation the conversation names, its published version, the page its «Mensaje de chat» names and
 * that page's «Chat» block naming it. The message is one run of the automation (its row in «Ejecuciones»), started
 * from the device that sent it; its row carries the page's values and the chat's last messages (`$chat`), each with
 * its label. What the run answers is the turn's reply, as plain text; what it asks is the card of always in the chat,
 * the run's one proposal, which only a personal device accepts (A-45, A-46). The conversation, its turns and its
 * title stay where they are (`docs/conversacion.md`); the turn names the run.
 */
import {
  type ConversationInfo,
  deepLabel,
  type HistoryTurn,
  history,
  type Pending,
  paint,
  type Reply,
  recordTurn,
  type TurnResult,
  turnOfRun,
  type Val,
} from "@boni/agent";
import {
  BONI_PARAMS,
  BONI_TRIGGERS,
  type ChatLine,
  type ChatMessage,
  chatPageOf,
  type Execution,
} from "@boni/automations";
import { join, type Label, type Labeled, label } from "@boni/entities";
import type { UserStore } from "@boni/store";
import { heldValue } from "@boni/views";
import { handLabel } from "../actions.ts";
import type { ChatView } from "../pageChat.ts";
import { getPage } from "../pages.ts";
import { chatCardOf } from "./proposal.ts";
import { type RunHand, runChat } from "./runs.ts";
import { publishedOf } from "./service.ts";

/** How many earlier messages a chat's run receives in `$chat` (AU-222's «Memoria» makes it his, 0 to 20). */
export const CHAT_MEMORY = 10;
/** The longest reply or message of an earlier turn kept in `$chat`: the rest is cut. */
export const CHAT_LINE = 2000;

const CODE = label("own", "personal", [{ kind: "code", id: "chat" }]);

/** Whether a conversation's chat is an automation now: its flow was converted (F16 S1, AU-228). */
export const chatIsAutomation = (store: UserStore, flow: string): boolean =>
  !!flow && store.journal.flowConversion(flow)?.state === "converted";

/**
 * The chat an automation is, as stored now: its published version, the page its «Mensaje de chat» names, and a «Chat»
 * block of that page naming it. `no-chat`: gone, unpublished, with no chat trigger, or no block names it; `chat-off`:
 * switched off.
 */
export function chatAutomationOf(
  store: UserStore,
  id: string,
): { id: string; page: string } | { error: "no-chat" | "chat-off" } {
  const row = store.journal.automation(id);
  const doc = publishedOf(store, id)?.automation;
  const page = doc ? chatPageOf(doc) : null;
  const p = page ? getPage(store, page) : null;
  if (!row || !doc || !page || !p || !p.spec.blocks.some((b) => b.type === "chat" && b.flow === id))
    return { error: "no-chat" };
  if (!row.enabled) return { error: "chat-off" };
  return { id, page };
}

/**
 * The block panel's chat once it is an automation: what its published version says (its welcome, its buttons, on or
 * off), marked as an automation so the panel opens it in «Automatizaciones» instead of changing it.
 */
export function automatedChatView(store: UserStore, view: ChatView): ChatView {
  if (!chatIsAutomation(store, view.flow)) return view;
  const doc = publishedOf(store, view.flow)?.automation;
  const t = doc?.steps.find((s) => s.type === BONI_TRIGGERS.chat);
  const welcome = t?.params[BONI_PARAMS.welcome];
  const buttons = t?.params[BONI_PARAMS.buttons];
  return {
    ...view,
    welcome: typeof welcome === "string" ? welcome : "",
    buttons: Array.isArray(buttons)
      ? buttons.flatMap((b) => {
          const o = b as { label?: unknown; text?: unknown } | null;
          return o && typeof o.label === "string" && typeof o.text === "string"
            ? [{ label: o.label, text: o.text }]
            : [];
        })
      : [],
    enabled: store.journal.automation(view.flow)?.enabled === true,
    automation: true,
  };
}

/**
 * What the device that sent it says the message is: typed on a personal device, the person's own; on a shared one, an
 * ambient voice's, as a turn's words quoted from one are (the model does not read it, and nothing of it is saved alone).
 */
export const messageLabel = (hand: Pick<RunHand, "device" | "trust">): Label =>
  hand.trust === "personal"
    ? handLabel(hand.device)
    : label("ambient", "personal", [{ kind: "user-edit", id: `device:${hand.device}` }]);

/** The values the page's controls hold now, by their names, each labelled as the page's words are. */
export function pageValues(
  store: UserStore,
  page: string,
): Record<string, Labeled<string | number>> {
  const p = getPage(store, page);
  const s = store.get(page);
  if (!p || !s) return {};
  const by = join(CODE, ...Object.values(s.labels));
  const types = store.schema().types;
  const out: Record<string, Labeled<string | number>> = {};
  for (const b of p.spec.blocks) {
    if (b.type !== "control") continue;
    const v = heldValue(b);
    if (v === undefined) continue;
    // An option by its name, as the screen says it; anything else as it holds it.
    const f = b.collection ? types[b.collection]?.fields.find((x) => x.id === b.field) : undefined;
    const o = f?.options?.find((x) => x.id === v);
    out[b.name] = { value: o ? o.name : v, label: o ? join(by, o.label) : by, derived: false };
  }
  return out;
}

/**
 * The chat's last messages before this one (`$chat`), oldest first, with the label of what they are: each reply's as
 * it was kept (a model's is model text, one quoting outside is outside) and each message's who wrote it as its turn
 * kept it. A message the person did not write on a personal device (a shared one's, an ambient voice's; or one kept
 * without who wrote it, by the engine of before) leaves its words out, its line kept with its reply: the planner never
 * reads ambient text, and one label for the whole list cannot keep it ambient beside a model's reply (`join` keeps
 * the lowest, model, which the planner reads). One label for all, the lowest: none reads as a «Sí» (A-46).
 */
export function chatMemory(
  store: UserStore,
  conversation: string,
  n = CHAT_MEMORY,
): Labeled<ChatLine[]> | undefined {
  const turns = history(store, conversation, n).filter((t) => !t.corrected);
  if (!turns.length) return undefined;
  const labels: Label[] = [label("own", "personal", [{ kind: "turn", id: conversation }])];
  const lines = turns.map((t) => {
    const his = t.requestLabel && t.requestLabel.integrity === "user" ? t.requestLabel : null;
    if (his) labels.push(his);
    const parts: string[] = [];
    for (const r of t.replies)
      for (const v of Object.values(r.data)) {
        const text = textOf(v);
        if (text) parts.push(text);
        labels.push(deepLabel(v));
      }
    return {
      message: his ? t.request.slice(0, CHAT_LINE) : "",
      reply: parts.join(" ").slice(0, CHAT_LINE),
    };
  });
  return { value: lines, label: join(labels[0] as Label, ...labels.slice(1)), derived: true };
}

/** A kept reply's words, as plain text (a list's and a record's joined). */
const textOf = (v: Val): string =>
  v.t === "v"
    ? typeof v.value === "string" || typeof v.value === "number"
      ? String(v.value)
      : ""
    : v.t === "list"
      ? v.items.map(textOf).filter(Boolean).join(", ")
      : Object.values(v.fields).map(textOf).filter(Boolean).join(", ");

/** A reply of the run as the chat keeps it: its text in a slot of a fixed template, so nothing of it is read as code. */
function replyOf(e: Execution | null): HistoryTurn["replies"] {
  if (!e?.reply?.text) return [];
  const template: Val = { t: "v", value: "{a}", label: CODE, derived: false };
  const a: Val = { t: "v", value: e.reply.text, label: e.reply.label, derived: true };
  return [{ component: "text", data: { template, a } }];
}
const painted = (replies: HistoryTurn["replies"]): Reply[] =>
  replies.map((r) => ({
    component: r.component,
    data: Object.fromEntries(Object.entries(r.data).map(([k, v]) => [k, paint(v)])),
  }));

/** What a run's answer is as the chat's turn: done, waiting or stopped, its reply, and its card. */
function turnOf(
  store: UserStore,
  run: string,
  e: Execution | null,
): {
  status: TurnResult["status"];
  pending: Pending | null;
  notices: TurnResult["notices"];
  error: string | null;
} {
  // A fixed code, never the step's words: «Ejecuciones» says why.
  const error = !e || e.state === "failed" ? "run-failed" : null;
  const card = chatCardOf(store, run);
  return {
    status: e?.state === "waiting" ? "waiting" : e?.state === "failed" ? "stopped" : "done",
    pending:
      card && "proposal" in card ? { kind: "confirm", id: card.proposal, view: card.view } : null,
    notices: card && "proposals" in card ? [{ code: "proposals", n: card.proposals }] : [],
    error,
  };
}

/**
 * A message of a page's chat that is an automation (`chatIsAutomation`): its run, and the turn kept in the
 * conversation. Refused before it ran (the chat is gone, off, or a run of it is under way), nothing is kept.
 */
export async function chatTurn(
  store: UserStore,
  c: ConversationInfo,
  text: string,
  hand: RunHand,
): Promise<{ result: TurnResult } | { status: number; body: unknown }> {
  const chat = chatAutomationOf(store, c.flow);
  if ("error" in chat) return { status: 409, body: { error: chat.error } };
  const memory = chatMemory(store, c.id);
  const message: ChatMessage = {
    text: { value: text, label: messageLabel(hand), derived: false },
    page: chat.page,
    values: pageValues(store, chat.page),
    ...(memory ? { chat: memory } : {}),
  };
  const r = await runChat(store, chat.id, message, hand);
  if ("error" in r) return { status: r.error === "not-found" ? 404 : 400, body: r };
  if ("refused" in r) return { status: 409, body: { error: r.refused } };
  const kept = replyOf(r.execution);
  const t = turnOf(store, r.run, r.execution);
  recordTurn(store, {
    id: null,
    conversation: c.id,
    request: text,
    requestLabel: message.text.label,
    run: r.run,
    status: t.status,
    replies: kept,
    pending: t.pending,
    error: t.error,
    at: hand.now,
    device: hand.device,
  });
  return {
    result: {
      run: r.run,
      status: t.status,
      replies: painted(kept),
      pending: t.pending,
      proposals: t.pending ? [t.pending.id] : [],
      notices: t.notices,
      error: t.error,
      changed: false,
    },
  };
}

/**
 * The chat's card answered (AU-137): its turn kept as it now stands, the card gone once accepted or declined. Null when
 * the conversation has no turn of that run.
 */
export function chatCardAnswered(
  store: UserStore,
  conversation: string,
  run: string,
  o: { error: string | null; device: string; now: number },
): TurnResult | null {
  const turn = turnOfRun(store, conversation, run);
  if (!turn) return null;
  const replies =
    history(store, conversation, Number.MAX_SAFE_INTEGER).find((h) => h.run === run)?.replies ?? [];
  const pending = o.error ? (chatCardOf(store, run) ?? null) : null;
  const card =
    pending && "proposal" in pending
      ? ({ kind: "confirm", id: pending.proposal, view: pending.view } as const)
      : null;
  recordTurn(store, {
    id: turn.id,
    conversation,
    request: turn.request,
    run,
    status: "done",
    replies,
    pending: card,
    error: o.error,
    at: o.now,
    device: o.device,
  });
  return {
    run,
    status: "done",
    replies: painted(replies),
    pending: card,
    proposals: [],
    notices: [],
    error: o.error,
    changed: !o.error && store.runUndoable(run),
  };
}
