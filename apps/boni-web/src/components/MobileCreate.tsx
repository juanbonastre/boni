// The phone's + button and its sheet «Crear» (docs/design-guide.md, «El móvil»): capturing, the shortcuts, something new.
import {
  ChevronRight,
  Database,
  FileText,
  MoreVertical,
  Pencil,
  Plus,
  Smartphone,
  Trash2,
  Upload,
  Zap,
} from "lucide-react";
import { useRef, useState } from "react";
import type { Shortcut } from "../core/contract.ts";
import { formOf, summary } from "../core/shortcuts.ts";
import { host } from "../host.ts";
import {
  addRow,
  CAPTURE_SCREEN,
  deleteShortcut,
  newPage,
  openCollection,
  openRow,
  openScreen,
  openShortcutEditor,
  pinToHome,
  runShortcut,
  showTab,
  uploadFiles,
  useStore,
  useVisibleShortcuts,
} from "../store.ts";
import { BottomSheet, type Menu } from "./MobileParts.tsx";

/**
 * The + button (Material 3's FAB), above the bar on the right of every place but Boni's (there the action is to
 * write). Inside a collection it makes a record there and opens it; anywhere else it opens «Crear».
 */
export function Fab({ openMenu }: { openMenu: (m: Menu) => void }) {
  const t = useStore((s) => s.t);
  const view = useStore((s) => s.view);
  const tab = useStore((s) => s.tab);
  const [open, setOpen] = useState(false);
  // On a place's own screen, not over a record, a page or a proposal being read, nor in Boni's conversation.
  const shown =
    tab === "home" ||
    (tab === "pages" && (view.kind === "home" || view.kind === "collection")) ||
    (tab === "inbox" && view.kind !== "proposal");
  if (!shown) return null;
  const inCollection = tab === "pages" && view.kind === "collection" ? view.type : null;
  return (
    <>
      <button
        type="button"
        className="m-fab"
        aria-label={inCollection ? t("create.inHere") : t("create.title")}
        title={inCollection ? t("create.inHere") : t("create.title")}
        onClick={async () => {
          if (!inCollection) return setOpen(true);
          const row = await addRow(inCollection);
          if (row) void openRow(inCollection, row.id);
        }}
      >
        <Plus size={26} strokeWidth={2} />
      </button>
      {open && <CreateSheet close={() => setOpen(false)} openMenu={openMenu} />}
    </>
  );
}

/**
 * «Crear»: capturing first (the server's capture buttons and Juan's shortcuts, each with its menu: a long press or
 * ⋮), then something new: a page, a record in a collection, or a file kept in Boni.
 */
function CreateSheet({ close, openMenu }: { close: () => void; openMenu: (m: Menu) => void }) {
  const t = useStore((s) => s.t);
  const home = useStore((s) => s.home);
  const types = useStore((s) => s.dataTypes);
  const shortcuts = useVisibleShortcuts();
  const [step, setStep] = useState<"what" | "where">("what");
  const file = useRef<HTMLInputElement | null>(null);
  const buttons = (home?.components ?? []).filter((c) => c.type === "button");
  const actions = buttons.length
    ? buttons.map((b) => ({ label: b.label, screen: b.screen }))
    : [{ label: t("capture.title"), screen: CAPTURE_SCREEN }];
  if (step === "where")
    return (
      <BottomSheet title={t("create.where")} close={close}>
        <ul className="m-group m-sheet-list">
          {(types ?? [])
            .filter((d) => !d.system)
            .map((d) => (
              <li key={d.id} className="m-item">
                <button
                  type="button"
                  className="m-item-main row"
                  onClick={async () => {
                    close();
                    showTab("pages");
                    openCollection(d.id);
                    const row = await addRow(d.id);
                    if (row) void openRow(d.id, row.id);
                  }}
                >
                  <span className="m-item-icon">
                    {d.icon ? <span>{d.icon}</span> : <Database size={20} strokeWidth={1.8} />}
                  </span>
                  <span className="m-item-title">{d.name}</span>
                </button>
              </li>
            ))}
        </ul>
      </BottomSheet>
    );
  return (
    <BottomSheet title={t("create.title")} close={close}>
      <h3 className="m-label">{t("create.capture")}</h3>
      <div className="m-list">
        {actions.map((a) => (
          <button
            key={a.screen}
            type="button"
            className="m-capture"
            onClick={() => {
              close();
              openScreen(a.screen);
            }}
          >
            <span className="m-capture-icon">
              <Plus size={24} strokeWidth={2} />
            </span>
            <span className="m-capture-label">{a.label}</span>
          </button>
        ))}
        {shortcuts.map((sc) => (
          <ShortcutRow
            key={sc.id}
            sc={sc}
            run={() => {
              close();
              void runShortcut(sc);
            }}
            menu={(m) => {
              close();
              openMenu(m);
            }}
          />
        ))}
      </div>
      <button
        type="button"
        className="m-add"
        onClick={() => {
          close();
          openShortcutEditor(
            {
              id: "",
              label: "",
              screen: actions[0]!.screen,
              values: {},
              mode: "open",
              color: null,
            },
            true,
          );
        }}
      >
        <Plus size={20} strokeWidth={1.8} />
        {t("shortcut.new")}
      </button>
      <h3 className="m-label">{t("create.new")}</h3>
      <ul className="m-group">
        <li className="m-item">
          <button
            type="button"
            className="m-item-main row"
            onClick={() => {
              close();
              showTab("pages");
              void newPage();
            }}
          >
            <FileText size={20} strokeWidth={1.8} />
            <span className="m-item-title">{t("create.page")}</span>
          </button>
        </li>
        <li className="m-item">
          <button type="button" className="m-item-main row" onClick={() => setStep("where")}>
            <Database size={20} strokeWidth={1.8} />
            <span className="m-item-title">{t("create.record")}</span>
            <ChevronRight size={18} strokeWidth={1.8} className="m-chev" />
          </button>
        </li>
        <li className="m-item">
          <button type="button" className="m-item-main row" onClick={() => file.current?.click()}>
            <Upload size={20} strokeWidth={1.8} />
            <span className="m-item-title">{t("create.file")}</span>
          </button>
          <input
            ref={file}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              const files = [...(e.target.files ?? [])];
              close();
              if (files.length) void uploadFiles(files);
            }}
          />
        </li>
      </ul>
    </BottomSheet>
  );
}

/** A shortcut: a tap runs it; a long press or ⋮ opens its menu (edit, on the phone's launcher, delete). */
function ShortcutRow({
  sc,
  run,
  menu,
}: {
  sc: Shortcut;
  run: () => void;
  menu: (m: Menu) => void;
}) {
  const t = useStore((s) => s.t);
  const screens = useStore((s) => s.screens);
  const options = useStore((s) => s.options);
  const form = formOf(screens[sc.screen]);
  // What it fills in, without repeating its name (a concept is often the name too).
  const parts = form ? summary(form, sc.values, options).filter((x) => x !== sc.label) : [];
  const items: Menu = {
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
                void pinToHome({ target: `shortcut:${sc.id}`, label: sc.label, color: sc.color }),
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
      className="m-shortcut"
      style={{ "--sc": sc.color ?? "var(--accent)" } as React.CSSProperties}
    >
      <button
        type="button"
        className="m-shortcut-main"
        onClick={run}
        onContextMenu={(e) => {
          e.preventDefault();
          menu(items);
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
        onClick={() => menu(items)}
      >
        <MoreVertical size={20} strokeWidth={1.8} />
      </button>
    </div>
  );
}
