import { ArrowDown, ArrowUp, Copy, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import * as B from "../core/chartBuilder.ts";
import { host } from "../host.ts";
import {
  addWidget,
  CHART_EDIT,
  errorText,
  go,
  loadCatalog,
  loadCharts,
  loadWidgets,
  orderCharts,
  removeWidget,
  saveChart,
  toast,
  updateWidget,
  useStore,
} from "../store.ts";
import { MenuButton } from "./Menu.tsx";

const SIZES = ["small", "medium", "large"] as const;

/** Every chart (edit, duplicate, order, show on home) and the widgets of this computer. */
export function ChartsScreen() {
  const t = useStore((s) => s.t);
  const specs = useStore((s) => s.chartSpecs);
  const catalog = useStore((s) => s.catalog);
  const widgets = useStore((s) => s.widgets);
  const tick = useStore((s) => s.refreshTick);
  // Widgets exist only where there is a desktop to put them on.
  const desktop = host.desktop != null;
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    Promise.all([loadCharts(), loadWidgets(), loadCatalog()]).catch((e) =>
      setError(errorText(t, e)),
    );
  }, [tick]);

  const act = (job: () => Promise<unknown>) => {
    job().catch((e) => toast(errorText(t, e)));
  };
  const move = (i: number, by: number) => {
    const ids = specs.map((s) => s.id);
    const [id] = ids.splice(i, 1);
    ids.splice(i + by, 0, id!);
    act(() => orderCharts(ids));
  };
  const title = (chartId: string) => specs.find((s) => s.id === chartId)?.title ?? chartId;

  return (
    <div className="page narrow">
      <div className="section-head">
        <h2>{t("charts.yours")}</h2>
        <button
          type="button"
          className="btn primary"
          onClick={() => go(CHART_EDIT, B.newSpec(t("charts.newTitle")))}
        >
          <Plus size={15} strokeWidth={2} />
          {t("charts.new")}
        </button>
      </div>
      {error && <p className="form-error">{error}</p>}
      {specs.length === 0 && !error && <p className="muted">{t("charts.none")}</p>}
      <ul className="list">
        {specs.map((spec, i) => (
          <li key={spec.id} className="list-row">
            <div className="list-main">
              <div className="list-title">{spec.title}</div>
              <div className="list-sub">{B.describe(t, spec, catalog)}</div>
            </div>
            <label className="toggle-row" title={t("charts.home")}>
              <input
                type="checkbox"
                className="switch"
                checked={spec.home}
                onChange={(e) => act(() => saveChart({ ...spec, home: e.target.checked }))}
              />
              <span>{t("charts.home")}</span>
            </label>
            <button
              type="button"
              className="icon-btn"
              disabled={i === 0}
              onClick={() => move(i, -1)}
              title={t("charts.up")}
              aria-label={t("charts.up")}
            >
              <ArrowUp size={15} strokeWidth={1.8} />
            </button>
            <button
              type="button"
              className="icon-btn"
              disabled={i === specs.length - 1}
              onClick={() => move(i, 1)}
              title={t("charts.down")}
              aria-label={t("charts.down")}
            >
              <ArrowDown size={15} strokeWidth={1.8} />
            </button>
            <button
              type="button"
              className="icon-btn"
              onClick={() => go(CHART_EDIT, B.duplicate(spec, t("charts.copy")))}
              title={t("charts.duplicate")}
              aria-label={t("charts.duplicate")}
            >
              <Copy size={15} strokeWidth={1.8} />
            </button>
            <button type="button" className="btn" onClick={() => go(CHART_EDIT, spec)}>
              <Pencil size={14} strokeWidth={1.8} />
              {t("charts.edit")}
            </button>
          </li>
        ))}
      </ul>

      {desktop && (
        <>
          <div className="section-head spaced">
            <h2>{t("widgets.title")}</h2>
          </div>
          <p className="muted small">{t("widgets.help")}</p>
          {widgets.length === 0 && <p className="muted">{t("widgets.none")}</p>}
          <ul className="list">
            {widgets.map((w) => (
              <li key={w.id} className="list-row">
                <MenuButton
                  label={title(w.chart_id)}
                  items={specs.map((s) => ({ id: s.id, label: s.title, on: s.id === w.chart_id }))}
                  onPick={(id) => act(() => updateWidget(w.id, id, w.size))}
                />
                <div className="segmented">
                  {SIZES.map((size) => (
                    <button
                      key={size}
                      type="button"
                      className={w.size === size ? "on" : ""}
                      onClick={() => act(() => updateWidget(w.id, w.chart_id, size))}
                    >
                      {t(`widgets.size.${size}`)}
                    </button>
                  ))}
                </div>
                <span className="spacer" />
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => act(() => removeWidget(w.id))}
                  title={t("widgets.remove")}
                  aria-label={t("widgets.remove")}
                >
                  <Trash2 size={15} strokeWidth={1.8} />
                </button>
              </li>
            ))}
          </ul>
          {specs.length > 0 && (
            <MenuButton
              label={t("widgets.add")}
              icon={<Plus size={15} strokeWidth={2} />}
              items={specs.map((s) => ({ id: s.id, label: s.title }))}
              onPick={(id) => act(() => addWidget(id, "medium"))}
            />
          )}
        </>
      )}
    </div>
  );
}
