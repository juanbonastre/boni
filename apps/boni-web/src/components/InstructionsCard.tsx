/**
 * The Bandeja's card of what «Revisar instrucciones» suggests (AU-211): a change of an automation's draft, measured
 * on his decisions. «Ver el cambio» shows its rules and examples before and after, every text painted as plain text
 * (senders and subjects are someone else's); «Aceptar» puts it in the draft, where his own hand publishes it, and
 * «No» turns it down for a week. Boni never sets a «Sí» nor publishes. On a device that may not decide, read-only.
 */
import { Lightbulb } from "lucide-react";
import { useState } from "react";
import { automationsClient, isRefused } from "../automations/client.ts";
import { runRefusedWords } from "../automations/runWords.ts";
import { KEY } from "../automations/words.ts";
import type {
  InstructionsCard as Card,
  InstructionsExample,
  InstructionsRule,
} from "../core/agent.ts";
import type { T } from "../i18n.ts";
import {
  agentApi,
  dropInstructions,
  errorText,
  showAutomation,
  toast,
  useStore,
} from "../store.ts";
import { Modal } from "./AutomationPublish.tsx";

const client = automationsClient(agentApi);
/** The rule step's type, whose words say what a rule does («No leer»). */
const RULE = "boni.mailRule";

export function InstructionsCard({ c }: { c: Card }) {
  const t = useStore((s) => s.t);
  const [busy, setBusy] = useState(false);
  const [seeing, setSeeing] = useState(false);
  const decide = async (what: "take" | "drop") => {
    setBusy(true);
    try {
      const r = await client.instructions(c.automation, what, c.id);
      // «nothing»: already answered elsewhere, or gone; the card goes all the same.
      if (isRefused(r) && r.refused !== "nothing") return toast(runRefusedWords(t, r));
      dropInstructions(c.id);
      setSeeing(false);
      if (what === "take") {
        toast(t("inbox.instructions.taken"));
        showAutomation(c.automation);
      }
    } catch (e) {
      toast(errorText(t, e));
    } finally {
      setBusy(false);
    }
  };
  const name = c.name || t("inbox.run.unnamed");
  return (
    <section className="card inbox-card learning-card instructions-card" data-kind={c.kind}>
      <p className="inbox-kind">
        <Lightbulb size={12} strokeWidth={1.8} aria-hidden="true" />
        {t("inbox.kind.suggested")}
      </p>
      <header className="inbox-card-head">
        <h3>{name}</h3>
      </header>
      <p className="inbox-what muted">
        {t("inbox.instructions.right", { before: c.before, after: c.after, total: c.total })}
      </p>
      <div className="inbox-actions">
        <button type="button" className="btn primary decide-btn" onClick={() => setSeeing(true)}>
          <span className="decide-label">{t("inbox.instructions.see")}</span>
        </button>
        {c.mayDecide && (
          <button
            type="button"
            className="btn decide-btn"
            disabled={busy}
            aria-busy={busy}
            data-boni-action="automations.learn"
            onClick={() => void decide("drop")}
          >
            <span className="decide-label">{t("inbox.learn.no")}</span>
          </button>
        )}
      </div>
      {!c.mayDecide && <p className="inbox-source muted">{t("inbox.ask.personalOnly")}</p>}
      {seeing && (
        <Modal
          label={t("inbox.instructions.see")}
          title={`${t("inbox.instructions.see")} · ${name}`}
          onClose={() => setSeeing(false)}
          className="instructions-change"
        >
          <div className="modal-body">
            <p className="muted">
              {t("inbox.instructions.right", { before: c.before, after: c.after, total: c.total })}
            </p>
            <Side t={t} title={t("inbox.instructions.before")} c={c} added={false} />
            <Side t={t} title={t("inbox.instructions.after")} c={c} added />
            {c.mayDecide ? (
              <div className="inbox-actions">
                <button
                  type="button"
                  className="btn primary decide-btn"
                  disabled={busy}
                  aria-busy={busy}
                  data-boni-action="automations.learn"
                  onClick={() => void decide("take")}
                >
                  <span className="decide-label">{t("inbox.instructions.take")}</span>
                </button>
                <button
                  type="button"
                  className="btn decide-btn"
                  disabled={busy}
                  aria-busy={busy}
                  data-boni-action="automations.learn"
                  onClick={() => void decide("drop")}
                >
                  <span className="decide-label">{t("inbox.learn.no")}</span>
                </button>
              </div>
            ) : (
              <p className="inbox-source muted">{t("inbox.ask.personalOnly")}</p>
            )}
          </div>
        </Modal>
      )}
    </section>
  );
}

/** «Antes» lists what the draft has; «Después», what it adds (marked «Nuevo») and then what it had. */
function Side({ t, title, c, added }: { t: T; title: string; c: Card; added: boolean }) {
  const rules = added ? [...c.rules.added, ...c.rules.before] : c.rules.before;
  const examples = added ? [...c.examples.added, ...c.examples.before] : c.examples.before;
  const isNew = (i: number, n: number) => added && i < n;
  return (
    <section className="auto-pub-part instructions-side" aria-label={title}>
      <h3>{title}</h3>
      <h4>{t("inbox.instructions.rules")}</h4>
      {rules.length ? (
        <ul>
          {rules.map((r, i) => (
            <Line
              key={`r${i}`}
              isNew={isNew(i, c.rules.added.length)}
              t={t}
              text={ruleText(t, r)}
            />
          ))}
        </ul>
      ) : (
        <p className="muted">{t("inbox.instructions.none")}</p>
      )}
      <h4>{t("inbox.instructions.examples")}</h4>
      {examples.length ? (
        <ul>
          {examples.map((e, i) => (
            <Line
              key={`e${i}`}
              isNew={isNew(i, c.examples.added.length)}
              t={t}
              text={exampleText(e)}
            />
          ))}
        </ul>
      ) : (
        <p className="muted">{t("inbox.instructions.none")}</p>
      )}
    </section>
  );
}

function Line({ t, text, isNew }: { t: T; text: string; isNew: boolean }) {
  return (
    <li data-new={isNew || undefined}>
      {isNew && <span className="instructions-new">{t("inbox.instructions.added")}</span>}
      {text}
    </li>
  );
}

/** A rule as one line of plain text: its sender, then «No leer» or the collection it goes to. */
const ruleText = (t: T, r: InstructionsRule) =>
  `${r.sender} · ${r.do === "collection" && r.collection ? r.collection : t(KEY.choice(RULE, "do", r.do))}`;
/** An example as one line of plain text: the mail's subject, then the titles kept. */
const exampleText = (e: InstructionsExample) =>
  e.want.length ? `${e.subject} · ${e.want.join(", ")}` : e.subject;
