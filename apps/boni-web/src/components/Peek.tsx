import { Maximize2, X } from "lucide-react";
import { useEffect } from "react";
import { host } from "../host.ts";
import { dismissToast, flushRowBody, useStore } from "../store.ts";
import { useTheme } from "../theme.ts";
import { RowView } from "./RowView.tsx";

/**
 * A note opened from another app (Boni Calendar's "Abrir en Boni"), as a peek: a small window with the row as a
 * page (its properties and text, editable), "Abrir en Boni" to take it to the main window, and gone as soon as
 * it loses the focus or Esc is pressed.
 */
export function PeekPage() {
  useTheme();
  const t = useStore((s) => s.t);
  const path = useStore((s) => s.openedNote);
  const type = useStore((s) =>
    s.view.kind === "row"
      ? s.dataTypes?.find((x) => x.id === (s.view as { type: string }).type)
      : undefined,
  );
  const toast = useStore((s) => s.toast);
  const close = () => {
    void flushRowBody();
    host.desktop?.peekHide?.();
  };
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
          {type?.icon && <span>{type.icon}</span>}
          {type?.name ?? ""}
        </span>
        <span className="spacer" />
        {path && (
          <button
            type="button"
            className="btn ghost small"
            onClick={() => {
              void flushRowBody().then(() => {
                host.desktop?.openMain(`note:${path}`);
                host.desktop?.peekHide?.();
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
        <RowView />
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
