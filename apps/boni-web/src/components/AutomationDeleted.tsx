/**
 * «Eliminadas», P3b of F14d (docs/automatizaciones.md AU-191): the automations list's «⋯» opens the deleted ones,
 * read from the same collection as the list (`?deleted=1`, apps/server/src/http.ts) with their names and never a
 * draft, each with «Recuperar»: the route `restore` that the notice of «Eliminar» already uses, which brings it back
 * off, with its draft, versions and runs. Not on the phone, where the list is looked at (decision 15). Every name is
 * painted as plain text (A-01).
 */
import { automationRowTarget, SYS } from "@boni/views";
import { MoreHorizontal } from "lucide-react";
import { useEffect, useState } from "react";
import { automationsClient } from "../automations/client.ts";
import { DO } from "../automations/words.ts";
import type { DataRow } from "../core/agent.ts";
import { agentApi, loadRows, toast, useStore } from "../store.ts";
import { Modal } from "./AutomationPublish.tsx";
import { touchError } from "./AutomationRuns.tsx";
import { MenuRow, PopButton } from "./Popover.tsx";

const client = automationsClient(agentApi);

/** The list's «⋯»: «Eliminadas» and its screen; «Conversión» (AU-225) when the conversion reached a flow. */
export function DeletedMenu({ onConversion }: { onConversion?: (() => void) | undefined } = {}) {
  const t = useStore((s) => s.t);
  const [open, setOpen] = useState(false);
  return (
    <>
      <PopButton
        label={<MoreHorizontal size={16} strokeWidth={1.8} />}
        title={t("auto.more")}
        className="icon-btn flows-more"
      >
        {(close) => (
          <>
            <MenuRow
              label={t(DO.deletedList)}
              boniAction="automations.read"
              onClick={() => {
                close();
                setOpen(true);
              }}
            />
            {onConversion && (
              <MenuRow
                label={t("auto.conv.menu")}
                boniAction="automations.read"
                onClick={() => {
                  close();
                  onConversion();
                }}
              />
            )}
          </>
        )}
      </PopButton>
      {open && <DeletedScreen onClose={() => setOpen(false)} />}
    </>
  );
}

function DeletedScreen({ onClose }: { onClose: () => void }) {
  const t = useStore((s) => s.t);
  const [rows, setRows] = useState<DataRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    let gone = false;
    agentApi.deletedRows(SYS.flows.id).then(
      (r) => !gone && setRows(r),
      (e) => !gone && setError(touchError(t, e)),
    );
    return () => {
      gone = true;
    };
  }, [t]);
  // Esc closes it and stays on the list: the modal's own (`Modal`, before the app's Esc).
  const nameOf = (row: DataRow) => String(row.values[SYS.flows.title] ?? "");
  /** «Recuperar»: back to the list, off; it leaves this one. */
  const recover = async (row: DataRow) => {
    const id = automationRowTarget(row.id);
    if (!id) return;
    setBusy(row.id);
    try {
      await client.restore(id);
      setRows((r) => r?.filter((x) => x.id !== row.id) ?? r);
      void loadRows(SYS.flows.id);
      toast(t("auto.del.recovered", { name: nameOf(row) }));
    } catch (e) {
      toast(touchError(t, e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <Modal
      label={t("auto.del.title")}
      title={t("auto.del.title")}
      onClose={onClose}
      className="auto-deleted"
    >
      <div className="modal-body">
        {error ? (
          <p className="form-error">{error}</p>
        ) : rows === null ? (
          <div className="page-loading" role="status" aria-busy="true" />
        ) : rows.length === 0 ? (
          <p className="muted">{t("auto.del.none")}</p>
        ) : (
          <>
            <p className="muted">{t("auto.del.hint")}</p>
            <ul className="auto-deleted-list">
              {rows.map((row) => (
                <li key={row.id} className="auto-deleted-item">
                  <span className="auto-deleted-name" title={nameOf(row)}>
                    {nameOf(row)}
                  </span>
                  <button
                    type="button"
                    className="btn small"
                    data-boni-action="automations.restore"
                    disabled={busy === row.id}
                    onClick={() => void recover(row)}
                  >
                    {t(DO.recover)}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </Modal>
  );
}
