import { Maximize2, X } from "lucide-react";
import { useEffect } from "react";
import { host } from "../host.ts";
import {
  configured,
  dismissToast,
  flushRowBody,
  loadInbox,
  openNoteAt,
  useStore,
} from "../store.ts";
import { useTheme } from "../theme.ts";
import { ProposalPage } from "./InboxCards.tsx";
import { RowView } from "./RowView.tsx";
import { Account } from "./SettingsModal.tsx";

/**
 * A note opened from another app (Boni Calendar's "Abrir en Boni"), as a peek: a small window with the row as a
 * page (its properties and text, editable), "Abrir en Boni" to take it to the main window, and gone as soon as
 * Esc is pressed, its close button is used or Juan clicks in Boni Calendar (Juan, 2026-10-22: not when he
 * goes to another app). A proposal drawn in Boni Calendar opens here too, as its page (plan b2): accepted or
 * rejected, the peek goes away.
 */
export function PeekPage() {
  useTheme();
  const t = useStore((s) => s.t);
  const id = useStore((s) => s.openedNote);
  const type = useStore((s) =>
    s.view.kind === "row"
      ? s.dataTypes?.find((x) => x.id === (s.view as { type: string }).type)
      : undefined,
  );
  const proposal = useStore((s) => (s.view.kind === "proposal" ? s.view.id : null));
  const toast = useStore((s) => s.toast);
  const settings = useStore((s) => s.settings);
  const loggedIn = configured(settings) && !settings.sessionEnded;
  const close = () => {
    void flushRowBody();
    if (host.desktop) host.desktop.peekHide?.();
    else host.embed?.hide();
  };
  // Boni Calendar's peek logs in once with its own session; then the note asked for opens.
  useEffect(() => {
    if (!loggedIn) return;
    if (useStore.getState().view.kind === "proposal") void loadInbox();
    else if (id) void openNoteAt(id);
  }, [loggedIn]);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) close();
    };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, []);
  return (
    <div className="peek">
      <header className="peek-head">
        <span className="peek-kind">
          {proposal ? (
            t("ghost.proposed")
          ) : (
            <>
              {type?.icon && <span>{type.icon}</span>}
              {type?.name ?? ""}
            </>
          )}
        </span>
        <span className="spacer" />
        {proposal && host.desktop && (
          <button
            type="button"
            className="btn ghost small"
            onClick={() => {
              host.desktop?.openMain(`proposal:${proposal}`);
              host.desktop?.peekHide?.();
            }}
          >
            <Maximize2 size={13} strokeWidth={1.8} />
            {t("peek.open")}
          </button>
        )}
        {id && !proposal && (
          <button
            type="button"
            className="btn ghost small"
            onClick={() => {
              void flushRowBody().then(() => {
                if (host.desktop) {
                  host.desktop.openMain(`note:${id}`);
                  host.desktop.peekHide?.();
                } else {
                  host.embed?.openInBoni(id);
                  host.embed?.hide();
                }
              });
            }}
          >
            <Maximize2 size={13} strokeWidth={1.8} />
            {t("peek.open")}
          </button>
        )}
        <button
          type="button"
          className="icon-btn"
          onClick={close}
          title={t("settings.close")}
          aria-label={t("settings.close")}
        >
          <X size={16} strokeWidth={1.8} />
        </button>
      </header>
      <div className="peek-body">
        {loggedIn ? (
          proposal ? (
            <ProposalPage key={proposal} id={proposal} onDone={close} />
          ) : (
            <RowView />
          )
        ) : (
          <div className="peek-login">
            <p className="muted">{t("peek.login")}</p>
            <Account />
          </div>
        )}
      </div>
      {toast && (
        <div className="toast" role="status">
          <span>{toast.text}</span>
          <button
            type="button"
            className="icon-btn"
            onClick={dismissToast}
            aria-label={t("settings.close")}
          >
            <X size={14} strokeWidth={1.8} />
          </button>
        </div>
      )}
    </div>
  );
}
