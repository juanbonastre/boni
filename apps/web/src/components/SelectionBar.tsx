import { Trash2, X } from "lucide-react";
import { t } from "../i18n.ts";
import { useApp } from "../store.ts";

/** Floating bar shown while several events are selected. */
export function SelectionBar() {
  const ids = useApp((s) => s.selectedIds);
  if (ids.length < 2) return null;
  return (
    <div className="selbar" role="toolbar">
      <span className="selbar-count">{t("sel.count", { n: ids.length })}</span>
      <span className="selbar-hint">{t("sel.hint")}</span>
      <button
        type="button"
        className="selbar-btn danger"
        onClick={() => useApp.getState().deleteEvents(ids)}
      >
        <Trash2 size={14} /> {t("sel.delete")}
      </button>
      <button
        type="button"
        className="icon-btn"
        title={t("sel.clear")}
        onClick={() => useApp.getState().clearSelection()}
      >
        <X size={15} />
      </button>
    </div>
  );
}
