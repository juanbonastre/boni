import {
  type CalEvent,
  formatMinute,
  formatReminder,
  parseReminder,
  type Reminder,
  type ReminderDefaults,
  sameReminder,
  sortReminders,
} from "@boni/calendar";
import { Bell } from "lucide-react";
import { type CSSProperties, useEffect, useRef, useState } from "react";
import { isExternalCalendar } from "../external.ts";
import { t } from "../i18n.ts";
import { useApp } from "../store.ts";
import { Menu } from "./Menu.tsx";

/** The reminders offered (docs/design-guide.md, Reminders). */
const PRESETS: Record<Reminder["kind"], Reminder[]> = {
  before: ["0m", "5m", "10m", "15m", "30m", "1h", "2h", "1d"].map(
    (s) => parseReminder(s) as Reminder,
  ),
  day: ["0d@09:00", "1d@09:00", "1d@18:00", "2d@09:00"].map((s) => parseReminder(s) as Reminder),
};

export function reminderLabel(r: Reminder, h24: boolean): string {
  if (r.kind === "day") {
    const time = formatMinute(r.at, h24);
    if (r.days === 0) return t("reminders.sameDay", { time });
    if (r.days === 1) return t("reminders.dayBefore", { time });
    return t("reminders.daysBefore", { n: r.days, time });
  }
  const m = r.minutes;
  if (m === 0) return t("reminders.atStart");
  if (m % 1440 === 0)
    return m === 1440 ? t("reminders.day1") : t("reminders.days", { n: m / 1440 });
  if (m % 60 === 0) return t("reminders.hours", { n: m / 60 });
  return t("reminders.minutes", { n: m });
}

export function remindersSummary(list: readonly Reminder[], h24: boolean): string {
  return list.length === 0
    ? t("reminders.none")
    : sortReminders(list)
        .map((r) => reminderLabel(r, h24))
        .join(", ");
}

/**
 * A list of reminders of one kind: a button with the summary and a menu of the usual ones to switch
 * on and off. `inherit` adds "As the calendar" (an event following its calendar's).
 */
export function RemindersPicker({
  kind,
  value,
  onChange,
  inherit,
  disabled,
}: {
  kind: Reminder["kind"];
  value: readonly Reminder[];
  onChange: (list: Reminder[] | null) => void;
  inherit?: { active: boolean; summary: string };
  disabled?: boolean;
}) {
  const h24 = useApp((s) => s.settings.h24);
  const [open, setOpen] = useState(false);
  const has = (r: Reminder) => value.some((x) => sameReminder(x, r));
  const toggle = (r: Reminder) =>
    onChange(sortReminders(has(r) ? value.filter((x) => !sameReminder(x, r)) : [...value, r]));
  const label = inherit?.active
    ? t("reminders.asCalendar", { summary: inherit.summary })
    : remindersSummary(value, h24);
  return (
    <div className="choice reminders-picker">
      <button
        type="button"
        className="choice-btn"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
      >
        <span className={value.length === 0 && !inherit?.active ? "muted" : ""}>{label}</span>
      </button>
      <Menu open={open} onClose={() => setOpen(false)} className="choice-menu">
        {inherit && (
          <button
            type="button"
            className="menu-item"
            onClick={() => {
              onChange(null);
              setOpen(false);
            }}
          >
            <span>{t("reminders.asCalendar", { summary: inherit.summary })}</span>
            {inherit.active && <span className="menu-tick">✓</span>}
          </button>
        )}
        <button
          type="button"
          className="menu-item"
          onClick={() => {
            onChange([]);
            setOpen(false);
          }}
        >
          <span>{t("reminders.none")}</span>
          {value.length === 0 && !inherit?.active && <span className="menu-tick">✓</span>}
        </button>
        <div className="menu-sep" />
        {PRESETS[kind].map((r) => (
          <button
            type="button"
            key={formatReminder(r)}
            className="menu-item"
            onClick={() => toggle(r)}
          >
            <span>{reminderLabel(r, h24)}</span>
            {!inherit?.active && has(r) && <span className="menu-tick">✓</span>}
          </button>
        ))}
      </Menu>
    </div>
  );
}

/** Settings → Reminders: every calendar that can remind, with its reminders for timed and all-day events. */
export function RemindersSettings() {
  const calendars = useApp((s) => s.data.calendars);
  const views = useApp((s) => s.views);
  const externals = useApp((s) => s.settings.externals);
  const focus = useApp((s) => s.settingsFocus);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focus !== "reminders") return;
    ref.current?.scrollIntoView({ block: "start" });
    useApp.getState().set({ settingsFocus: null });
  }, [focus]);
  void views; // re-render when a calendar's reminders change
  void externals;
  const app = useApp.getState();
  const list = calendars.filter((c) => !c.readOnly || isExternalCalendar(c.id));
  return (
    <div ref={ref} className="reminder-settings">
      <h3>{t("settings.reminders")}</h3>
      <p className="muted small">{t("reminders.hint")}</p>
      {list.map((c) => {
        const d: ReminderDefaults = app.remindersOf(c.id);
        const set = (patch: Partial<ReminderDefaults>) =>
          void app.setCalendarReminders(c.id, { ...d, ...patch });
        return (
          <div key={c.id} className="reminder-cal">
            <div className="reminder-cal-name">
              <Bell size={13} />
              <span className="swatch" style={{ "--c": c.color } as CSSProperties} />
              <span>{c.name}</span>
            </div>
            <div className="setting">
              <div className="setting-label">
                <span>{t("reminders.timed")}</span>
              </div>
              <div className="setting-control">
                <RemindersPicker
                  kind="before"
                  value={d.timed}
                  onChange={(l) => set({ timed: l ?? [] })}
                />
              </div>
            </div>
            <div className="setting">
              <div className="setting-label">
                <span>{t("reminders.allDay")}</span>
              </div>
              <div className="setting-control">
                <RemindersPicker
                  kind="day"
                  value={d.allDay}
                  onChange={(l) => set({ allDay: l ?? [] })}
                />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** The detail's "Reminders" row: the event's own, or its calendar's ("As the calendar"). */
export function EventReminders({ ev, locked }: { ev: CalEvent; locked: boolean }) {
  const h24 = useApp((s) => s.settings.h24);
  useApp((s) => s.views);
  useApp((s) => s.settings.externals);
  const app = useApp.getState();
  const d = app.remindersOf(ev.calendarId);
  const kind: Reminder["kind"] = ev.when.kind === "timed" ? "before" : "day";
  const fromCalendar = kind === "before" ? d.timed : d.allDay;
  const own = ev.reminders ?? null;
  return (
    <div className="prop-row">
      <span className="prop-icon">
        <Bell size={15} strokeWidth={1.8} />
      </span>
      <span className="prop-name">{t("event.reminders")}</span>
      <div className="prop-value">
        <RemindersPicker
          kind={kind}
          value={own ?? fromCalendar}
          inherit={{ active: own === null, summary: remindersSummary(fromCalendar, h24) }}
          onChange={(list) => void app.setEventReminders(ev.id, list)}
          disabled={locked}
        />
      </div>
    </div>
  );
}
