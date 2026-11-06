/**
 * What a piece of Boni lets you set, in its panel on the map and in the editor (F7, task 83; the review of its first
 * part: «los ajustes de las piezas»): «Aceptar solas» shows the «Solo» switch of its area, the very switch of Ajustes →
 * Decisiones (one setting, two places; on only once earned, from a personal device); «Plegar hilo» says how many days
 * back it looks in a thread (its step's `days`, which the editor changes as any setting).
 */
import { useEffect } from "react";
import type { FlowStep } from "../core/agent.ts";
import { loadDecisions, setDecisionAuto, useStore } from "../store.ts";

/** The area of the procedure «Aceptar solas» decides in (the server's `AUTO_AREA`, autoAccept.ts). */
const ALONE_AREA = "mail.accept";
/** «Plegar hilo»'s days when its step gives none (the server's `FOLD_DAYS`). */
const FOLD_DAYS = 60;

export function PieceFacts({
  step,
  editor = false,
}: {
  step: FlowStep;
  /** In the editor, whose panel already shows the step's settings as fields (its days among them). */
  editor?: boolean;
}) {
  const t = useStore((s) => s.t);
  const accuracy = useStore((s) => s.accuracy);
  const alone = step.op === "call" && step.tool === "inbox.accept_alone";
  useEffect(() => {
    if (alone && !accuracy.length) void loadDecisions();
  }, [alone, accuracy.length]);
  if (alone) {
    const a = accuracy.find((x) => x.area === ALONE_AREA);
    if (!a?.switchable) return null;
    return (
      <section className="piece-facts" aria-label={t("decisions.solo")}>
        <label className="piece-facts-switch">
          <span>{t("decisions.solo")}</span>
          <input
            type="checkbox"
            className="switch"
            checked={a.auto}
            disabled={!a.auto && !a.earned}
            onChange={(e) => void setDecisionAuto(a.area, e.target.checked)}
          />
        </label>
        <p className="muted small">
          {!a.auto && !a.earned ? `${t("decisions.notYet")}. ` : ""}
          {t("flows.piece.soloHint")}
        </p>
      </section>
    );
  }
  if (!editor && step.op === "call" && step.tool === "inbox.fold") {
    const days = (step.args as { days?: { lit?: unknown } } | undefined)?.days?.lit;
    const n = typeof days === "number" && days >= 1 ? days : FOLD_DAYS;
    return (
      <section className="piece-facts">
        <p className="muted">{t("flows.piece.foldDays", { n })}</p>
      </section>
    );
  }
  return null;
}
