import { MessageCircle, Plus, Send, X } from "lucide-react";
import { useEffect, useState } from "react";
import { CHAT_ACTIONS, type PageChat } from "../core/agent.ts";
import { loadPageChat, savePageChat, sendInPageChat, useStore } from "../store.ts";

/**
 * A page's chat (docs/sistema.md §4.6 point 6, D-61): the «Chat» block. Its welcome and its buttons are its flow's
 * «Chat» trigger; what is written here (or a button's text) opens a conversation in its mode in Boni's window, over
 * the page, where it goes on. What it may do is its «Agente» step's, which its panel changes (`PageChatSettings`);
 * the server reads both again on every message. Every word of it is painted as plain text.
 */
export function PageChatBlock({ flow }: { flow: string }) {
  const t = useStore((s) => s.t);
  const chat = useStore((s) => s.pageChats[flow]);
  const busy = useStore((s) => s.chatBusy);
  const [text, setText] = useState("");
  useEffect(() => {
    if (chat === undefined) void loadPageChat(flow);
  }, [flow]);
  if (chat === null)
    return (
      <div className="pchat pchat-gone" role="note">
        {t("pagechat.gone")}
      </div>
    );
  const send = (words: string) => {
    if (!words.trim() || busy) return;
    void sendInPageChat(flow, words);
    setText("");
  };
  return (
    <section className="pchat" data-boni-action="pages.figures" aria-label={t("pagechat.title")}>
      <header className="pchat-head">
        <MessageCircle size={16} strokeWidth={1.8} aria-hidden />
        <span>{t("pagechat.title")}</span>
        {chat && !chat.enabled && <span className="muted small">{t("pagechat.off")}</span>}
      </header>
      <p className="pchat-welcome">{chat?.welcome || t("pagechat.welcome")}</p>
      {!!chat?.buttons.length && (
        <div className="pchat-buttons">
          {chat.buttons.map((b, i) => (
            <button
              // biome-ignore lint/suspicious/noArrayIndexKey: two buttons may have the same label
              key={i}
              type="button"
              className="btn"
              disabled={busy || !chat.enabled}
              title={b.text}
              onClick={() => send(b.text)}
            >
              {b.label}
            </button>
          ))}
        </div>
      )}
      <form
        className="pchat-bar"
        onSubmit={(e) => {
          e.preventDefault();
          send(text);
        }}
      >
        <input
          className="input"
          value={text}
          maxLength={8000}
          placeholder={t("pagechat.placeholder")}
          aria-label={t("pagechat.placeholder")}
          disabled={!!chat && !chat.enabled}
          onChange={(e) => setText(e.target.value)}
        />
        <button
          type="submit"
          className="icon-btn"
          aria-label={t("pagechat.send")}
          disabled={busy || !text.trim() || (!!chat && !chat.enabled)}
        >
          <Send size={16} strokeWidth={1.8} />
        </button>
      </form>
    </section>
  );
}

type Draft = Pick<PageChat, "welcome" | "buttons" | "instructions" | "actions">;
const draftOf = (c: PageChat): Draft => ({
  welcome: c.welcome,
  buttons: c.buttons.map((b) => ({ ...b })),
  instructions: c.instructions,
  actions: [...c.actions],
});

/**
 * The chat's settings in its block's panel: what it says (its trigger: welcome, buttons) and what it is told and may
 * do (its «Agente» step: instructions, actions of the fixed list). «Guardar» makes a new version of its flow.
 */
export function PageChatSettings({ flow }: { flow: string }) {
  const t = useStore((s) => s.t);
  const chat = useStore((s) => s.pageChats[flow]);
  const [draft, setDraft] = useState<Draft | null>(chat ? draftOf(chat) : null);
  const [state, setState] = useState<"" | "saving" | "saved" | string>("");
  useEffect(() => {
    if (chat === undefined) void loadPageChat(flow);
  }, [flow]);
  useEffect(() => {
    if (chat && !draft) setDraft(draftOf(chat));
  }, [chat]);
  if (chat === null) return <p className="muted">{t("pagechat.gone")}</p>;
  if (!chat || !draft) return <p className="muted">{t("pagechat.loading")}</p>;
  const change = (d: Partial<Draft>) => {
    setDraft({ ...draft, ...d });
    setState("");
  };
  const button = (i: number, d: Partial<{ label: string; text: string }>) =>
    change({ buttons: draft.buttons.map((b, j) => (j === i ? { ...b, ...d } : b)) });
  const ok =
    draft.actions.length > 0 &&
    draft.instructions.trim().length > 0 &&
    draft.buttons.every((b) => b.label.trim() && b.text.trim());
  const save = async () => {
    setState("saving");
    const error = await savePageChat(flow, { base: chat.version, ...draft });
    // What the server saved, as the panel's draft from now on (its version is the next save's base).
    const now = useStore.getState().pageChats[flow];
    if (!error && now) setDraft(draftOf(now));
    setState(error ? error : "saved");
  };
  return (
    <div className="pchat-settings">
      <label className="field">
        <span className="field-label">{t("pagechat.set.welcome")}</span>
        <textarea
          className="input"
          rows={2}
          maxLength={400}
          value={draft.welcome}
          placeholder={t("pagechat.welcome")}
          onChange={(e) => change({ welcome: e.target.value })}
        />
      </label>
      <div className="field">
        <span className="field-label">{t("pagechat.set.buttons")}</span>
        {draft.buttons.map((b, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: the buttons are edited in place, in their order
          <div key={i} className="pchat-set-button">
            <input
              className="input"
              value={b.label}
              maxLength={40}
              placeholder={t("pagechat.set.label")}
              aria-label={t("pagechat.set.label")}
              onChange={(e) => button(i, { label: e.target.value })}
            />
            <input
              className="input"
              value={b.text}
              maxLength={300}
              placeholder={t("pagechat.set.text")}
              aria-label={t("pagechat.set.text")}
              onChange={(e) => button(i, { text: e.target.value })}
            />
            <button
              type="button"
              className="icon-btn"
              aria-label={t("pagechat.set.removeButton")}
              onClick={() => change({ buttons: draft.buttons.filter((_, j) => j !== i) })}
            >
              <X size={14} />
            </button>
          </div>
        ))}
        {draft.buttons.length < 6 && (
          <button
            type="button"
            className="btn ghost"
            onClick={() => change({ buttons: [...draft.buttons, { label: "", text: "" }] })}
          >
            <Plus size={14} /> {t("pagechat.set.addButton")}
          </button>
        )}
      </div>
      <label className="field">
        <span className="field-label">{t("pagechat.set.instructions")}</span>
        <textarea
          className="input"
          rows={6}
          maxLength={2000}
          value={draft.instructions}
          onChange={(e) => change({ instructions: e.target.value })}
        />
        {draft.instructions !== chat.defaults.instructions && (
          <button
            type="button"
            className="btn ghost"
            onClick={() => change({ instructions: chat.defaults.instructions })}
          >
            {t("pagechat.set.reset")}
          </button>
        )}
      </label>
      <fieldset className="field pchat-actions">
        <legend className="field-label">{t("pagechat.set.actions")}</legend>
        {CHAT_ACTIONS.map((a) => (
          <label key={a} className="toggle-row">
            <input
              type="checkbox"
              checked={draft.actions.includes(a)}
              onChange={(e) =>
                change({
                  actions: e.target.checked
                    ? CHAT_ACTIONS.filter((x) => x === a || draft.actions.includes(x))
                    : draft.actions.filter((x) => x !== a),
                })
              }
            />
            <span>{t(`pagechat.action.${a}`)}</span>
          </label>
        ))}
      </fieldset>
      <div className="pchat-save">
        <button
          type="button"
          className="btn primary"
          disabled={!ok || state === "saving"}
          onClick={() => void save()}
        >
          {t("pagechat.set.save")}
        </button>
        {state === "saved" && <span className="muted small">{t("pagechat.set.saved")}</span>}
        {state && state !== "saving" && state !== "saved" && (
          <span className="form-error" role="alert">
            {state === "conflict" ? t("pagechat.set.conflict") : t("pagechat.set.failed")}
          </span>
        )}
      </div>
    </div>
  );
}
