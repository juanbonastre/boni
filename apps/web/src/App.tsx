import { BarChart3, ChevronLeft, Plus, RefreshCw, Settings } from "lucide-react";
import { useEffect } from "react";
import { ChartCard } from "./components/ChartCard.tsx";
import { ChartEditor } from "./components/ChartEditor.tsx";
import { ChartsScreen } from "./components/ChartsScreen.tsx";
import { FormView } from "./components/FormView.tsx";
import { SettingsModal } from "./components/SettingsModal.tsx";
import type { ButtonComponent, ChartCardComponent, Component, Screen } from "./core/contract.ts";
import {
  CHART_EDIT,
  CHARTS,
  configured,
  dismissRejected,
  go,
  HOME,
  loadScreen,
  openSettings,
  optionList,
  refresh,
  submit,
  sync,
  toast,
  todayIso,
  useStore,
} from "./store.ts";
import { useTheme } from "./theme.ts";

/** Home when the server can't be reached and nothing is saved yet: the starting charts. */
const OFFLINE_HOME: Screen = {
  id: HOME,
  title: "Boni",
  components: [
    {
      type: "button",
      label: "Apuntar gasto",
      screen: "capture-expense",
      icon: "add",
      style: "primary",
    },
    { type: "chart_card", chart_id: "spending-by-category", title: "Gasto del mes", size: "wide" },
    { type: "chart_card", chart_id: "monthly-spending", title: "Gasto por mes" },
    { type: "chart_card", chart_id: "eating-out", title: "Comida fuera" },
  ],
};

export function App() {
  useTheme();
  const t = useStore((s) => s.t);
  const screenId = useStore((s) => s.screen);
  const editing = useStore((s) => s.editing);
  const screens = useStore((s) => s.screens);
  const screenError = useStore((s) => s.screenError);
  const tick = useStore((s) => s.refreshTick);
  const settings = useStore((s) => s.settings);
  const pending = useStore((s) => s.pending);
  const toastMsg = useStore((s) => s.toast);
  const settingsOpen = useStore((s) => s.settingsOpen);
  const ready = configured(settings);
  const local = screenId === CHARTS || screenId === CHART_EDIT;

  useEffect(() => {
    if (!local && ready) void loadScreen(screenId);
  }, [screenId, tick, ready]);
  useEffect(() => {
    // Esc goes back one level, as everywhere in Boni.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || settingsOpen) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [role=menu]")) return;
      if (screenId === CHART_EDIT) go(CHARTS);
      else if (screenId !== HOME) go(HOME);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [screenId, settingsOpen]);

  const screen =
    screens[screenId] ?? (screenId === HOME && (screenError || !ready) ? OFFLINE_HOME : null);
  const title =
    screenId === CHARTS
      ? t("charts.title")
      : screenId === CHART_EDIT
        ? editing?.id
          ? t("charts.editTitle")
          : t("charts.newTitle")
        : (screen?.title ?? "Boni");

  return (
    <div className="app">
      <header className="topbar">
        {screenId !== HOME && (
          <button
            type="button"
            className="icon-btn"
            onClick={() => go(screenId === CHART_EDIT ? CHARTS : HOME)}
            title={t("top.back")}
            aria-label={t("top.back")}
          >
            <ChevronLeft size={18} strokeWidth={1.8} />
          </button>
        )}
        <h1 className="title">{title}</h1>
        {screenError && <span className="status muted small">{screenError}</span>}
        <span className="spacer" />
        {pending > 0 && <span className="pending">{t("top.pending", { n: pending })}</span>}
        {screenId === HOME && (
          <button type="button" className="pill" onClick={() => go(CHARTS)}>
            <BarChart3 size={15} strokeWidth={1.8} />
            {t("top.charts")}
          </button>
        )}
        <button
          type="button"
          className="icon-btn"
          onClick={() => {
            void sync();
            refresh();
          }}
          title={t("top.refresh")}
          aria-label={t("top.refresh")}
        >
          <RefreshCw size={16} strokeWidth={1.8} />
        </button>
        <button
          type="button"
          className="icon-btn"
          onClick={() => openSettings()}
          title={t("top.settings")}
          aria-label={t("top.settings")}
        >
          <Settings size={16} strokeWidth={1.8} />
        </button>
      </header>
      <main className="main">
        {!ready && screenId === HOME && (
          <div className="setup-hint">
            <span>{t("home.setup")}</span>
            <button type="button" className="btn primary" onClick={() => openSettings()}>
              {t("home.setupButton")}
            </button>
          </div>
        )}
        {screenId === CHARTS ? (
          <ChartsScreen />
        ) : screenId === CHART_EDIT && editing ? (
          <ChartEditor key={editing.id || "new"} initial={editing} />
        ) : (
          screen && <ScreenView screen={screen} />
        )}
        <QueueNotes />
      </main>
      {settingsOpen && <SettingsModal />}
      {toastMsg && (
        <div className="toast" role="status" key={toastMsg.id}>
          {toastMsg.text}
        </div>
      )}
    </div>
  );
}

function ScreenView({ screen }: { screen: Screen }) {
  const buttons = screen.components.filter((c): c is ButtonComponent => c.type === "button");
  const cards = screen.components.filter((c): c is ChartCardComponent => c.type === "chart_card");
  const others = screen.components.filter((c) => c.type !== "button" && c.type !== "chart_card");
  return (
    <div className="page">
      {buttons.length > 0 && (
        <div className="row">
          {buttons.map((b) => (
            <button
              key={b.screen}
              type="button"
              className={b.style === "secondary" ? "btn" : "btn primary big"}
              onClick={() => go(b.screen)}
            >
              {b.icon === "add" && <Plus size={16} strokeWidth={2} />}
              {b.label}
            </button>
          ))}
        </div>
      )}
      {others.map((c, i) => (
        <Other key={i} component={c} />
      ))}
      {cards.length > 0 && (
        <div className="chart-grid">
          {cards.map((c) => (
            <ChartCard
              key={c.chart_id}
              chartId={c.chart_id}
              title={c.title}
              className={c.size === "wide" ? "wide" : undefined}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Other({ component: c }: { component: Component }) {
  const t = useStore((s) => s.t);
  switch (c.type) {
    case "text":
      return <p className={`text-${c.style ?? "body"}`}>{c.text}</p>;
    case "form":
      return (
        <div className="card form-card">
          <FormView
            form={c}
            today={todayIso()}
            loadOptions={optionList}
            onSubmit={async (values) => {
              const r = await submit(c, values);
              if (r.kind === "done" || r.kind === "queued") {
                toast(r.message);
                go(HOME);
                return {};
              }
              if (r.kind === "invalid")
                return Object.keys(r.fieldErrors).length ? r.fieldErrors : { _: r.message };
              toast(r.message);
              return { _: r.message };
            }}
          />
        </div>
      );
    case "unknown":
      return <p className="muted small">{t("home.updateApp", { type: c.original })}</p>;
    default:
      return null;
  }
}

function QueueNotes() {
  const t = useStore((s) => s.t);
  const rejected = useStore((s) => s.rejected);
  if (!rejected.length) return null;
  return (
    <div className="page">
      <div className="card rejected">
        <h3>{t("queue.rejected")}</h3>
        {rejected.map((item) => (
          <div key={item.request.client_id} className="list-row">
            <span className="list-main small">
              {String(item.request.values.concept ?? "")} {String(item.request.values.amount ?? "")}
              : {item.error}
            </span>
            <button
              type="button"
              className="btn ghost"
              onClick={() => void dismissRejected(item.request.client_id)}
            >
              {t("queue.dismiss")}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
