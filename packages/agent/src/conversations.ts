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
  /** Pinned: on top of the list, on every device (task 63, point 7). */
  pinned: boolean;
  /**
   * The page's chat it is written in (D-61): that chat's flow, whose «Agente» step plans every turn of it; "" for an
   * ordinary conversation. The writing bar shows it as a label a click removes.
   */
  flow: string;
}
/** A turn as the history keeps it for the planner: the request and the replies with their labels. */
export interface HistoryTurn {
  request: string;
  replies: { component: string; data: Record<string, Val> }[];
  /** Juan edited it (§3.1): what it did was undone, and the turn that corrects it redoes it with his new words. */
  corrected?: boolean;
  /** Its run: what `turns.undo` takes back, bound by code as `$history[i].turn` (never shown to a model). */
  run?: string;
}
/** Something the user pointed at with a message, as its chip said it (a reference and its words; I-33). */
export interface TurnChip {
  ref: Record<string, unknown>;
  title: string;
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
  /** What the user pointed at with it, as its chips said it. */
  pointed: TurnChip[];
  /** Juan edited it (§3.1): its run was taken back, and a later turn redid it with the new words. */
  corrected: boolean;
  /** The run of the turn it corrects, when it is a correction. */
  corrects: string | null;
}

const json = <T>(s: unknown, fallback: T): T => {
  try {
    return typeof s === "string" && s ? (JSON.parse(s) as T) : fallback;
  } catch {
    return fallback;
  }
};
const alive = (s: StoredEntity) => s.entity.deleted === undefined;
/** A field a newer Boni gives a system type (ensureSystemTypes adds it; a store not yet opened by it lacks it). */
const hasField = (store: UserStore, type: string, key: string) =>
  !!store.schema().types[type]?.fields.some((f) => f.id === `f_${key}`);
const text = (s: StoredEntity, k: string) => String(s.entity.values[`f_${k}`] ?? "");

const info = (s: StoredEntity): ConversationInfo => ({
  id: s.entity.id,
  title: text(s, "title"),
  model: text(s, "model"),
  last: Number(text(s, "last")) || 0,
  pinned: text(s, "pinned") === "1",
  flow: text(s, "flow"),
});

/** A title from the first request: its first words, cut at a word (the code's, never a model's). */
export function titleFrom(request: string): string {
  const t = request.replace(/\s+/g, " ").trim();
  if (t.length <= 60) return t;
  const cut = t.slice(0, 60);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 40)).trim()}…`;
}

/** The conversations, the pinned first and then the latest (none deleted). */
export function listConversations(store: UserStore): ConversationInfo[] {
  if (!store.schema().types[CONVERSATION]) return [];
  return (
    store
      .list(CONVERSATION)
      .filter(alive)
      .map(info)
      // The pinned first, each part the latest first.
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.last - a.last)
  );
}

export function conversation(store: UserStore, id: string): ConversationInfo | null {
  const s = store.get(id);
  return s && s.entity.type === CONVERSATION && alive(s) ? info(s) : null;
}

/** A new conversation; its title comes with its first turn unless one is given. */
export function createConversation(
  store: UserStore,
  o: { title?: string; key?: string; model?: string; flow?: string; device?: string; now: number },
): string {
  return store.create(
    CONVERSATION,
    {
      f_title: v(o.title ?? ""),
      f_key: v(o.key ?? ""),
      f_model: v(o.model ?? ""),
      f_last: v(String(o.now)),
      ...(o.flow && hasField(store, CONVERSATION, "flow") ? { f_flow: v(o.flow) } : {}),
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
  o: { title?: string; model?: string; pinned?: boolean; flow?: string; device?: string },
): boolean {
  if (!conversation(store, id)) return false;
  const writes: Record<string, ReturnType<typeof v>> = {};
  if (o.title !== undefined) writes.f_title = v(o.title);
  if (o.model !== undefined) writes.f_model = v(o.model);
  if (o.pinned !== undefined && hasField(store, CONVERSATION, "pinned"))
    writes.f_pinned = v(o.pinned ? "1" : "");
  if (o.flow !== undefined && hasField(store, CONVERSATION, "flow")) writes.f_flow = v(o.flow);
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
      ...(text(s, "corrected") ? { corrected: true } : {}),
      ...(text(s, "run") ? { run: text(s, "run") } : {}),
    }));
}

/** A conversation's turn by its run (the one a correction names), or null. */
export function turnOfRun(
  store: UserStore,
  id: string,
  run: string,
): { id: string; corrected: boolean; request: string } | null {
  if (!run) return null;
  const s = turnsOf(store, id).find((x) => text(x, "run") === run);
  return s
    ? { id: s.entity.id, corrected: text(s, "corrected") === "1", request: text(s, "request") }
    : null;
}

/** Juan edited this turn's message (§3.1): marked once its run is taken back; it stays in the history. */
export function markCorrected(store: UserStore, turn: string, device?: string): void {
  if (hasField(store, TURN, "corrected")) store.update(turn, { f_corrected: v("1") }, meta(device));
}

/** A conversation's turns as a device shows them (the replies painted). */
/** `undoable`: a run's changes outside the store's log (AgentOptions.undoable). */
export function turnViews(
  store: UserStore,
  id: string,
  undoable?: (run: string) => boolean,
): TurnView[] {
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
      changed:
        text(s, "run") !== "" &&
        (store.runUndoable(text(s, "run")) || !!undoable?.(text(s, "run"))),
      at: Number(text(s, "at")) || 0,
      pointed: json<TurnChip[]>(s.entity.values.f_pointed, []).slice(0, 20),
      corrected: text(s, "corrected") === "1",
      corrects: text(s, "corrects") || null,
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
    /** What the user pointed at with it: written when the turn is first kept, never changed after. */
    chips?: TurnChip[];
    /**
     * The run of the turn it corrects (§3.1): written when the turn is first kept (Juan edited his message), or once
     * its plan took that turn back (`turns.undo`, «antes te he dicho X, pero es Y»); never changed after.
     */
    corrects?: string;
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
    const was = id ? store.get(id) : null;
    if (id && was) {
      const all: Record<string, ReturnType<typeof v>> = { ...writes };
      if (t.corrects && !was.entity.values.f_corrects && hasField(store, TURN, "corrects"))
        all.f_corrects = v(t.corrects);
      store.update(id, all, meta(t.device));
    } else
      id = store.create(
        TURN,
        {
          ...writes,
          f_at: v(String(t.at)),
          ...(t.chips?.length && hasField(store, TURN, "pointed")
            ? { f_pointed: v(JSON.stringify(t.chips)) }
            : {}),
          ...(t.corrects && hasField(store, TURN, "corrects") ? { f_corrects: v(t.corrects) } : {}),
        },
        meta(t.device),
      ).entity.id;
    const conv: Record<string, ReturnType<typeof v>> = { f_last: v(String(t.at)) };
    if (!c.title) conv.f_title = v(titleFrom(t.request));
    store.update(t.conversation, conv, meta(t.device));
  });
  return id;
}
