import { Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { OfflineError } from "../core/api.ts";
import { normalize } from "../core/chartBuilder.ts";
import type { ChartSpec, Screen } from "../core/contract.ts";
import {
  closePanel,
  deleteChart,
  errorText,
  loadCatalog,
  markPanelEdited,
  optionList,
  preview,
  saveChart,
  setEditDraft,
  setEditPreview,
  submit,
  toast,
  todayIso,
  useStore,
} from "../store.ts";
import { EditorForm } from "./editorFields.tsx";
import { FormView } from "./FormView.tsx";

/**
 * The right side panel (Boni Calendar's side panel): what is being captured or edited, next to the charts, which
 * stay in view. Esc or the close button closes it.
 */
export function SidePanel() {
  const t = useStore((s) => s.t);
  const panel = useStore((s) => s.panel);
  const screens = useStore((s) => s.screens);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const st = useStore.getState();
      // Esc closes the panel when it is the top thing (the settings modal goes first)
      if (e.key === "Escape" && !e.defaultPrevented && st.panel && !st.settingsOpen) {
        e.preventDefault();
        closePanel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!panel) return null;
  const screen = panel.kind === "screen" ? screens[panel.id] : null;
  const title =
    panel.kind === "edit"
      ? panel.isNew
        ? t("charts.newTitle")
        : t("charts.editTitle")
      : (screen?.title ?? t("chart.loading"));
  return (
    <aside className="side-panel" aria-label={title}>
      <div className="panel-head">
        <h2>{title}</h2>
        <button
          type="button"
          className="icon-btn"
          onClick={closePanel}
          title={t("settings.close")}
          aria-label={t("settings.close")}
        >
          <X size={16} strokeWidth={1.8} />
        </button>
      </div>
      {panel.kind === "edit" ? (
        <EditorPanel key={panel.spec.id || "new"} initial={panel.spec} isNew={panel.isNew} />
      ) : screen ? (
        <ScreenPanel screen={screen} />
      ) : (
        <p className="muted panel-body">{t("chart.loading")}</p>
      )}
    </aside>
  );
}

/** A server screen in the panel: its form (the capture). */
function ScreenPanel({ screen }: { screen: Screen }) {
  const t = useStore((s) => s.t);
  return (
    <div className="panel-body">
      {screen.components.map((c, i) => {
        if (c.type === "form") {
          return (
            <FormView
              key={c.id}
              form={c}
              today={todayIso()}
              loadOptions={optionList}
              onSubmit={async (values) => {
                const r = await submit(c, values);
                if (r.kind === "done" || r.kind === "queued") {
                  toast(r.message);
                  closePanel();
                  return {};
                }
                if (r.kind === "invalid") {
                  return Object.keys(r.fieldErrors).length ? r.fieldErrors : { _: r.message };
                }
                return { _: r.message };
              }}
            />
          );
        }
        if (c.type === "text") return <p key={i}>{c.text}</p>;
        if (c.type === "unknown") {
          return (
            <p key={i} className="muted small">
              {t("home.updateApp", { type: c.original })}
            </p>
          );
        }
        return null;
      })}
    </div>
  );
}

/**
 * The chart editor: every option of the definition. The card of the chart (a new card for a new chart) shows the
 * preview computed by the server as the options change; nothing is saved until "Save".
 */
export function EditorPanel({ initial, isNew }: { initial: ChartSpec; isNew: boolean }) {
  const t = useStore((s) => s.t);
  const catalog = useStore((s) => s.catalog);
  const [spec, setSpec] = useState(initial);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadCatalog().catch(() => undefined);
  }, []);
  // The card shows the draft's title and colour at once, and the preview once the definition settles (typing a
  // title must not send a request per key).
  useEffect(() => {
    setEditDraft(spec);
    if (spec !== initial) markPanelEdited();
  }, [spec]);
  useEffect(() => {
    let live = true;
    const id = isNew ? "" : spec.id;
    const timer = setTimeout(() => {
      const current = useStore.getState().editPreview;
      const loading = {
        data: current?.id === id ? current.state.data : null,
        loading: true,
        offline: false,
        error: null,
      };
      setEditPreview({ id, state: loading });
      preview(spec)
        .then((data) => {
          if (live)
            setEditPreview({ id, state: { data, loading: false, offline: false, error: null } });
        })
        .catch((e) => {
          if (live) {
            setEditPreview({
              id,
              state: {
                data: null,
                loading: false,
                offline: e instanceof OfflineError,
                error: errorText(t, e),
              },
            });
          }
        });
    }, 350);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [spec]);

  const save = async () => {
    setSaving(true);
    try {
      await saveChart(spec);
      toast(t("charts.saved"));
      closePanel();
    } catch (e) {
      toast(errorText(t, e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="panel-body editor-form">
        {catalog ? (
          <EditorForm spec={spec} cat={catalog} edit={(fn) => setSpec((s) => normalize(fn(s)))} />
        ) : (
          <p className="muted">{t("editor.loading")}</p>
        )}
      </div>
      <div className="panel-foot">
        <button
          type="button"
          className="btn primary"
          disabled={saving || !spec.title.trim()}
          onClick={() => void save()}
        >
          {isNew ? t("editor.create") : t("editor.save")}
        </button>
        <button type="button" className="btn ghost" onClick={closePanel}>
          {t("editor.cancel")}
        </button>
        <span className="spacer" />
        {!isNew && (
          <button
            type="button"
            className="btn ghost danger"
            onClick={() => {
              closePanel();
              deleteChart(spec.id);
            }}
          >
            <Trash2 size={14} strokeWidth={1.8} />
            {t("editor.delete")}
          </button>
        )}
      </div>
    </>
  );
}
