/**
 * The editor of an automation of the new format, C1 of F14b (docs/automatizaciones.md §5.7, AU-61, AU-62): its
 * header (back, the name edited there, «Guardado» and «⋯» with Duplicar and Eliminar) over the canvas's place. The
 * draft saves itself a moment after each change and on leaving, one request at a time, again after a failure
 * (automations/state.ts says what is owed; automations/client.ts asks the server). «Nueva» opens it with nothing
 * saved: the automation is made by its first step, which the empty canvas asks for («¿Cómo empieza?»). The canvas
 * itself, its steps and «Probar» are C2's and after (docs/automatizaciones.md §8).
 */
import { CATALOGUE } from "@boni/automations";
import { SYS } from "@boni/views";
import { ArrowLeft, MoreHorizontal } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { automationsClient } from "../automations/client.ts";
import {
  change,
  type EditorState,
  emptyEditor,
  openedEditor,
  saved,
  saveFailed,
} from "../automations/state.ts";
import { DO, KEY } from "../automations/words.ts";
import { ApiError } from "../core/api.ts";
import { DRAFT_PAUSE_MS, draftRetryMs } from "../core/flowEdit.ts";
import {
  agentApi,
  errorText,
  loadRows,
  showAutomation,
  showFlows,
  toast,
  useStore,
} from "../store.ts";
import { MenuRow, PopButton } from "./Popover.tsx";

const client = automationsClient(agentApi);
/** What each editor left on its way to the server, by automation: opening it again waits for it. */
const pending = new Map<string, Promise<void>>();
const TRIGGERS = CATALOGUE.filter((s) => s.category === "trigger");
const newStepId = () => `s_${Math.random().toString(36).slice(2, 10)}`;

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
        if (!s?.owed.draft) return;
        const sent = s.draft;
        try {
          if (s.id === null) {
            // The first step makes it (AU-61); what changed while it was on its way is owed after.
            const made = await client.create(sent);
            const was = latest.current as EditorState;
            const opened = openedEditor(made);
            latest.current =
              was.draft === sent
                ? opened
                : change(opened, { draft: { ...was.draft, id: made.id } });
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
  useEffect(() => {
    if (!owed) return;
    if (pause.current) clearTimeout(pause.current);
    pause.current = setTimeout(() => void keep(), DRAFT_PAUSE_MS);
  }, [draft, owed, keep]);
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
  /** The first step of an empty canvas: a trigger (AU-61). */
  const start = (type: string) =>
    apply((s) =>
      change(s, {
        draft: {
          ...s.draft,
          steps: [{ id: newStepId(), name: t(KEY.step(type)), type, params: {} }],
        },
      }),
    );

  return (
    <div className="content page-doc full auto-page" data-boni-action="automations.read">
      <div className="doc">
        <Header
          state={state}
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
            {state.draft.steps.length === 0 && (
              <div className="auto-start">
                <h2>{t("auto.start")}</h2>
                <ul>
                  {TRIGGERS.map((s) => (
                    <li key={s.type}>
                      <button
                        type="button"
                        className="auto-start-row"
                        data-boni-action="automations.create"
                        onClick={() => start(s.type)}
                      >
                        {t(KEY.step(s.type))}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
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

/** Back, the name, «Guardado» and «⋯»: nothing else of its own (AU-62). */
function Header({
  state,
  onName,
  onRetry,
  onDuplicate,
  onRemove,
}: {
  state: EditorState | null;
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
      <button
        type="button"
        className="icon-btn"
        aria-label={t("auto.back")}
        title={t("auto.back")}
        onClick={showFlows}
      >
        <ArrowLeft size={16} strokeWidth={1.8} />
      </button>
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
      {state && (exists || state.owed.draft) && (
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
      {exists && (
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
