import type { CalendarDef } from "@boni/calendar";
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
            {!closed && (
              <Level
                cals={g.cals}
                parentId={null}
                depth={0}
                collapsed={collapsed}
                setCollapsed={setCollapsed}
              />
            )}
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

/**
 * The rows of a group as a tree (D-24; Juan, 2026-11-02: «grupo plegable», and any calendar of it split again):
 * a calendar on its own, or a node (a split definition, or a value split again) as a folded row with its name and
 * the field, with what it makes inside. The folded row is the node's: its gear opens the node's properties and
 * its eye shows or hides everything inside; a calendar's own gear opens its own.
 */
function Level({
  cals,
  parentId,
  depth,
  collapsed,
  setCollapsed,
}: {
  cals: CalendarDef[];
  parentId: string | null;
  depth: number;
  collapsed: Set<string>;
  setCollapsed: (f: (prev: Set<string>) => Set<string>) => void;
}) {
  const toggle = useApp((s) => s.toggleCalendar);
  const seen = new Set<string>();
  const out: React.ReactNode[] = [];
  for (const c of cals) {
    const path = c.path ?? [];
    if (depth > 0 && path[depth - 1]?.id !== parentId) continue;
    if (path.length === depth) {
      out.push(<CalRow key={c.id} c={c} depth={depth} />);
      continue;
    }
    const node = path[depth];
    if (!node || seen.has(node.id)) continue;
    seen.add(node.id);
    const gid = `group:${node.id}`;
    const closed = collapsed.has(gid);
    const inside = cals.filter((x) => x.path?.[depth]?.id === node.id);
    const anyVisible = inside.some((m) => m.visible);
    out.push(
      <div key={gid} className="cal-group" data-group={node.id}>
        <div className="cal-group-row" style={{ "--depth": depth } as React.CSSProperties}>
          <button
            type="button"
            className="cal-group-head"
            onClick={() =>
              setCollapsed((prev) => {
                const next = new Set(prev);
                if (!next.delete(gid)) next.add(gid);
                return next;
              })
            }
          >
            <ChevronDown size={12} className={closed ? "chev closed" : "chev"} />
            <span className="cal-group-name">{node.name}</span>
            <span className="cal-group-by">{t("sidebar.groupBy", { field: node.fieldName })}</span>
          </button>
          <button
            type="button"
            className="icon-btn row-btn gear"
            title={t("sidebar.groupProperties", { name: node.name })}
            aria-label={t("sidebar.groupProperties", { name: node.name })}
            onClick={() => useApp.getState().set({ schemaCalendarId: node.id })}
          >
            <SlidersHorizontal size={13} />
          </button>
          <button
            type="button"
            className={`icon-btn row-btn eye ${anyVisible ? "" : "keep"}`}
            title={anyVisible ? t("sidebar.hideAll") : t("sidebar.showAll")}
            aria-label={anyVisible ? t("sidebar.hideAll") : t("sidebar.showAll")}
            onClick={() => {
              // Everything inside at once: hidden while any shows, shown otherwise.
              for (const m of inside) if (m.visible === anyVisible) toggle(m.id);
            }}
          >
            {anyVisible ? <Eye size={14} /> : <EyeOff size={14} />}
          </button>
        </div>
        {!closed && (
          <Level
            cals={inside}
            parentId={node.id}
            depth={depth + 1}
            collapsed={collapsed}
            setCollapsed={setCollapsed}
          />
        )}
      </div>,
    );
  }
  return <>{out}</>;
}

function CalRow({ c, depth = 0 }: { c: CalendarDef; depth?: number }) {
  const toggle = useApp((s) => s.toggleCalendar);
  return (
    <div
      data-cal={c.id}
      className={`cal-row ${c.visible ? "" : "off"}${depth ? " member" : ""}`}
      style={{ "--depth": depth } as React.CSSProperties}
    >
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
  );
}
