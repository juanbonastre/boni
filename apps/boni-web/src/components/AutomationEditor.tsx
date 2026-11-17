/**
 * The editor of an automation of the new format, C1 of F14b (docs/automatizaciones.md §5.7, AU-61, AU-62): its
 * header (back, the name edited there, «Guardado» and «⋯» with Duplicar and Eliminar) over the canvas's place. The
 * draft saves itself a moment after each change and on leaving, one request at a time, again after a failure
 * (automations/state.ts says what is owed; automations/client.ts asks the server). «Nueva» opens it with nothing
 * saved: the automation is made by its first step, which the empty canvas asks for («¿Cómo empieza?»). The canvas
 * (AutomationCanvas.tsx, C2) changes the state; the boxes that moved go to the server after the draft, by their own
 * route (AU-05). «Probar» and the step's view come later (docs/automatizaciones.md §8). P1 of F14d adds what the
 * header says of the version that runs, the switch «Encendida», «Publicar» with its screen, «⋯ → Ejecutar» and
 * «⋯ → Ajustes» (AU-95, AU-96, AU-97, AU-194, AU-17; AutomationPublish.tsx).
 */
import { type Automation, type Cell, isTrigger } from "@boni/automations";
import { SYS } from "@boni/views";
import { ArrowLeft, MoreHorizontal } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { automationsClient, isRefused, type PublishView } from "../automations/client.ts";
import { triggerFor } from "../automations/panel.ts";
import {
  PUBLISH_WORDS,
  type Published,
  publishWord,
  refusedWords,
} from "../automations/publishing.ts";
import { runRefusedWords } from "../automations/runWords.ts";
import {
  askTest,
  change,
  created,
  type EditorState,
  emptyEditor,
  openedEditor,
  owedPlaces,
  placesKept,
  publishAsked,
  saved,
  saveFailed,
  tested,
  testLost,
} from "../automations/state.ts";
import { DO, localeOf, said } from "../automations/words.ts";
import { ApiError } from "../core/api.ts";
import { DRAFT_PAUSE_MS, draftRetryMs } from "../core/flowEdit.ts";
import { phoneLayout } from "../host.ts";
import {
  agentApi,
  errorText,
  loadRows,
  showAutomation,
  showFlows,
  toast,
  useStore,
} from "../store.ts";
import { AutomationCanvas } from "./AutomationCanvas.tsx";
import { PublishScreen, RunScreen, SettingsScreen } from "./AutomationPublish.tsx";
import { RunsPane, touchError } from "./AutomationRuns.tsx";
import {
  PhoneContext,
  type Tester,
  TesterContext,
  trialOf,
  triggerFields,
} from "./AutomationTest.tsx";
import { MenuRow, MenuSep, PopButton } from "./Popover.tsx";

const client = automationsClient(agentApi);
/** What each editor left on its way to the server, by automation: opening it again waits for it. */
const pending = new Map<string, Promise<void>>();

/**
 * What runs (AU-95): the switch and the version's number and, to compare the draft with, its document. Unknown when
 * it cannot be read (offline, a server before F14d): the header then says nothing of it.
 */
async function readPublished(id: string): Promise<Published | null> {
  try {
    const v = await client.versions(id);
    if (v.running === null) return { running: null, enabled: v.enabled, doc: null };
    return { running: v.running, enabled: v.enabled, doc: await client.version(id, v.running) };
  } catch {
    return null;
  }
}

/**
 * `id` null: «Nueva»'s empty canvas. `runs`: the tab «Ejecuciones» (AU-99), on one run; its `start`, new each time,
 * runs the published version there once it is known («Ejecutar» in the list's row, AU-97).
 */
export function AutomationPage({
  id,
  runs,
}: {
  id: string | null;
  runs?: { run?: string; start?: number };
}) {
  const t = useStore((s) => s.t);
  const locale = localeOf(useStore((s) => s.settings.language) === "en" ? "en" : "es");
  const [state, setState] = useState<EditorState | null>(() =>
    id === null ? emptyEditor(t("auto.newName")) : null,
  );
  const [error, setError] = useState<string | null>(null);
  /** The version that runs and the switch (AU-95, AU-194): asked when it opens, and kept after each publish. */
  const [published, setPublished] = useState<Published | null>(null);
  /** «Publicar» open: what the server showed and the draft it was asked for. */
  const [publishing, setPublishing] = useState<{ view: PublishView; draft: Automation } | null>(
    null,
  );
  const [running, setRunning] = useState(false);
  /** «Ejecutar»'s box open (AU-97). */
  const [asking, setAsking] = useState(false);
  const latest = useRef(state);
  /** Every change goes through here: the ref first, so what is sent is always the latest. */
  const apply = useCallback((f: (s: EditorState) => EditorState) => {
    if (!latest.current) return;
    latest.current = f(latest.current);
    setState(latest.current);
  }, []);

  const pause = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flight = useRef<Promise<void>>(Promise.resolve());
  const failures = useRef(0);
  const keep = useCallback((): Promise<void> => {
    if (pause.current) clearTimeout(pause.current);
    pause.current = null;
    flight.current = flight.current.then(async () => {
      for (;;) {
        const s = latest.current;
        if (!s) return;
        if (!s.owed.draft) {
          // The boxes, once the server has the steps they belong to (AU-05): never one request per pixel, since a
          // drag is one change when the box is dropped.
          const boxes = s.id ? owedPlaces(s) : [];
          if (!s.id || boxes.length === 0) return;
          try {
            await client.place(s.id, boxes);
            apply((cur) => placesKept(cur, boxes));
            failures.current = 0;
          } catch (e) {
            if (e instanceof ApiError && e.status >= 400 && e.status < 500) {
              // Refused: these boxes stay where they are on the screen and are owed no more.
              apply((cur) => ({ ...cur, owed: { ...cur.owed, places: [] } }));
              return;
            }
            apply(saveFailed);
            pause.current = setTimeout(() => void keep(), draftRetryMs(failures.current++));
            return;
          }
          continue;
        }
        const sent = s.draft;
        try {
          if (s.id === null) {
            // The first step makes it (AU-61); what changed while it was on its way is owed after, and so are
            // the boxes, which the server had nowhere to keep before.
            const made = await client.create(sent);
            latest.current = created(latest.current as EditorState, made, sent);
            setState(latest.current);
            // The address of an automation that exists: Back and a reload find it.
            showAutomation(made.id);
          } else {
            const answer = await client.save(s.id, sent);
            apply((cur) => saved(cur, answer, sent));
          }
          failures.current = 0;
        } catch (e) {
          // What he changed stays on the screen; it is sent again in a moment, longer each time. Refused (a
          // shared device, an automation gone, a draft the server will not take), only with his next change.
          apply(saveFailed);
          if (e instanceof ApiError && e.status >= 400 && e.status < 500) return;
          pause.current = setTimeout(() => void keep(), draftRetryMs(failures.current++));
          return;
        }
      }
    });
    const mine = flight.current;
    const at = latest.current?.id;
    if (at) {
      pending.set(at, mine);
      void mine.then(() => {
        if (pending.get(at) === mine) pending.delete(at);
      });
    }
    return mine;
  }, [apply]);

  // Opened: what the server has, once what was owed of the one shown before and what an earlier editor left of
  // this one have arrived.
  useEffect(() => {
    if (id === null || latest.current?.id === id) return;
    let gone = false;
    setError(null);
    void keep()
      .then(() => {
        if (gone) return;
        latest.current = null;
        setState(null);
        return pending.get(id);
      })
      .then(() => (gone ? null : client.open(id)))
      .then(
        (o) => {
          if (gone || !o) return;
          latest.current = openedEditor(o);
          setState(latest.current);
          setPublished(null);
          void readPublished(o.id).then((p) => !gone && setPublished(p));
        },
        (e) =>
          !gone &&
          setError(e instanceof ApiError && e.status === 404 ? t("flows.gone") : errorText(t, e)),
      );
    return () => {
      gone = true;
    };
  }, [id, t, keep]);

  // A moment after each change.
  const draft = state?.draft;
  const owed = state?.owed.draft ?? false;
  const boxes = state?.owed.places.length ? state.places : null;
  useEffect(() => {
    if (!owed && !boxes) return;
    if (pause.current) clearTimeout(pause.current);
    pause.current = setTimeout(() => void keep(), DRAFT_PAUSE_MS);
  }, [draft, owed, boxes, keep]);
  // Leaving the editor, or the window hidden (closing the app): what is owed is sent now.
  useEffect(() => {
    const hidden = () => {
      if (document.visibilityState === "hidden") void keep();
    };
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("pagehide", hidden);
    return () => {
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("pagehide", hidden);
      void keep();
    };
  }, [keep]);

  /**
   * «Probar» and «Probar paso» (AU-64, AU-90, AU-91): what the draft owes goes first, since the server tests the
   * draft it has; a draft that could not be sent is not tested. One test at a time.
   */
  const tester = useMemo<Tester>(
    () => ({
      run: (step, trigger) => {
        const s = latest.current;
        if (!s || s.testing) return;
        const from = trigger ?? triggerFor(s.draft, step);
        if (!from) return;
        apply((cur) => askTest(cur, step));
        void (async () => {
          await keep();
          const cur = latest.current;
          if (!cur?.id || cur.owed.draft) {
            apply(testLost);
            toast(t("auto.save.failed"));
            return;
          }
          const request = { trigger: from, fields: trialOf(cur, from), ...(step ? { step } : {}) };
          try {
            const answer = await client.test(cur.id, request);
            apply((x) => tested(x, answer, Date.now(), request));
          } catch (e) {
            apply(testLost);
            toast(errorText(t, e));
          }
        })();
      },
      rows: (at) => (offset) => {
        const id = latest.current?.id;
        return id ? client.rows(id, { ...at, offset }) : Promise.resolve({ rows: [], total: 0 });
      },
      sample: (step) => {
        const id = latest.current?.id;
        // With no test yet the server has nothing to give: the preview says nothing (AU-20).
        return id ? client.sample(id, step).catch(() => null) : Promise.resolve(null);
      },
      // Offline or refused, the line keeps what it said: nothing is toasted for a line that is asked on each pause.
      preview: (at) => {
        const id = latest.current?.id;
        return id ? client.preview(id, at).catch(() => null) : Promise.resolve(null);
      },
      // «Fijar» (AU-93): what the server keeps of the draft's pins is what the cards say.
      pin: (step, on) => {
        const id = latest.current?.id;
        if (!id) return;
        void (on ? client.pin(id, step) : client.unpin(id, step)).then(
          (r) => {
            if (isRefused(r)) return toast(runRefusedWords(t, r));
            apply((s) => ({ ...s, pins: r.pins }));
          },
          (e) => toast(touchError(t, e)),
        );
      },
    }),
    [apply, keep, t],
  );

  /** «Duplicar» (AU-62): the copy, named «<nombre> (copia)», opened once what is owed has arrived. */
  const duplicate = async () => {
    const s = latest.current;
    if (!s?.id) return;
    await keep();
    try {
      const copy = await client.duplicate(s.id, t("auto.copyName", { name: s.draft.name }));
      latest.current = openedEditor(copy);
      setState(latest.current);
      showAutomation(copy.id);
    } catch (e) {
      toast(errorText(t, e));
    }
  };
  /** «Eliminar» (AU-62): without asking; its notice brings it back. */
  const remove = async () => {
    const s = latest.current;
    if (!s?.id) return;
    const { id: gone, draft: d } = s;
    await keep();
    try {
      await client.remove(gone);
    } catch (e) {
      toast(errorText(t, e));
      return;
    }
    showFlows();
    void loadRows(SYS.flows.id);
    toast(t("auto.removed", { name: d.name }), {
      label: t(DO.undo),
      boniAction: "automations.restore",
      run: () =>
        void client
          .restore(gone)
          .then(() => loadRows(SYS.flows.id))
          .catch((e) => toast(errorText(t, e))),
    });
  };
  /**
   * «Publicar» (AU-96): what is owed goes first, since the server publishes the draft it has; then the screen with
   * what the server says of it, and every required parameter left empty is marked (AU-83).
   */
  const openPublish = async () => {
    const s = latest.current;
    if (!s?.id) return;
    await keep();
    const cur = latest.current;
    if (!cur?.id || cur.owed.draft) {
      toast(t("auto.save.failed"));
      return;
    }
    try {
      const view = await client.publishView(cur.id);
      apply((x) => publishAsked(x, view.blocks));
      setPublishing({ view, draft: cur.draft });
    } catch (e) {
      toast(touchError(t, e));
    }
  };
  /** «Publicar versión N»: the draft the screen showed, by its `rev`; then its notice with «Ejecutar» (AU-97). */
  const publish = async () => {
    const s = latest.current;
    if (!s?.id || !publishing) return;
    const { view, draft: sent } = publishing;
    setRunning(true);
    try {
      const r = await client.publish(s.id, { rev: view.rev });
      if (isRefused(r)) {
        toast(refusedWords(t, r.refused));
        // Another device changed the draft, or the server found what stops it: the screen is asked again.
        if (r.refused === "stale" || r.refused === "blocked") {
          setPublishing(null);
          void openPublish();
        }
        return;
      }
      setPublishing(null);
      setPublished({ running: r.version, enabled: r.enabled, doc: sent });
      void loadRows(SYS.flows.id);
      toast(t("auto.pub.done", { n: r.version }), {
        label: t(DO.run),
        boniAction: "automations.run",
        run: () => void startRun(),
      });
    } catch (e) {
      toast(touchError(t, e));
    } finally {
      setRunning(false);
    }
  };
  /** The switch (AU-194): on or off, nothing runs on turning it on. */
  const toggle = async (on: boolean) => {
    const s = latest.current;
    if (!s?.id || !published) return;
    try {
      const r = await client.setEnabled(s.id, on);
      if (isRefused(r)) return toast(refusedWords(t, r.refused));
      setPublished((p) => (p ? { ...p, enabled: r.enabled } : p));
      void loadRows(SYS.flows.id);
    } catch (e) {
      toast(touchError(t, e));
    }
  };
  /** The version's document and whether «Ejecutar» runs at once: one trigger asking no field, no unpublished change. */
  const atOnce = (doc: Automation): string | null => {
    const triggers = doc.steps.filter(isTrigger);
    const only = triggers.length === 1 ? triggers[0] : undefined;
    const draft = latest.current?.draft;
    const changes = !!draft && publishWord(draft, published) === "changes";
    return only && !changes && !triggerFields(doc, only.id).length ? only.id : null;
  };
  /**
   * «Ejecutar» (AU-97): the published version, never the draft. Off, it says so with «Encender»; with fields, several
   * triggers or unpublished changes, its box asks first.
   */
  const startRun = async () => {
    const p = publishedRef.current;
    // Until the version's document arrives (a moment after opening) its trigger is not known.
    if (!p || p.running === null || !p.doc) return;
    if (!p.enabled) {
      toast(t("auto.run.off"), {
        label: t(DO.turnOn),
        boniAction: "automations.enable",
        run: () => void toggle(true),
      });
      return;
    }
    const trigger = atOnce(p.doc);
    if (trigger) return run(trigger, {});
    setAsking(true);
  };
  const run = async (trigger: string, fields: Record<string, Cell>) => {
    const s = latest.current;
    if (!s?.id) return;
    setRunning(true);
    try {
      const r = await client.run(s.id, { trigger, fields });
      if (isRefused(r)) {
        if (r.refused === "off")
          toast(t("auto.run.off"), {
            label: t(DO.turnOn),
            boniAction: "automations.enable",
            run: () => void toggle(true),
          });
        else if (r.refused === "invalid" && r.problems?.length)
          toast(said(t, "problem", r.problems[0] as never, locale));
        else toast(refusedWords(t, r.refused));
        return;
      }
      setAsking(false);
      // To «Ejecuciones», where the run is seen advancing (AU-99).
      showAutomation(s.id, { run: r.run.id });
    } catch (e) {
      toast(touchError(t, e));
    } finally {
      setRunning(false);
    }
  };
  const publishedRef = useRef(published);
  publishedRef.current = published;
  // «Ejecutar» of the list's row: once, when what runs is known.
  const started = useRef<number | undefined>(undefined);
  const start = runs?.start;
  const known = !!published?.doc;
  useEffect(() => {
    if (!start || !known || started.current === start) return;
    started.current = start;
    void startRun();
  });
  const tab = runs && state?.id ? "runs" : "editor";
  // On the phone it is looked at and tested, never changed (AU-74); another layout mounts another app.
  const phone = phoneLayout();
  return (
    <div className="content page-doc full auto-page" data-boni-action="automations.read">
      <div className="doc">
        <Header
          state={state}
          phone={phone}
          published={published}
          onName={(name) => apply((s) => change(s, { draft: { ...s.draft, name } }))}
          onRetry={() => void keep()}
          onDuplicate={() => void duplicate()}
          onRemove={() => void remove()}
          onPublish={() => void openPublish()}
          onToggle={(on) => void toggle(on)}
          onRun={() => void startRun()}
          onSettings={() => apply((s) => ({ ...s, ajustes: { limit: null } }))}
          tab={id ? tab : null}
        />
        {error ? (
          <p className="form-error">{error}</p>
        ) : !state ? (
          <div className="page-loading" role="status" aria-busy="true" />
        ) : tab === "runs" && state.id ? (
          <RunsPane
            id={state.id}
            run={runs?.run}
            places={state.places}
            names={(step) => state.draft.steps.find((x) => x.id === step)?.name}
            onEditor={(f) => {
              apply(f);
              showAutomation(state.id);
            }}
          />
        ) : (
          <section className="auto-canvas" aria-label={state.draft.name}>
            <PhoneContext.Provider value={phone}>
              <TesterContext.Provider value={tester}>
                <AutomationCanvas state={state} apply={apply} />
              </TesterContext.Provider>
            </PhoneContext.Provider>
          </section>
        )}
        {state && publishing && (
          <PublishScreen
            view={publishing.view}
            draft={state.draft}
            was={published?.doc ?? null}
            busy={running}
            onClose={() => setPublishing(null)}
            onPublish={() => void publish()}
            onStep={(step) => {
              setPublishing(null);
              apply((s) => ({ ...s, selected: [step], arrow: null, open: step }));
            }}
          />
        )}
        {state?.ajustes && !phone && <SettingsScreen state={state} apply={apply} />}
        {state && asking && published?.doc && published.running !== null && (
          <RunScreen
            doc={published.doc}
            version={published.running}
            changes={publishWord(state.draft, published) === "changes"}
            busy={running}
            onClose={() => setAsking(false)}
            onRun={(trigger, fields) => void run(trigger, fields)}
          />
        )}
      </div>
    </div>
  );
}

const SAVE_WORDS = {
  saving: "auto.save.saving",
  saved: "auto.save.saved",
  failed: "auto.save.failed",
} as const;

/**
 * Back, the name, «Guardado» with what runs (AU-62, AU-95), the switch once published (AU-194), «Publicar» and «⋯»
 * with «Ejecutar» (published), «Ajustes», Duplicar and Eliminar. On the phone, the name, the switch and «Ejecutar»:
 * there it is looked at, tested, run and turned off or on, never edited nor published (AU-74, decision 15).
 */
function Header({
  state,
  phone,
  published,
  onName,
  onRetry,
  onDuplicate,
  onRemove,
  onPublish,
  onToggle,
  onRun,
  onSettings,
  tab,
}: {
  state: EditorState | null;
  phone: boolean;
  published: Published | null;
  onName: (name: string) => void;
  onRetry: () => void;
  onDuplicate: () => void;
  onRemove: () => void;
  onPublish: () => void;
  onToggle: (on: boolean) => void;
  onRun: () => void;
  onSettings: () => void;
  /** «Editor | Ejecuciones» (pantalla 8): null on «Nueva»'s empty canvas, which has no runs. */
  tab: "editor" | "runs" | null;
}) {
  const t = useStore((s) => s.t);
  const name = state?.draft.name ?? "";
  // The text in the box: a name is never empty, so an empty box changes nothing and goes back on leaving it.
  const [text, setText] = useState(name);
  const editing = useRef(false);
  useEffect(() => {
    if (!editing.current) setText(name);
  }, [name]);
  const save = state?.save ?? "saved";
  const exists = !!state?.id;
  const words = t(SAVE_WORDS[save]);
  const pub = state && exists ? publishWord(state.draft, published) : null;
  const isPublished = published !== null && published.running !== null;
  return (
    <header className={phone ? "auto-head phone" : "auto-head"}>
      {/* On the phone its own bar goes back. */}
      {!phone && (
        <button
          type="button"
          className="icon-btn"
          aria-label={t("auto.back")}
          title={t("auto.back")}
          onClick={showFlows}
        >
          <ArrowLeft size={16} strokeWidth={1.8} />
        </button>
      )}
      {phone ? (
        <h1 className="auto-name look" title={name}>
          {name}
        </h1>
      ) : (
        <input
          className="auto-name"
          aria-label={t("auto.name")}
          data-boni-action="automations.edit"
          value={text}
          disabled={!state}
          onFocus={() => {
            editing.current = true;
          }}
          onChange={(e) => {
            setText(e.target.value);
            if (e.target.value.trim()) onName(e.target.value);
          }}
          onBlur={() => {
            editing.current = false;
            setText(name);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === "Escape") e.currentTarget.blur();
          }}
        />
      )}
      {state && !phone && (exists || state.owed.draft) && (
        <span className={`auto-saved ${save}`} role="status">
          {words}
          {save === "failed" && (
            <>
              {" · "}
              <button
                type="button"
                className="link-btn"
                data-boni-action="automations.edit"
                onClick={onRetry}
              >
                {t(DO.retrySave)}
              </button>
            </>
          )}
        </span>
      )}
      {pub && !phone && (
        <span className={`auto-published ${pub}`}>
          {`· ${t(PUBLISH_WORDS[pub], { n: published?.running ?? 0 })}`}
        </span>
      )}
      <span className="spacer" />
      {tab && state?.id && (
        <div className="segmented auto-tabs" role="tablist" aria-label={t("auto.tab.label")}>
          {(["editor", "runs"] as const).map((x) => (
            <button
              key={x}
              type="button"
              role="tab"
              aria-selected={tab === x}
              className={tab === x ? "on" : undefined}
              onClick={() => {
                if (tab !== x && state.id) showAutomation(state.id, x === "runs" ? {} : undefined);
              }}
            >
              {t(`auto.tab.${x}`)}
            </button>
          ))}
        </div>
      )}
      {/* The switch is on the phone too (decision 15): turning it off or on changes no document. */}
      {exists && isPublished && (
        <label className="toggle-row auto-switch">
          <input
            type="checkbox"
            className="switch"
            data-boni-action="automations.enable"
            checked={published.enabled}
            aria-label={published.enabled ? t("flows.enabled") : t("flows.disabled")}
            onChange={(e) => onToggle(e.target.checked)}
          />
          <span>{published.enabled ? t("flows.enabled") : t("flows.disabled")}</span>
        </label>
      )}
      {/* AU-74: the phone looks, tests and, once published, runs and turns it off or on; it neither edits nor publishes. */}
      {exists && phone && isPublished && (
        <button
          type="button"
          className="btn small auto-run-phone"
          data-boni-action="automations.run"
          onClick={onRun}
        >
          {t(DO.run)}
        </button>
      )}
      {exists && !phone && (
        <button
          type="button"
          className="btn primary small auto-publish"
          data-boni-action="automations.publish"
          onClick={onPublish}
        >
          {t(DO.publish)}
        </button>
      )}
      {exists && !phone && (
        <PopButton label={<MoreHorizontal size={16} strokeWidth={1.8} />} title={t("auto.more")}>
          {(close) => (
            <>
              {isPublished && (
                <MenuRow
                  label={t(DO.run)}
                  boniAction="automations.run"
                  onClick={() => {
                    close();
                    onRun();
                  }}
                />
              )}
              <MenuRow
                label={t("auto.view.settings")}
                boniAction="automations.edit"
                onClick={() => {
                  close();
                  onSettings();
                }}
              />
              <MenuSep />
              <MenuRow
                label={t(DO.duplicate)}
                boniAction="automations.duplicate"
                onClick={() => {
                  close();
                  onDuplicate();
                }}
              />
              <MenuRow
                label={t(DO.remove)}
                danger
                boniAction="automations.delete"
                onClick={() => {
                  close();
                  onRemove();
                }}
              />
            </>
          )}
        </PopButton>
      )}
    </header>
  );
}
