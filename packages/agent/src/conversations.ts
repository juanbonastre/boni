/**
 * Juan's conversations with Boni, kept in his store (docs/conversacion.md 3.1): a `conversation` per chat (its title,
 * the planner model chosen for it, when it was last used) and a `turn` per request (what Juan wrote, Boni's replies as
 * labelled values, its run, and the question or confirmation it waits on). Only code writes them (system types, actor
 * `system`), never inside a run: undoing a run never takes back what was said. The agent reads a conversation's last
 * turns as its history, through `toPlannerView` as before.
 */
import { label } from "@boni/entities";
import type { StoredEntity, UserStore } from "@boni/store";
import type { Pending, Reply } from "./agent.ts";
import { type Painted, paint, type Val } from "./values.ts";

export const CONVERSATION = "conversation";
export const TURN = "turn";
const CODE = label("own", "personal", [{ kind: "code", id: "conversations" }]);
const v = (value: string) => ({ value, label: CODE });
const meta = (device?: string) => ({ actor: "system" as const, ...(device ? { device } : {}) });

export interface ConversationInfo {
  id: string;
  title: string;
  /** The planner model chosen for it (`connection:model`), or "" for the account's. */
  model: string;
  /** When it was last written in (epoch ms). */
  last: number;
}
/** A turn as the history keeps it for the planner: the request and the replies with their labels. */
export interface HistoryTurn {
  request: string;
  replies: { component: string; data: Record<string, Val> }[];
}
/** A turn as a device shows it. */
export interface TurnView {
  id: string;
  request: string;
  run: string;
  status: "done" | "waiting" | "stopped";
  replies: Reply[];
  pending: Pending | null;
  error: string | null;
  /** Whether its run changed something still not undone. */
  changed: boolean;
  at: number;
}

const json = <T>(s: unknown, fallback: T): T => {
  try {
    return typeof s === "string" && s ? (JSON.parse(s) as T) : fallback;
  } catch {
    return fallback;
  }
};
const alive = (s: StoredEntity) => s.entity.deleted === undefined;
const text = (s: StoredEntity, k: string) => String(s.entity.values[`f_${k}`] ?? "");

const info = (s: StoredEntity): ConversationInfo => ({
  id: s.entity.id,
  title: text(s, "title"),
  model: text(s, "model"),
  last: Number(text(s, "last")) || 0,
});

/** A title from the first request: its first words, cut at a word (the code's, never a model's). */
export function titleFrom(request: string): string {
  const t = request.replace(/\s+/g, " ").trim();
  if (t.length <= 60) return t;
  const cut = t.slice(0, 60);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 40)).trim()}…`;
}

/** The conversations, the latest first (none deleted). */
export function listConversations(store: UserStore): ConversationInfo[] {
  if (!store.schema().types[CONVERSATION]) return [];
  return store
    .list(CONVERSATION)
    .filter(alive)
    .map(info)
    .sort((a, b) => b.last - a.last);
}

export function conversation(store: UserStore, id: string): ConversationInfo | null {
  const s = store.get(id);
  return s && s.entity.type === CONVERSATION && alive(s) ? info(s) : null;
}

/** A new conversation; its title comes with its first turn unless one is given. */
export function createConversation(
  store: UserStore,
  o: { title?: string; key?: string; model?: string; device?: string; now: number },
): string {
  return store.create(
    CONVERSATION,
    {
      f_title: v(o.title ?? ""),
      f_key: v(o.key ?? ""),
      f_model: v(o.model ?? ""),
      f_last: v(String(o.now)),
    },
    meta(o.device),
  ).entity.id;
}

/** The conversation a device without one of its own talks in (a device that predates the list). */
export function conversationByKey(
  store: UserStore,
  key: string,
  o: { device?: string; now: number },
): string {
  const had = store.schema().types[CONVERSATION]
    ? store.list(CONVERSATION).find((s) => alive(s) && text(s, "key") === key)
    : undefined;
  return had ? had.entity.id : createConversation(store, { key, ...o });
}

export function updateConversation(
  store: UserStore,
  id: string,
  o: { title?: string; model?: string; device?: string },
): boolean {
  if (!conversation(store, id)) return false;
  const writes: Record<string, ReturnType<typeof v>> = {};
  if (o.title !== undefined) writes.f_title = v(o.title);
  if (o.model !== undefined) writes.f_model = v(o.model);
  if (Object.keys(writes).length) store.update(id, writes, meta(o.device));
  return true;
}

/** To the trash (Undo brings it back), with its turns. */
export function deleteConversation(store: UserStore, id: string, device?: string): boolean {
  if (!conversation(store, id)) return false;
  store.batch(() => {
    for (const t of turnsOf(store, id)) store.remove(t.entity.id, meta(device));
    store.remove(id, meta(device));
  });
  return true;
}

function turnsOf(store: UserStore, id: string): StoredEntity[] {
  if (!store.schema().types[TURN]) return [];
  return store
    .list(TURN)
    .filter((s) => alive(s) && text(s, "conversation") === id)
    .sort((a, b) => (Number(text(a, "at")) || 0) - (Number(text(b, "at")) || 0));
}

/** The last `n` turns of a conversation as the planner's history (their replies as the labelled values they were). */
export function history(store: UserStore, id: string, n = 10): HistoryTurn[] {
  return turnsOf(store, id)
    .slice(-n)
    .map((s) => ({
      request: text(s, "request"),
      replies: json<HistoryTurn["replies"]>(s.entity.values.f_replies, []),
    }));
}

/** A conversation's turns as a device shows them (the replies painted). */
export function turnViews(store: UserStore, id: string): TurnView[] {
  return turnsOf(store, id).map((s) => {
    const status = text(s, "status");
    return {
      id: s.entity.id,
      request: text(s, "request"),
      run: text(s, "run"),
      status: status === "waiting" || status === "stopped" ? status : "done",
      replies: json<HistoryTurn["replies"]>(s.entity.values.f_replies, []).map((r) => ({
        component: r.component,
        data: Object.fromEntries(
          Object.entries(r.data).map(([k, x]): [string, Painted] => [k, paint(x)]),
        ),
      })),
      pending: json<Pending | null>(s.entity.values.f_pending, null),
      error: text(s, "error") || null,
      changed: text(s, "run") !== "" && store.runUndoable(text(s, "run")),
      at: Number(text(s, "at")) || 0,
    };
  });
}

/**
 * A turn written as it stands (made the first time, updated as its run goes on: a question answered, a confirmation
 * given). The conversation gets its title from its first request and its time from its latest turn.
 */
export function recordTurn(
  store: UserStore,
  t: {
    /** The turn's own record once it has one. */
    id: string | null;
    conversation: string;
    request: string;
    run: string;
    status: TurnView["status"];
    replies: HistoryTurn["replies"];
    pending: Pending | null;
    error: string | null;
    at: number;
    device?: string;
  },
): string | null {
  const c = conversation(store, t.conversation);
  if (!c) return null;
  const writes = {
    f_request: v(t.request),
    f_conversation: v(t.conversation),
    f_run: v(t.run),
    f_status: v(t.status),
    f_replies: v(JSON.stringify(t.replies)),
    f_pending: v(t.pending ? JSON.stringify(t.pending) : ""),
    f_error: v(t.error ?? ""),
  };
  let id = t.id;
  store.batch(() => {
    if (id && store.get(id)) store.update(id, writes, meta(t.device));
    else id = store.create(TURN, { ...writes, f_at: v(String(t.at)) }, meta(t.device)).entity.id;
    const conv: Record<string, ReturnType<typeof v>> = { f_last: v(String(t.at)) };
    if (!c.title) conv.f_title = v(titleFrom(t.request));
    store.update(t.conversation, conv, meta(t.device));
  });
  return id;
}
