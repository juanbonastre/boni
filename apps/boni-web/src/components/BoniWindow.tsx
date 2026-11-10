/**
 * Boni over the screen (docs/sistema.md §4.7, F9; task 85; C4 of docs/conversacion.md): the circle at the bottom
 * right of every screen and `Ctrl+E` open the conversation over what is open, the same one as always; it docks to the
 * right in the Bandeja's place («Llevar a la derecha»), widens to the Conversación screen («Ampliar») and closes with
 * `Esc`. What is on the screen goes with each message, by reference (`screenNow`).
 */
import {
  Maximize2,
  MessageCircle,
  MousePointerClick,
  PanelRight,
  PictureInPicture2,
  X,
} from "lucide-react";
import { useEffect, useRef } from "react";
import {
  closeBoniWindow,
  openBoniWindow,
  setPointing,
  useStore,
  widenBoniWindow,
} from "../store.ts";
import { ChatView } from "./Chat.tsx";

/**
 * The circle: Boni, on every screen but the conversation's own. While the pointer points (`Ctrl+Shift+E`) it says
 * so, and a click on it stops: with the window closed it is the sign, besides the pointer, that the screen is not
 * answering clicks (the window's «Señalar» is when it is open).
 */
export function BoniCircle() {
  const t = useStore((s) => s.t);
  const mode = useStore((s) => s.boniWindow);
  const onChat = useStore((s) => s.view.kind === "chat");
  const pointing = useStore((s) => s.pointing);
  if (onChat || mode !== "closed") return null;
  if (pointing)
    return (
      <button
        type="button"
        className="boni-circle pointing"
        onClick={() => setPointing(false)}
        aria-pressed="true"
        title={t("point.start")}
        aria-label={t("point.start")}
      >
        <MousePointerClick size={20} strokeWidth={1.8} />
      </button>
    );
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

/**
 * The conversation over what is open, or docked to the right. Docked, it gives way to any other panel on the right
 * (the Bandeja, a record): it floats beside it until that closes, and docks again. One element either way, so what
 * Juan was writing stays.
 */
export function BoniWindow() {
  const t = useStore((s) => s.t);
  const mode = useStore((s) => s.boniWindow);
  const onChat = useStore((s) => s.view.kind === "chat");
  const otherRight = useStore((s) => s.panel != null || s.inboxOpen);
  const box = useRef<HTMLElement | null>(null);
  const open = mode !== "closed" && !onChat;
  const docked = mode === "right" && !otherRight;
  // `Esc` with the focus in it closes it before anything under it (in the capture: the page's own `Esc` does not go
  // back); a menu of its own closes first. With the focus elsewhere `Esc` is that place's.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      const st = useStore.getState();
      if (e.key !== "Escape" || e.defaultPrevented || st.settingsOpen || st.findOpen) return;
      if (!box.current?.contains(document.activeElement)) return;
      const inner = (e.target as HTMLElement | null)?.closest?.(
        "[role=menu], [role=listbox], .chat-drawer, .pop-box",
      );
      if (inner) return;
      e.preventDefault();
      closeBoniWindow();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open]);
  // Opened, what Juan types goes to it.
  useEffect(() => {
    if (open) box.current?.querySelector<HTMLTextAreaElement>("textarea")?.focus();
  }, [open]);
  if (!open) return null;
  return (
    <section
      ref={(n) => {
        box.current = n;
      }}
      className={docked ? "side-panel boni-docked" : "boni-window"}
      role={docked ? "complementary" : "dialog"}
      aria-label={t("boni.title")}
    >
      <header className="panel-head boni-window-head">
        <h2>{t("boni.title")}</h2>
        <button
          type="button"
          className="icon-btn"
          onClick={() => openBoniWindow(docked ? "float" : "right")}
          title={t(docked ? "boni.float" : "boni.dock")}
          aria-label={t(docked ? "boni.float" : "boni.dock")}
        >
          {docked ? (
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
    </section>
  );
}
