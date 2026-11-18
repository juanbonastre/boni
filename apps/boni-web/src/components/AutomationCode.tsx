/**
 * The parts of a «Código» step's view (docs/automatizaciones.md AU-30, AU-31, AU-33, AU-35, AU-36): «Se ejecuta» with
 * its two modes, the editor (CodeEditor.tsx, loaded only when a «Código» opens), the notice that connects a
 * collection the code cites, what is wrong with the source as a whole, and «Consola» under the step's output. What
 * is marked and completed comes from the core (automations/code.ts, `completions`); nothing here decides it. The
 * code's own text (its console, an error's message) is painted as plain text (A-01).
 */
import {
  type Automation,
  CODE_LIMITS,
  CODE_MODES,
  CODE_PARAMS,
  type CodeContext,
  type CodeFailure,
  completions,
  renameCollectionInCode,
  type Step,
} from "@boni/automations";
import { ChevronRight } from "lucide-react";
import { lazy, Suspense, useMemo } from "react";
import type { StepTest } from "../automations/client.ts";
import { consoleOf, modeOf, sourceOf, sourceProblems } from "../automations/code.ts";
import { wouldLines } from "../automations/connections.ts";
import { DO, KEY, type SaidNames, said } from "../automations/words.ts";
import type { T } from "../i18n.ts";
import { WouldTable } from "./AutomationRows.tsx";
import type { CodeMark } from "./CodeEditor.tsx";

const CodeEditor = lazy(() => import("./CodeEditor.tsx"));

export function CodeParams({
  t,
  step,
  draft,
  context,
  locale,
  names,
  readOnly,
  setMode,
  setSource,
  connect,
  failure,
}: {
  t: T;
  step: Step;
  draft: Automation;
  context: CodeContext;
  locale: string;
  names: SaidNames;
  readOnly: boolean;
  setMode: (mode: (typeof CODE_MODES)[number]) => void;
  setSource: (source: string) => void;
  connect: (collection: string) => void;
  /** How its last test failed in its code (AU-33): its line is marked, with the message as it is. */
  failure?: CodeFailure;
}) {
  const source = sourceOf(step);
  const mode = modeOf(step);
  const found = useMemo(() => sourceProblems(step, draft, context), [step, draft, context]);
  const marks: CodeMark[] = useMemo(() => {
    const out: CodeMark[] = found.marks.map((p) => ({
      from: p.from,
      to: p.to,
      severity: p.severity,
      message: said(t, "problem", p, locale, names),
    }));
    const line = failure?.detail?.line;
    if (failure && typeof line === "number") {
      const at = lineSpan(source, line);
      if (at)
        out.push({ ...at, severity: "error", message: said(t, "failure", failure, locale, names) });
    }
    return out;
  }, [found, t, locale, names, failure, source]);
  const modeName = t(KEY.param(step.type, CODE_PARAMS.mode));
  const sourceName = t(KEY.param(step.type, CODE_PARAMS.source));
  return (
    <>
      <div className="auto-param" data-param={CODE_PARAMS.mode}>
        <span className="auto-param-name" id={`${step.id}-mode`}>
          {modeName}
        </span>
        <div className="auto-param-control">
          <div className="auto-code-modes" role="radiogroup" aria-labelledby={`${step.id}-mode`}>
            {CODE_MODES.map((m) => (
              <label key={m} className={`auto-code-mode${m === mode ? " on" : ""}`}>
                <input
                  type="radio"
                  name={`${step.id}-mode`}
                  value={m}
                  checked={m === mode}
                  onChange={() => setMode(m)}
                />
                {t(KEY.choice(step.type, CODE_PARAMS.mode, m))}
              </label>
            ))}
          </div>
        </div>
      </div>
      <div className="auto-param auto-param-code" data-param={CODE_PARAMS.source}>
        <span className="auto-param-name">{sourceName}</span>
        <div className="auto-param-control">
          <Suspense fallback={<div className="auto-code-editor loading" aria-busy="true" />}>
            <CodeEditor
              value={source}
              label={sourceName}
              readOnly={readOnly}
              hint={t("auto.code.hint")}
              marks={marks}
              onChange={setSource}
              complete={(text, at) =>
                completions(
                  text,
                  at,
                  "code",
                  { ...step, params: { ...step.params, [CODE_PARAMS.source]: text } },
                  draft,
                  context,
                )
              }
            />
          </Suspense>
          <p className="auto-code-size" aria-live="polite">
            {t("auto.code.size", {
              got: source.length.toLocaleString(locale),
              max: CODE_LIMITS.sourceChars.toLocaleString(locale),
            })}
          </p>
          {found.whole.map((p) => (
            <p
              key={`${p.code}-${p.from}`}
              className={`auto-code-problem ${p.severity}`}
              role="alert"
            >
              {said(t, "problem", p, locale, names)}
            </p>
          ))}
          {/* AU-192: a collection cited by its name of before; the button rewrites only its `$col('…')`, by his hand. */}
          {found.renamed.map((r) => (
            <div key={r.name} className="auto-view-notice auto-code-renamed" role="status">
              <span>{t("auto.code.renamed", r)}</span>
              {!readOnly && (
                <button
                  type="button"
                  className="btn small"
                  data-boni-action="automations.edit"
                  onClick={() => setSource(renameCollectionInCode(source, r.name, r.now))}
                >
                  {t(DO.renameCited, { now: r.now })}
                </button>
              )}
            </div>
          ))}
          {found.notConnected.map((key) => (
            <div key={key} className="auto-view-notice auto-code-connect" role="status">
              <span>{t("auto.code.connect", { name: context.collectionName?.(key) ?? key })}</span>
              {!readOnly && (
                <button
                  type="button"
                  className="btn small"
                  data-boni-action="automations.edit"
                  onClick={() => connect(key)}
                >
                  {t(DO.connect)}
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

/** Where the 1-based line `n` of `text` is, without its end of line; undefined past the last. */
export function lineSpan(text: string, n: number): { from: number; to: number } | undefined {
  let from = 0;
  for (let i = 1; i < n; i++) {
    const next = text.indexOf("\n", from);
    if (next < 0) return undefined;
    from = next + 1;
  }
  const end = text.indexOf("\n", from);
  return { from, to: end < 0 ? text.length : end };
}

/**
 * «Consola» (AU-33): a strip under the step's output, folded when the last test wrote nothing. Each line with the
 * line of the code that wrote it and, once per row, its row; the lines left out are counted.
 */
export function CodeConsole({
  t,
  test,
  locale,
}: {
  t: T;
  test: StepTest | undefined;
  locale: string;
}) {
  const { lines, dropped } = consoleOf(test);
  const empty = lines.length === 0 && dropped === 0;
  return (
    <details className="auto-console" open={!empty} data-lines={lines.length}>
      <summary>
        <ChevronRight size={14} aria-hidden="true" className="auto-console-fold" />
        {t("auto.console")}
        <span className="auto-console-count">
          {empty ? t("auto.console.empty") : lines.length.toLocaleString(locale)}
        </span>
      </summary>
      {!empty && (
        <ol className="auto-console-lines">
          {lines.map((l, i) => (
            <li key={i} className={`auto-console-line ${l.level}`}>
              <span className="auto-console-text">{l.text}</span>
              <span className="auto-console-where">
                {l.line !== undefined && t("auto.console.line", { line: l.line })}
                {l.row !== undefined && ` · ${t("auto.console.row", { row: l.row + 1 })}`}
              </span>
            </li>
          ))}
          {dropped > 0 && (
            <li className="auto-console-more">
              {t("auto.console.more", { n: dropped.toLocaleString(locale) })}
            </li>
          )}
        </ol>
      )}
    </details>
  );
}

/**
 * «Haría esto» of a «Código» (AU-181, AU-189): a strip above «Consola», folded, with how many rows of which collection
 * each action would change («Modificaría 12 filas en Gastos») and the first rows with their before and after. Nothing
 * of it was saved. Absent when its last test asked to save nothing. Values are the code's: painted as plain text.
 */
export function CodeWould({
  t,
  test,
  locale,
  nameOf,
  fieldNames,
}: {
  t: T;
  test: StepTest | undefined;
  locale: string;
  nameOf: (collection: string) => string;
  /** A collection's field names by key, for the table's heads. */
  fieldNames: (collection: string) => Readonly<Record<string, string>>;
}) {
  const would = test?.would;
  if (!would || would.counts.length === 0) return null;
  const lines = wouldLines(t, would, locale, nameOf);
  const total = would.counts.reduce((n, c) => n + c.n, 0);
  const more = total - would.records.length;
  const byCollection = [...new Set(would.records.map((r) => r.collection))];
  return (
    <details className="auto-would-code" data-rows={total}>
      <summary>
        <ChevronRight size={14} aria-hidden="true" className="auto-console-fold" />
        {t("auto.would.code")}
        <span className="auto-would-lines">
          {lines.map((l) => (
            <span key={l} className="auto-would-line">
              {l}
            </span>
          ))}
        </span>
      </summary>
      {would.asks && <p className="muted small">{t("auto.would.code.asks")}</p>}
      {byCollection.map((c) => (
        <WouldTable
          key={c}
          t={t}
          names={fieldNames(c)}
          rows={would.records
            .filter((r) => r.collection === c)
            .map((r) => ({
              json: r.after ?? r.before ?? {},
              before: r.action === "create" ? null : (r.before ?? null),
              would: r.action === "remove" ? "trash" : r.action,
            }))}
        />
      ))}
      {more > 0 && (
        <p className="auto-console-more">
          {t("auto.would.code.more", { n: more.toLocaleString(locale) })}
        </p>
      )}
    </details>
  );
}
