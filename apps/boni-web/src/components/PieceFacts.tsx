/**
 * What a piece of Boni lets you set, in its panel on the map and in the editor (F7, task 83; the review of its first
 * part: «los ajustes de las piezas»): «Aceptar solas» shows the «Solo» switch of its area, the very switch of Ajustes →
 * Decisiones (one setting, two places; on only once earned, from a personal device; asked again each time its panel
 * opens, so Boni turning it off shows); «Plegar hilo» says how many days back it looks in a thread, as the server
 * reads its step's `days` (a whole number from 1 to 366, else 60).
 */
import { useEffect } from "react";
import type { FlowStep } from "../core/agent.ts";
import { deviceZone } from "../core/clock.ts";
import { loadDecisions, setDecisionAuto, useStore } from "../store.ts";

/** The area of the procedure «Aceptar solas» decides in (the server's `AUTO_AREA`, autoAccept.ts). */
const ALONE_AREA = "mail.accept";

/** «Plegar hilo»'s days as the server takes them (`foldDays`, mail.ts): a whole number from 1 to 366, else 60. */
export const foldDays = (v: unknown): number =>
  typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 366 ? v : 60;

export function PieceFacts({ step }: { step: FlowStep }) {
  const t = useStore((s) => s.t);
  const lang = useStore((s) => s.settings.language);
  const accuracy = useStore((s) => s.accuracy);
  const alone = step.op === "call" && step.tool === "inbox.accept_alone";
  useEffect(() => {
    if (alone) void loadDecisions();
  }, [alone]);
  if (alone) {
    const a = accuracy.find((x) => x.area === ALONE_AREA);
    // Not decided on yet (no mail decided), or not earned: off, greyed, and why in Ajustes' words.
    const state =
      a?.autoBy === "boni" && a.autoAt && !a.auto
        ? t("decisions.backedOff", {
            when: new Intl.DateTimeFormat(lang === "en" ? "en-GB" : "es-ES", {
              dateStyle: "medium",
              timeZone: deviceZone(),
            }).format(a.autoAt),
          })
        : !a?.auto && !a?.earned
          ? t("decisions.notYet")
          : "";
    return (
      <section className="piece-facts" aria-label={t("decisions.solo")}>
        <label className="piece-facts-switch">
          <span>{t("decisions.solo")}</span>
          <input
            type="checkbox"
            className="switch"
            checked={!!a?.auto}
            disabled={!a || (!a.auto && !a.earned)}
            onChange={(e) => a && void setDecisionAuto(a.area, e.target.checked)}
          />
        </label>
        {state && <p className="muted small">{state}</p>}
      </section>
    );
  }
  if (step.op === "call" && step.tool === "inbox.fold") {
    const n = foldDays((step.args as { days?: { lit?: unknown } } | undefined)?.days?.lit);
    return (
      <section className="piece-facts">
        <p className="muted">
          {t(n === 1 ? "flows.piece.foldDays.one" : "flows.piece.foldDays", { n })}
        </p>
      </section>
    );
  }
  return null;
}
