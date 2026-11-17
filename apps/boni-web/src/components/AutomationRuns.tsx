/**
 * «Ejecuciones», P2 of F14d (docs/automatizaciones.md §5.8, pantalla 8: AU-99, AU-18, AU-100, AU-101, AU-93, AU-103,
 * AU-190): the automation's runs, fifty at a time with «Todas», «Fallos» and «Pruebas», and one run on its canvas,
 * looked at and never changed, each step with what it gave. Its bar says when, how it ended, who started it with
 * which version and what it did in one line; «Reintentar», «Deshacer lo que hizo», «Abrir en el editor con estos
 * datos» and, stopped at a limit, «Cambiar el límite». The words are automations/runWords.ts's; the canvas is the
 * editor's own over the run made into a state (automations/runs.ts). A run advancing is followed by the server's
 * `run` events on the desktop; elsewhere by asking again on opening, on coming back to the window, after each touch
 * and, only while the run shown is under way and the window is seen, every few seconds. Nothing asks rows but the
 * step's view, a page at a time; every name and value is painted as plain text (A-01).
 */
import { ArrowLeft } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  automationsClient,
  isRefused,
  type RunSummary,
  type RunsFilter,
  type RunView,
} from "../automations/client.ts";
import { stoppedByLimit } from "../automations/publishing.ts";
import { mergeRuns, runEditor, treeLines } from "../automations/runs.ts";
import {
  bad,
  didWords,
  ended,
  failureWords,
  fullWhen,
  howWords,
  runRefusedWords,
  whenWords,
  whoWords,
} from "../automations/runWords.ts";
import type { EditorState } from "../automations/state.ts";
import { DO } from "../automations/words.ts";
import { ApiError } from "../core/api.ts";
import { deviceZone } from "../core/clock.ts";
import { host, phoneLayout } from "../host.ts";
import type { T } from "../i18n.ts";
import { agentApi, errorText, showAutomation, toast, useStore } from "../store.ts";
import { AutomationCanvas, useCollectionNames } from "./AutomationCanvas.tsx";
import { Modal } from "./AutomationPublish.tsx";
import {
  LookContext,
  PhoneContext,
  type Tester,
  TesterContext,
  TreeButton,
  useNow,
} from "./AutomationTest.tsx";

const client = automationsClient(agentApi);

/** While the run shown is under way, with no events to follow it (the browser, the phone): asked again this often. */
const UNDER_WAY_MS = 2_500;
/** Events that come together (each step of a run) are one request. */
const SETTLE_MS = 250;

/** What a refused touch says: its own words, and a shared device's 403 in the words the app has for it. */
export function touchError(t: T, e: unknown) {
  if (e instanceof ApiError && e.code === "personal-device-only")
    return t("mail.error.personal-device-only");
  return errorText(t, e);
}

/** A function that runs `f` once, a moment after the last of its calls. */
function useSettled(f: () => void, ms: number) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(f);
  latest.current = f;
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => latest.current(), ms);
  }, [ms]);
}

/** Calls `f` when this automation's runs change (the desktop's events) and when the window is seen again. */
function useRunEvents(automation: string, f: (run: string) => void) {
  const latest = useRef(f);
  latest.current = f;
  useEffect(() => {
    const off = host.onEvent((e) => {
      if (e.type === "run" && e.automation === automation) latest.current(e.run);
    });
    const seen = () => {
      if (document.visibilityState === "visible") latest.current("");
    };
    document.addEventListener("visibilitychange", seen);
    return () => {
      off();
      document.removeEventListener("visibilitychange", seen);
    };
  }, [automation]);
}

const FILTERS: RunsFilter[] = ["all", "failed", "tests"];
const NONE = {
  all: "auto.runs.none",
  failed: "auto.runs.noneFailed",
  tests: "auto.runs.noneTests",
};

/**
 * The tab «Ejecuciones» (pantalla 8): on the left the list, on the right the run chosen (the newest when none is).
 * On the phone the list first, then the run with «Todas las ejecuciones» to go back. `names`: the steps as the
 * draft names them, for the list's lines (a step it no longer has is left unsaid). `onEditor`: back to the editor's
 * tab with what to change in its state.
 */
export function RunsPane({
  id,
  run,
  places,
  names,
  onEditor,
}: {
  id: string;
  run: string | undefined;
  places: EditorState["places"];
  names: (step: string) => string | undefined;
  onEditor: (f: (s: EditorState) => EditorState) => void;
}) {
  const t = useStore((s) => s.t);
  const lang = useStore((s) => s.settings.language) === "en" ? "en" : "es";
  const phone = phoneLayout();
  const now = useNow();
  const zone = useMemo(deviceZone, []);
  const [filter, setFilter] = useState<RunsFilter>("all");
  const [list, setList] = useState<RunSummary[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The list as it is now, for asking its first page again without losing the older ones. */
  const shown = useRef<{ list: RunSummary[]; next: string | null; pages: number }>({
    list: [],
    next: null,
    pages: 0,
  });
  const asked = useRef(0);

  const first = useCallback(async () => {
    const mine = ++asked.current;
    try {
      const page = await client.runs(id, { filter });
      if (mine !== asked.current) return;
      const was = shown.current;
      const kept = was.pages > 1 ? mergeRuns(page.runs, was.list) : page.runs;
      shown.current = {
        list: kept,
        next: was.pages > 1 ? was.next : page.next,
        pages: Math.max(1, was.pages),
      };
      setList(kept);
      setNext(shown.current.next);
      setError(null);
    } catch (e) {
      if (mine === asked.current) setError(touchError(t, e));
    }
  }, [id, filter, t]);

  // Another filter is another list, from its first page.
  useEffect(() => {
    shown.current = { list: [], next: null, pages: 0 };
    setList(null);
    void first();
  }, [first]);
  const again = useSettled(() => void first(), SETTLE_MS);
  useRunEvents(id, again);

  /** «Ver más»: the fifty before the last one shown. */
  const older = async () => {
    const before = shown.current.next;
    if (!before) return;
    setMore(true);
    try {
      const page = await client.runs(id, { filter, before });
      const ids = new Set(shown.current.list.map((r) => r.id));
      const kept = [...shown.current.list, ...page.runs.filter((r) => !ids.has(r.id))];
      shown.current = { list: kept, next: page.next, pages: shown.current.pages + 1 };
      setList(kept);
      setNext(page.next);
    } catch (e) {
      toast(touchError(t, e));
    } finally {
      setMore(false);
    }
  };

  const chosen = run ?? (phone ? undefined : list?.[0]?.id);
  const choose = (r: string | undefined) => showAutomation(id, r ? { run: r } : {});

  const side = (
    <aside className="auto-runs-list" aria-label={t("auto.tab.runs")}>
      <div
        className="segmented auto-runs-filter"
        role="radiogroup"
        aria-label={t("auto.runs.filter")}
      >
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            role="radio"
            aria-checked={filter === f}
            className={filter === f ? "on" : undefined}
            onClick={() => setFilter(f)}
          >
            {t(`auto.runs.${f}`)}
          </button>
        ))}
      </div>
      {error ? (
        <p className="form-error">{error}</p>
      ) : list === null ? (
        <div className="page-loading" role="status" aria-busy="true" />
      ) : list.length === 0 ? (
        <p className="muted auto-runs-none">{t(NONE[filter])}</p>
      ) : (
        <ul className="auto-runs-items">
          {list.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                className={`auto-runs-item${r.id === chosen ? " on" : ""}`}
                aria-current={r.id === chosen ? "true" : undefined}
                onClick={() => choose(r.id)}
              >
                <span className="auto-runs-when">
                  {whenWords(t, lang, zone, r.started ?? r.at, now)}
                </span>
                <span className={`auto-runs-how${bad(r) ? " bad" : ""}${ended(r) ? "" : " live"}`}>
                  {howWords(t, lang, r, names)}
                </span>
                <span className="auto-runs-who">{whoWords(t, r)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {next && list?.length ? (
        <button
          type="button"
          className="btn small auto-runs-more"
          disabled={more}
          onClick={() => void older()}
        >
          {t(DO.moreRuns)}
        </button>
      ) : null}
    </aside>
  );

  if (phone && !chosen) return <div className="auto-runs phone">{side}</div>;
  return (
    <div className={`auto-runs${phone ? " phone" : ""}`}>
      {!phone && side}
      {chosen ? (
        <RunDetail
          key={chosen}
          id={id}
          runId={chosen}
          places={places}
          onBack={phone ? () => choose(undefined) : null}
          onChanged={again}
          onEditor={onEditor}
        />
      ) : (
        <p className="muted auto-runs-choose">
          {t(list?.length ? "auto.runs.choose" : NONE[filter])}
        </p>
      )}
    </div>
  );
}

/**
 * One run (pantalla 8's right side): its bar and its canvas. `onChanged`: the list is asked again (it retried or
 * undid). `onBack`: the phone's way back to the list.
 */
function RunDetail({
  id,
  runId,
  places,
  onBack,
  onChanged,
  onEditor,
}: {
  id: string;
  runId: string;
  places: EditorState["places"];
  onBack: (() => void) | null;
  onChanged: () => void;
  onEditor: (f: (s: EditorState) => EditorState) => void;
}) {
  const t = useStore((s) => s.t);
  const lang = useStore((s) => s.settings.language) === "en" ? "en" : "es";
  const phone = phoneLayout();
  const now = useNow();
  const zone = useMemo(deviceZone, []);
  const collections = useCollectionNames();
  const collectionName = (key: string) => collections[key] ?? t("auto.run.did.gone");
  const [view, setView] = useState<RunView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [retrying, setRetrying] = useState(false);
  /** The run's canvas, with what is selected and open there; rebuilt as the run advances, keeping both. */
  const [look, setLook] = useState<EditorState | null>(null);

  /** The run shown was under way when last asked: once it has ended, the list is asked again with it. */
  const wasUnderWay = useRef(false);
  const load = useCallback(async () => {
    try {
      const v = await client.runView(id, runId);
      if (wasUnderWay.current && ended(v.run)) onChanged();
      wasUnderWay.current = !ended(v.run);
      setView(v);
      setError(null);
      setLook((was) => {
        const made = runEditor(v, places);
        if (!made || !was) return made;
        return { ...made, selected: was.selected, open: was.open };
      });
    } catch (e) {
      setError(e instanceof ApiError && e.status === 404 ? t("flows.gone") : touchError(t, e));
    }
  }, [id, runId, places, t, onChanged]);
  useEffect(() => {
    void load();
  }, [load]);
  const again = useSettled(() => void load(), SETTLE_MS);
  useRunEvents(id, (run) => {
    if (!run || run === runId) again();
  });
  // With no events to follow it, a run under way is asked again while it is seen; never once it has ended.
  const underWay = !!view && !ended(view.run);
  useEffect(() => {
    if (!underWay || host.desktop) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, UNDER_WAY_MS);
    return () => clearInterval(timer);
  }, [underWay, load]);

  const apply = useCallback((f: (s: EditorState) => EditorState) => {
    setLook((s) => (s ? f(s) : s));
  }, []);
  const tester = useMemo<Tester>(
    () => ({
      run: () => {},
      rows: (at) => (offset) => client.runRows(id, runId, { ...at, offset }),
      sample: () => Promise.resolve(null),
      preview: () => Promise.resolve(null),
    }),
    [id, runId],
  );

  if (error) return <p className="form-error auto-run-detail">{error}</p>;
  if (!view) return <div className="page-loading auto-run-detail" role="status" aria-busy="true" />;
  const r = view.run;
  const doc = view.automation;
  const stepName = (step: string) => doc?.steps.find((s) => s.id === step)?.name;
  const did = didWords(t, lang, r, (key) => collections[key]);
  const why = failureWords(t, lang, r);
  const limit = look && r.state === "failed" ? stoppedByLimit(look) : null;
  const hasSteps = Object.keys(view.steps).length > 0;
  const canRetry = !r.test && ended(r) && r.state !== "missed";
  const canPin = !phone && !!doc && view.trigger in view.steps && ended(r);

  /** «Reintentar» (AU-100): at once when it runs the same version and wrote nothing; else its box says why first. */
  const retry = async (undo: boolean) => {
    setBusy(true);
    try {
      const answer = await client.retry(id, runId, undo);
      if (isRefused(answer)) return toast(runRefusedWords(t, answer));
      setRetrying(false);
      onChanged();
      showAutomation(id, { run: answer.run.id });
    } catch (e) {
      toast(touchError(t, e));
    } finally {
      setBusy(false);
    }
  };
  const askRetry = () => {
    const otherVersion = view.published !== null && view.published !== r.version;
    if (otherVersion || view.wrote) setRetrying(true);
    else void retry(false);
  };
  /** «Deshacer lo que hizo» (AU-18): all of it or nothing; a later run that stands refuses it (`changed`). */
  const undo = async () => {
    setBusy(true);
    try {
      const answer = await client.undoRun(id, runId);
      if (isRefused(answer)) return toast(runRefusedWords(t, answer));
      toast(t("auto.undo.done"));
      void load();
      onChanged();
    } catch (e) {
      toast(touchError(t, e));
    } finally {
      setBusy(false);
    }
  };
  /** «Abrir en el editor con estos datos» (AU-100, AU-93): the trigger's output of this run, pinned on the draft. */
  const openWithData = async () => {
    setBusy(true);
    try {
      const answer = await client.pinFromRun(id, runId);
      if (isRefused(answer)) return toast(runRefusedWords(t, answer));
      const step = answer.trigger;
      onEditor((s) => ({ ...s, pins: answer.pins, selected: [step], arrow: null, open: step }));
      toast(t("auto.pin.fromRun", { step: stepName(step) ?? "" }));
    } catch (e) {
      toast(touchError(t, e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="auto-run-detail" aria-label={fullWhen(lang, zone, r.started ?? r.at)}>
      <div className="auto-run-bar">
        {onBack && (
          <button type="button" className="btn small auto-runs-back" onClick={onBack}>
            <ArrowLeft size={14} strokeWidth={1.8} aria-hidden />
            <span>{t("auto.runs.back")}</span>
          </button>
        )}
        <div className="auto-run-what">
          <strong className="auto-run-when">{fullWhen(lang, zone, r.started ?? r.at)}</strong>
          <span className="auto-run-line">
            <span className={bad(r) ? "bad" : undefined}>{howWords(t, lang, r, stepName)}</span>
            {` · ${whoWords(t, r)}`}
            {did ? ` · ${did}` : ""}
          </span>
          {why && <span className="auto-run-why">{why}</span>}
          {r.undone !== null && (
            <span className="auto-run-undone">
              {t("auto.run.undone", { when: whenWords(t, lang, zone, r.undone, now) })}
            </span>
          )}
        </div>
        <div className="auto-run-do">
          {doc && hasSteps && (
            <TreeButton
              lines={treeLines(doc, view.steps)}
              collectionName={collectionName}
              onStep={(step) => apply((s) => ({ ...s, selected: [step], arrow: null }))}
            />
          )}
          {view.undoable && (
            <button
              type="button"
              className="btn small"
              data-boni-action="automations.undo_run"
              disabled={busy}
              onClick={() => void undo()}
            >
              {t(DO.undoRun)}
            </button>
          )}
          {canRetry && (
            <button
              type="button"
              className="btn small"
              data-boni-action="automations.run"
              disabled={busy}
              onClick={askRetry}
            >
              {t(DO.retrySave)}
            </button>
          )}
          {limit && !phone && (
            <button
              type="button"
              className="btn small"
              data-boni-action="automations.edit"
              onClick={() => onEditor((s) => ({ ...s, ajustes: { limit } }))}
            >
              {t(DO.changeLimit)}
            </button>
          )}
          {canPin && (
            <button
              type="button"
              className="btn small"
              data-boni-action="automations.pin"
              disabled={busy}
              onClick={() => void openWithData()}
            >
              {t(DO.openWithData)}
            </button>
          )}
        </div>
      </div>
      {r.state === "missed" ? null : !hasSteps ? (
        <p className="muted auto-run-only">
          {t(ended(r) ? "auto.run.summaryOnly" : "auto.run.waiting")}
        </p>
      ) : look ? (
        <section className="auto-canvas auto-run-canvas" aria-label={look.draft.name}>
          <PhoneContext.Provider value={phone}>
            <LookContext.Provider value={true}>
              <TesterContext.Provider value={tester}>
                <AutomationCanvas state={look} apply={apply} />
              </TesterContext.Provider>
            </LookContext.Provider>
          </PhoneContext.Provider>
        </section>
      ) : (
        <p className="muted auto-run-only">{t("auto.run.summaryOnly")}</p>
      )}
      {retrying && (
        <RetryBox
          view={view}
          name={doc?.name ?? ""}
          did={did}
          busy={busy}
          onClose={() => setRetrying(false)}
          onRetry={(u) => void retry(u)}
        />
      )}
    </section>
  );
}

/**
 * «Reintentar»'s box (AU-100), when there is something to know first: it runs the version that runs now, not the
 * one that ran; and what that run saved would be saved again unless it is undone first («Deshacer y reintentar»).
 */
function RetryBox({
  view,
  name,
  did,
  busy,
  onClose,
  onRetry,
}: {
  view: RunView;
  name: string;
  did: string | null;
  busy: boolean;
  onClose: () => void;
  onRetry: (undo: boolean) => void;
}) {
  const t = useStore((s) => s.t);
  const r = view.run;
  const otherVersion = view.published !== null && view.published !== r.version;
  const title = t("auto.retry.title", { name });
  return (
    <Modal label={title} title={title} onClose={onClose}>
      <div className="modal-body auto-retry">
        <p>
          {otherVersion
            ? t("auto.retry.version", { now: view.published ?? 0, was: r.version ?? 0 })
            : t("auto.retry.same")}
        </p>
        {view.wrote && did && <p>{t("auto.retry.wrote", { what: did })}</p>}
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            {t("flows.cancel")}
          </button>
          {view.undoable && (
            <button
              type="button"
              className="btn primary"
              data-boni-action="automations.undo_run"
              disabled={busy}
              onClick={() => onRetry(true)}
            >
              {t(DO.undoRetry)}
            </button>
          )}
          <button
            type="button"
            className={view.undoable ? "btn" : "btn primary"}
            data-boni-action="automations.run"
            disabled={busy}
            onClick={() => onRetry(false)}
          >
            {t(DO.retrySave)}
          </button>
        </div>
      </div>
    </Modal>
  );
}
