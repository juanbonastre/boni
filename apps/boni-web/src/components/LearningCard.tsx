/**
 * The Bandeja's card of a pause or a suggestion of an automation's cell (AU-209, AU-210, F15 P2): painted by the
 * app's code from the server's fields, the names as plain text. A suggestion has «Abrir», which opens the automation
 * for his own «Sí» and «Publicar» (both from a personal device), and «No»; a pause has «Quitar pausa» and «Abrir».
 * Boni never sets a «Sí». On a device that may not decide (the server's `mayDecide`), the card is read-only.
 */
import { Lightbulb } from "lucide-react";
import { useState } from "react";
import { automationsClient, isRefused } from "../automations/client.ts";
import { runRefusedWords } from "../automations/runWords.ts";
import type { LearningCard as Card } from "../core/agent.ts";
import { agentApi, dropLearning, errorText, showAutomation, toast, useStore } from "../store.ts";

const client = automationsClient(agentApi);

export function LearningCard({ c }: { c: Card }) {
  const t = useStore((s) => s.t);
  const [busy, setBusy] = useState(false);
  const decide = async (what: "unpause" | "decline") => {
    setBusy(true);
    try {
      const r = await client.learn(c.automation, what, {
        step: c.step,
        collection: c.collection,
        action: c.action,
      });
      // «nothing»: already lifted or answered elsewhere; the card goes all the same.
      if (isRefused(r) && r.refused !== "nothing") return toast(runRefusedWords(t, r));
      dropLearning(c);
    } catch (e) {
      toast(errorText(t, e));
    } finally {
      setBusy(false);
    }
  };
  const open = () => showAutomation(c.automation);
  const wrong = c.decided - c.right;
  const line =
    c.kind === "suggested"
      ? t("inbox.learn.right", { right: c.right, n: c.decided })
      : c.why === "inARow"
        ? t("inbox.learn.inARow", { n: wrong })
        : t("inbox.learn.share", { wrong, n: c.decided });
  return (
    <section className="card inbox-card learning-card" data-kind={c.kind}>
      <p className="inbox-kind">
        <Lightbulb size={12} strokeWidth={1.8} aria-hidden="true" />
        {t(c.kind === "suggested" ? "inbox.kind.suggested" : "inbox.kind.paused")}
      </p>
      <header className="inbox-card-head">
        <h3>
          {t("inbox.learn.title", {
            name: c.name || t("inbox.run.unnamed"),
            step: c.stepName || t("auto.value.empty"),
            collection: c.collectionName,
          })}
        </h3>
      </header>
      <p className="inbox-what muted">{line}</p>
      {!c.mayDecide ? (
        <p className="inbox-source muted">{t("inbox.ask.personalOnly")}</p>
      ) : (
        <div className="inbox-actions">
          {c.kind === "paused" ? (
            <>
              <button
                type="button"
                className="btn primary decide-btn"
                disabled={busy}
                aria-busy={busy}
                data-boni-action="automations.learn"
                onClick={() => void decide("unpause")}
              >
                <span className="decide-label">{t("inbox.learn.unpause")}</span>
              </button>
              <button type="button" className="btn decide-btn" onClick={open}>
                <span className="decide-label">{t("inbox.learn.open")}</span>
              </button>
            </>
          ) : (
            <>
              <button type="button" className="btn primary decide-btn" onClick={open}>
                <span className="decide-label">{t("inbox.learn.open")}</span>
              </button>
              <button
                type="button"
                className="btn decide-btn"
                disabled={busy}
                aria-busy={busy}
                data-boni-action="automations.learn"
                onClick={() => void decide("decline")}
              >
                <span className="decide-label">{t("inbox.learn.no")}</span>
              </button>
            </>
          )}
        </div>
      )}
    </section>
  );
}
