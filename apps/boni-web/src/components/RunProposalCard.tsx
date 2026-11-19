/**
 * The card in the inbox of what a run of an automation asked (AU-193, F14d P3b): painted by the app's code from the
 * server's `RunProposalView`, never from a model's words. It says the automation and its version, how many rows it
 * creates, modifies and sends to the trash in each collection («Tarea de la mañana: crear 4 filas en Tareas»),
 * and each row with its before, its after and the mark of what came from outside, every value as plain text (A-01).
 * «Ver todo» reads the rest a page at a time. Accepted, it has no «Deshacer» of its own: it is undone with its run,
 * which «Ver la ejecución» opens in «Ejecuciones». Expired, it says «Caducada» and runs it again.
 */
import { Inbox } from "lucide-react";
import { useState } from "react";
import { automationsClient, isRefused } from "../automations/client.ts";
import { runRefusedWords } from "../automations/runWords.ts";
import { rowsWords } from "../automations/words.ts";
import type { AskedRow, Proposal, RunProposal } from "../core/agent.ts";
import { chipTitle, pointAttrs } from "../core/pointing.ts";
import type { T } from "../i18n.ts";
import {
  acceptProposal,
  agentApi,
  dismissProposal,
  errorText,
  rejectProposal,
  showAutomation,
  toast,
  useStore,
} from "../store.ts";
import { cellText } from "./AutomationRows.tsx";

const client = automationsClient(agentApi);

/** «Tarea de la mañana: crear 4 filas en Tareas y modificar 2 filas en Gastos». */
export function wantsWords(
  t: T,
  lang: "es" | "en",
  r: RunProposal,
  names: (key: string) => string | undefined,
): string {
  const parts = r.counts.map((c) =>
    // A change of the chat's page is counted by its page, named by its title (AU-137).
    c.collection === ""
      ? c.n === 1
        ? t("inbox.run.page", { page: c.name ?? t("auto.run.did.gone") })
        : t("inbox.run.pages", {
            n: c.n.toLocaleString(lang === "en" ? "en-GB" : "es-ES"),
            page: c.name ?? t("auto.run.did.gone"),
          })
      : t(`inbox.run.${c.action}`, {
          rows: rowsWords(t, lang, c.n),
          collection: names(c.collection) ?? c.name ?? t("auto.run.did.gone"),
        }),
  );
  const what = parts.length
    ? new Intl.ListFormat(lang === "en" ? "en-GB" : "es-ES", { type: "conjunction" }).format(parts)
    : t("inbox.run.nothing");
  return t("inbox.run.wants", { name: r.name || t("inbox.run.unnamed"), what });
}

/** What a change of the chat's page is, as its row says it: «Mes en «Ventas»», «Un bloque nuevo en «Ventas»». */
const pageWords = (t: T, page: NonNullable<AskedRow["page"]>) =>
  page.change === "value"
    ? t("inbox.run.row.page.value", { control: page.control ?? "", page: page.title })
    : t("inbox.run.row.page.block", { page: page.title });
/** A page change's values, as its row shows them: the control is in its words already, the rest by plain names. */
const pageValues = (r: AskedRow) =>
  r.page ? r.values.filter((v) => v.key !== "control") : r.values;

/** One value as the card says it: its text, never markup; a list or a row by how many it holds. */
const valueText = (t: T, v: unknown) => cellText(t, v as Parameters<typeof cellText>[1]);

export function RunProposalCard({ p, asked }: { p: Proposal; asked: RunProposal }) {
  const t = useStore((s) => s.t);
  const lang = useStore((s) => s.settings.language) === "en" ? "en" : "es";
  const types = useStore((s) => s.dataTypes);
  const failed = useStore((s) => s.decideErrors[p.id]);
  const [all, setAll] = useState<AskedRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [again, setAgain] = useState(false);
  const typeOf = (key: string) => (types ?? []).find((d) => d.key === key);
  const names = (key: string) => typeOf(key)?.name;
  const fieldName = (collection: string, key: string) =>
    typeOf(collection)?.fields.find((f) => f.key === key)?.name ?? key;
  const rows = all ?? asked.first;
  const stale = failed?.code === "stale";

  /** «Ver todo»: every change it asked, 50 at a time, as the server keeps them. */
  const seeAll = async () => {
    setLoading(true);
    try {
      const out: AskedRow[] = [];
      for (let total = Number.POSITIVE_INFINITY; out.length < total; ) {
        const page = await client.asked(asked.automation, asked.run, out.length);
        if (!page.asked.length) break;
        out.push(...page.asked);
        total = page.total;
      }
      setAll(out);
    } catch (e) {
      toast(errorText(t, e));
    } finally {
      setLoading(false);
    }
  };
  /** «Ejecutar otra vez» (AU-193): a run with the same data, with what the rows hold now; the card goes. */
  const runAgain = async () => {
    setAgain(true);
    try {
      const answer = await client.retry(asked.automation, asked.run, false);
      if (isRefused(answer)) return toast(runRefusedWords(t, answer));
      dismissProposal(p.id);
      showAutomation(asked.automation, { run: answer.run.id });
    } catch (e) {
      toast(errorText(t, e));
    } finally {
      setAgain(false);
    }
  };
  const openRun = () => showAutomation(asked.automation, { run: asked.run });
  const busy = useStore((s) => s.deciding[p.id]);

  return (
    <section
      className="card proposal inbox-card detailed run-proposal"
      {...pointAttrs(
        { kind: "proposal", id: p.id },
        chipTitle(t("inbox.kind.proposal"), asked.name),
      )}
    >
      <p className="inbox-kind">
        <Inbox size={12} strokeWidth={1.8} aria-hidden="true" />
        {t("inbox.kind.run")}
      </p>
      <header className="inbox-card-head">
        <h3>{wantsWords(t, lang, asked, names)}</h3>
      </header>
      <p className="inbox-what muted run-proposal-line">
        {[
          asked.version !== null ? t("auto.run.by.version", { n: asked.version }) : null,
          t(asked.startedBy === "schedule" ? "auto.run.by.schedule" : "auto.run.by.user"),
          stale ? t("inbox.run.stale") : t("inbox.run.pending"),
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>
      <ul className="run-asked" aria-label={t("inbox.run.rows")}>
        {rows.map((r, i) => (
          <li
            // biome-ignore lint/suspicious/noArrayIndexKey: the changes of one run, in the order it asked them
            key={i}
            className="run-asked-row"
            data-action={r.action}
          >
            <span className="run-asked-what">
              {r.page
                ? pageWords(t, r.page)
                : t(`inbox.run.row.${r.action}`, {
                    collection: names(r.collection) ?? r.name ?? t("auto.run.did.gone"),
                    title: r.row?.title || t("auto.value.empty"),
                  })}
              {r.byAgent && <span className="run-asked-agent"> · {t("auto.conn.byAgent")}</span>}
            </span>
            {pageValues(r).map((v) => (
              <span className="run-asked-value" key={v.key}>
                <span className="run-asked-field">
                  {r.page
                    ? t(
                        v.key === "block"
                          ? "inbox.run.row.page.blockField"
                          : "inbox.run.row.page.valueField",
                      )
                    : fieldName(r.collection, v.key)}
                </span>
                {"before" in v && (
                  <>
                    <span className="run-asked-before">{valueText(t, v.before)}</span>
                    <span className="run-asked-arrow" aria-hidden="true">
                      {" → "}
                    </span>
                  </>
                )}
                <span className="run-asked-after">{valueText(t, v.value)}</span>
                {v.outside && <span className="run-asked-outside">{t("inbox.run.outside")}</span>}
              </span>
            ))}
          </li>
        ))}
      </ul>
      {!all && asked.count > rows.length && (
        <button
          type="button"
          className="btn ghost small run-asked-all"
          disabled={loading}
          aria-busy={loading}
          onClick={() => void seeAll()}
        >
          {t("inbox.run.all", { n: asked.count.toLocaleString(lang === "en" ? "en-GB" : "es-ES") })}
        </button>
      )}
      <div className="inbox-actions">
        {stale ? (
          <>
            <button
              type="button"
              className="btn primary decide-btn"
              disabled={again}
              aria-busy={again}
              onClick={() => void runAgain()}
            >
              <span className="decide-label">{t("inbox.run.again")}</span>
            </button>
            <button type="button" className="btn decide-btn" onClick={() => dismissProposal(p.id)}>
              <span className="decide-label">{t("inbox.dismiss")}</span>
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className={`btn primary decide-btn${busy === "accept" ? " busy" : ""}`}
              disabled={!!busy || !!failed?.gone}
              aria-busy={busy === "accept"}
              data-boni-action="inbox.accept"
              onClick={() => void acceptProposal(p.id)}
            >
              <span className="decide-label">{t("inbox.accept")}</span>
              {busy === "accept" && <span className="spinner" aria-hidden="true" />}
            </button>
            <button
              type="button"
              className={`btn decide-btn${busy === "reject" ? " busy" : ""}`}
              disabled={!!busy || !!failed?.gone}
              aria-busy={busy === "reject"}
              data-boni-action="inbox.reject"
              onClick={() => void rejectProposal(p.id)}
            >
              <span className="decide-label">{t("inbox.reject")}</span>
              {busy === "reject" && <span className="spinner" aria-hidden="true" />}
            </button>
          </>
        )}
        <button type="button" className="btn ghost decide-btn" onClick={openRun}>
          <span className="decide-label">{t("inbox.run.open")}</span>
        </button>
        {failed && !stale && (
          <p className="decide-error" role="alert">
            <span>{failed.text}</span>
            {failed.gone && (
              <button
                type="button"
                className="btn ghost small"
                onClick={() => dismissProposal(p.id)}
              >
                {t("inbox.dismiss")}
              </button>
            )}
          </p>
        )}
      </div>
    </section>
  );
}
