import { Eye, EyeOff, House, PanelLeft, Plus, Settings, SlidersHorizontal, X } from "lucide-react";
import { useState } from "react";
import { newSpec } from "../core/chartBuilder.ts";
import { host } from "../host.ts";
import {
  addWidget,
  CAPTURE_SCREEN,
  changeChart,
  openEditor,
  openScreen,
  openSettings,
  orderCharts,
  removeWidget,
  setWidgetHidden,
  showChart,
  showHome,
  toggleSidebar,
  useStore,
  useVisibleCharts,
} from "../store.ts";
import { ACCENT } from "./Chart.tsx";
import { MenuRow, PopButton } from "./Popover.tsx";

/**
 * The sidebar (Boni Calendar's): home, the charts (colour, eye = on the home screen, gear = edit, drag to reorder),
 * this computer's desktop widgets (eye = shown here) and, at the bottom, settings and who is logged in.
 */
export function Sidebar() {
  const t = useStore((s) => s.t);
  const view = useStore((s) => s.view);
  const specs = useVisibleCharts();
  const widgets = useStore((s) => s.widgets);
  const settings = useStore((s) => s.settings);
  const home = useStore((s) => s.home);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const canCapture =
    !home || home.components.some((c) => c.type === "button" && c.screen === CAPTURE_SCREEN);

  const drop = (target: string) => {
    if (!dragging || dragging === target) return;
    const ids = specs.map((s) => s.id).filter((id) => id !== dragging);
    ids.splice(ids.indexOf(target), 0, dragging);
    void orderCharts(ids);
  };

  return (
    <nav className="sidebar" aria-label={t("sidebar.label")}>
      <div className="sidebar-top">
        <button
          type="button"
          className="icon-btn"
          onClick={toggleSidebar}
          title={t("sidebar.hide")}
          aria-label={t("sidebar.hide")}
        >
          <PanelLeft size={16} strokeWidth={1.8} />
        </button>
        <span className="spacer" />
        {canCapture && (
          <button
            type="button"
            className="icon-btn"
            onClick={() => openScreen(CAPTURE_SCREEN)}
            title={t("capture.title")}
            aria-label={t("capture.title")}
          >
            <Plus size={16} strokeWidth={1.8} />
          </button>
        )}
      </div>
      <div className="sidebar-scroll">
        <button
          type="button"
          className={`nav-row${view.kind === "home" ? " active" : ""}`}
          onClick={showHome}
        >
          <House size={15} strokeWidth={1.8} />
          <span className="nav-name">{t("top.home")}</span>
        </button>

        <div className="group-head">
          <span>{t("charts.yours")}</span>
          <button
            type="button"
            className="icon-btn tiny"
            onClick={() => openEditor(newSpec(t("charts.newTitle")), true)}
            title={t("charts.new")}
            aria-label={t("charts.new")}
          >
            <Plus size={13} strokeWidth={2} />
          </button>
        </div>
        <ul className="nav-list">
          {specs.map((spec) => (
            <li
              key={spec.id}
              className={`chart-row${view.kind === "chart" && view.id === spec.id ? " active" : ""}${
                over === spec.id && dragging && dragging !== spec.id ? " drop-before" : ""
              }${!spec.home ? " off" : ""}`}
              draggable
              onDragStart={(e) => {
                setDragging(spec.id);
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", spec.id);
              }}
              onDragOver={(e) => {
                if (!dragging) return;
                e.preventDefault();
                setOver(spec.id);
              }}
              onDragLeave={() => setOver((o) => (o === spec.id ? null : o))}
              onDrop={(e) => {
                e.preventDefault();
                drop(spec.id);
                setOver(null);
              }}
              onDragEnd={() => {
                setDragging(null);
                setOver(null);
              }}
            >
              <button type="button" className="chart-main" onClick={() => showChart(spec.id)}>
                <span
                  className={`swatch${spec.home ? "" : " hollow"}`}
                  style={{ ["--c" as string]: spec.color ?? ACCENT }}
                />
                <span className="nav-name">{spec.title}</span>
              </button>
              <button
                type="button"
                className="icon-btn tiny row-action"
                onClick={() => openEditor(spec)}
                title={t("controls.edit")}
                aria-label={`${t("controls.edit")}: ${spec.title}`}
              >
                <SlidersHorizontal size={13} strokeWidth={1.8} />
              </button>
              <button
                type="button"
                className={`icon-btn tiny row-action eye${spec.home ? "" : " shown"}`}
                onClick={() => void changeChart({ ...spec, home: !spec.home })}
                title={spec.home ? t("controls.hideHome") : t("controls.showHome")}
                aria-label={`${spec.home ? t("controls.hideHome") : t("controls.showHome")}: ${spec.title}`}
              >
                {spec.home ? (
                  <Eye size={13} strokeWidth={1.8} />
                ) : (
                  <EyeOff size={13} strokeWidth={1.8} />
                )}
              </button>
            </li>
          ))}
        </ul>

        {host.desktop && (
          <>
            <div className="group-head">
              <span>{t("widgets.title")}</span>
              <PopButton
                className="icon-btn tiny"
                title={t("widgets.add")}
                align="start"
                label={<Plus size={13} strokeWidth={2} />}
              >
                {(close) => (
                  <div className="menu-list" role="menu">
                    {specs.map((s) => (
                      <MenuRow
                        key={s.id}
                        label={s.title}
                        icon={
                          <span
                            className="swatch"
                            style={{ ["--c" as string]: s.color ?? ACCENT }}
                          />
                        }
                        onClick={() => {
                          close();
                          void addWidget(s.id);
                        }}
                      />
                    ))}
                  </div>
                )}
              </PopButton>
            </div>
            {widgets.length === 0 && <p className="nav-hint">{t("widgets.none")}</p>}
            <ul className="nav-list">
              {widgets.map((w) => {
                const spec = specs.find((s) => s.id === w.chart_id);
                const hidden = !settings.showWidgets || settings.hiddenWidgets.includes(w.id);
                return (
                  <li key={w.id} className={`chart-row${hidden ? " off" : ""}`}>
                    <span className="chart-main static">
                      <span
                        className={`swatch square${hidden ? " hollow" : ""}`}
                        style={{ ["--c" as string]: spec?.color ?? ACCENT }}
                      />
                      <span className="nav-name">{spec?.title ?? w.chart_id}</span>
                    </span>
                    <button
                      type="button"
                      className="icon-btn tiny row-action"
                      onClick={() => void removeWidget(w.id)}
                      title={t("widgets.remove")}
                      aria-label={`${t("widgets.remove")}: ${spec?.title ?? w.chart_id}`}
                    >
                      <X size={13} strokeWidth={1.8} />
                    </button>
                    <button
                      type="button"
                      className={`icon-btn tiny row-action eye${hidden ? " shown" : ""}`}
                      onClick={() =>
                        void setWidgetHidden(w.id, !settings.hiddenWidgets.includes(w.id))
                      }
                      title={hidden ? t("widgets.show") : t("widgets.hide")}
                      aria-label={`${hidden ? t("widgets.show") : t("widgets.hide")}: ${spec?.title ?? w.chart_id}`}
                    >
                      {hidden ? (
                        <EyeOff size={13} strokeWidth={1.8} />
                      ) : (
                        <Eye size={13} strokeWidth={1.8} />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
      <div className="sidebar-foot">
        <button type="button" className="foot-btn" onClick={() => openSettings()}>
          <Settings size={15} strokeWidth={1.8} />
          <span className="nav-name">{t("top.settings")}</span>
        </button>
        {settings.user && (
          <span className="foot-user" title={`${settings.user} · ${settings.device}`}>
            {settings.user}
          </span>
        )}
      </div>
    </nav>
  );
}
