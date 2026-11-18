/**
 * What «Preguntar», «Avisar» and «Responder» show in the editor (docs/automatizaciones.md AU-125, AU-201, AU-202,
 * AU-203): in «Probar» a question is asked and answered in the test's own panel, never in the Bandeja; in SALIDA, the
 * question and how it ended, what a notice would say, and the test's answer. Every text from the step or the rows is
 * painted as plain text, never as HTML, Markdown or a link (A-01).
 */
import {
  ASK_TYPE,
  type AskRecord,
  NOTIFY_TYPE,
  type Notice,
  REPLY_TYPE,
  type RunReply,
  type Step,
} from "@boni/automations";
import { useMemo, useState } from "react";
import type { RunAsk, StepTest, TestGiven } from "../automations/client.ts";
import { fullWhen } from "../automations/runWords.ts";
import { deviceZone } from "../core/clock.ts";
import type { T } from "../i18n.ts";

type Lang = "es" | "en";

/** The «Preguntar» steps whose last test waits with questions still open: what the test's panel asks. */
export function waitingAsks(tests: Record<string, StepTest>): { step: string; ask: AskRecord }[] {
  return Object.entries(tests).flatMap(([step, test]) =>
    test.state === "waiting" && test.ask && !test.ask.ended && test.ask.questions.length
      ? [{ step, ask: test.ask }]
      : [],
  );
}

/** An answer given to one question, or not yet. */
type Given = TestGiven | null | undefined;

/**
 * The test's panel (AU-203): each question with the control of its kind («Sí» / «No», its options, several to tick,
 * a text), «Enviar» once every one has an answer, and «Sin respuesta» for all. While it sends, nothing is pressed.
 */
export function AskPanel({
  t,
  lang,
  asks,
  nameOf,
  sending,
  answer,
}: {
  t: T;
  lang: Lang;
  asks: { step: string; ask: AskRecord }[];
  nameOf: (step: string) => string;
  sending: boolean;
  answer: (answers: Record<string, (TestGiven | null)[]>) => void;
}) {
  const zone = useMemo(deviceZone, []);
  const [given, setGiven] = useState<Record<string, Given[]>>({});
  const put = (step: string, i: number, g: Given) =>
    setGiven((was) => {
      const list = [...(was[step] ?? [])];
      list[i] = g;
      return { ...was, [step]: list };
    });
  const complete = asks.every(({ step, ask }) =>
    ask.questions.every((_, i) => isAnswer(ask, given[step]?.[i])),
  );
  const send = (none: boolean) =>
    answer(
      Object.fromEntries(
        asks.map(({ step, ask }) => [
          step,
          ask.questions.map((_, i) => (none ? null : (given[step]?.[i] ?? null))),
        ]),
      ),
    );
  return (
    <section className="auto-ask" aria-label={t("auto.ask.title")}>
      {asks.map(({ step, ask }) => (
        <div key={step} className="auto-ask-step">
          <h4 className="auto-ask-head">
            <span>{nameOf(step)}</span>
            <span className="auto-ask-until">
              {t("auto.ask.until", { when: fullWhen(lang, zone, ask.until) })}
            </span>
          </h4>
          {ask.questions.map((q, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: a question is its place in the step's list.
            <fieldset key={i} className="auto-ask-question" disabled={sending}>
              <legend className="auto-ask-text">{q.text}</legend>
              <AnswerControl
                t={t}
                ask={ask}
                options={q.options?.map((o) => o.value) ?? []}
                label={ask.questions.length > 1 ? t("auto.ask.questionN", { n: i + 1 }) : q.text}
                given={given[step]?.[i]}
                set={(g) => put(step, i, g)}
              />
            </fieldset>
          ))}
        </div>
      ))}
      <div className="auto-ask-actions">
        <button
          type="button"
          className="btn primary small"
          data-boni-action="automations.test"
          disabled={sending || !complete}
          onClick={() => send(false)}
        >
          {t("auto.ask.send")}
        </button>
        <button
          type="button"
          className="btn ghost small"
          data-boni-action="automations.test"
          disabled={sending}
          onClick={() => send(true)}
        >
          {t("auto.ask.none")}
        </button>
      </div>
    </section>
  );
}

/**
 * A waiting run's questions in «Ejecuciones» (AU-247, decision 29 of §10): where its notification opens, each with
 * the control of its kind and its own «Enviar» and «Sin respuesta», as its card would. A question answered already
 * says «Respondida». Where the server says this device does not answer it, the text alone and why. `answer` sends
 * one and resolves once the run was asked again.
 */
export function RunQuestions({
  t,
  lang,
  asks,
  nameOf,
  answer,
}: {
  t: T;
  lang: Lang;
  asks: RunAsk[];
  nameOf: (step: string) => string;
  answer: (at: { step: string; i: number }, given: TestGiven | null) => Promise<void>;
}) {
  const zone = useMemo(deviceZone, []);
  const [given, setGiven] = useState<Record<string, Given>>({});
  const [sending, setSending] = useState<string | null>(null);
  const send = async (step: string, i: number, g: TestGiven | null) => {
    const at = `${step}:${i}`;
    setSending(at);
    try {
      await answer({ step, i }, g);
    } finally {
      setSending(null);
    }
  };
  return (
    <section className="auto-ask auto-run-asks" aria-label={t("auto.ask.title")}>
      {asks.map((ask) => (
        <div key={ask.step} className="auto-ask-step">
          <h4 className="auto-ask-head">
            <span>{nameOf(ask.step)}</span>
            <span className="auto-ask-until">
              {t("auto.ask.until", { when: fullWhen(lang, zone, ask.until) })}
            </span>
          </h4>
          {!ask.mayAnswer && <p className="muted small">{t("inbox.ask.personalOnly")}</p>}
          {ask.questions.map((q, i) => {
            const at = `${ask.step}:${i}`;
            const open = ask.mayAnswer && !q.answered;
            return (
              <fieldset
                // biome-ignore lint/suspicious/noArrayIndexKey: a question is its place in the step's list.
                key={i}
                className="auto-ask-question"
                disabled={sending !== null}
              >
                <legend className="auto-ask-text">{q.text}</legend>
                {q.answered ? (
                  <p className="muted small auto-ask-done">{t("auto.ask.answered")}</p>
                ) : open ? (
                  <>
                    <AnswerControl
                      t={t}
                      ask={ask}
                      options={q.options}
                      label={ask.questions.length > 1 ? t("auto.ask.questionN", { n: i + 1 }) : q.text}
                      given={given[at]}
                      set={(g) => setGiven((was) => ({ ...was, [at]: g }))}
                    />
                    <div className="auto-ask-actions">
                      <button
                        type="button"
                        className="btn primary small"
                        data-boni-action="automations.answer"
                        disabled={sending !== null || !isAnswer(ask, given[at])}
                        aria-busy={sending === at || undefined}
                        onClick={() => {
                          const g = given[at];
                          if (g) void send(ask.step, i, g);
                        }}
                      >
                        {t("auto.ask.send")}
                      </button>
                      <button
                        type="button"
                        className="btn ghost small"
                        data-boni-action="automations.answer"
                        disabled={sending !== null}
                        onClick={() => void send(ask.step, i, null)}
                      >
                        {t("auto.ask.none")}
                      </button>
                    </div>
                  </>
                ) : null}
              </fieldset>
            );
          })}
        </div>
      ))}
    </section>
  );
}

/** Whether `g` answers a question of `ask`'s kind: a text not empty, at least one option of several. */
function isAnswer(ask: Pick<AskRecord, "answer">, g: Given): boolean {
  if (!g) return false;
  if (ask.answer === "text") return "text" in g && g.text.trim() !== "";
  if (ask.answer === "several") return "choices" in g && g.choices.length > 0;
  return true;
}

/** One question's control, by the kind of answer it takes (the Bandeja's, AU-125). */
function AnswerControl({
  t,
  ask,
  options,
  label,
  given,
  set,
}: {
  t: T;
  ask: Pick<AskRecord, "answer">;
  options: string[];
  label: string;
  given: Given;
  set: (g: Given) => void;
}) {
  if (ask.answer === "yesNo") {
    const yes = given && "yes" in given ? given.yes : undefined;
    return (
      <div className="auto-ask-choices" role="group" aria-label={label}>
        {[true, false].map((v) => (
          <button
            key={String(v)}
            type="button"
            className={`btn small${yes === v ? " on" : ""}`}
            aria-pressed={yes === v}
            onClick={() => set({ yes: v })}
          >
            {t(v ? "auto.ask.yes" : "auto.ask.no")}
          </button>
        ))}
      </div>
    );
  }
  if (ask.answer === "one") {
    const chosen = given && "choice" in given ? given.choice : undefined;
    return (
      <div className="auto-ask-choices" role="radiogroup" aria-label={label}>
        {options.map((o, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: an option is its place in the question's list.
          <label key={i} className="auto-ask-option-pick">
            <input type="radio" checked={chosen === i} onChange={() => set({ choice: i })} />
            <span>{o}</span>
          </label>
        ))}
      </div>
    );
  }
  if (ask.answer === "several") {
    const chosen = given && "choices" in given ? given.choices : [];
    return (
      <div className="auto-ask-choices" role="group" aria-label={label}>
        {options.map((o, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: an option is its place in the question's list.
          <label key={i} className="auto-ask-option-pick">
            <input
              type="checkbox"
              checked={chosen.includes(i)}
              onChange={(e) =>
                set({
                  choices: e.target.checked
                    ? [...chosen, i].sort((a, b) => a - b)
                    : chosen.filter((c) => c !== i),
                })
              }
            />
            <span>{o}</span>
          </label>
        ))}
      </div>
    );
  }
  return (
    <textarea
      className="input auto-ask-input"
      aria-label={label}
      value={given && "text" in given ? given.text : ""}
      onChange={(e) => set({ text: e.target.value })}
    />
  );
}

/**
 * SALIDA of «Preguntar», «Avisar» and «Responder» after a test: the questions and how they ended («Esperando
 * respuesta · hasta …», «Respondida», «Sin respuesta»); «Avisaría» with each notice and where it would go; the
 * test's answer, whole. Nothing for another step.
 */
export function PeopleOut({
  t,
  lang,
  step,
  test,
  reply,
  locale,
}: {
  t: T;
  lang: Lang;
  step: Step;
  test: StepTest | undefined;
  reply: RunReply | undefined;
  locale: string;
}) {
  const zone = useMemo(deviceZone, []);
  if (step.type === ASK_TYPE && test?.ask) {
    const ask = test.ask;
    const how =
      ask.ended === "answered"
        ? t("auto.ask.answered")
        : ask.ended === "noAnswer"
          ? t("auto.ask.none")
          : t("auto.run.how.waitingUntil", { when: fullWhen(lang, zone, ask.until) });
    return (
      <section className="auto-did auto-people" aria-label={t("auto.ask.title")}>
        <h4 className="auto-did-title">{t("auto.ask.title")}</h4>
        <p className="auto-did-head">{how}</p>
        <ul className="auto-did-lines">
          {ask.questions.map((q, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: a question is its place in the step's list.
            <li key={i}>{q.text}</li>
          ))}
        </ul>
      </section>
    );
  }
  if (step.type === NOTIFY_TYPE && test?.notices) {
    const n = test.notices;
    return (
      <section className="auto-did auto-people" aria-label={t("auto.notice.title")}>
        <h4 className="auto-did-title">{t(n.sent ? "auto.notice.sent" : "auto.notice.title")}</h4>
        <ul className="auto-did-lines">
          {n.notices.map((x, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: a notice is its place in the step's list.
            <li key={i}>{noticeWords(t, x, locale)}</li>
          ))}
        </ul>
      </section>
    );
  }
  if (step.type === REPLY_TYPE && reply && reply.step === step.id)
    return (
      <section className="auto-did auto-people" aria-label={t("auto.reply.title")}>
        <h4 className="auto-did-title">{t("auto.reply.title")}</h4>
        <p className="auto-people-reply">{reply.text}</p>
      </section>
    );
  return null;
}

/**
 * One notice as SALIDA says it: its text and where it goes, by «Por dónde» (AU-246): the devices of a notification,
 * «Bandeja» for a card; the one that groups the rest, «y 12 más».
 */
function noticeWords(t: T, n: Notice, locale: string): string {
  const via = n.via ?? ["notification"];
  const where = [
    ...(via.includes("notification") ? [t(`auto.notice.where.${n.where}`)] : []),
    ...(via.includes("inbox") ? [t("auto.notice.inbox")] : []),
  ].join(" · ");
  if (n.more !== undefined && !n.text)
    return `${t("auto.notice.more", { n: n.more.toLocaleString(locale) })} · ${where}`;
  return `${n.text} · ${where}`;
}
