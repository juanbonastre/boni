/**
 * «Probar», E of F14b (docs/automatizaciones.md §5.7 and §5.8: AU-64, AU-67, AU-71, AU-72, AU-84, AU-90 to AU-94):
 * the button at the bottom centre of the canvas with its box of the trigger's fields and its «Registro», and the
 * ENTRADA and SALIDA of a step's view once it has been tested. A test goes to the server through the page's `Tester`
 * (AutomationEditor.tsx), which first sends what the draft owes: the server tests the draft it has, and validates it
 * (with problems it answers `invalid` and nothing runs). What is shown is a pure reading of the editor's state
 * (automations/state.ts: `logLine`, `outputCount`, `failedAt`; automations/panel.ts: `outputSays`); the rows come
 * 50 at a time (AutomationRows.tsx).
 */
import {
  type Automation,
  type Cell,
  inputsOf,
  isTrigger,
  type KeptNames,
  outputsOf,
  type Step,
  stepChanges,
} from "@boni/automations";
import { ListTree, Pin, Play } from "lucide-react";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { dragFrom } from "../automations/cite.ts";
import type { ExprPreview, Sample, TestGiven } from "../automations/client.ts";
import {
  type ConditionField,
  cannotTest,
  fieldsOut,
  outputSays,
  stepsBefore,
  writesRows,
} from "../automations/panel.ts";
import { stoppedByLimit } from "../automations/publishing.ts";
import { type TreeLine, treeLines } from "../automations/runs.ts";
import { type EditorState, failedAt, logLine } from "../automations/state.ts";
import {
  agoWords,
  choiceNames,
  DO,
  fieldNames,
  KEY,
  localeOf,
  logWords,
  rowsWords,
  type SaidNames,
  said,
  secsWords,
} from "../automations/words.ts";
import type { T } from "../i18n.ts";
import { useStore } from "../store.ts";
import { AskPanel, waitingAsks } from "./AutomationPeople.tsx";
import { type RowsAsk, type RowsShow, TestRows } from "./AutomationRows.tsx";
import { MenuRow, PopButton } from "./Popover.tsx";

type Apply = (f: (s: EditorState) => EditorState) => void;

/** What the canvas and the view ask of the page to test: one object for the page's life. */
export interface Tester {
  /** «Probar» (`step` null) or «Probar paso», from `trigger` (by default the one the arrows reach it from). */
  run: (step: string | null, trigger?: string) => void;
  /**
   * The test that waits goes on with the panel's answers (AU-203), by «Preguntar» and question; null is «Sin
   * respuesta». None in a run.
   */
  answer?: (answers: Record<string, (TestGiven | null)[]>) => void;
  /** The rows of one input or output of a step's last test, a page at a time. */
  rows: (at: { step: string; side: "in" | "out"; name: string }) => RowsAsk;
  /** The first rows of the last test as `step` sees them: what the preview of an expression reads (AU-20). */
  sample: (step: string) => Promise<Sample | null>;
  /** What an expression being typed gives with one row of the step's last test, worked out by the server (AU-23). */
  preview: (at: {
    step: string;
    param: string;
    row: number;
    expr: string;
  }) => Promise<ExprPreview | null>;
  /** «Fijar» and «Soltar» (AU-93): the step's last tested output, pinned on the draft or let go. None in a run. */
  pin?: (step: string, on: boolean) => void;
  /** A run's, not a test's: what a step gave is said as run («corrió hace 2 h»), never as tested. */
  ran?: boolean;
}
export const TesterContext = createContext<Tester | null>(null);
export const useTester = () => useContext(TesterContext);

/**
 * On the phone an automation is looked at and tested, never changed (AU-74): no «Probar paso», no buttons in the empty
 * states, nothing that edits. The page says it once; a change of layout mounts another app, so it never flips.
 */
export const PhoneContext = createContext(false);
export const usePhone = () => useContext(PhoneContext);
/**
 * A run's canvas in «Ejecuciones» (AU-99): looked at on any screen, never changed nor tested; its rows are the run's,
 * which the page's `Tester` gives (AutomationRuns.tsx).
 */
export const LookContext = createContext(false);
export const useLook = () => useContext(LookContext);
/**
 * The names the version that runs kept for each collection its code cites (AU-192): with them, the draft's code that
 * still cites a renamed collection by its name of before says so, with a button. None before it is published.
 */
export const KeptContext = createContext<KeptNames | null>(null);
/** Nothing is changed here: the phone (AU-74), or a run's canvas (AU-99). */
export function useStill(): boolean {
  const phone = useContext(PhoneContext);
  const look = useContext(LookContext);
  return phone || look;
}

/** The time, again every half minute: what «hace 2 min» is said against. Asks nothing of the server. */
export function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

/** The fields a trigger asks (AU-94): «Disparado por el usuario»'s, as the draft declares them. */
export const triggerFields = (draft: Automation, trigger: string): ConditionField[] =>
  fieldsOut(draft, trigger, () => undefined);

/** The values the next test of `trigger` is made with: those typed, else those of its last test (AU-94). */
export function trialOf(state: EditorState, trigger: string): Record<string, Cell> {
  const given = state.trial[trigger] ?? state.tested[trigger] ?? {};
  const out: Record<string, Cell> = {};
  for (const f of triggerFields(state.draft, trigger)) out[f.key] = given[f.key] ?? null;
  return out;
}

/** Types a value of a trigger's field for the next test: never a change of the draft, never undone. */
export const setTrial =
  (trigger: string, key: string, value: Cell) =>
  (s: EditorState): EditorState => ({
    ...s,
    trial: { ...s.trial, [trigger]: { ...trialOf(s, trigger), [key]: value } },
  });

/** The fields of a trigger to test with (AU-70, AU-94): in the box of «Probar» and in its ENTRADA. */
export function TrialFields({
  t,
  fields,
  values,
  set,
}: {
  t: T;
  fields: readonly ConditionField[];
  values: Readonly<Record<string, Cell>>;
  set: (key: string, value: Cell) => void;
}) {
  if (!fields.length) return <p className="muted small">{t("auto.view.noFields")}</p>;
  return (
    <div className="auto-trial">
      {fields.map((f) => {
        const v = values[f.key];
        const id = `auto-trial-${f.key}`;
        return (
          <label key={f.key} className="auto-trial-field" htmlFor={id}>
            <span className="auto-trial-name">{f.name}</span>
            {f.type === "checkbox" ? (
              <input
                id={id}
                type="checkbox"
                checked={v === true}
                onChange={(e) => set(f.key, e.target.checked)}
              />
            ) : (
              <input
                id={id}
                className="input"
                type={
                  f.type === "number"
                    ? "number"
                    : f.type === "date"
                      ? "date"
                      : f.type === "datetime"
                        ? "datetime-local"
                        : "text"
                }
                value={v === null || v === undefined ? "" : String(v)}
                onChange={(e) => {
                  const text = e.target.value;
                  if (f.type !== "number") return set(f.key, text === "" ? null : text);
                  const n = Number(text);
                  set(f.key, text === "" || !Number.isFinite(n) ? null : n);
                }}
              />
            )}
          </label>
        );
      })}
    </div>
  );
}

/**
 * Bottom centre of the canvas (AU-64): «Probar» and, folded beside it, the «Registro». With one trigger and no
 * fields it tests at once; with fields, they are asked in a small box with those of the last test; with several
 * triggers, a menu chooses which first. While it tests it says «Probando…» and cannot be pressed.
 */
export function TestBar({
  state,
  apply,
  collectionName,
}: {
  state: EditorState;
  apply: Apply;
  collectionName: (key: string) => string;
}) {
  const t = useStore((s) => s.t);
  const lang = useStore((s) => s.settings.language) === "en" ? "en" : "es";
  const tester = useTester();
  const now = useNow();
  const [from, setFrom] = useState<string | null>(null);
  const triggers = state.draft.steps.filter(isTrigger);
  const testing = state.testing !== null;
  const nameOf = (id: string) => state.draft.steps.find((s) => s.id === id)?.name ?? id;
  const line = logLine(state);
  const go = (trigger: string) => tester?.run(null, trigger);
  const only = triggers.length === 1 ? triggers[0] : undefined;
  const label = (
    <>
      <Play size={14} strokeWidth={1.9} aria-hidden />
      <span>{t(testing && state.testing?.step === null ? "auto.view.testing" : DO.test)}</span>
    </>
  );
  /** Where a click on the «Registro» goes: the first step with a problem, or the one the test failed in. */
  const goTo =
    line.kind === "problems"
      ? line.first || null
      : line.kind === "tested" && !line.ok
        ? line.failedAt
        : null;
  const words = logWords(t, lang, line, nameOf, now);
  const phone = usePhone();
  const limit = line.kind === "tested" && !line.ok ? stoppedByLimit(state) : null;
  const fieldsBox = (trigger: string, close: () => void) => (
    <div className="auto-trial-box">
      <TrialFields
        t={t}
        fields={triggerFields(state.draft, trigger)}
        values={trialOf(state, trigger)}
        set={(key, value) => apply(setTrial(trigger, key, value))}
      />
      <button
        type="button"
        className="btn primary small"
        data-boni-action="automations.test"
        onClick={() => {
          close();
          setFrom(null);
          go(trigger);
        }}
      >
        {t(DO.test)}
      </button>
    </div>
  );
  const asks = line.kind === "waiting" ? waitingAsks(state.tests) : [];
  return (
    <div className="auto-test-bar">
      {asks.length > 0 && tester?.answer && (
        <AskPanel
          key={asks.map((a) => `${a.step}:${a.ask.until}`).join(" ")}
          t={t}
          lang={lang}
          asks={asks}
          nameOf={nameOf}
          sending={testing}
          answer={tester.answer}
        />
      )}
      {only && !triggerFields(state.draft, only.id).length ? (
        <button
          type="button"
          className="btn primary auto-test-go"
          data-boni-action="automations.test"
          disabled={testing}
          onClick={() => go(only.id)}
        >
          {label}
        </button>
      ) : (
        <PopButton
          label={label}
          title={t(DO.test)}
          className="btn primary auto-test-go"
          align="start"
          disabled={testing || !triggers.length}
          onOpenChange={(open) => {
            if (!open) setFrom(null);
          }}
        >
          {(close) => {
            const chosen = only?.id ?? from;
            if (chosen) return fieldsBox(chosen, close);
            return (
              <div role="menu" aria-label={t("auto.test.from")}>
                <p className="auto-pop-head">{t("auto.test.from")}</p>
                {triggers.map((s) => (
                  <MenuRow
                    key={s.id}
                    label={s.name}
                    boniAction="automations.test"
                    onClick={() => {
                      if (triggerFields(state.draft, s.id).length) setFrom(s.id);
                      else {
                        close();
                        go(s.id);
                      }
                    }}
                  />
                ))}
              </div>
            );
          }}
        </PopButton>
      )}
      <div className="auto-log" role="status">
        <span className="auto-log-name">{t("auto.log")}</span>
        {goTo ? (
          <button
            type="button"
            className={`auto-log-line link${line.kind === "problems" || (line.kind === "tested" && !line.ok) ? " bad" : ""}`}
            title={words}
            onClick={() => apply((s) => ({ ...s, selected: [goTo], arrow: null }))}
          >
            {words}
          </button>
        ) : (
          <span className="auto-log-line" title={words}>
            {words}
          </span>
        )}
      </div>
      {line.kind === "tested" && (
        <TreeButton
          lines={treeLines(state.draft, state.tests, {
            ran: state.last ? [...state.last.ran, ...state.last.reused] : undefined,
            pins: state.pins,
          })}
          collectionName={collectionName}
          onStep={(step) => apply((s) => ({ ...s, selected: [step], arrow: null, open: step }))}
        />
      )}
      {limit && !phone && (
        <button
          type="button"
          className="btn small auto-log-limit"
          data-boni-action="automations.edit"
          onClick={() => apply((s) => ({ ...s, ajustes: { limit } }))}
        >
          {t(DO.changeLimit)}
        </button>
      )}
    </div>
  );
}

/**
 * «Ver cada paso» (AU-101): the «Registro» unfolded, beside its line in the editor and on a run's bar. The same tree
 * for a test and for a run.
 */
export function TreeButton({
  lines,
  collectionName,
  onStep,
}: {
  lines: readonly TreeLine[];
  collectionName: (key: string) => string;
  onStep: (step: string) => void;
}) {
  const t = useStore((s) => s.t);
  if (!lines.length) return null;
  return (
    <PopButton
      label={<ListTree size={15} strokeWidth={1.8} aria-hidden />}
      title={t("auto.tree.show")}
      className="icon-btn auto-tree-open"
      align="start"
      width={380}
    >
      {(close) => (
        <LogTree
          lines={lines}
          collectionName={collectionName}
          onStep={(step) => {
            close();
            onStep(step);
          }}
        />
      )}
    </PopButton>
  );
}

/**
 * The «Registro» tree (AU-101): each step in the order it ran, how it ended, its rows in and out and its seconds;
 * under it what it read, saved, proposed or would save, and its console. Counts only: the rows are in the step's
 * view. A click on a step selects it on the canvas.
 */
export function LogTree({
  lines,
  collectionName,
  onStep,
}: {
  lines: readonly TreeLine[];
  collectionName: (key: string) => string;
  onStep?: (step: string) => void;
}) {
  const t = useStore((s) => s.t);
  const lang = useStore((s) => s.settings.language) === "en" ? "en" : "es";
  const n = (x: number) => x.toLocaleString(localeOf(lang));
  const stateWord = (s: string) =>
    s === "running"
      ? t("auto.run.how.running")
      : KNOWN_STATES.has(s)
        ? t(`auto.state.${s}`)
        : t("auto.run.how.failed");
  return (
    <ol className="auto-tree" aria-label={t("auto.tree.label")}>
      {lines.map((l) => {
        const under = [
          ...l.reads.map((r) =>
            t("auto.tree.reads", {
              rows: rowsWords(t, lang, r.rows),
              collection: collectionName(r.collection),
            }),
          ),
          ...(l.saved ? [t("auto.tree.saved", { n: n(l.saved) })] : []),
          ...(l.asked ? [t("auto.tree.asked", { n: n(l.asked) })] : []),
          ...(l.would ? [t("auto.tree.would", { n: n(l.would) })] : []),
          ...(l.console ? [t("auto.tree.console", { n: n(l.console) })] : []),
        ];
        return (
          <li key={l.step} className={`auto-tree-line ${l.state}`}>
            <button
              type="button"
              className="auto-tree-step"
              disabled={!onStep}
              onClick={() => onStep?.(l.step)}
            >
              <span className={`auto-tree-mark ${l.state}`}>{stateWord(l.state)}</span>
              <span className="auto-tree-name" title={l.name}>
                {l.name}
                {l.pinned ? ` · ${t("auto.tree.pinned")}` : ""}
              </span>
              <span className="auto-tree-rows">
                {t("auto.tree.rows", { in: n(l.rowsIn), out: n(l.rowsOut) })}
              </span>
              <span className="auto-tree-ms">{secsWords(t, lang, l.ms)}</span>
            </button>
            {under.length > 0 && (
              <ul className="auto-tree-under">
                {under.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ol>
  );
}
const KNOWN_STATES = new Set(["done", "failed", "skipped", "stopped"]);

/**
 * «Probar paso» (AU-66, AU-73): it cannot be pressed while required parameters are empty or a test runs; while this
 * step is tested it says «Probando…», unless `besideSays` (the view's header says it beside the button).
 */
export function TestStepButton({
  t,
  state,
  step,
  className,
  besideSays = false,
  blocked = false,
}: {
  t: T;
  state: EditorState;
  step: Step;
  className: string;
  besideSays?: boolean;
  /** A «Código» whose source cannot run as it is (AU-31, AU-36): the view says why. */
  blocked?: boolean;
}) {
  const tester = useTester();
  const phone = useStill();
  const why = cannotTest(step, state.testing !== null);
  if (phone) return null;
  return (
    <button
      type="button"
      className={className}
      data-boni-action="automations.test"
      disabled={why !== null || blocked || !tester}
      onClick={() => tester?.run(step.id)}
    >
      {t(!besideSays && state.testing?.step === step.id ? "auto.view.testing" : DO.testStep)}
    </button>
  );
}

/** How rows are shown by default (AU-72): «Haría esto» for a step that writes, «Esquema» for one row, else «Tabla». */
const firstShow = (writes: boolean, total: number): RowsShow =>
  writes && total > 0 ? "would" : total === 1 ? "schema" : "table";

/** «Ver como» (AU-71, AU-72): «Esquema», «Tabla», «JSON» and, for a step that writes, «Haría esto». */
function ShowAs({
  t,
  show,
  set,
  writes,
}: {
  t: T;
  show: RowsShow;
  set: (s: RowsShow) => void;
  writes: boolean;
}) {
  const ways: RowsShow[] = writes
    ? ["would", "table", "schema", "json"]
    : ["schema", "table", "json"];
  return (
    <div className="segmented auto-show" role="radiogroup" aria-label={t("auto.show.label")}>
      {ways.map((w) => (
        <button
          key={w}
          type="button"
          role="radio"
          aria-checked={show === w}
          className={show === w ? "on" : undefined}
          onClick={() => set(w)}
        >
          {t(w === "would" ? "auto.out.would" : `auto.show.${w}`)}
        </button>
      ))}
    </div>
  );
}

/** One tab per input or output, with its count: «sí (3)», «no (125)» (AU-71, AU-72). */
function SideTabs({
  t,
  names,
  counts,
  at,
  set,
  label,
}: {
  t: T;
  names: readonly { id: string; label: string }[];
  counts: Readonly<Record<string, number>>;
  at: string;
  set: (id: string) => void;
  label: string;
}) {
  const locale = useStore((s) => s.settings.language) === "en" ? "en-GB" : "es-ES";
  if (names.length < 2) return null;
  return (
    <div className="auto-tabs auto-side-tabs" role="tablist" aria-label={label}>
      {names.map((n) => (
        <button
          key={n.id}
          type="button"
          role="tab"
          aria-selected={at === n.id}
          className="auto-tab"
          onClick={() => set(n.id)}
        >
          {t("auto.out.tab", { output: n.label, n: (counts[n.id] ?? 0).toLocaleString(locale) })}
        </button>
      ))}
    </div>
  );
}

/** A step whose removal a run would not ask (its «Permiso» «Sí», AU-187), read as the card's mark reads it. */
const removesNoAsk = (step: Step) =>
  stepChanges(step, { collectionNamed: () => undefined }).some((c) =>
    c.actions.some((a) => a.action === "remove" && a.mode === "yes"),
  );

/**
 * SALIDA after a test (AU-72, AU-84, AU-92): a tab per output with its count, «desactualizada» with «Probar paso»
 * when the step changed since, the rows 50 at a time, and at the foot when it was tested and how long it took. In
 * place of rows, what to do next: «Sin probar», «Saltado», «Parado», the reason of a failure with «Ir al parámetro»,
 * or «0 filas».
 */
export function StepOutput({
  state,
  step,
  outputName,
  fields,
  goToParam,
}: {
  state: EditorState;
  step: Step;
  outputName: (id: string) => string;
  /** The fields the step gives, as the draft knows them: their names and their options' names. */
  fields: readonly ConditionField[];
  goToParam: (key: string) => void;
}) {
  const t = useStore((s) => s.t);
  const lang = useStore((s) => s.settings.language) === "en" ? "en" : "es";
  const types = useStore((s) => s.dataTypes);
  const collectionName = (key: string) => types?.find((d) => d.key === key)?.name;
  const tester = useTester();
  const phone = useStill();
  const now = useNow();
  const test = state.tests[step.id];
  const outs = outputsOf(step);
  const first = outs.find((o) => (test?.out[o] ?? 0) > 0) ?? outs[0] ?? "main";
  const [at, setAt] = useState(first);
  const output = outs.includes(at) ? at : first;
  const writes = writesRows(step);
  const total = test?.out[output] ?? 0;
  const [show, setShow] = useState<RowsShow | null>(null);
  const shown = show ?? firstShow(writes, total);
  const says = outputSays(step, test);
  const nameOf = (id: string) => state.draft.steps.find((s) => s.id === id)?.name ?? id;
  const testStep = <TestStepButton t={t} state={state} step={step} className="btn small" />;
  const names = useMemo(() => fieldNames(t, fields), [t, fields]);
  const choices = useMemo(() => choiceNames(fields), [fields]);

  if (says && says.kind !== "empty") {
    let body: React.ReactNode;
    if (says.kind === "untested")
      body = (
        <>
          <p>{t("auto.view.untested")}</p>
          {testStep}
        </>
      );
    else if (says.kind === "skipped") body = <p>{t("auto.out.skipped")}</p>;
    else if (says.kind === "stopped") {
      const where = failedAt(state);
      body = (
        <p>{where ? t("auto.out.stopped", { step: nameOf(where) }) : t("auto.state.stopped")}</p>
      );
    } else {
      const { failure, param } = says;
      body = (
        <>
          <p className="auto-out-failure">
            {said(t, "failure", failure, localeOf(lang), { collection: collectionName })}
          </p>
          {param && !phone && (
            <>
              <p className="muted small">{t(KEY.param(step.type, param.key))}</p>
              <button type="button" className="btn small" onClick={() => goToParam(param.key)}>
                {t(DO.goToParam)}
              </button>
            </>
          )}
        </>
      );
    }
    return (
      <div className="auto-view-empty" data-out={says.kind}>
        {body}
      </div>
    );
  }
  if (!test) return null;
  return (
    <div className="auto-out">
      <SideTabs
        t={t}
        names={outs.map((id) => ({ id, label: outputName(id) }))}
        counts={test.out}
        at={output}
        set={(id) => {
          setAt(id);
          setShow(null);
        }}
        label={t("auto.view.output")}
      />
      <div className="auto-out-head">
        <span className="auto-out-count">{rowsWords(t, lang, total)}</span>
        {test.stale && (
          <span className="auto-out-stale">
            {t("auto.out.stale")}
            {testStep}
          </span>
        )}
        {total > 0 && <ShowAs t={t} show={shown} set={setShow} writes={writes} />}
        {tester?.pin && !phone && (
          <button
            type="button"
            className={`btn small auto-pin${state.pins[step.id] ? " on" : ""}`}
            data-boni-action="automations.pin"
            aria-pressed={!!state.pins[step.id]}
            // What is pinned is the last test that ended well (AU-93): a failed one has nothing to give.
            disabled={!state.pins[step.id] && test.state !== "done"}
            title={state.pins[step.id] ? t("auto.pin.card") : undefined}
            onClick={() => tester.pin?.(step.id, !state.pins[step.id])}
          >
            <Pin size={13} strokeWidth={1.8} aria-hidden />
            <span>{t(state.pins[step.id] ? DO.unpin : DO.pin)}</span>
          </button>
        )}
      </div>
      {total > 0 && tester && (
        <TestRows
          key={`${step.id}:out:${output}:${test.at}`}
          t={t}
          ask={tester.rows({ step: step.id, side: "out", name: output })}
          total={total}
          show={shown}
          names={names}
          choices={choices}
          noAsk={removesNoAsk(step)}
        />
      )}
      <p className="auto-out-foot muted small">
        {t(tester?.ran ? "auto.out.ran" : "auto.out.tested", {
          ago: agoWords(t, test.at, now),
          secs: secsWords(t, lang, test.ms),
        })}
      </p>
    </div>
  );
}

/**
 * ENTRADA of a step that is not a trigger (AU-71, AU-84): «De «Buscar gastos» · 128 filas», a tab per input
 * («Combinar»), any step before it on the path to look at instead, and its rows; with nothing tested before it,
 * «Sin datos de entrada» with «Probar los anteriores».
 */
export function StepInput({
  state,
  step,
  inputName,
  fieldsOf,
  withKeys = false,
}: {
  state: EditorState;
  step: Step;
  inputName: (id: string) => string;
  /**
   * A «Código»'s input (AU-25): each field with its key beside its name, as the code cites it. The one place outside
   * an expression where a key is seen.
   */
  withKeys?: boolean;
  /** The fields that come into `input` of `step`, or out of `output` of a step before it, as the draft knows them. */
  fieldsOf: (at: { step: string; input?: string; output?: string }) => readonly ConditionField[];
}) {
  const t = useStore((s) => s.t);
  const lang = useStore((s) => s.settings.language) === "en" ? "en" : "es";
  const tester = useTester();
  const phone = useStill();
  const ins = inputsOf(step);
  const [at, setAt] = useState(ins[0] ?? "main");
  const input = ins.includes(at) ? at : (ins[0] ?? "main");
  const [source, setSource] = useState<string | null>(null);
  const [show, setShow] = useState<RowsShow>("schema");
  const draft = state.draft;
  const nameOf = (id: string) => draft.steps.find((s) => s.id === id)?.name ?? id;
  const before = stepsBefore(draft, step.id);
  const into = draft.arrows.filter((a) => a.to.step === step.id && a.to.input === input);
  const own = state.tests[step.id];
  const ownRows = own && own.state !== "stopped" ? own.in[input] : undefined;

  // What is shown: this step's own input in its last test; or what a step before it gave (the one chosen, else the
  // one the arrow comes from).
  let ask: { step: string; side: "in" | "out"; name: string; total: number; at: number } | null =
    null;
  let fromNames: string[] = into.map((a) => nameOf(a.from.step));
  let fields: readonly ConditionField[] = [];
  /** The step whose rows are shown: a field of them dragged onto a value of this step cites it (AU-21). */
  let from: string | undefined;
  if (source) {
    const t2 = state.tests[source];
    const outOf = outputsOf(draft.steps.find((s) => s.id === source) as Step);
    const onPath = new Set([step.id, ...before]);
    const output =
      draft.arrows.find((a) => a.from.step === source && onPath.has(a.to.step))?.from.output ??
      outOf[0];
    if (t2 && output && t2.state !== "stopped")
      ask = { step: source, side: "out", name: output, total: t2.out[output] ?? 0, at: t2.at };
    fromNames = [nameOf(source)];
    fields = output ? fieldsOf({ step: source, output }) : [];
    from = source;
  } else if (ownRows !== undefined && own) {
    ask = { step: step.id, side: "in", name: input, total: ownRows, at: own.at };
    fields = fieldsOf({ step: step.id, input });
    from = dragFrom(draft, step.id, into);
  } else {
    const a = into.find((x) => {
      const k = state.tests[x.from.step];
      return k && k.state !== "stopped" && k.out[x.from.output] !== undefined;
    });
    const k = a ? state.tests[a.from.step] : undefined;
    if (a && k) {
      ask = {
        step: a.from.step,
        side: "out",
        name: a.from.output,
        total: k.out[a.from.output] ?? 0,
        at: k.at,
      };
      fromNames = [nameOf(a.from.step)];
      fields = fieldsOf({ step: a.from.step, output: a.from.output });
      from = a.from.step;
    }
  }
  const nearest = into[0]?.from.step ?? before[0];
  const head = (
    <>
      <SideTabs
        t={t}
        names={ins.map((id) => ({ id, label: inputName(id) }))}
        counts={own?.in ?? {}}
        at={input}
        set={(id) => {
          setAt(id);
          setSource(null);
        }}
        label={t("auto.view.input")}
      />
      {before.length > 0 && (
        <label className="auto-in-source">
          <span className="sr-only">{t("auto.in.source")}</span>
          <select
            className="input small"
            aria-label={t("auto.in.source")}
            value={source ?? ""}
            onChange={(e) => setSource(e.target.value || null)}
          >
            <option value="">{t("auto.in.here")}</option>
            {before.map((id) => (
              <option key={id} value={id}>
                {nameOf(id)}
              </option>
            ))}
          </select>
        </label>
      )}
    </>
  );
  if (!ask)
    return (
      <div className="auto-in">
        {head}
        <div className="auto-view-empty" data-in="untested">
          <p>{t(phone ? "auto.view.untested" : "auto.view.noInput")}</p>
          {nearest && !phone && (
            <button
              type="button"
              className="btn small"
              data-boni-action="automations.test"
              disabled={state.testing !== null || !tester}
              onClick={() => tester?.run(nearest)}
            >
              {t(DO.testBefore)}
            </button>
          )}
        </div>
      </div>
    );
  return (
    <div className="auto-in">
      {head}
      <div className="auto-out-head">
        <span className="auto-in-from">
          {t("auto.in.from", {
            steps: fromNames.map((n) => `«${n}»`).join(", "),
            rows: rowsWords(t, lang, ask.total),
          })}
        </span>
        {ask.total > 0 && <ShowAs t={t} show={show} set={setShow} writes={false} />}
      </div>
      {ask.total > 0 && tester && (
        <TestRows
          key={`${ask.step}:${ask.side}:${ask.name}:${ask.at}`}
          t={t}
          ask={tester.rows(ask)}
          total={ask.total}
          show={show}
          names={withKeys ? keyedNames(t, fields) : fieldNames(t, fields)}
          choices={choiceNames(fields)}
          from={phone ? undefined : from}
        />
      )}
    </div>
  );
}

/** A field's name with its key beside it, «Precio · precio», where the key is what one writes (AU-25). */
function keyedNames(t: T, fields: readonly ConditionField[]): Record<string, string> {
  const named = fieldNames(t, fields);
  for (const f of fields) if (named[f.key] !== f.key) named[f.key] = `${named[f.key]} · ${f.key}`;
  return named;
}

/** The mark of how a step ended in its last test, on its card (AU-67): its word, and why it failed. */
export function stateMark(
  t: T,
  step: Step,
  test: EditorState["tests"][string] | undefined,
  locale = "es-ES",
  names: SaidNames = {},
): {
  state: "done" | "failed" | "skipped" | "stopped";
  word: string;
  why: string | null;
  stale: boolean;
} | null {
  if (!test) return null;
  const s = test.state;
  if (s !== "done" && s !== "failed" && s !== "skipped" && s !== "stopped") return null;
  const says = s === "failed" ? outputSays(step, test) : null;
  const why = says?.kind === "failed" ? said(t, "failure", says.failure, locale, names) : null;
  return { state: s, word: t(`auto.state.${s}`), why, stale: test.stale };
}
