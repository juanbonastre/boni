/**
 * The editor of an automation of the new format, C1 of F14b (docs/automatizaciones.md §5.7, AU-61, AU-62): its
 * header (back, the name edited there, «Guardado» and «⋯» with Duplicar and Eliminar) over the canvas's place. The
 * draft saves itself a moment after each change and on leaving, one request at a time, again after a failure
 * (automations/state.ts says what is owed; automations/client.ts asks the server). «Nueva» opens it with nothing
 * saved: the automation is made by its first step, which the empty canvas asks for («¿Cómo empieza?»). The canvas
 * (AutomationCanvas.tsx, C2) changes the state; the boxes that moved go to the server after the draft, by their own
 * route (AU-05). «Probar» and the step's view come later (docs/automatizaciones.md §8).
 */
import { SYS } from "@boni/views";
import { ArrowLeft, MoreHorizontal } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { automationsClient } from "../automations/client.ts";
import { triggerFor } from "../automations/panel.ts";
import {
  askTest,
  change,
  created,
  type EditorState,
  emptyEditor,
  openedEditor,
  owedPlaces,
  placesKept,
  saved,
  saveFailed,
  tested,
  testLost,
} from "../automations/state.ts";
import { DO } from "../automations/words.ts";
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
import { PhoneContext, type Tester, TesterContext, trialOf } from "./AutomationTest.tsx";
import { MenuRow, PopButton } from "./Popover.tsx";

const client = automationsClient(agentApi);
/** What each editor left on its way to the server, by automation: opening it again waits for it. */
const pending = new Map<string, Promise<void>>();

/** `id` null: «Nueva»'s empty canvas. */
export function AutomationPage({ id }: { id: string | null }) {
  const t = useStore((s) => s.t);
  const [state, setState] = useState<EditorState | null>(() =>
    id === null ? emptyEditor(t("auto.newName")) : null,
  );
  const [error, setError] = useState<string | null>(null);
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
  // On the phone it is looked at and tested, never changed (AU-74); another layout mounts another app.
  const phone = phoneLayout();
  return (
    <div className="content page-doc full auto-page" data-boni-action="automations.read">
      <div className="doc">
        <Header
          state={state}
          phone={phone}
          onName={(name) => apply((s) => change(s, { draft: { ...s.draft, name } }))}
          onRetry={() => void keep()}
          onDuplicate={() => void duplicate()}
          onRemove={() => void remove()}
        />
        {error ? (
          <p className="form-error">{error}</p>
        ) : !state ? (
          <div className="page-loading" role="status" aria-busy="true" />
        ) : (
          <section className="auto-canvas" aria-label={state.draft.name}>
            <PhoneContext.Provider value={phone}>
              <TesterContext.Provider value={tester}>
                <AutomationCanvas state={state} apply={apply} />
              </TesterContext.Provider>
            </PhoneContext.Provider>
          </section>
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

/** Back, the name, «Guardado» and «⋯»: nothing else of its own (AU-62). On the phone, back and the name alone. */
function Header({
  state,
  phone,
  onName,
  onRetry,
  onDuplicate,
  onRemove,
}: {
  state: EditorState | null;
  phone: boolean;
  onName: (name: string) => void;
  onRetry: () => void;
  onDuplicate: () => void;
  onRemove: () => void;
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
  return (
    <header className="auto-head">
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
      <span className="spacer" />
      {exists && !phone && (
        <PopButton label={<MoreHorizontal size={16} strokeWidth={1.8} />} title={t("auto.more")}>
          {(close) => (
            <>
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
