import { civilFromDays, isoWeek, monthNames } from "@boni-calendar/core";
import { Check, ChevronDown, ChevronLeft, ChevronRight, PanelLeft, PanelRight } from "lucide-react";
import { useState } from "react";
import { t } from "../i18n.ts";
import { useApp, useVisible, type ViewKind, visibleDays } from "../store.ts";
import { Menu } from "./Menu.tsx";

export function TopBar() {
  const view = useApp((s) => s.view);
  const nDays = useApp((s) => s.nDays);
  const settings = useApp((s) => s.settings);
  const sidebarOpen = useApp((s) => s.sidebarOpen);
  const detailMode = useApp((s) => s.detailMode);
  const popoverId = useApp((s) => s.popoverId);
  const selectedId = useApp((s) => s.selectedId);
  const start = useVisible((s) => s.start);
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState(String(nDays));
  const n = visibleDays(view, nDays);
  const focus = view === "month" ? start : start + Math.floor(n / 2);
  const { y, m } = civilFromDays(focus);

  const choose = (v: ViewKind, days?: number) => {
    useApp.getState().setView(v, days);
    setOpen(false);
  };
  const label =
    view === "day"
      ? t("view.day")
      : view === "week"
        ? t("view.week")
        : view === "month"
          ? t("view.month")
          : t("view.days", { n: nDays });

  return (
    <header className="topbar">
      {!sidebarOpen && (
        <button
          type="button"
          className="icon-btn"
          title={t("sidebar.toggle")}
          onClick={() => useApp.getState().toggleSidebar()}
        >
          <PanelLeft size={16} />
        </button>
      )}
      <h1 className="title">
        {monthNames(settings.locale, "long")[m - 1]} <span className="title-year">{y}</span>
        {settings.weekNumbers && view !== "month" && (
          <span className="title-week">{t("grid.week", { n: isoWeek(start) })}</span>
        )}
      </h1>
      <span className="spacer" />
      <div className="view-picker">
        <button
          type="button"
          className="pill"
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="menu"
          aria-expanded={open}
        >
          {label}
          <ChevronDown size={14} />
        </button>
        <Menu open={open} onClose={() => setOpen(false)} className="view-menu">
          {(
            [
              ["day", t("view.day"), "D"],
              ["week", t("view.week"), "W"],
              ["month", t("view.month"), "M"],
            ] as const
          ).map(([k, name, key]) => (
            <button type="button" key={k} className="menu-item" onClick={() => choose(k)}>
              <span className="menu-check">{view === k && <Check size={14} />}</span>
              {name}
              <kbd>{key}</kbd>
            </button>
          ))}
          <div className="menu-sep" />
          <div className="menu-item custom">
            <span className="menu-check">{view === "days" && <Check size={14} />}</span>
            <label htmlFor="custom-days">{t("view.customN")}</label>
            <input
              id="custom-days"
              type="number"
              min={2}
              max={14}
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter")
                  choose("days", Math.min(14, Math.max(2, Number(custom) || 3)));
              }}
            />
            <button
              type="button"
              className="mini-btn"
              onClick={() => choose("days", Math.min(14, Math.max(2, Number(custom) || 3)))}
            >
              OK
            </button>
          </div>
        </Menu>
      </div>
      <button type="button" className="pill" onClick={() => useApp.getState().goToday()}>
        {t("nav.today")}
      </button>
      <button
        type="button"
        className="icon-btn"
        title={t("nav.prev")}
        onClick={() => useApp.getState().step(-1)}
      >
        <ChevronLeft size={17} />
      </button>
      <button
        type="button"
        className="icon-btn"
        title={t("nav.next")}
        onClick={() => useApp.getState().step(1)}
      >
        <ChevronRight size={17} />
      </button>
      <button
        type="button"
        className={`icon-btn ${detailMode === "panel" && (popoverId || selectedId) ? "active" : ""}`}
        title={t("panel.toggle")}
        onClick={() => {
          const s = useApp.getState();
          s.setDetailMode(s.detailMode === "panel" ? "popover" : "panel");
        }}
      >
        <PanelRight size={16} />
      </button>
    </header>
  );
}
