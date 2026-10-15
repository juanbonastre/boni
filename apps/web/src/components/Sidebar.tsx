import { PanelLeft, Search, SquarePen } from "lucide-react";
import { t } from "../i18n.ts";
import { useApp } from "../store.ts";
import { CalendarList } from "./CalendarList.tsx";
import { MiniMonth } from "./MiniMonth.tsx";

export function Sidebar() {
  const toggle = useApp((s) => s.toggleSidebar);
  return (
    <aside className="sidebar">
      <div className="sidebar-top">
        <button type="button" className="icon-btn" title={t("sidebar.toggle")} onClick={toggle}>
          <PanelLeft size={16} />
        </button>
        <span className="spacer" />
        <button
          type="button"
          className="icon-btn"
          title={t("sidebar.search")}
          onClick={() => useApp.getState().set({ paletteOpen: true })}
        >
          <Search size={16} />
        </button>
        <button
          type="button"
          className="icon-btn"
          title={t("sidebar.newEvent")}
          onClick={() => useApp.getState().set({ paletteOpen: true })}
        >
          <SquarePen size={16} />
        </button>
      </div>
      <MiniMonth />
      <div className="sidebar-scroll">
        <CalendarList />
      </div>
      <div className="sidebar-foot">
        <button
          type="button"
          className="foot-btn"
          onClick={() => useApp.getState().set({ settingsOpen: true })}
        >
          {t("settings.title")}
        </button>
        <button
          type="button"
          className="foot-btn"
          onClick={() => useApp.getState().set({ helpOpen: true })}
        >
          ?
        </button>
      </div>
    </aside>
  );
}
