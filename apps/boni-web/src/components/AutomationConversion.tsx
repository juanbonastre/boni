/**
 * The screens of the conversion, F16 P1 (docs/automatizaciones.md AU-225, decision 21): the band «Tus flujos son
 * ahora automatizaciones» over the list of automations, which stays until «Cerrar» (kept for the account by the
 * server) and then lives in the list's «⋯ → Conversión»; and the app's one notice that leads to it. Each flow the
 * conversion reached says «Hace lo mismo» or «Lo que cambia» (its lines by their keys, `auto.conv.change.<key>`),
 * how many runs it had since and how many failed; and the band says how many versions of before could not be
 * converted. Asked once when the list opens and once when the app starts (until its notice was given): never on a
 * clock (A-15). Every name is painted as plain text (A-01).
 */
import { SYS } from "@boni/views";
import { X } from "lucide-react";
import { useEffect, useState } from "react";
import {
  automationsClient,
  type ConversionList,
  type ConvertedItem,
  isRefused,
} from "../automations/client.ts";
import type { T } from "../i18n.ts";
import { agentApi, loadRows, showAutomation, showFlows, toast, useStore } from "../store.ts";
import { Modal } from "./AutomationPublish.tsx";
import { touchError } from "./AutomationRuns.tsx";

const client = automationsClient(agentApi);

/** The keys of «Lo que cambia» this app words; another (a newer server's) is «Otro cambio». */
const CHANGE_KEYS: readonly string[] = [
  "asksNow",
  "textsCut",
  "readerClassifies",
  "undoWhole",
  "automationLimits",
  "pageValueAsks",
  "permissionDecides",
  "doubtAsks",
];
export const changeWords = (t: T, key: string) =>
  t(CHANGE_KEYS.includes(key) ? `auto.conv.change.${key}` : "auto.conv.change.other");

/** «3 ejecuciones desde la conversión · ninguna falló». */
export function runsWords(t: T, item: Pick<ConvertedItem, "runs" | "failed">): string {
  if (!item.runs) return t("auto.conv.runsNone");
  const failed = item.failed
    ? t("auto.conv.failed", { n: item.failed })
    : t("auto.conv.failedNone");
  return `${t("auto.conv.runs", { n: item.runs })} · ${failed}`;
}

/** Whether the band has something to say: a flow the conversion made an automation, and «Cerrar» not yet given. */
export const bandShows = (list: ConversionList | null) =>
  !!list && list.closed === null && list.items.some((x) => x.state !== "kept");

/** The list of the conversion, asked once (`n` asks again); null until it arrives or when the server has none. */
export function useConversion(n = 0): [ConversionList | null, (l: ConversionList) => void] {
  const [list, setList] = useState<ConversionList | null>(null);
  useEffect(() => {
    let gone = false;
    client.conversion().then(
      (l) => !gone && setList(l),
      () => undefined,
    );
    return () => {
      gone = true;
    };
  }, [n]);
  return [list, setList];
}

/** Each flow of the conversion: its name, its state when it is not converted, what changes and its runs since. */
function ConvertedRows({ items }: { items: ConvertedItem[] }) {
  const t = useStore((s) => s.t);
  return (
    <ul className="auto-conv-items">
      {items.map((x) => (
        <li key={x.id} className={`auto-conv-item ${x.state}`}>
          <div className="auto-conv-line">
            {x.state === "kept" ? (
              <span className="auto-conv-name" title={x.name}>
                {x.name}
              </span>
            ) : (
              <button
                type="button"
                className="link-btn auto-conv-name"
                title={x.name}
                data-boni-action="automations.read"
                onClick={() => showAutomation(x.id)}
              >
                {x.name}
              </button>
            )}
            {x.state !== "converted" && (
              <span className="auto-conv-state">{t(`auto.conv.state.${x.state}`)}</span>
            )}
            {x.state !== "kept" && <span className="auto-conv-runs">{runsWords(t, x)}</span>}
          </div>
          {x.changes.length === 0 ? (
            <span className="auto-conv-same">{t("auto.conv.same")}</span>
          ) : (
            <details className="auto-conv-changes">
              <summary>{t("auto.conv.changes")}</summary>
              <ul>
                {x.changes.map((c) => (
                  <li key={c}>{changeWords(t, c)}</li>
                ))}
              </ul>
            </details>
          )}
        </li>
      ))}
    </ul>
  );
}

/** «N versiones de antes no se pudieron convertir», over every flow; nothing with none. */
function Skipped({ items }: { items: ConvertedItem[] }) {
  const t = useStore((s) => s.t);
  const n = items.reduce((sum, x) => sum + x.skipped, 0);
  return n ? <p className="muted auto-conv-skipped">{t("auto.conv.skipped", { n })}</p> : null;
}

/** The band over the list (AU-225): until «Cerrar», which no device shows again. */
export function ConversionBand({
  list,
  onClosed,
}: {
  list: ConversionList;
  onClosed: (l: ConversionList) => void;
}) {
  const t = useStore((s) => s.t);
  const [busy, setBusy] = useState(false);
  const close = async () => {
    setBusy(true);
    try {
      const r = await client.closeBand();
      if (isRefused(r)) toast(t("mail.error.personal-device-only"));
      else onClosed({ ...list, closed: r.closed });
    } catch (e) {
      toast(touchError(t, e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="auto-conv-band" aria-label={t("auto.conv.title")}>
      <div className="auto-conv-head">
        <h2>{t("auto.conv.title")}</h2>
        <button
          type="button"
          className="icon-btn"
          aria-label={t("auto.conv.close")}
          title={t("auto.conv.close")}
          data-boni-action="automations.convert"
          disabled={busy}
          onClick={() => void close()}
        >
          <X size={16} strokeWidth={1.8} />
        </button>
      </div>
      <ConvertedRows items={list.items} />
      <Skipped items={list.items} />
    </section>
  );
}

/** «⋯ → Conversión»: the same list, once the band was closed. */
export function ConversionScreen({ list, onClose }: { list: ConversionList; onClose: () => void }) {
  const t = useStore((s) => s.t);
  return (
    <Modal
      label={t("auto.conv.title")}
      title={t("auto.conv.title")}
      onClose={onClose}
      className="auto-conv"
    >
      <div className="modal-body">
        <ConvertedRows items={list.items} />
        <Skipped items={list.items} />
      </div>
    </Modal>
  );
}

/** Where the app keeps that its notice was given, on this device: it is given once. */
const NOTICED = "boni.conversion.noticed";
const readNoticed = () => {
  try {
    return localStorage.getItem(NOTICED) !== null;
  } catch {
    return true;
  }
};

/**
 * The app's one notice (AU-225): when the band has something to say and the list is not open, «Tus flujos son
 * ahora automatizaciones» with «Ver», which opens it. Once per device; a server before F16 says nothing.
 */
export function useConversionNotice() {
  const t = useStore((s) => s.t);
  useEffect(() => {
    if (readNoticed()) return;
    let gone = false;
    client.conversion().then(
      (l) => {
        if (gone || !bandShows(l)) return;
        try {
          localStorage.setItem(NOTICED, String(Date.now()));
        } catch {
          // Without storage it may be given again: the band is still the server's.
        }
        if (useStore.getState().view.kind === "flows") return;
        // On the phone the list is under «Páginas»; the desktop has no tabs.
        const open = () => {
          useStore.setState({ tab: "pages" });
          showFlows();
        };
        toast(t("auto.conv.title"), { label: t("auto.conv.open"), run: open });
      },
      () => undefined,
    );
    return () => {
      gone = true;
    };
  }, [t]);
}

/**
 * «Volver al flujo de antes» or «Convertir otra vez» (decision 21): the new state and the switch after it (coming
 * again, as Juan left it before going back), or null when refused (its words shown). From a personal device only: the server refuses another, and nothing changes.
 */
export async function convertStep(
  t: T,
  id: string,
  name: string,
  step: "back" | "again",
): Promise<{ state: "converted" | "reverted"; enabled: boolean } | null> {
  try {
    const r = await client.convert(id, step);
    if (isRefused(r)) {
      toast(
        r.refused === "changed"
          ? t("auto.conv.refused.changed")
          : r.refused === "not-personal"
            ? t("mail.error.personal-device-only")
            : t("error.generic"),
      );
      return null;
    }
    void loadRows(SYS.flows.id);
    toast(t(step === "back" ? "auto.conv.backDone" : "auto.conv.againDone", { name }));
    return r.state === "kept" ? null : { state: r.state, enabled: r.enabled };
  } catch (e) {
    toast(touchError(t, e));
    return null;
  }
}
