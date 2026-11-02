import { ChevronDown, Eye, EyeOff, Plus, SlidersHorizontal } from "lucide-react";
import { useState } from "react";
import { EXTERNAL_ACCOUNT, isExternalCalendar } from "../external.ts";
import { t } from "../i18n.ts";
import type { CalendarCandidate } from "../remote.ts";
import { type AppState, useApp } from "../store.ts";
import { Menu } from "./Menu.tsx";

/** What "properties" opens for a calendar: its schema, or for an external one its Settings section. */
export const propertiesOf = (id: string): Partial<AppState> =>
  isExternalCalendar(id)
    ? { settingsOpen: true, settingsFocus: "external" }
    : { schemaCalendarId: id };

/** The sidebar's groups: Boni's calendars as one («Calendarios»; Juan, 2026-11-02) and the external ones. */
const BONI = "boni";

export function CalendarList() {
  const calendars = useApp((s) => s.data.calendars);
  const source = useApp((s) => s.source);
  const toggle = useApp((s) => s.toggleCalendar);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const groups = [
    {
      id: BONI,
      name: t("sidebar.calendars"),
      cals: calendars.filter((c) => c.accountId !== EXTERNAL_ACCOUNT),
    },
    {
      id: EXTERNAL_ACCOUNT,
      name: t("external.account"),
      cals: calendars.filter((c) => c.accountId === EXTERNAL_ACCOUNT),
    },
  ];

  return (
    <div className="cal-list">
      {groups.map((g) => {
        if (g.cals.length === 0) return null;
        const closed = collapsed.has(g.id);
        return (
          <section key={g.id} className="account">
            <button
              type="button"
              className="account-head"
              onClick={() =>
                setCollapsed((prev) => {
                  const next = new Set(prev);
                  if (!next.delete(g.id)) next.add(g.id);
                  return next;
                })
              }
            >
              <span className="account-name">{g.name}</span>
              <ChevronDown size={13} className={closed ? "chev closed" : "chev"} />
            </button>
            {!closed &&
              g.cals.map((c) => (
                <div key={c.id} data-cal={c.id} className={`cal-row ${c.visible ? "" : "off"}`}>
                  <button
                    type="button"
                    className="cal-main"
                    onClick={() => toggle(c.id)}
                    title={c.visible ? t("sidebar.hide") : t("sidebar.show")}
                  >
                    <span className="swatch" style={{ "--c": c.color } as React.CSSProperties} />
                    <span className="cal-name">{c.name}</span>
                  </button>
                  <button
                    type="button"
                    className="icon-btn row-btn gear"
                    title={t("sidebar.properties")}
                    onClick={() => useApp.getState().set(propertiesOf(c.id))}
                  >
                    <SlidersHorizontal size={13} />
                  </button>
                  <button
                    type="button"
                    className={`icon-btn row-btn eye ${c.visible ? "" : "keep"}`}
                    title={c.visible ? t("sidebar.hide") : t("sidebar.show")}
                    onClick={() => toggle(c.id)}
                  >
                    {c.visible ? <Eye size={14} /> : <EyeOff size={14} />}
                  </button>
                </div>
              ))}
          </section>
        );
      })}
      {source === "server" && <AddCalendar />}
      <button
        type="button"
        className="add-account"
        onClick={() => useApp.getState().set({ settingsOpen: true, settingsFocus: "external" })}
      >
        <Plus size={15} />
        <span>{t("sidebar.addAccount")}</span>
      </button>
    </div>
  );
}

/**
 * «+ Añadir calendario»: a menu of the server's collections with a day and no calendar yet (asked when it opens);
 * choosing one makes it a calendar, and the server's new snapshot lists it.
 */
function AddCalendar() {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<CalendarCandidate[] | null>(null);
  const show = async () => {
    setOpen(true);
    setList(null);
    setList(await useApp.getState().calendarCandidates());
  };
  return (
    <div className="add-calendar">
      <button type="button" className="add-account" onClick={() => void show()}>
        <Plus size={15} />
        <span>{t("sidebar.addCalendar")}</span>
      </button>
      <Menu open={open} onClose={() => setOpen(false)} className="add-calendar-menu">
        {list === null ? (
          <div className="menu-note">…</div>
        ) : list.length === 0 ? (
          <div className="menu-note">{t("sidebar.noCandidates")}</div>
        ) : (
          list.map((c) => (
            <button
              key={c.type}
              type="button"
              role="menuitem"
              className="menu-item"
              onClick={() => {
                setOpen(false);
                void useApp.getState().addCalendar(c.type);
              }}
            >
              <span className="add-calendar-name">
                {c.icon ? `${c.icon} ` : ""}
                {c.name}
              </span>
              <span className="add-calendar-count">{c.count}</span>
            </button>
          ))
        )}
      </Menu>
    </div>
  );
}
