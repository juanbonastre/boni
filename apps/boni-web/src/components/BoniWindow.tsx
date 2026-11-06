/**
 * Boni over the screen (docs/sistema.md §4.7, F9; task 85; C4 of docs/conversacion.md): the circle at the bottom
 * right of every screen and `Ctrl+E` open the conversation over what is open, the same one as always; it docks to the
 * right in the Bandeja's place («Llevar a la derecha»), widens to the Conversación screen («Ampliar») and closes with
 * `Esc`. What is on the screen goes with each message, by reference (`screenNow`).
 */
import { Maximize2, MessageCircle, PanelRight, PictureInPicture2, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { closeBoniWindow, openBoniWindow, useStore, widenBoniWindow } from "../store.ts";
import { ChatView } from "./Chat.tsx";

/** The circle: Boni, on every screen but the conversation's own. */
export function BoniCircle() {
  const t = useStore((s) => s.t);
  const mode = useStore((s) => s.boniWindow);
  const onChat = useStore((s) => s.view.kind === "chat");
  if (onChat || mode !== "closed") return null;
  return (
    <button
      type="button"
      className="boni-circle"
      onClick={() => openBoniWindow()}
      title={t("boni.open")}
      aria-label={t("boni.open")}
    >
      <MessageCircle size={20} strokeWidth={1.8} />
    </button>
  );
}

/** The conversation over what is open, or docked to the right. */
export function BoniWindow() {
  const t = useStore((s) => s.t);
  const mode = useStore((s) => s.boniWindow);
  const onChat = useStore((s) => s.view.kind === "chat");
  const box = useRef<HTMLElement | null>(null);
  const open = mode !== "closed" && !onChat;
  // `Esc` closes it before anything under it (in the capture: the page's own `Esc` does not go back); a menu or a
  // dialog of its own closes first.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      const st = useStore.getState();
      if (e.key !== "Escape" || e.defaultPrevented || st.settingsOpen || st.findOpen) return;
      const inner = (e.target as HTMLElement | null)?.closest?.(
        "[role=menu], [role=listbox], .chat-drawer",
      );
      if (inner) return;
      e.preventDefault();
      closeBoniWindow();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open]);
  // Opened or moved, what Juan types goes to it.
  useEffect(() => {
    if (open) box.current?.querySelector<HTMLTextAreaElement>("textarea")?.focus();
  }, [open, mode]);
  if (!open) return null;
  const right = mode === "right";
  const body = (
    <>
      <header className="panel-head boni-window-head">
        <h2>{t("boni.title")}</h2>
        <button
          type="button"
          className="icon-btn"
          onClick={() => openBoniWindow(right ? "float" : "right")}
          title={t(right ? "boni.float" : "boni.dock")}
          aria-label={t(right ? "boni.float" : "boni.dock")}
        >
          {right ? (
            <PictureInPicture2 size={16} strokeWidth={1.8} />
          ) : (
            <PanelRight size={16} strokeWidth={1.8} />
          )}
        </button>
        <button
          type="button"
          className="icon-btn"
          onClick={widenBoniWindow}
          title={t("boni.widen")}
          aria-label={t("boni.widen")}
        >
          <Maximize2 size={16} strokeWidth={1.8} />
        </button>
        <button
          type="button"
          className="icon-btn"
          onClick={closeBoniWindow}
          title={t("boni.close")}
          aria-label={t("boni.close")}
        >
          <X size={16} strokeWidth={1.8} />
        </button>
      </header>
      <div className="boni-window-body">
        <ChatView compact />
      </div>
    </>
  );
  return right ? (
    <aside
      ref={(n) => {
        box.current = n;
      }}
      className="side-panel boni-docked"
      aria-label={t("boni.title")}
    >
      {body}
    </aside>
  ) : (
    <section
      ref={(n) => {
        box.current = n;
      }}
      className="boni-window"
      role="dialog"
      aria-label={t("boni.title")}
    >
      {body}
    </section>
  );
}
