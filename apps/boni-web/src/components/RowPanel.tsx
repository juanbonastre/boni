import { Maximize2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { DataRow } from "../core/agent.ts";
import { agentApi, closePanel, openRow, useStore } from "../store.ts";
import { MailView } from "./MailView.tsx";

/**
 * A record opened from the conversation in the side panel (Juan, 2026-11-02: a click on a mail's line shows it
 * without leaving the chat): a mail as a mail client shows it, anything else by its title; «Agrandar» takes it
 * to its page.
 */
export function RowPanel({ type, id }: { type: string; id: string }) {
  const t = useStore((s) => s.t);
  const def = useStore((s) => s.dataTypes?.find((x) => x.id === type));
  const [row, setRow] = useState<DataRow | null>(null);
  const [titles, setTitles] = useState<Record<string, string>>({});
  useEffect(() => {
    let live = true;
    setRow(null);
    setTitles({});
    agentApi
      .dataRow(id)
      .then((r) => live && setRow(r))
      .catch(() => {});
    agentApi
      .dataRelated(id)
      .then((r) => live && setTitles(r.titles))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [id]);
  const enlarge = () => {
    closePanel();
    void openRow(type, id);
  };
  return (
    <div className="row-panel">
      <div className="row-panel-actions">
        <button type="button" className="btn ghost" onClick={enlarge}>
          <Maximize2 size={14} strokeWidth={1.8} aria-hidden="true" />
          {t("panel.enlarge")}
        </button>
      </div>
      {def && row ? (
        def.view === "mail" ? (
          <MailView type={def} row={row} titles={titles} />
        ) : (
          <h3>{String(row.values[def.titleField] ?? "")}</h3>
        )
      ) : (
        <p className="muted">{t("db.loading")}</p>
      )}
    </div>
  );
}
