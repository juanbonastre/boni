import {
  BookmarkPlus,
  ChevronLeft,
  Copy,
  Database,
  History,
  House,
  Inbox,
  Library,
  MessageSquare,
  MessageSquarePlus,
  MoreHorizontal,
  MoreVertical,
  PanelLeft,
  Pencil,
  Pin,
  PinOff,
  Smartphone,
  Trash2,
  WifiOff,
  X,
} from "lucide-react";
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AuditView } from "./components/Audit.tsx";
import { BlockPanel } from "./components/BlockPanel.tsx";
import { ChartCard, ChartCardContent } from "./components/ChartCard.tsx";
import { ChatView, InboxView, LogView } from "./components/Chat.tsx";
import { FormView } from "./components/FormView.tsx";
import { ProposalPage } from "./components/InboxCards.tsx";
import { KeyboardBar } from "./components/KeyboardBar.tsx";
import { Fab } from "./components/MobileCreate.tsx";
import { MobileHome } from "./components/MobileHome.tsx";
import { MobilePages } from "./components/MobilePages.tsx";
import { BottomSheet, LargeTitle, type Menu } from "./components/MobileParts.tsx";
import { QuickFind } from "./components/QuickFind.tsx";
import { RowsPanel } from "./components/RowsPanel.tsx";
import { RowView } from "./components/RowView.tsx";
import { SettingsModal } from "./components/SettingsModal.tsx";
import { EditorPanel } from "./components/SidePanel.tsx";
import * as B from "./core/chartBuilder.ts";
import { emptyState } from "./core/charts.ts";
import type { ChartSpec, FormComponent, Screen, Shortcut } from "./core/contract.ts";
import type { Values } from "./core/formLogic.ts";
import { PALETTE, QUICK_PERIODS } from "./core/palette.ts";
import { formOf, shortcutValues, suggestedLabel } from "./core/shortcuts.ts";
import { host } from "./host.ts";
import {
  changeChart,
  closePanel,
  configured,
  deleteChart,
  deletePage,
  deleteRow,
  deleteShortcut,
  dismissPanel,
  dismissToast,
  duplicateChart,
  duplicatePage,
  errorText,
  goBack,
  keepEditing,
  loadScreen,
  markPanelEdited,
  newConversation,
  openEditor,
  openShortcutEditor,
  optionList,
  pinToHome,
  saveShortcut,
  setRowHistory,
  showHome,
  showTab,
  submit,
  toast,
  todayIso,
  toggleChatList,
  useStore,
} from "./store.ts";

/**
 * The phone (narrower than 640 px; the Android app), made for the phone (Juan, 2026-10-31: «parecen adaptaciones muy
 * obvias de la versión desktop»): four places in the bar below (Inicio, Páginas, Boni, Bandeja), a + button for
 * capturing and creating, large titles, lists for a thumb, menus and forms as sheets from below, one chart at a time
 * on the whole screen. Back (Esc, Android's button) closes the top thing. Same tokens as Boni Calendar, with bigger
 * type and 48 px touch targets (docs/design-guide.md, «El móvil»).
 */
export function MobileApp() {
  const t = useStore((s) => s.t);
  const tab = useStore((s) => s.tab);
  const view = useStore((s) => s.view);
  const panel = useStore((s) => s.panel);
  const settingsOpen = useStore((s) => s.settingsOpen);
  const discardAsk = useStore((s) => s.discardAsk);
  const toastState = useStore((s) => s.toast);
  const fileChoice = useStore((s) => s.fileChoice);
  const [menu, setMenu] = useState<Menu | null>(null);
  const findOpen = useStore((s) => s.findOpen);
  const chartOpen = view.kind === "chart";
  return (
    <div className="m-app">
      {chartOpen ? (
        <ChartScreen id={view.id} openMenu={setMenu} />
      ) : (
        <>
          <MobileTop openMenu={setMenu} />
          {tab === "home" ? (
            <MobileHome />
          ) : tab === "pages" ? (
            <MobilePages />
          ) : tab === "inbox" ? (
            view.kind === "proposal" ? (
              <div className="m-scroll">
                <ProposalPage id={view.id} />
              </div>
            ) : (
              <MobileInbox />
            )
          ) : view.kind === "inbox" ? (
            <MobileInbox />
          ) : view.kind === "log" ? (
            <div className="m-scroll">
              <LogView />
            </div>
          ) : view.kind === "audit" ? (
            <AuditView filter={view.filter} />
          ) : view.kind === "proposal" ? (
            <div className="m-scroll">
              <ProposalPage id={view.id} />
            </div>
          ) : view.kind === "row" ? (
            // A record opened from another app (Boni Calendar's «Abrir en Boni»).
            <div className="m-scroll m-row">
              <RowView mobile />
            </div>
          ) : (
            <ChatView compact />
          )}
          <Fab openMenu={setMenu} />
          <KeyboardBar />
          <TabBar />
        </>
      )}
      {panel && <Sheet />}
      {settingsOpen && <SettingsModal />}
      {findOpen && <QuickFind />}
      {/* A page asks it itself (a file dropped in it); anywhere else, «Subir un archivo». */}
      {fileChoice && view.kind !== "page" && <FileChoiceSheet />}
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

/**
 * The top bar: slim, and only there when it has something to do. A place shows its large title in its content; deeper
 * (a collection, a record, a page, a proposal) the bar has Back and, on a record or a page, «…»; Boni's has its
 * conversations (a drawer from the left) and a new one. The settings are the account's initial on Inicio.
 */
function MobileTop({ openMenu }: { openMenu: (m: Menu) => void }) {
  const t = useStore((s) => s.t);
  const tab = useStore((s) => s.tab);
  const view = useStore((s) => s.view);
  const pending = useStore((s) => s.pending);
  const settings = useStore((s) => s.settings);
  // A record says which collection it is in (Boni Calendar's «Abrir en Boni» opens one alone).
  const rowType = useStore((s) =>
    s.view.kind === "row"
      ? s.dataTypes?.find((x) => x.id === (s.view as { type: string }).type)?.name
      : undefined,
  );
  const offline = configured(settings) && host.live && !settings.live && !settings.liveUnsupported;
  const deep =
    (tab === "pages" && view.kind !== "home") ||
    (tab === "inbox" && view.kind === "proposal") ||
    (tab === "boni" && view.kind !== "home" && view.kind !== "chat");
  const status = (
    <>
      {pending > 0 && <span className="m-status">{t("top.pending", { n: pending })}</span>}
      {offline && (
        <span className="m-status" title={t("top.offlineHelp")}>
          <WifiOff size={16} strokeWidth={1.8} />
          {t("top.offline")}
        </span>
      )}
    </>
  );
  if (tab === "boni" && !deep)
    return (
      <header className="m-top slim">
        <button
          type="button"
          className="m-icon"
          onClick={() => toggleChatList()}
          title={t("chats.title")}
          aria-label={t("chats.title")}
        >
          <PanelLeft size={22} strokeWidth={1.8} />
        </button>
        <h1 className="m-title small center">{t("tab.boni")}</h1>
        {status}
        <button
          type="button"
          className="m-icon"
          onClick={newConversation}
          title={t("chats.new")}
          aria-label={t("chats.new")}
        >
          <MessageSquarePlus size={22} strokeWidth={1.8} />
        </button>
      </header>
    );
  if (!deep)
    return pending > 0 || offline ? <header className="m-top slim">{status}</header> : null;
  return (
    <header className="m-top slim">
      <button
        type="button"
        className="m-icon"
        onClick={() => goBack()}
        title={t("mobile.back")}
        aria-label={t("mobile.back")}
      >
        <ChevronLeft size={26} strokeWidth={1.8} />
      </button>
      {rowType ? <h1 className="m-title small center">{rowType}</h1> : <span className="spacer" />}
      {status}
      {(view.kind === "row" || view.kind === "page") && <MoreButton openMenu={openMenu} />}
    </header>
  );
}

/** A record's or a page's «…»: what the desktop has around it (a record's History, a page's copy) and the trash. */
function MoreButton({ openMenu }: { openMenu: (m: Menu) => void }) {
  const t = useStore((s) => s.t);
  const view = useStore((s) => s.view);
  const page = useStore((s) => s.page);
  const row = useStore((s) => s.row);
  const def = useStore((s) =>
    s.view.kind === "row"
      ? s.dataTypes?.find((x) => x.id === (s.view as { type: string }).type)
      : undefined,
  );
  if (view.kind !== "row" && view.kind !== "page") return null;
  const title =
    view.kind === "row"
      ? String((def && row?.values[def.titleField]) || "") || t("page.untitled")
      : page?.title || t("page.untitled");
  const menu: Menu =
    view.kind === "row"
      ? {
          title,
          items: [
            {
              label: t("history.title"),
              icon: <History size={20} strokeWidth={1.8} />,
              run: () => setRowHistory(true),
            },
            {
              label: t("more.delete"),
              icon: <Trash2 size={20} strokeWidth={1.8} />,
              danger: true,
              run: () => {
                goBack();
                void deleteRow(view.type, view.id);
              },
            },
          ],
        }
      : {
          title,
          items: [
            {
              label: t("more.duplicate"),
              icon: <Copy size={20} strokeWidth={1.8} />,
              run: () => void duplicatePage(view.id),
            },
            {
              label: t("more.delete"),
              icon: <Trash2 size={20} strokeWidth={1.8} />,
              danger: true,
              run: () => {
                goBack();
                void deletePage(view.id);
              },
            },
          ],
        };
  return (
    <button
      type="button"
      className="m-icon"
      onClick={() => openMenu(menu)}
      title={t("more.title")}
      aria-label={t("more.title")}
    >
      <MoreHorizontal size={22} strokeWidth={1.8} />
    </button>
  );
}

/** The Bandeja as a place of its own: its large title over the proposals and the questions that wait. */
function MobileInbox() {
  const t = useStore((s) => s.t);
  return (
    <main className="m-scroll m-screen">
      <LargeTitle title={t("inbox.title")} />
      <InboxView />
    </main>
  );
}

/** Where a file goes when the account has several collections of files: asked once, the account keeps the answer. */
function FileChoiceSheet() {
  const t = useStore((s) => s.t);
  const choice = useStore((s) => s.fileChoice);
  if (!choice) return null;
  return (
    <BottomSheet title={t("file.choose")} close={() => choice.answer(null)}>
      <p className="m-hint">{t("file.chooseHelp")}</p>
      <ul className="m-group m-sheet-list">
        {choice.options.map((o) => (
          <li key={o.type} className="m-item">
            <button type="button" className="m-item-main row" onClick={() => choice.answer(o.type)}>
              <Database size={20} strokeWidth={1.8} />
              <span className="m-item-title">{o.name}</span>
            </button>
          </li>
        ))}
      </ul>
    </BottomSheet>
  );
}

/** The four places, always in view (NN/g): the Bandeja with how many things wait in it. */
function TabBar() {
  const t = useStore((s) => s.t);
  const tab = useStore((s) => s.tab);
  const waiting = useStore((s) => s.inbox.length + s.requests.length);
  const tabs = [
    { id: "home" as const, label: t("tab.home"), icon: <House size={22} strokeWidth={1.8} /> },
    { id: "pages" as const, label: t("tab.pages"), icon: <Library size={22} strokeWidth={1.8} /> },
    {
      id: "boni" as const,
      label: t("tab.boni"),
      icon: <MessageSquare size={22} strokeWidth={1.8} />,
    },
    { id: "inbox" as const, label: t("inbox.title"), icon: <Inbox size={22} strokeWidth={1.8} /> },
  ];
  return (
    <nav className="m-tabs" aria-label={t("tab.label")}>
      {tabs.map((x) => (
        <button
          key={x.id}
          type="button"
          className={`m-tab${tab === x.id ? " on" : ""}`}
          aria-current={tab === x.id ? "page" : undefined}
          aria-label={
            x.id === "inbox" && waiting > 0 ? t("inbox.titleN", { n: waiting }) : undefined
          }
          onClick={() => showTab(x.id)}
        >
          <span className="m-tab-icon">
            {x.icon}
            {x.id === "inbox" && waiting > 0 && (
              <span className="m-badge" aria-hidden="true">
                {waiting}
              </span>
            )}
          </span>
          <span className="m-tab-label">{x.label}</span>
        </button>
      ))}
    </nav>
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
      // On Inicio or only in the pages that show it (Juan, 2026-10-31: «puede fijar alguna en Inicio»).
      {
        label: spec.home ? t("charts.unpinHome") : t("charts.pinHome"),
        icon: spec.home ? (
          <PinOff size={20} strokeWidth={1.8} />
        ) : (
          <Pin size={20} strokeWidth={1.8} />
        ),
        run: () =>
          void changeChart(
            { ...spec, home: !spec.home },
            spec.home ? t("charts.unpinnedHome") : t("charts.pinnedHome"),
          ),
      },
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
  } else if (panel.kind === "block") {
    title = t("block.menuTitle");
    body = <BlockPanel key={panel.id} id={panel.id} />;
  } else if (panel.kind === "rows") {
    title = t("rows.title");
    body = <RowsPanel key={panel.id} id={panel.id} drill={panel.drill} label={panel.label} />;
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
