import {
  ArrowUp,
  ArrowUpRight,
  Check,
  ChevronDown,
  Copy,
  Inbox,
  ListChecks,
  ListPlus,
  MessageSquarePlus,
  MousePointerClick,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  ShieldCheck,
  Square,
  Trash2,
  Undo2,
  Workflow,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  type AreaAccuracy,
  type ConfirmView,
  fillTemplate,
  isProposal,
  lowest,
  type Painted,
  type Pending,
  type Reply,
  type RunDetail,
  type RunSummary,
  reveal,
  type StepWords,
  textOf,
} from "../core/agent.ts";
import { deviceZone, today } from "../core/clock.ts";
import { pointKey } from "../core/pointing.ts";
import { moneyText, runCopy, runWords } from "../core/runText.ts";
import type { T } from "../i18n.ts";
import {
  agentErrorText,
  answerAsk,
  type ChatEntry,
  chooseModel,
  confirmPending,
  declinePending,
  draftOf,
  type LiveStep,
  loadConversations,
  loadInbox,
  loadPlanners,
  loadRunDetail,
  newConversation,
  openConversation,
  openRecord,
  openSettings,
  openTarget,
  proposeFromMail,
  removeConversation,
  renameConversation,
  sendTurn,
  setDraftText,
  showAudit,
  showInbox,
  showLog,
  showRun,
  stopTurn,
  toast,
  toggleChatList,
  togglePointing,
  undoRun,
  unpoint,
  useStore,
} from "../store.ts";
import { ProposalCard, RequestCard, useInboxQueue } from "./InboxCards.tsx";
import { RunPath } from "./RunPath.tsx";

/**
 * The conversation with Boni's agent (docs/nucleo.md, 7.14; docs/conversacion.md). Everything here is painted by
 * this code from labelled values: text is always text (React escapes it; nothing is HTML, Markdown or a link), what
 * came from outside carries a mark, and a confirmation shows the real values of the call with their origin and the
 * warnings against visual tricks, never a model's summary. Its button changes side every time. On the left, Juan's
 * conversations as other AIs list them; a turn shows its steps as they happen, and «Parar» stops it.
 */
export function ChatView({ compact = false }: { compact?: boolean }) {
  const t = useStore((s) => s.t);
  const chat = useStore((s) => s.chat);
  const live = useStore((s) => s.live);
  const waiting = useStore((s) => s.inbox.length + s.requests.length);
  // On the phone the list is a drawer the top bar opens.
  const list = useStore((s) => s.chatList);
  const setList = (open: boolean) => toggleChatList(open);
  const first = useStore((s) => s.dataTypes?.find((d) => !d.system)?.name);
  const end = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    void loadInbox();
    void loadConversations();
    void loadPlanners();
  }, []);
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: "end" });
  }, [chat, live]);
  // The conversations on the left: folded away or widened by dragging, kept on this device (task 92).
  const [width, setWidth] = useState(listWidth);
  const [folded, setFolded] = useState(() => kept(LIST_FOLDED) === "1");
  const fold = (f: boolean) => {
    setFolded(f);
    keep(LIST_FOLDED, f ? "1" : null);
  };
  const sized = (w: number) => Math.round(Math.min(LIST_MAX, Math.max(LIST_MIN, w)));
  const widen = (w: number) => {
    const x = sized(w);
    setWidth(x);
    keep(LIST_WIDTH, String(x));
  };
  // A drag follows the pointer it started with, even outside the window; the width is kept once it is let go.
  const dragging = useRef<{ from: number; was: number } | null>(null);
  const drag = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    dragging.current = { from: e.clientX, was: width };
  };
  const dragMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragging.current;
    if (d) setWidth(sized(d.was + e.clientX - d.from));
  };
  const dragEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragging.current;
    if (!d) return;
    dragging.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    widen(d.was + e.clientX - d.from);
  };
  return (
    <div className={`chat-layout${compact ? " compact" : ""}`}>
      {!compact &&
        (folded ? (
          <div className="chat-list-rail">
            <button
              type="button"
              className="icon-btn"
              aria-label={t("chats.show")}
              title={t("chats.show")}
              onClick={() => fold(false)}
            >
              <PanelLeftOpen size={16} strokeWidth={1.8} />
            </button>
          </div>
        ) : (
          <>
            <ConversationList width={width} onFold={() => fold(true)} />
            <div
              className="chat-list-grip"
              role="separator"
              aria-orientation="vertical"
              aria-label={t("chats.width")}
              aria-valuenow={width}
              aria-valuemin={LIST_MIN}
              aria-valuemax={LIST_MAX}
              tabIndex={0}
              onPointerDown={drag}
              onPointerMove={dragMove}
              onPointerUp={dragEnd}
              onPointerCancel={dragEnd}
              onKeyDown={(e) => {
                if (e.key === "ArrowLeft") widen(width - 16);
                if (e.key === "ArrowRight") widen(width + 16);
              }}
            />
          </>
        ))}
      {compact && list && (
        <>
          {/* The phone's conversations: a drawer from the left over a scrim (Claude's, ChatGPT's); a tap outside or
              Back closes it, and what was the chat's buttons on the desktop is at its foot. */}
          <div className="chat-drawer-scrim" onPointerDown={() => setList(false)} />
          <div className="chat-drawer" role="dialog" aria-label={t("chats.title")}>
            <ConversationList onPick={() => setList(false)} />
            <div className="chat-drawer-foot">
              <button
                type="button"
                className="link-btn"
                onClick={() => {
                  setList(false);
                  showLog();
                }}
              >
                <ListChecks size={16} strokeWidth={1.8} />
                {t("log.title")}
              </button>
              <button
                type="button"
                className="link-btn"
                onClick={() => {
                  setList(false);
                  showAudit({});
                }}
              >
                <ShieldCheck size={16} strokeWidth={1.8} />
                {t("audit.title")}
              </button>
            </div>
          </div>
        </>
      )}
      <div className={`chat${compact ? " compact" : ""}`}>
        {!compact && (
          <div className="chat-tools">
            <button type="button" className="pill" onClick={showInbox}>
              <Inbox size={14} strokeWidth={1.8} />
              <span>{waiting ? t("inbox.titleN", { n: waiting }) : t("inbox.title")}</span>
            </button>
            <button type="button" className="pill" onClick={showLog}>
              <ListChecks size={14} strokeWidth={1.8} />
              <span>{t("log.title")}</span>
            </button>
            <button type="button" className="pill" onClick={() => showAudit({})}>
              <ShieldCheck size={14} strokeWidth={1.8} />
              <span>{t("audit.title")}</span>
            </button>
          </div>
        )}
        <div className="chat-thread" aria-live="polite">
          {chat.length === 0 &&
            (compact ? (
              // On the phone an empty chat greets, with things to try (Claude's, ChatGPT's): what any account
              // can ask, and one of its own collections.
              <div className="chat-hello">
                <p className="chat-hello-title">{t("chat.hello")}</p>
                <div className="chat-hello-chips">
                  {[
                    t("chat.try.today"),
                    t("chat.try.tomorrow"),
                    ...(first ? [t("chat.try.count", { name: first })] : []),
                  ].map((x) => (
                    <button
                      key={x}
                      type="button"
                      className="m-chip"
                      onClick={() => void sendTurn(x)}
                    >
                      {x}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <p className="muted center-note">{t("chat.empty")}</p>
            ))}
          {chat.map((e) => (
            <Turn key={e.id} entry={e} />
          ))}
          <div ref={end} />
        </div>
        <Composer inWindow={compact} />
      </div>
    </div>
  );
}

/** How long ago a conversation was last used, as the list groups them: today, yesterday, this week, before. */
function groupOf(last: number, now: string): "today" | "yesterday" | "week" | "month" | "older" {
  const day = (iso: string) => {
    const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
    return Date.UTC(y, m - 1, d) / 86_400_000;
  };
  const ago = day(now) - day(today(new Date(last)));
  return ago <= 0
    ? "today"
    : ago === 1
      ? "yesterday"
      : ago < 7
        ? "week"
        : ago < 31
          ? "month"
          : "older";
}

/** How wide the conversations' list is on the desktop, and whether it is folded: kept on this device (task 92). */
const LIST_WIDTH = "boni:chatListWidth";
const LIST_FOLDED = "boni:chatListFolded";
const LIST_MIN = 180;
const LIST_MAX = 440;
const kept = (k: string): string | null => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const keep = (k: string, v: string | null) => {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    // A private window keeps nothing: it is as it was until the app is closed.
  }
};
const listWidth = () => {
  const n = Number(kept(LIST_WIDTH));
  return n >= LIST_MIN && n <= LIST_MAX ? n : 240;
};

/** Juan's conversations, the latest first, by when they were used (docs/conversacion.md 3.1). */
function ConversationList({
  onPick,
  width,
  onFold,
}: {
  onPick?: () => void;
  width?: number;
  onFold?: () => void;
}) {
  const t = useStore((s) => s.t);
  const all = useStore((s) => s.conversations);
  const open = useStore((s) => s.conversationId);
  const busy = useStore((s) => s.chatBusy);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState("");
  const groups = useMemo(() => {
    const now = today();
    const q = query.trim().toLowerCase();
    const out = new Map<string, typeof shown>();
    const shown = (all ?? []).filter((c) => !q || (c.title || "").toLowerCase().includes(q));
    for (const c of shown) {
      const g = groupOf(c.last, now);
      out.set(g, [...(out.get(g) ?? []), c]);
    }
    return [...out.entries()];
  }, [all, query]);
  return (
    <nav
      className="chat-list"
      aria-label={t("chats.title")}
      style={width ? { flexBasis: width, width } : undefined}
    >
      <div className="chat-list-head">
        <button
          type="button"
          className="btn chat-new"
          disabled={busy}
          onClick={() => {
            newConversation();
            onPick?.();
          }}
        >
          <MessageSquarePlus size={15} strokeWidth={1.8} />
          {t("chats.new")}
        </button>
        {onFold && (
          <button
            type="button"
            className="icon-btn"
            aria-label={t("chats.hide")}
            title={t("chats.hide")}
            onClick={onFold}
          >
            <PanelLeftClose size={16} strokeWidth={1.8} />
          </button>
        )}
      </div>
      <input
        className="input chat-search"
        type="search"
        value={query}
        placeholder={t("chats.search")}
        aria-label={t("chats.search")}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="chat-groups">
        {all === null && <p className="muted small">{t("chats.loading")}</p>}
        {all?.length === 0 && <p className="muted small">{t("chats.none")}</p>}
        {groups.map(([g, items]) => (
          <section key={g} className="chat-group">
            <h3>{t(`chats.when.${g}`)}</h3>
            {items.map((c) =>
              editing === c.id ? (
                <form
                  key={c.id}
                  className="chat-rename"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void renameConversation(c.id, name);
                    setEditing(null);
                  }}
                >
                  <input
                    className="input"
                    value={name}
                    maxLength={120}
                    aria-label={t("chats.rename")}
                    ref={(el) => el?.focus()}
                    onChange={(e) => setName(e.target.value)}
                    onBlur={() => setEditing(null)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") setEditing(null);
                    }}
                  />
                </form>
              ) : (
                <div key={c.id} className={`chat-item${c.id === open ? " on" : ""}`}>
                  <button
                    type="button"
                    className="chat-item-open"
                    disabled={busy}
                    aria-current={c.id === open ? "page" : undefined}
                    onClick={() => {
                      void openConversation(c.id);
                      onPick?.();
                    }}
                  >
                    {c.title || t("chats.untitled")}
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    title={t("chats.rename")}
                    aria-label={t("chats.rename")}
                    onClick={() => {
                      setName(c.title);
                      setEditing(c.id);
                    }}
                  >
                    <Pencil size={13} strokeWidth={1.8} />
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    title={t("chats.delete")}
                    aria-label={t("chats.delete")}
                    onClick={() => void removeConversation(c.id)}
                  >
                    <Trash2 size={13} strokeWidth={1.8} />
                  </button>
                </div>
              ),
            )}
          </section>
        ))}
      </div>
    </nav>
  );
}

/** The bar to write in: it grows with the text; its button sends, or stops the turn that runs (3.6). */
/**
 * The bar's buttons keep the focus where Juan writes: on a phone the keyboard stays up for the next message (as in
 * other chats), and nothing moves under the finger while it taps.
 */
const keepFocus = (e: React.PointerEvent) => e.preventDefault();

function Composer({ inWindow }: { inWindow: boolean }) {
  const t = useStore((s) => s.t);
  const busy = useStore((s) => s.chatBusy);
  // What is being written to this conversation: on its screen and in its window, kept when either closes.
  const draft = useStore(draftOf);
  const text = draft.text;
  const pointed = draft.pointed;
  const pointing = useStore((s) => s.pointing);
  const area = useRef<HTMLTextAreaElement | null>(null);
  // As tall as its text, up to a few lines; then it scrolls.
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [text]);
  const send = () => {
    if (!text.trim() || busy) return;
    void sendTurn(text);
    setDraftText("");
  };
  return (
    <form
      className="chat-composer"
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      {/* What Juan pointed at for this message (F9): each a reference, taken off with its «×». */}
      {pointed.length > 0 && (
        <ul className="chat-pointed" aria-label={t("point.list")}>
          {pointed.map((p) => (
            <li key={pointKey(p.ref)} className="chat-chip">
              <span className="chat-chip-text">{p.title}</span>
              <button
                type="button"
                className="chat-chip-x"
                onPointerDown={keepFocus}
                onClick={() => unpoint(pointKey(p.ref))}
                title={t("point.remove")}
                aria-label={`${t("point.remove")}: ${p.title}`}
              >
                <X size={12} strokeWidth={2} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <textarea
        ref={area}
        value={text}
        rows={1}
        maxLength={8000}
        placeholder={t("chat.placeholder")}
        aria-label={t("chat.placeholder")}
        onChange={(e) => setDraftText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            send();
          }
        }}
      />
      <div className="chat-composer-row">
        <ModelChip />
        {/* Over a screen there is something to point at: the pointer marks what the message is about. */}
        {inWindow && (
          <button
            type="button"
            className={`icon-btn chat-point${pointing ? " on" : ""}`}
            onPointerDown={keepFocus}
            onClick={togglePointing}
            aria-pressed={pointing}
            title={t("point.start")}
            aria-label={t("point.start")}
          >
            <MousePointerClick size={15} strokeWidth={1.8} />
          </button>
        )}
        <span className="spacer" />
        {busy ? (
          <button
            type="button"
            className="chat-send stop"
            onPointerDown={keepFocus}
            onClick={stopTurn}
            title={t("chat.stop")}
            aria-label={t("chat.stop")}
          >
            <Square size={13} strokeWidth={2.4} fill="currentColor" />
          </button>
        ) : (
          <button
            type="submit"
            className="chat-send"
            onPointerDown={keepFocus}
            disabled={!text.trim()}
            title={t("chat.send")}
            aria-label={t("chat.send")}
          >
            <ArrowUp size={16} strokeWidth={2.2} />
          </button>
        )}
      </div>
    </form>
  );
}

/** The model this conversation plans with (3.5): the account's, or one Juan evaluated for it in «Modelos». */
function ModelChip() {
  const t = useStore((s) => s.t);
  const planners = useStore((s) => s.planners);
  const chosen = useStore(
    (s) => s.conversations?.find((c) => c.id === s.conversationId)?.model ?? "",
  );
  const busy = useStore((s) => s.chatBusy);
  const [open, setOpen] = useState(false);
  const current = planners.find((p) => (chosen ? p.id === chosen : p.current));
  if (!planners.length) return null;
  const short = (m: string) => m.replace(/^[a-z-]+\//, "");
  return (
    <div className="chat-model">
      <button
        type="button"
        className="chat-model-btn"
        disabled={busy}
        aria-expanded={open}
        title={t("chat.model")}
        onClick={() => setOpen(!open)}
      >
        {current ? short(current.model) : t("chat.model")}
        <ChevronDown size={12} strokeWidth={1.8} />
      </button>
      {open && (
        <div className="chat-model-menu" role="menu">
          {planners.map((p) => (
            <button
              key={p.id}
              type="button"
              role="menuitemradio"
              aria-checked={p === current}
              onClick={() => {
                void chooseModel(p.current ? "" : p.id);
                setOpen(false);
              }}
            >
              <span>{short(p.model)}</span>
              {p.current && <span className="muted small">{t("chat.modelAccount")}</span>}
              {p === current && <Check size={13} strokeWidth={2} />}
            </button>
          ))}
          <button
            type="button"
            className="chat-model-more"
            onClick={() => {
              setOpen(false);
              openSettings(true, "models");
            }}
          >
            {t("chat.modelMore")}
          </button>
        </div>
      )}
    </div>
  );
}

/** What a step is, in Juan's words: its tool's own title, or the kind of step. */
function stepText(t: T, s: LiveStep): string {
  if (s.op === "read") {
    const kind = s.what.replace(/^read:/, "");
    return t(`chat.step.read.${kind}`) === `chat.step.read.${kind}`
      ? t("chat.step.read")
      : t(`chat.step.read.${kind}`);
  }
  if (s.op === "ask") return t("chat.step.ask");
  return (s.words && wordsText(t, s.words)) || s.what;
}

/**
 * A call in Juan's words (docs/conversacion.md §3.5): what it does and on what, by the names he gave things
 * («Buscando «pan» en Tareas»). A tool the app does not word (an extension's) keeps its own title.
 */
function wordsText(t: T, w: StepWords): string | null {
  const a = w.args;
  // A checkbox's value in words («Hecha: no»), not as the code writes it.
  const said = (x: string) => (x === "true" ? t("chat.w.yes") : x === "false" ? t("chat.w.no") : x);
  const where =
    a.field && a.contains
      ? t("chat.w.contains", { field: a.field, value: a.contains })
      : a.field && a.equals
        ? t("chat.w.where", { field: a.field, value: said(a.equals) })
        : "";
  switch (w.tool) {
    case "entities.query":
      return a.type ? t("chat.w.query", { type: a.type }) + where : null;
    case "entities.search":
      return a.text
        ? a.type
          ? t("chat.w.searchIn", { text: a.text, type: a.type })
          : t("chat.w.search", { text: a.text })
        : null;
    case "entities.get":
      return a.id ? t("chat.w.get", { title: a.id }) : null;
    case "entities.aggregate":
      if (!a.type) return null;
      return (
        (a.op === "sum" && a.of
          ? t("chat.w.sum", { field: a.of, type: a.type })
          : t("chat.w.count", { type: a.type })) + where
      );
    case "entities.create":
      return a.type
        ? a.title
          ? t("chat.w.createTitled", { title: a.title, type: a.type })
          : t("chat.w.create", { type: a.type })
        : null;
    case "entities.update":
      return a.id ? t("chat.w.update", { title: a.id }) : null;
    case "entities.delete":
      return a.id ? t("chat.w.delete", { title: a.id }) : null;
    case "schema.describe":
      return t("chat.w.schema");
    case "schema.create_type":
      return a.name ? t("chat.w.createType", { name: a.name }) : null;
    case "schema.add_field":
      return a.name && a.type ? t("chat.w.addField", { name: a.name, type: a.type }) : null;
    case "memory.save":
      return t("chat.w.remember");
    case "notify":
      return t("chat.w.notify");
    default:
      return null;
  }
}

/** What a step found, after it: how many, or its number in Juan's locale. */
function StepFound({ s }: { s: LiveStep }) {
  const t = useStore((x) => x.t);
  const lang = useStore((x) => x.settings.language);
  if (s.n !== undefined) return <span className="step-found"> · {t("chat.w.n", { n: s.n })}</span>;
  if (s.value !== undefined)
    return (
      <span className="step-found">
        {" · "}
        {new Intl.NumberFormat(lang === "en" ? "en-GB" : "es-ES", {
          maximumFractionDigits: 2,
        }).format(s.value)}
      </span>
    );
  return null;
}

/** A turn's steps: as they happen (the one going on with its animation), then folded once it answered. */
function Steps({
  steps,
  thinking,
  going,
}: {
  steps: LiveStep[];
  thinking: boolean;
  going: boolean;
}) {
  const t = useStore((s) => s.t);
  const [open, setOpen] = useState(false);
  if (!going && !steps.length) return null;
  if (!going)
    return (
      <div className="turn-steps folded">
        <button
          type="button"
          className="link-btn"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {t("chat.steps", { n: steps.length })}
          <ChevronDown size={12} strokeWidth={1.8} />
        </button>
        {open && (
          <ol>
            {steps.map((s) => (
              <li key={s.id} className="done">
                <Check size={12} strokeWidth={2.2} />
                <span>
                  {stepText(t, s)}
                  <StepFound s={s} />
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>
    );
  return (
    <div className="turn-steps" aria-live="polite">
      <ol>
        {thinking && (
          <li className="going">
            <span className="step-dot" aria-hidden="true" />
            {t("chat.planning")}
          </li>
        )}
        {steps.map((s) => (
          <li key={s.id} className={s.done ? "done" : "going"}>
            {s.done ? (
              <Check size={12} strokeWidth={2.2} />
            ) : (
              <span className="step-dot" aria-hidden="true" />
            )}
            <span>
              {stepText(t, s)}
              {s.done && <StepFound s={s} />}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Turn({ entry }: { entry: ChatEntry }) {
  const t = useStore((s) => s.t);
  const live = useStore((s) => (s.live?.entry === entry.id ? s.live : null));
  const r = entry.result;
  return (
    <div className="turn">
      {/* What was pointed at for this message (I-33): its chips, as they were sent, painted as text. */}
      {entry.pointed && entry.pointed.length > 0 && (
        <ul className="chat-pointed turn-pointed" aria-label={t("point.sent")}>
          {entry.pointed.map((p) => (
            <li key={pointKey(p.ref)} className="chat-chip sent">
              <span className="chat-chip-text">{p.title}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="turn-request">{entry.request}</div>
      <div className="turn-answer">
        {!live && <Steps steps={entry.steps ?? []} thinking={false} going={false} />}
        {r?.replies.map((reply, i) => (
          <ReplyView key={i} reply={reply} />
        ))}
        {r?.pending?.kind === "ask" && <AskBox entryId={entry.id} pending={r.pending} />}
        {r?.pending?.kind === "confirm" && <ConfirmCard entryId={entry.id} view={r.pending.view} />}
        {r && <Notices t={t} result={r} />}
        {r?.status === "stopped" &&
          r.error &&
          (r.error === "stopped-by-juan" ? (
            <p className="turn-stopped">{t("chat.stopped")}</p>
          ) : (
            <p className="turn-error">{agentErrorText(t, r.error)}</p>
          ))}
        {entry.error && <p className="turn-error">{entry.error}</p>}
        {r?.status === "done" && r.run && r.changed !== false && (
          <button type="button" className="link-btn turn-undo" onClick={() => void undoRun(r.run)}>
            <Undo2 size={13} strokeWidth={1.8} />
            {t("chat.undo")}
          </button>
        )}
        {r?.run && (
          <button type="button" className="link-btn turn-trace" onClick={() => showRun(r.run)}>
            {t("log.trace")}
          </button>
        )}
      </div>
      {/* The part still going (3.5): its steps and what it said so far; the answer above fills when it ends. */}
      {live && (
        <div className="turn-live">
          <Steps steps={live.steps} thinking={live.thinking} going />
          {live.replies.map((reply, i) => (
            <ReplyView key={i} reply={reply} />
          ))}
        </div>
      )}
    </div>
  );
}

function Notices({ t, result }: { t: T; result: NonNullable<ChatEntry["result"]> }) {
  const shown = result.notices.filter((n) => n.code !== "denied");
  if (!shown.length) return null;
  return (
    <ul className="turn-notices">
      {shown.map((n, i) => (
        <li key={i}>
          {n.code === "proposals" ? (
            <button type="button" className="link-btn" onClick={showInbox}>
              {t("notice.proposals", { n: n.n ?? 1 })}
            </button>
          ) : (
            t(`notice.${n.code}`)
          )}
        </li>
      ))}
    </ul>
  );
}

const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/;
const CIVIL_DAY = /^\d{4}-\d{2}-\d{2}$/;
/** An instant or a day as a value reads as a date in Juan's language and zone, never in ISO form (Juan, 2026-11-02). */
function readable(v: unknown, lang: string): string | null {
  if (typeof v !== "string") return null;
  const locale = lang === "en" ? "en-GB" : "es-ES";
  if (INSTANT.test(v)) {
    const ms = Date.parse(v);
    return Number.isNaN(ms)
      ? null
      : new Intl.DateTimeFormat(locale, {
          dateStyle: "medium",
          timeStyle: "short",
          timeZone: deviceZone(),
        }).format(ms);
  }
  if (CIVIL_DAY.test(v)) {
    const [y, m, d] = v.split("-").map(Number);
    return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(
      Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1),
    );
  }
  return null;
}

/**
 * A value as text, with a mark when it came from outside (an e-mail, a page) or from a model; `plain` when the block
 * around it already carries the mark (a list, a table or a chart of outside values: once, not on every cell).
 */
export function ValueText({ p, plain = false }: { p: Painted; plain?: boolean }) {
  const t = useStore((s) => s.t);
  const lang = useStore((s) => s.settings.language);
  if (isProposal(p)) return <span className="val-proposal">{t("chat.inInbox")}</span>;
  const integrity = lowest(p);
  const cls =
    integrity === "external" && !plain ? "val-ext" : integrity === "model" ? "val-model" : "val";
  return (
    <span className={cls} title={integrity === "external" ? t("chat.fromOutside") : undefined}>
      {(p.t === "v" ? readable(p.value, lang) : null) ?? textOf(p)}
    </span>
  );
}

/** A number in Juan's locale ("42,5"); anything else as text. `plain`: the block carries the outside mark. */
function NumberText({ p, plain = false }: { p: Painted; plain?: boolean }) {
  const lang = useStore((s) => s.settings.language);
  if (p.t === "v" && typeof p.value === "number")
    return (
      <span className={lowest(p) === "external" && !plain ? "val-ext" : "val"}>
        {new Intl.NumberFormat(lang === "en" ? "en-GB" : "es-ES", {
          maximumFractionDigits: 2,
        }).format(p.value)}
      </span>
    );
  return <ValueText p={p} plain={plain} />;
}

const fieldsOf = (spec: Painted | undefined): string[] | null => {
  if (!spec) return null;
  const v = textOf(spec);
  return v
    ? v
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean)
    : null;
};

const HIDDEN_FIELDS = new Set(["id", "type"]);
/** The fields of a record a block shows: the given ones, or all but its id and type. */
const shownFields = (fields: string[] | null, rec: Record<string, Painted>) =>
  fields ?? Object.keys(rec).filter((k) => !HIDDEN_FIELDS.has(k));
/** The painted leaves a block shows of its items: the shown fields of a record, or the value itself. */
const shownLeaves = (items: Painted[], fields: string[] | null): Painted[] =>
  items.flatMap((p) =>
    p.t === "rec"
      ? shownFields(fields, p.fields).flatMap((f) => (p.fields[f] ? [p.fields[f] as Painted] : []))
      : p.t === "list"
        ? shownLeaves(p.items, fields)
        : [p],
  );
/** Whether every shown value of a block came from outside: then the block carries the mark once (Juan, 2026-11-02). */
const allOutside = (items: Painted[], fields: string[] | null = null) => {
  const leaves = shownLeaves(items, fields);
  return leaves.length > 0 && leaves.every((l) => lowest(l) === "external");
};

const TRUSTED = new Set(["own", "imported", "user"]);
/** The record an item points to: its id and type as the code wrote them (a model's or outside text never opens anything). */
function recordOf(item: Painted): { type: string; id: string } | null {
  if (item.t !== "rec") return null;
  const id = item.fields.id;
  const type = item.fields.type;
  if (id?.t !== "v" || type?.t !== "v") return null;
  if (typeof id.value !== "string" || typeof type.value !== "string") return null;
  if (!TRUSTED.has(id.integrity) || !TRUSTED.has(type.integrity)) return null;
  return { type: type.value, id: id.value };
}

/**
 * A list item: its shown fields as text, « · » between them (not the group's); one that points to a record gets a
 * small ↗ button after its text that opens it (Juan, 2026-11-02: not the whole line as a link), and a mail also one
 * that proposes its tasks to the inbox (task 30).
 */
function ListItem({
  item,
  fields,
  group,
  plain,
}: {
  item: Painted;
  fields: string[] | null;
  group: string;
  plain: boolean;
}) {
  const t = useStore((s) => s.t);
  const at = recordOf(item);
  const mail = useStore((s) =>
    at
      ? !!s.dataTypes?.some(
          (x) => (x.key === at.type || x.id === at.type || x.name === at.type) && x.view === "mail",
        )
      : false,
  );
  const [proposing, setProposing] = useState(false);
  const body =
    item.t === "rec" ? (
      shownFields(fields, item.fields)
        .filter((f) => f !== group && item.fields[f])
        .map((f, i) => (
          <span key={f}>
            {i > 0 && <span className="reply-sep"> · </span>}
            <ValueText p={item.fields[f] as Painted} plain={plain} />
          </span>
        ))
    ) : (
      <ValueText p={item} plain={plain} />
    );
  return (
    <li>
      {body}
      {at && (
        <button
          type="button"
          className="reply-open"
          title={t("chat.openRecord")}
          aria-label={t("chat.openRecord")}
          onClick={() => void openRecord(at.type, at.id)}
        >
          <ArrowUpRight size={13} strokeWidth={2} aria-hidden="true" />
        </button>
      )}
      {at && mail && (
        <button
          type="button"
          className="reply-open"
          data-boni-action="connectors.mail_propose"
          title={t("chat.proposeTask")}
          aria-label={t("chat.proposeTask")}
          aria-busy={proposing}
          disabled={proposing}
          onClick={() => {
            setProposing(true);
            void proposeFromMail(at.id).finally(() => setProposing(false));
          }}
        >
          {proposing ? (
            <span className="spinner" aria-hidden="true" />
          ) : (
            <ListPlus size={13} strokeWidth={2} aria-hidden="true" />
          )}
        </button>
      )}
    </li>
  );
}

function ReplyView({ reply }: { reply: Reply }) {
  const t = useStore((s) => s.t);
  const dataTypes = useStore((s) => s.dataTypes);
  const d = reply.data;
  const caption = d.caption ? <div className="reply-caption">{textOf(d.caption)}</div> : null;
  switch (reply.component) {
    case "text": {
      const template = d.template ? textOf(d.template) : "";
      return (
        <p className="reply-text">
          {fillTemplate(template, { a: d.a, b: d.b, c: d.c, d: d.d }).map((part, i) =>
            "text" in part ? <span key={i}>{part.text}</span> : <ValueText key={i} p={part.slot} />,
          )}
        </p>
      );
    }
    case "number":
      return (
        <div className="reply-number">
          {caption}
          <span className="reply-figure">
            {d.value ? <NumberText p={d.value} /> : "—"}
            {d.unit ? <span className="reply-unit"> {textOf(d.unit)}</span> : null}
          </span>
        </div>
      );
    case "list": {
      const items = d.items?.t === "list" ? d.items.items : d.items ? [d.items] : [];
      const group = d.group ? textOf(d.group) : "";
      const fields = fieldsOf(d.fields);
      const outside = allOutside(items, fields);
      // One section per value of the group field, in the items' order (what came first matters most).
      const sections: { key: string; items: Painted[] }[] = [];
      for (const item of items) {
        const g = group && item.t === "rec" ? item.fields[group] : undefined;
        const key = g ? textOf(g) : "";
        const s = sections.find((x) => x.key === key);
        if (s) s.items.push(item);
        else sections.push({ key, items: [item] });
      }
      return (
        <div
          className={`reply-list${outside ? " reply-ext" : ""}`}
          title={outside ? t("chat.fromOutside") : undefined}
        >
          {caption}
          {sections.map((s, si) => (
            <div key={si} className="reply-section">
              {s.key && (
                <div className="reply-group">
                  {s.key} · {s.items.length}
                </div>
              )}
              <ul>
                {s.items.map((item, i) => (
                  <ListItem key={i} item={item} fields={fields} group={group} plain={outside} />
                ))}
              </ul>
            </div>
          ))}
        </div>
      );
    }
    case "open": {
      // What Boni opened on the screen (F9), said in the code's words: the opening itself happened once, when the
      // turn came (`openFromReplies`), never when the conversation is read again; what it may not open, unsaid.
      const target = openTarget(reply, dataTypes);
      const what = !target
        ? null
        : target.kind === "place"
          ? t(`chat.place.${target.place}`)
          : target.kind === "collection"
            ? target.type.name
            : (target.title ?? t("inbox.element"));
      return what ? (
        <p className="reply-opened">
          {t("chat.opened", { what })}
          {caption}
        </p>
      ) : null;
    }
    case "run": {
      // A run drawn in the conversation, with «Ampliar» to the map (task 92): only one a tool gave (the code's own
      // value, I-29), never a model's word nor text from outside.
      const id =
        d.run?.t === "v" && d.run.integrity === "own" && typeof d.run.value === "string"
          ? d.run.value
          : null;
      return id ? <RunPath run={id} caption={caption} /> : null;
    }
    case "chart": {
      const outside = allOutside([d.labels, d.values].filter((x): x is Painted => Boolean(x)));
      return (
        <div
          className={`reply-chart${outside ? " reply-ext" : ""}`}
          title={outside ? t("chat.fromOutside") : undefined}
        >
          {caption}
          <ReplyChart d={d} plain={outside} />
        </div>
      );
    }
    case "table": {
      const rows = d.rows?.t === "list" ? d.rows.items : [];
      const first = rows.find((r) => r.t === "rec");
      const fields =
        fieldsOf(d.fields) ??
        (first?.t === "rec"
          ? Object.keys(first.fields).filter((k) => k !== "id" && k !== "type")
          : []);
      const outside = allOutside(rows);
      return (
        <div
          className={`reply-table${outside ? " reply-ext" : ""}`}
          title={outside ? t("chat.fromOutside") : undefined}
        >
          {caption}
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  {fields.map((f) => (
                    <th key={f}>{f}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    {r.t === "rec" ? (
                      fields.map((f) => (
                        <td key={f}>
                          {r.fields[f] ? (
                            <ValueText p={r.fields[f] as Painted} plain={outside} />
                          ) : null}
                        </td>
                      ))
                    ) : (
                      <td colSpan={Math.max(1, fields.length)}>
                        <ValueText p={r} plain={outside} />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      );
    }
  }
}

function AskBox({
  entryId,
  pending,
}: {
  entryId: string;
  pending: Extract<Pending, { kind: "ask" }>;
}) {
  const t = useStore((s) => s.t);
  const busy = useStore((s) => s.chatBusy);
  const [text, setText] = useState("");
  return (
    <div className="ask">
      <p className="ask-prompt">
        <ValueText p={pending.prompt} />
      </p>
      {pending.control === "choice" ? (
        <div className="ask-options">
          {pending.options.map((o, i) => (
            <button
              key={i}
              type="button"
              className="pill"
              disabled={busy}
              onClick={() => void answerAsk(entryId, { choice: i })}
            >
              <ValueText p={o} />
            </button>
          ))}
        </div>
      ) : (
        <form
          className="ask-text"
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim()) void answerAsk(entryId, { text });
          }}
        >
          {/* Never a password field: Boni does not ask for secrets here (docs/nucleo.md, 7.5). */}
          <input
            type="text"
            value={text}
            maxLength={500}
            onChange={(e) => setText(e.target.value)}
          />
          <button type="submit" className="btn" disabled={busy || !text.trim()}>
            {t("ask.answer")}
          </button>
        </form>
      )}
    </div>
  );
}

/** An argument's name for Juan: by its name when it is a known one ("Asunto"), else by its role ("Para"). */
function argLabel(t: T, arg: string, role: string): string {
  const byName = t(`argname.${arg}`);
  if (byName !== `argname.${arg}`) return byName;
  const byRole = t(`arg.${role}`);
  return byRole !== `arg.${role}` ? byRole : arg;
}

/** "values.autor" -> "autor": a record's field without a name from the schema. */
const fieldKey = (arg: string) => (arg.includes(".") ? arg.slice(arg.indexOf(".") + 1) : null);

/** What an extension's function would change (task 93, D-52): its rows by their names, never by their keys. */
const FUNCTION_ROWS = new Set([
  "cambios.nombre",
  "cambios.resumen",
  "cambios.nuevas",
  "cambios.cambiadas",
  "cambios.preguntas",
]);
/** A row of what a function would change, by its name («Nuevas»); null for any other row. */
export const functionRowName = (t: T, arg: string): string | null =>
  FUNCTION_ROWS.has(arg) ? t(`inbox.row.${arg}`) : null;

/** "Enviar correo" -> "enviar correo", for the middle of a sentence. */
const lower = (s: string) => (s ? s[0]?.toLowerCase() + s.slice(1) : s);

/** Where a value came from, in words. */
function provenance(t: T, integrity: string, sources: string[]): string {
  const from = [...new Set(sources)].map((s) => t(`prov.source.${s}`)).join(", ");
  return from ? `${t(`prov.${integrity}`)} · ${from}` : t(`prov.${integrity}`);
}

function Marks({ marks }: { marks: string[] }) {
  const t = useStore((s) => s.t);
  if (!marks.length) return null;
  return (
    <ul className="confirm-marks">
      {marks.map((m) => {
        const [kind, extra] = m.split(":");
        return (
          <li key={m} className="mark-warn">
            {t(`mark.${kind}`, { domain: extra ?? "" })}
          </li>
        );
      })}
    </ul>
  );
}

/** The rows of a call painted from its real arguments: shared by confirmations and the inbox. */
export function CallRows({ view }: { view: ConfirmView }) {
  const t = useStore((s) => s.t);
  return (
    <dl className="confirm-rows">
      {view.rows.map((r) => (
        <div key={r.arg} className="confirm-row">
          <dt>
            {r.name ?? functionRowName(t, r.arg) ?? fieldKey(r.arg) ?? argLabel(t, r.arg, r.role)}
          </dt>
          <dd>
            <div className={`confirm-value${r.integrity === "external" ? " ext" : ""}`}>
              {r.detail ? (
                <>
                  {reveal(r.detail)}
                  {r.role !== "type" && <span className="muted small"> {reveal(r.value)}</span>}
                </>
              ) : (
                reveal(r.value)
              )}
            </div>
            <div className="confirm-prov muted small">{provenance(t, r.integrity, r.sources)}</div>
            <Marks marks={r.marks} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * A confirmation: on its own surface with only the code's components; the accept button changes side every
 * time and only answers after a moment, so it is not accepted out of habit (docs/nucleo.md, 7.5).
 */
function ConfirmCard({ entryId, view }: { entryId: string; view: ConfirmView }) {
  const t = useStore((s) => s.t);
  const busy = useStore((s) => s.chatBusy);
  const flip = useStore((s) => s.confirmFlip);
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    setArmed(false);
    const timer = setTimeout(() => setArmed(true), 700);
    return () => clearTimeout(timer);
  }, [view]);
  const accept = (
    <button
      key="accept"
      type="button"
      className="btn primary"
      disabled={busy || !armed}
      onClick={() => void confirmPending(entryId)}
    >
      {t("confirm.accept", { action: lower(view.title) })}
    </button>
  );
  const cancel = (
    <button
      key="cancel"
      type="button"
      className="btn"
      disabled={busy}
      onClick={() => void declinePending(entryId)}
    >
      {t("confirm.cancel")}
    </button>
  );
  return (
    <section className="confirm-card" aria-label={t("confirm.label")}>
      <h3>{t("confirm.title", { action: view.title })}</h3>
      <CallRows view={view} />
      <div className={`confirm-actions${flip ? " flipped" : ""}`}>
        {flip ? [cancel, accept] : [accept, cancel]}
      </div>
    </section>
  );
}

export function InboxView() {
  const t = useStore((s) => s.t);
  const queue = useInboxQueue();
  useEffect(() => {
    void loadInbox();
  }, []);
  return (
    <div className="agent-page">
      <p className="muted small">{t("inbox.help")}</p>
      {queue.length === 0 && <p className="muted center-note">{t("inbox.empty")}</p>}
      {queue.map((x) =>
        "p" in x ? (
          <ProposalCard key={x.p.id} p={x.p} wide />
        ) : (
          <RequestCard key={x.r.id} r={x.r} />
        ),
      )}
    </div>
  );
}

/** A reading that found nothing to do and changed nothing (Juan, 2026-10-22: grouped, not one line each). */
const quiet = (r: RunSummary) =>
  r.status === "done" &&
  (r.what?.kind === "mail" || r.what?.kind === "measure" || r.what?.kind === "review") &&
  !r.changed &&
  !(r.proposals && Object.values(r.proposals).some((n) => n > 0));

/** The Registro's entries: one per run, quiet readings in a row as one group. */
type LogEntry = { run: RunSummary } | { quiet: RunSummary[] };
function logEntries(runs: RunSummary[]): LogEntry[] {
  const out: LogEntry[] = [];
  for (const r of runs) {
    const last = out.at(-1);
    if (quiet(r) && last && "quiet" in last) last.quiet.push(r);
    else out.push(quiet(r) ? { quiet: [r] } : { run: r });
  }
  // A single quiet reading is an entry like any other.
  return out.map((e) =>
    "quiet" in e && e.quiet.length === 1 ? { run: e.quiet[0] as RunSummary } : e,
  );
}

/** What a run was, in Juan's words (made from the server's `what`; an older server gives only the origin). */
function runTitle(t: T, r: RunSummary): string {
  const w = r.what;
  switch (w?.kind) {
    case "request":
      return w.text ? t("log.what.request", { text: w.text }) : t("log.origin.turn");
    case "mail":
      return t("log.what.mail", { subject: w.subject });
    case "measure":
      return t("log.what.measure", { subject: w.subject });
    case "review":
      return t("log.what.review");
    case "accepted":
      return r.alone ? t("log.what.alone") : t("log.what.accepted");
    case "test":
      return t("log.what.test", { name: w.flow });
    case "flow":
      return w.flow;
    default:
      return t(`log.origin.${r.origin}`);
  }
}

/** What came of it: its proposals, what it changed, or nothing; a stopped run says so. */
function runResult(t: T, r: RunSummary): string {
  const parts: string[] = [];
  if (r.what?.kind === "mail") {
    if (r.what.from) parts.push(t("log.from", { from: r.what.from }));
    if (r.what.account) parts.push(t("log.account", { account: r.what.account }));
  }
  if (r.status.startsWith("stopped")) parts.push(t("log.status.stopped"));
  else if (r.status !== "done" && r.status !== "proposed")
    parts.push(t(`log.status.${r.status.split(":")[0]}`));
  const p = r.proposals;
  if (p)
    for (const k of ["pending", "accepted", "rejected", "stale"] as const)
      if (p[k] > 0) parts.push(t(`log.result.${k}`, { n: p[k] }));
  const changes = r.changes ?? [];
  for (const c of changes)
    parts.push(
      `${t(`log.change.${c.action}`, { title: c.title, collection: c.collection })}${c.undone ? ` ${t("log.change.undone")}` : ""}`,
    );
  if ((r.changed ?? 0) > changes.length)
    parts.push(t("log.change.more", { n: (r.changed ?? 0) - changes.length }));
  if (r.what && quiet(r)) parts.push(t("log.result.nothing"));
  if (!r.what && !parts.length) parts.push(t(`log.status.${r.status.split(":")[0]}`));
  return parts.join(" · ");
}

/** Undo only where there is something to undo (an older server does not say: then as before). */
const undoable = (r: RunSummary) =>
  (r.status === "done" || r.status.startsWith("stopped")) &&
  (r.changed === undefined ||
    (r.changes ?? []).some((c) => !c.undone) ||
    (r.changed ?? 0) > (r.changes ?? []).length);

/**
 * «Acierto» (docs/fiabilidad.md §3.3): per area, Boni's last decisions (alone, asked, left) and, of the ones alone,
 * how many Juan kept as they were; by level of confidence on a click. What earns an area its «Solo».
 */
function Accuracy({ t, areas, lang }: { t: T; areas: AreaAccuracy[]; lang: string }) {
  const [open, setOpen] = useState<string | null>(null);
  const num = new Intl.NumberFormat(lang === "en" ? "en-GB" : "es-ES", {
    maximumFractionDigits: 1,
  });
  const name = (area: string) => {
    const key = `accuracy.area.${area}`;
    const s = t(key);
    return s === key ? area : s;
  };
  return (
    <section className="log-accuracy" aria-label={t("accuracy.title")}>
      <h3>{t("accuracy.title")}</h3>
      <ul>
        {areas.map((a) => (
          <li key={a.area} className="log-area">
            <span className="log-area-name">{name(a.area)}</span>
            <span className="log-area-line muted small">
              {t("accuracy.line", {
                total: a.total,
                done: a.done,
                asked: a.asked,
                nothing: a.nothing,
              })}{" "}
              ·{" "}
              {a.judged
                ? t("accuracy.judged", {
                    right: a.right,
                    judged: a.judged,
                    pct: Math.round((100 * a.right) / a.judged),
                  })
                : t("accuracy.judged.none")}
              {a.switchable && a.auto ? ` · ${t("accuracy.solo")}` : ""}
            </span>
            {a.judged > 0 && (
              <button
                type="button"
                className="link-btn small"
                aria-expanded={open === a.area}
                onClick={() => setOpen(open === a.area ? null : a.area)}
              >
                {t("accuracy.levels")}
              </button>
            )}
            {open === a.area && (
              <ul className="log-levels muted small">
                {a.levels
                  .filter((l) => l.judged > 0)
                  .map((l) => (
                    <li key={l.from}>
                      {t("accuracy.level", {
                        from: num.format(l.from),
                        to: num.format(l.to),
                        right: l.right,
                        judged: l.judged,
                      })}
                    </li>
                  ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function LogView() {
  const t = useStore((s) => s.t);
  const runs = useStore((s) => s.runs);
  const auto = useStore((s) => s.autoAccept);
  const accuracy = useStore((s) => s.accuracy);
  const lang = useStore((s) => s.settings.language);
  const [open, setOpen] = useState<string | null>(null);
  const [detail, setDetail] = useState<RunDetail | null | "loading">(null);
  const [groups, setGroups] = useState<Set<string>>(new Set());
  const when = new Intl.DateTimeFormat(lang === "en" ? "en-GB" : "es-ES", {
    dateStyle: "short",
    timeStyle: "short",
  });
  const toggle = (id: string) => {
    if (open === id) return setOpen(null);
    setOpen(id);
    setDetail("loading");
    void loadRunDetail(id).then(setDetail);
  };
  const line = (r: RunSummary) => (
    <li key={r.id} className="log-run">
      <div className="list-row">
        <button
          type="button"
          className="link-btn list-main small log-head"
          aria-expanded={open === r.id}
          onClick={() => toggle(r.id)}
        >
          <span className="log-title">{runTitle(t, r)}</span>
          <span className="log-result muted">
            {when.format(r.started)} · {runResult(t, r)}
          </span>
        </button>
        {/* A stopped run may have left changes (a limit stopped it after some): it can be undone too. */}
        {undoable(r) && (
          <button type="button" className="btn ghost" onClick={() => void undoRun(r.id)}>
            <Undo2 size={13} strokeWidth={1.8} />
            {t("chat.undo")}
          </button>
        )}
      </div>
      {open === r.id && <RunSteps t={t} detail={detail} />}
    </li>
  );
  return (
    <div className="agent-page">
      {runs.length === 0 && <p className="muted center-note">{t("log.empty")}</p>}
      {auto && auto.decided > 0 && (
        <p className="muted small log-measure">
          {t(auto.would > 0 ? "log.autoAccept" : "log.autoAccept.none", { ...auto })}
        </p>
      )}
      {accuracy.length > 0 && <Accuracy t={t} areas={accuracy} lang={lang} />}
      <ul className="log-list">
        {logEntries(runs).map((e) => {
          if ("run" in e) return line(e.run);
          const first = e.quiet[0] as RunSummary;
          const last = e.quiet.at(-1) as RunSummary;
          const shown = groups.has(first.id);
          return (
            <li key={`quiet-${first.id}`} className="log-run log-quiet">
              <button
                type="button"
                className="link-btn small log-head"
                aria-expanded={shown}
                onClick={() =>
                  setGroups((g) => {
                    const n = new Set(g);
                    if (n.has(first.id)) n.delete(first.id);
                    else n.add(first.id);
                    return n;
                  })
                }
              >
                <span className="log-title">{t("log.quiet", { n: e.quiet.length })}</span>
                <span className="log-result muted">
                  {when.format(last.started)} – {when.format(first.started)}
                </span>
              </button>
              {shown && <ul className="log-list log-group">{e.quiet.map(line)}</ul>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * A run step by step («Recorrido», task 52; Juan, 2026-11-03: «ver bien cómo se están moviendo sus datos en un
 * diagrama como el de n8n»): the diagram of its steps on top, each step with the policy's decision and what the
 * models said in it, then what it read, changed, proposed and decided, and the models it called. All text from the
 * journal and the audit; «Copiar» puts it in the clipboard to paste in a chat.
 */
function RunSteps({ t, detail }: { t: T; detail: RunDetail | null | "loading" }) {
  const lang = useStore((s) => s.settings.language);
  if (detail === "loading") return <p className="muted small log-detail">{t("log.loading")}</p>;
  if (!detail) return <p className="muted small log-detail">{t("log.noDetail")}</p>;
  // Its words, as the map's card and «Copiar» say them (core/runText.ts): the drawing is the map's (task 90).
  const money = (usd: number) => moneyText(lang, usd);
  const w = runWords(t, detail, money);
  const copy = () => {
    const when = new Intl.DateTimeFormat(lang === "en" ? "en-GB" : "es-ES", {
      dateStyle: "short",
      timeStyle: "short",
      timeZone: deviceZone(),
    }).format(detail.started);
    void navigator.clipboard
      .writeText(runCopy(t, detail, w, when))
      .then(() => toast(t("log.copied")));
  };
  return (
    <div className="log-detail small trace">
      <div className="trace-tools">
        {/* Its drawing: the map, with the way it went lit (docs/sistema.md §4.4; task 90). */}
        <button type="button" className="link-btn small" onClick={() => showRun(detail.id)}>
          <Workflow size={13} strokeWidth={1.8} />
          {t("log.trace")}
        </button>
        <button type="button" className="link-btn small" onClick={copy}>
          <Copy size={13} strokeWidth={1.8} />
          {t("log.copy")}
        </button>
      </div>
      {detail.request !== null && <p className="log-request">{detail.request}</p>}
      <ol className="log-steps">
        {w.steps.map((s, i) => (
          <li
            key={s.id}
            id={`trace-step-${s.id}`}
            className={detail.steps[i]?.error ? "log-step failed" : "log-step"}
          >
            <span className="log-step-what">{s.name}</span>{" "}
            <span className="muted">— {s.line}</span>
            {s.desc && <span className="log-step-desc muted">{s.desc}</span>}
            {s.answers.map((a, k) => (
              <details key={`${s.id}-${k}`} className="trace-answer">
                <summary>{t("log.answer")}</summary>
                <pre>{a}</pre>
              </details>
            ))}
          </li>
        ))}
      </ol>
      <TraceBlock name={t("log.read")} items={w.read} />
      <TraceBlock name={t("log.did")} items={w.did} />
      <TraceBlock name={t("log.proposed")} items={w.proposed} />
      <TraceBlock name={t("log.decisions")} items={w.decided} />
      <TraceBlock name={t("log.models")} items={w.models} />
    </div>
  );
}

function TraceBlock({ name, items }: { name: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div className="trace-block">
      <span className="trace-name">{name}</span>
      <ul>
        {items.map((x, i) => (
          <li key={`${i}-${x.slice(0, 20)}`}>{x}</li>
        ))}
      </ul>
    </div>
  );
}

const numberIn = (p: Painted | undefined): number | null =>
  p?.t === "v" && typeof p.value === "number" && Number.isFinite(p.value) ? p.value : null;

/**
 * A chart in an answer: numbers the tools gave, one per label (never the model's own), as bars across (they fit a
 * phone and their labels never turn), or as a line when it asks for one. Labels and values are painted as text.
 */
function ReplyChart({ d, plain = false }: { d: Record<string, Painted>; plain?: boolean }) {
  const labels = d.labels?.t === "list" ? d.labels.items : [];
  const values = d.values?.t === "list" ? d.values.items : [];
  const unit = d.unit ? textOf(d.unit) : "";
  const points = labels.slice(0, 40).flatMap((label, i) => {
    const p = values[i];
    const v = numberIn(p);
    return v === null || !p ? [] : [{ label, p, v }];
  });
  if (!points.length) return null;
  const max = Math.max(...points.map((x) => Math.abs(x.v)), 0) || 1;
  if (d.kind && textOf(d.kind) === "line" && points.length > 1) {
    const lo = Math.min(...points.map((x) => x.v), 0);
    const hi = Math.max(...points.map((x) => x.v), 0);
    const span = hi - lo || 1;
    const xy = points.map((x, i) => [
      (i / (points.length - 1)) * 100,
      36 - ((x.v - lo) / span) * 32,
    ]);
    const first = points[0];
    const last = points[points.length - 1];
    return (
      <div className="reply-line">
        <svg viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true">
          <polyline points={xy.map(([x, y]) => `${x},${y}`).join(" ")} />
        </svg>
        <div className="reply-line-ends">
          {first && (
            <span>
              <ValueText p={first.label} plain={plain} /> · <NumberText p={first.p} plain={plain} />
            </span>
          )}
          {last && (
            <span>
              <ValueText p={last.label} plain={plain} /> · <NumberText p={last.p} plain={plain} />
              {unit && ` ${unit}`}
            </span>
          )}
        </div>
      </div>
    );
  }
  return (
    <ul className="reply-bars">
      {points.map((x, i) => (
        <li key={i}>
          <span className="reply-bar-label">
            <ValueText p={x.label} plain={plain} />
          </span>
          <span className="reply-bar-track">
            <span
              className={`reply-bar${x.v < 0 ? " neg" : ""}`}
              style={{ width: `${Math.max(2, (Math.abs(x.v) / max) * 100)}%` }}
            />
          </span>
          <span className="reply-bar-value">
            <NumberText p={x.p} plain={plain} />
            {unit && ` ${unit}`}
          </span>
        </li>
      ))}
    </ul>
  );
}
