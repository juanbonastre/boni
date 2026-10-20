import {
  BarChart3,
  BookmarkPlus,
  ChevronLeft,
  ChevronRight,
  Copy,
  MessageSquare,
  MoreVertical,
  Pencil,
  PenLine,
  Plus,
  Settings,
  Smartphone,
  Trash2,
  WifiOff,
  X,
  Zap,
} from "lucide-react";
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChartCard, ChartCardContent, useChartData } from "./components/ChartCard.tsx";
import { ChatView, InboxView, LogView } from "./components/Chat.tsx";
import { FormView } from "./components/FormView.tsx";
import { SettingsModal } from "./components/SettingsModal.tsx";
import { EditorPanel } from "./components/SidePanel.tsx";
import * as B from "./core/chartBuilder.ts";
import * as M from "./core/chartMath.ts";
import { emptyState } from "./core/charts.ts";
import type { ChartSpec, FormComponent, Screen, Shortcut } from "./core/contract.ts";
import type { Values } from "./core/formLogic.ts";
import { PALETTE, QUICK_PERIODS } from "./core/palette.ts";
import { formOf, shortcutValues, suggestedLabel, summary } from "./core/shortcuts.ts";
import { host } from "./host.ts";
import {
  CAPTURE_SCREEN,
  changeChart,
  closePanel,
  configured,
  deleteChart,
  deleteShortcut,
  dismissPanel,
  dismissRejected,
  dismissToast,
  duplicateChart,
  errorText,
  keepEditing,
  loadScreen,
  markPanelEdited,
  openEditor,
  openScreen,
  openSettings,
  openShortcutEditor,
  optionList,
  pinToHome,
  runShortcut,
  saveShortcut,
  showChart,
  showHome,
  showTab,
  submit,
  toast,
  todayIso,
  useStore,
  useVisibleCharts,
  useVisibleShortcuts,
} from "./store.ts";

/**
 * The phone (narrower than 640 px; the Android app): made for capturing, not for watching charts. It opens on the
 * "Log" tab (the server's capture buttons and the shortcuts); the charts are the second tab, one chart at a time
 * on the whole screen. Forms and editors are sheets over everything; Back (Esc) closes the top one. Same tokens
 * as Boni Calendar, with bigger type and 48 px touch targets (docs/design-guide.md, "Mobile").
 */
export function MobileApp() {
  const t = useStore((s) => s.t);
  const tab = useStore((s) => s.tab);
  const view = useStore((s) => s.view);
  const panel = useStore((s) => s.panel);
  const settingsOpen = useStore((s) => s.settingsOpen);
  const discardAsk = useStore((s) => s.discardAsk);
  const toastState = useStore((s) => s.toast);
  const [menu, setMenu] = useState<Menu | null>(null);
  const chartOpen = view.kind === "chart";
  return (
    <div className="m-app">
      {chartOpen ? (
        <ChartScreen id={view.id} openMenu={setMenu} />
      ) : (
        <>
          <MobileTop
            title={
              tab === "capture"
                ? t("tab.capture")
                : tab === "charts"
                  ? t("tab.charts")
                  : view.kind === "inbox"
                    ? t("inbox.title")
                    : view.kind === "log"
                      ? t("log.title")
                      : t("tab.boni")
            }
          />
          {tab === "capture" ? (
            <CaptureTab openMenu={setMenu} />
          ) : tab === "charts" ? (
            <ChartsTab />
          ) : view.kind === "inbox" ? (
            <div className="m-scroll">
              <InboxView />
            </div>
          ) : view.kind === "log" ? (
            <div className="m-scroll">
              <LogView />
            </div>
          ) : (
            <ChatView compact />
          )}
          <TabBar />
        </>
      )}
      {panel && <Sheet />}
      {settingsOpen && <SettingsModal />}
      {menu && <ActionSheet menu={menu} close={() => setMenu(null)} />}
      {discardAsk && (
        <ActionSheet
          menu={{
            title: t("mobile.discardTitle"),
            items: [
              {
                label: t("mobile.discard"),
                icon: <Trash2 size={20} strokeWidth={1.8} />,
                danger: true,
                run: closePanel,
              },
            ],
            cancel: t("mobile.keepEditing"),
          }}
          close={keepEditing}
        />
      )}
      {toastState && (
        <div className={`toast${chartOpen ? "" : " over-tabs"}`} role="status" key={toastState.id}>
          <span>{toastState.text}</span>
          {toastState.action && (
            <button
              type="button"
              onClick={() => {
                toastState.action?.run();
                dismissToast();
              }}
            >
              {toastState.action.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

interface Menu {
  title: string;
  items: { label: string; icon: ReactNode; danger?: boolean; run: () => void }[];
  /** The last row's label (it closes the menu): "Cancelar" unless a question needs another. */
  cancel?: string;
}

function MobileTop({ title }: { title: string }) {
  const t = useStore((s) => s.t);
  const pending = useStore((s) => s.pending);
  const settings = useStore((s) => s.settings);
  const offline = configured(settings) && host.live && !settings.live && !settings.liveUnsupported;
  return (
    <header className="m-top">
      <h1 className="m-title">{title}</h1>
      <span className="spacer" />
      {pending > 0 && <span className="m-status">{t("top.pending", { n: pending })}</span>}
      {offline && (
        <span className="m-status" title={t("top.offlineHelp")}>
          <WifiOff size={16} strokeWidth={1.8} />
          {t("top.offline")}
        </span>
      )}
      <button
        type="button"
        className="m-icon"
        onClick={() => openSettings()}
        title={t("top.settings")}
        aria-label={t("top.settings")}
      >
        <Settings size={22} strokeWidth={1.8} />
      </button>
    </header>
  );
}

function TabBar() {
  const t = useStore((s) => s.t);
  const tab = useStore((s) => s.tab);
  const tabs = [
    {
      id: "capture" as const,
      label: t("tab.capture"),
      icon: <PenLine size={22} strokeWidth={1.8} />,
    },
    {
      id: "charts" as const,
      label: t("tab.charts"),
      icon: <BarChart3 size={22} strokeWidth={1.8} />,
    },
    {
      id: "boni" as const,
      label: t("tab.boni"),
      icon: <MessageSquare size={22} strokeWidth={1.8} />,
    },
  ];
  return (
    <nav className="m-tabs" aria-label={t("tab.label")}>
      {tabs.map((x) => (
        <button
          key={x.id}
          type="button"
          className={`m-tab${tab === x.id ? " on" : ""}`}
          aria-current={tab === x.id ? "page" : undefined}
          onClick={() => showTab(x.id)}
        >
          <span className="m-tab-icon">{x.icon}</span>
          <span className="m-tab-label">{x.label}</span>
        </button>
      ))}
    </nav>
  );
}

// ---------- Log: the server's capture buttons and the shortcuts ----------
function CaptureTab({ openMenu }: { openMenu: (m: Menu) => void }) {
  const t = useStore((s) => s.t);
  const settings = useStore((s) => s.settings);
  const home = useStore((s) => s.home);
  const screens = useStore((s) => s.screens);
  const options = useStore((s) => s.options);
  const rejected = useStore((s) => s.rejected);
  const shortcuts = useVisibleShortcuts();
  const buttons = (home?.components ?? []).filter((c) => c.type === "button");
  const actions = buttons.length
    ? buttons.map((b) => ({ label: b.label, screen: b.screen }))
    : [{ label: t("capture.title"), screen: CAPTURE_SCREEN }];

  if (!configured(settings)) {
    return (
      <main className="m-scroll center">
        <div className="empty-state">
          <img src="./favicon.png" alt="" width={56} height={56} />
          <p>{t("home.setup")}</p>
          <button type="button" className="btn primary" onClick={() => openSettings()}>
            {t("home.setupButton")}
          </button>
        </div>
      </main>
    );
  }
  const newShortcut = () =>
    openShortcutEditor(
      { id: "", label: "", screen: actions[0]!.screen, values: {}, mode: "open", color: null },
      true,
    );
  return (
    <main className="m-scroll">
      {rejected.length > 0 && (
        <div className="m-card rejected">
          <h3>{t("queue.rejected")}</h3>
          {rejected.map((item) => (
            <div key={item.request.client_id} className="m-row-line">
              <span className="m-row-text">
                {String(item.request.values.concept ?? "")}{" "}
                {String(item.request.values.amount ?? "")}: {item.error}
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
      )}
      {actions.map((a) => (
        <button
          key={a.screen}
          type="button"
          className="m-capture"
          onClick={() => openScreen(a.screen)}
        >
          <span className="m-capture-icon">
            <Plus size={24} strokeWidth={2} />
          </span>
          <span className="m-capture-label">{a.label}</span>
        </button>
      ))}
      <h2 className="m-section">{t("shortcut.title")}</h2>
      {shortcuts.length > 0 ? (
        <div className="m-list">
          {shortcuts.map((sc) => {
            const form = formOf(screens[sc.screen]);
            // What it fills in, without repeating its name (a concept is often the name too).
            const parts = form
              ? summary(form, sc.values, options).filter((x) => x !== sc.label)
              : [];
            const menu: Menu = {
              title: sc.label,
              items: [
                {
                  label: t("shortcut.edit"),
                  icon: <Pencil size={20} strokeWidth={1.8} />,
                  run: () => openShortcutEditor(sc),
                },
                ...(host.phone
                  ? [
                      {
                        label: t("shortcut.pin"),
                        icon: <Smartphone size={20} strokeWidth={1.8} />,
                        run: () =>
                          void pinToHome({
                            target: `shortcut:${sc.id}`,
                            label: sc.label,
                            color: sc.color,
                          }),
                      },
                    ]
                  : []),
                {
                  label: t("shortcut.delete"),
                  icon: <Trash2 size={20} strokeWidth={1.8} />,
                  danger: true,
                  run: () => deleteShortcut(sc.id),
                },
              ],
            };
            return (
              <div
                key={sc.id}
                className="m-shortcut"
                style={{ "--sc": sc.color ?? "var(--accent)" } as React.CSSProperties}
              >
                <button
                  type="button"
                  className="m-shortcut-main"
                  onClick={() => void runShortcut(sc)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    openMenu(menu);
                  }}
                >
                  <span className="m-shortcut-name">
                    {sc.label}
                    {sc.mode === "save" && (
                      <Zap
                        size={15}
                        strokeWidth={2}
                        className="m-shortcut-zap"
                        aria-label={t("shortcut.savesOnTap")}
                      />
                    )}
                  </span>
                  <span className="m-shortcut-sub">
                    {parts.slice(0, 3).join(" · ") || t("shortcut.emptyValues")}
                  </span>
                </button>
                <button
                  type="button"
                  className="m-icon"
                  aria-label={t("shortcut.menu", { label: sc.label })}
                  title={t("shortcut.menu", { label: sc.label })}
                  onClick={() => openMenu(menu)}
                >
                  <MoreVertical size={20} strokeWidth={1.8} />
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="m-hint">{t("shortcut.empty")}</p>
      )}
      <button type="button" className="m-add" onClick={newShortcut}>
        <Plus size={20} strokeWidth={1.8} />
        {t("shortcut.new")}
      </button>
    </main>
  );
}

// ---------- Charts: a list; one chart at a time on the whole screen ----------
function ChartsTab() {
  const t = useStore((s) => s.t);
  const specs = useVisibleCharts();
  return (
    <main className="m-scroll">
      {specs.length > 0 ? (
        <div className="m-list">
          {specs.map((spec) => (
            <ChartRow key={spec.id} spec={spec} />
          ))}
        </div>
      ) : (
        <p className="m-hint">{t("mobile.noCharts")}</p>
      )}
      <button
        type="button"
        className="m-add"
        onClick={() => openEditor(B.newSpec(t("charts.newTitle")), true)}
      >
        <Plus size={20} strokeWidth={1.8} />
        {t("charts.new")}
      </button>
    </main>
  );
}

function ChartRow({ spec }: { spec: ChartSpec }) {
  const t = useStore((s) => s.t);
  const { data } = useChartData(spec.id);
  const value = data?.total != null ? M.formatAuto(data.total, data.unit ?? "EUR") : "";
  return (
    <button type="button" className="m-chart-row" onClick={() => showChart(spec.id)}>
      <span className="card-dot" style={{ background: spec.color ?? "var(--accent)" }} />
      <span className="m-chart-row-text">
        <span className="m-chart-row-name">{spec.title}</span>
        <span className="m-chart-row-sub">{B.periodLabel(t, spec.period)}</span>
      </span>
      {value && <span className="m-chart-row-value">{value}</span>}
      <ChevronRight size={20} strokeWidth={1.8} className="m-chevron" />
    </button>
  );
}

const samePeriod = (a: ChartSpec["period"], b: { kind: string; months?: number }) =>
  a.kind === b.kind && (a.kind !== "last_months" || a.months === b.months);

function ChartScreen({ id, openMenu }: { id: string; openMenu: (m: Menu) => void }) {
  const t = useStore((s) => s.t);
  const spec = useStore((s) => s.chartSpecs.find((c) => c.id === id));
  const periods = useRef<HTMLDivElement>(null);
  // The chosen period in view (a long list scrolls sideways).
  useLayoutEffect(() => {
    const on = periods.current?.querySelector<HTMLElement>(".m-chip.on");
    const box = periods.current;
    if (on && box) box.scrollLeft = on.offsetLeft - (box.clientWidth - on.offsetWidth) / 2;
  }, [id, spec?.period.kind, spec?.period.months]);
  if (!spec) return null;
  const menu: Menu = {
    title: spec.title,
    items: [
      {
        label: t("mobile.editChart"),
        icon: <Pencil size={20} strokeWidth={1.8} />,
        run: () => openEditor(spec),
      },
      ...(host.phone
        ? [
            {
              label: t("shortcut.pin"),
              icon: <Smartphone size={20} strokeWidth={1.8} />,
              run: () =>
                void pinToHome({
                  target: `chart:${spec.id}`,
                  label: spec.title,
                  color: spec.color,
                }),
            },
          ]
        : []),
      {
        label: t("mobile.duplicateChart"),
        icon: <Copy size={20} strokeWidth={1.8} />,
        run: () => void duplicateChart(spec),
      },
      {
        label: t("mobile.deleteChart"),
        icon: <Trash2 size={20} strokeWidth={1.8} />,
        danger: true,
        run: () => deleteChart(spec.id),
      },
    ],
  };
  return (
    <div className="m-chart-screen">
      <header className="m-top">
        <button
          type="button"
          className="m-icon"
          onClick={showHome}
          title={t("chart.back")}
          aria-label={t("chart.back")}
        >
          <ChevronLeft size={24} strokeWidth={1.8} />
        </button>
        <h1 className="m-title">{spec.title}</h1>
        <span className="spacer" />
        <button
          type="button"
          className="m-icon"
          onClick={() => openMenu(menu)}
          title={t("mobile.chartMenu")}
          aria-label={t("mobile.chartMenu")}
        >
          <MoreVertical size={22} strokeWidth={1.8} />
        </button>
      </header>
      <div ref={periods} className="m-periods" role="radiogroup" aria-label={t("controls.period")}>
        {QUICK_PERIODS.map((p) => {
          const on = samePeriod(spec.period, p);
          return (
            <button
              key={`${p.kind}${"months" in p ? p.months : ""}`}
              type="button"
              role="radio"
              aria-checked={on}
              className={`m-chip${on ? " on" : ""}`}
              onClick={() => !on && void changeChart({ ...spec, period: { ...p } })}
            >
              {B.periodLabel(t, p)}
            </button>
          );
        })}
      </div>
      <div className="m-chart-body">
        <ChartCard key={id} chartId={id} focused bare className="focus" />
      </div>
    </div>
  );
}

// ---------- sheets: a form, the shortcut editor, the chart editor ----------
function Sheet() {
  const t = useStore((s) => s.t);
  const panel = useStore((s) => s.panel);
  const screens = useStore((s) => s.screens);
  const shortcuts = useStore((s) => s.shortcuts);
  if (!panel) return null;
  let title = "";
  let body: ReactNode = null;
  if (panel.kind === "screen") {
    const screen = screens[panel.id];
    const sc = panel.shortcut ? shortcuts.find((s) => s.id === panel.shortcut) : undefined;
    title = sc?.label ?? screen?.title ?? t("chart.loading");
    body = screen ? (
      <ScreenSheet key={`${panel.id}:${panel.shortcut ?? ""}`} screen={screen} />
    ) : (
      <p className="muted m-sheet-pad">{t("chart.loading")}</p>
    );
  } else if (panel.kind === "shortcut") {
    title = panel.isNew ? t("shortcut.newTitle") : t("shortcut.editTitle");
    body = (
      <ShortcutEditor
        key={panel.shortcut.id || "new"}
        initial={panel.shortcut}
        isNew={panel.isNew}
      />
    );
  } else {
    title = panel.isNew ? t("charts.newTitle") : t("charts.editTitle");
    body = <ChartEditorSheet key={panel.spec.id || "new"} spec={panel.spec} isNew={panel.isNew} />;
  }
  return (
    <div className="m-sheet" role="dialog" aria-modal="true" aria-label={title}>
      <header className="m-top">
        <button
          type="button"
          className="m-icon"
          onClick={dismissPanel}
          title={t("settings.close")}
          aria-label={t("settings.close")}
        >
          <X size={24} strokeWidth={1.8} />
        </button>
        <h1 className="m-title">{title}</h1>
      </header>
      {body}
    </div>
  );
}

/** A server screen's form, maybe filled in by a shortcut; it can be kept as a new shortcut. */
function ScreenSheet({ screen }: { screen: Screen }) {
  const t = useStore((s) => s.t);
  const panel = useStore((s) => s.panel);
  const options = useStore((s) => s.options);
  const initial = panel?.kind === "screen" ? panel.values : undefined;
  const keepAsShortcut = (form: FormComponent, values: Values) => {
    const kept = shortcutValues(form, values);
    openShortcutEditor(
      {
        id: "",
        label: suggestedLabel(form, kept, options),
        screen: screen.id,
        values: kept,
        mode: "open",
        color: null,
      },
      true,
    );
  };
  return (
    <div className="m-sheet-body">
      {screen.components.map((c, i) => {
        if (c.type === "form") {
          return (
            <FormView
              key={c.id}
              form={c}
              today={todayIso()}
              loadOptions={optionList}
              initial={initial}
              collapse
              extra={(values) => (
                <button
                  type="button"
                  className="btn"
                  onClick={() => keepAsShortcut(c, values)}
                  title={t("shortcut.saveAs")}
                >
                  <BookmarkPlus size={20} strokeWidth={1.8} />
                  {t("shortcut.saveAs")}
                </button>
              )}
              onSubmit={async (values) => {
                const r = await submit(c, values);
                if (r.kind === "done" || r.kind === "queued") {
                  closePanel();
                  // A capture that was not a shortcut yet can become one from its toast.
                  if (!(panel?.kind === "screen" && panel.shortcut)) {
                    toast(r.message, {
                      label: t("shortcut.saveAs"),
                      run: () => keepAsShortcut(c, values),
                    });
                  } else toast(r.message);
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
            <p key={i} className="muted">
              {t("home.updateApp", { type: c.original })}
            </p>
          );
        }
        return null;
      })}
    </div>
  );
}

/** Name, what a tap does, colour, and the values it puts in the form (the form itself, nothing required). */
function ShortcutEditor({ initial, isNew }: { initial: Shortcut; isNew: boolean }) {
  const t = useStore((s) => s.t);
  const screen = useStore((s) => s.screens[initial.screen]);
  const [label, setLabel] = useState(initial.label);
  const [mode, setMode] = useState(initial.mode);
  const [color, setColor] = useState(initial.color);
  useEffect(() => {
    if (label !== initial.label || mode !== initial.mode || color !== initial.color)
      markPanelEdited();
  }, [label, mode, color]);
  const form = formOf(screen);
  useEffect(() => {
    if (!screen) void loadScreen(initial.screen).catch(() => undefined);
  }, []);
  if (!form) return <p className="muted m-sheet-pad">{t("chart.loading")}</p>;
  return (
    <div className="m-sheet-body">
      <div className="field">
        <label className="field-label" htmlFor="sc-name">
          {t("shortcut.name")}
        </label>
        <input
          id="sc-name"
          className="input"
          autoComplete="off"
          maxLength={60}
          placeholder={t("shortcut.namePlaceholder")}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
      </div>
      <div className="field">
        <span className="field-label">{t("shortcut.onTap")}</span>
        <div className="segmented m-segmented">
          {(["open", "save"] as const).map((m) => (
            <button
              key={m}
              type="button"
              className={mode === m ? "on" : ""}
              aria-pressed={mode === m}
              onClick={() => setMode(m)}
            >
              {m === "open" ? t("shortcut.modeOpen") : t("shortcut.modeSave")}
            </button>
          ))}
        </div>
        <div className="field-help">
          {mode === "open" ? t("shortcut.modeOpenHelp") : t("shortcut.modeSaveHelp")}
        </div>
      </div>
      <div className="field">
        <span className="field-label">{t("shortcut.color")}</span>
        <div className="m-swatches">
          <button
            type="button"
            className={`m-swatch none${color == null ? " on" : ""}`}
            aria-label={t("shortcut.colorNone")}
            aria-pressed={color == null}
            onClick={() => setColor(null)}
          />
          {PALETTE.map((p) => (
            <button
              key={p.hex}
              type="button"
              className={`m-swatch${color === p.hex ? " on" : ""}`}
              style={{ background: p.hex }}
              aria-label={t(`color.${p.name}`)}
              aria-pressed={color === p.hex}
              onClick={() => setColor(p.hex)}
            />
          ))}
        </div>
      </div>
      <h3 className="m-subhead">{t("shortcut.values")}</h3>
      <FormView
        form={form}
        today={todayIso()}
        loadOptions={optionList}
        initial={initial.values}
        collapse
        mode="values"
        submitLabel={isNew ? t("shortcut.create") : t("shortcut.save")}
        extra={
          isNew
            ? undefined
            : () => (
                <button
                  type="button"
                  className="btn ghost danger"
                  onClick={() => {
                    closePanel();
                    deleteShortcut(initial.id);
                  }}
                >
                  <Trash2 size={20} strokeWidth={1.8} />
                  {t("shortcut.delete")}
                </button>
              )
        }
        onSubmit={async (values): Promise<Record<string, string>> => {
          if (!label.trim()) return { _: t("shortcut.nameRequired") };
          try {
            await saveShortcut({
              ...initial,
              label: label.trim(),
              mode,
              color,
              values: shortcutValues(form, values),
            });
            closePanel();
            toast(isNew ? t("shortcut.created") : t("shortcut.saved"));
            return {};
          } catch (e) {
            return { _: errorText(t, e) };
          }
        }}
      />
    </div>
  );
}

/** The chart editor (the desktop's), with the preview card above it. */
function ChartEditorSheet({ spec, isNew }: { spec: ChartSpec; isNew: boolean }) {
  const draft = useStore((s) => (s.panel?.kind === "edit" ? s.panel.spec : spec));
  const preview = useStore((s) =>
    s.editPreview?.id === (isNew ? "" : spec.id) ? s.editPreview.state : null,
  );
  return (
    <div className="m-sheet-body editor">
      <ChartCardContent
        title={draft.title}
        color={draft.color}
        state={preview ?? emptyState()}
        className="m-preview"
      />
      <EditorPanel initial={spec} isNew={isNew} />
    </div>
  );
}

/** A menu from the bottom (a shortcut's or a chart's): big rows, Cancel at the end. */
function ActionSheet({ menu, close }: { menu: Menu; close: () => void }) {
  const t = useStore((s) => s.t);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) {
        e.preventDefault();
        close();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
  return (
    <div className="m-scrim" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="m-action-sheet" role="menu" aria-label={menu.title}>
        <div className="m-action-title">{menu.title}</div>
        {menu.items.map((it) => (
          <button
            key={it.label}
            type="button"
            role="menuitem"
            className={`m-action${it.danger ? " danger" : ""}`}
            onClick={() => {
              close();
              it.run();
            }}
          >
            {it.icon}
            {it.label}
          </button>
        ))}
        <button type="button" className="m-action cancel" onClick={close}>
          {menu.cancel ?? t("mobile.cancel")}
        </button>
      </div>
    </div>
  );
}
