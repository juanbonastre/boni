import { ChevronDown, Eye, EyeOff, Plus, SlidersHorizontal } from "lucide-react";
import { useState } from "react";
import { t } from "../i18n.ts";
import { useApp } from "../store.ts";

export function CalendarList() {
  const accounts = useApp((s) => s.data.accounts);
  const calendars = useApp((s) => s.data.calendars);
  const toggle = useApp((s) => s.toggleCalendar);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  return (
    <div className="cal-list">
      {accounts.map((acc) => {
        const cals = calendars.filter((c) => c.accountId === acc.id);
        if (cals.length === 0) return null;
        const closed = collapsed.has(acc.id);
        return (
          <section key={acc.id} className="account">
            <button
              type="button"
              className="account-head"
              onClick={() =>
                setCollapsed((prev) => {
                  const next = new Set(prev);
                  if (!next.delete(acc.id)) next.add(acc.id);
                  return next;
                })
              }
            >
              <span className="account-name">{acc.email.includes("@") ? acc.email : acc.name}</span>
              <ChevronDown size={13} className={closed ? "chev closed" : "chev"} />
            </button>
            {!closed &&
              cals.map((c) => (
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
                    onClick={() => useApp.getState().set({ schemaCalendarId: c.id })}
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
      <button type="button" className="add-account" title={t("sidebar.addAccountSoon")} disabled>
        <Plus size={15} />
        <span>{t("sidebar.addAccount")}</span>
      </button>
    </div>
  );
}
