import {
  type CalEvent,
  civilFromDays,
  eventDurationMinutes,
  formatDuration,
  formatMinute,
  fromLocal,
  gmtLabel,
  monthNames,
  occurrenceId,
  type PropertyDef,
  type PropValue,
  type Recurrence,
  resolveOccurrence,
  toLocal,
  type When,
  weekdayNames,
  whenStartDay,
} from "@boni/calendar";
import {
  AlignLeft,
  ArrowRight,
  Calendar as CalendarIcon,
  CheckSquare,
  Clock,
  Copy,
  ExternalLink,
  Globe,
  Hash,
  Link as LinkIcon,
  ListChecks,
  MapPin,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  Repeat,
  Square,
  Tag,
  Trash2,
  Type,
  X,
} from "lucide-react";
import {
  type CSSProperties,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { appRect, appRoot, findInApp } from "../host.ts";
import { t } from "../i18n.ts";
import { presetOf, type RecPreset, recurrenceLabel, ruleOf } from "../recurrence.ts";
import { useApp } from "../store.ts";
import { useViewport } from "../ViewportContext.tsx";
import { ChoicePicker, DateField, DraftInput, TimeInput } from "./fields.tsx";
import { Menu } from "./Menu.tsx";
import { RecurrenceModal } from "./RecurrenceModals.tsx";
import { EventReminders } from "./Reminders.tsx";

const DETAIL_W = 340;

export function EventDetail() {
  const popoverId = useApp((s) => s.popoverId);
  const selectedId = useApp((s) => s.selectedId);
  const mode = useApp((s) => s.detailMode);
  const id = mode === "panel" ? selectedId : popoverId;
  const stored = useApp((s) => s.data.events);
  const ev = useMemo(() => (id ? resolveOccurrence(stored, id) : null), [stored, id]);
  const drag = useApp((s) => s.drag);
  if (!ev || (drag && drag.kind !== "create" && drag.id === ev.id && mode === "popover"))
    return null;
  return mode === "panel" ? (
    <aside className="detail-panel">
      <DetailBody ev={ev} />
    </aside>
  ) : (
    <Popover ev={ev} />
  );
}

function Popover({ ev }: { ev: CalEvent }) {
  const vp = useViewport();
  const compact = useApp((s) => s.compact);
  const ref = useRef<HTMLDivElement>(null);
  const [hidden, setHidden] = useState(true);

  const place = useCallback(() => {
    const pop = ref.current;
    if (!pop) return;
    // On a phone the detail is a sheet at the bottom (CSS), whatever the event's place.
    if (useApp.getState().compact) {
      pop.style.left = "";
      pop.style.top = "";
      setHidden(false);
      return;
    }
    const id = CSS.escape(ev.id);
    const anchor = findInApp<HTMLElement>(
      `.ev[data-id="${id}"], .bar[data-id="${id}"], .mchip[data-id="${id}"]`,
    );
    if (!anchor) {
      setHidden(true);
      return;
    }
    const a = anchor.getBoundingClientRect();
    // Viewport coordinates, kept inside the app's box; the popover is positioned relative to that box.
    const box = appRect();
    const body = findInApp(".stage")?.getBoundingClientRect();
    const h = pop.offsetHeight;
    const maxBottom = (body?.bottom ?? box.bottom) - 8;
    const minTop = (body?.top ?? box.top) + 8;
    let left = a.right + 10;
    if (left + DETAIL_W > box.right - 8) left = a.left - DETAIL_W - 10;
    if (left < box.left + 8)
      left = Math.max(box.left + 8, Math.min(box.right - DETAIL_W - 8, a.left + 12));
    let top = a.top;
    if (top + h > maxBottom) top = maxBottom - h;
    top = Math.max(minTop, top);
    pop.style.left = `${Math.round(left - box.left)}px`;
    pop.style.top = `${Math.round(top - box.top)}px`;
    const offscreen = a.bottom < (body?.top ?? box.top) || a.top > (body?.bottom ?? box.bottom);
    setHidden(offscreen);
  }, [ev.id]);

  useLayoutEffect(() => {
    place();
    const raf = requestAnimationFrame(place);
    return () => cancelAnimationFrame(raf);
  });
  useEffect(() => vp.subscribe(place), [vp, place]);
  useEffect(() => {
    // The app's box can change size without the window doing so (a pane resized inside a host).
    const root = appRoot();
    if (!root) {
      window.addEventListener("resize", place);
      return () => window.removeEventListener("resize", place);
    }
    const ro = new ResizeObserver(() => place());
    ro.observe(root);
    return () => ro.disconnect();
  }, [place]);

  return (
    <div
      ref={ref}
      className={`popover ${hidden ? "is-hidden" : ""}`}
      style={{ width: compact ? undefined : DETAIL_W }}
    >
      <DetailBody ev={ev} />
    </div>
  );
}

function PropertyIcon({ type }: { type: PropertyDef["type"] }) {
  const p = { size: 15, strokeWidth: 1.8 };
  switch (type) {
    case "number":
      return <Hash {...p} />;
    case "select":
    case "multiselect":
      return <Tag {...p} />;
    case "checkbox":
      return <ListChecks {...p} />;
    case "date":
      return <CalendarIcon {...p} />;
    case "url":
      return <LinkIcon {...p} />;
    case "project":
      return <Globe {...p} />;
    default:
      return <Type {...p} />;
  }
}

function DetailBody({ ev }: { ev: CalEvent }) {
  const app = useApp();
  const mode = app.detailMode;
  const cal = app.data.calendars.find((c) => c.id === ev.calendarId);
  const [menu, setMenu] = useState(false);
  const isNew = app.newEventId === ev.id;
  const close = () => app.clearSelection();
  const tasks = app.supportsTasks(ev.calendarId);
  const locked = app.isLocked(ev.id);
  const update = (patch: Partial<CalEvent>) => app.editEvents([ev.id], patch);
  const setProp = (id: string, v: PropValue) => update({ props: { ...ev.props, [id]: v } });
  const h24 = app.settings.h24;
  const fmt = useCallback((m: number) => formatMinute(m, h24), [h24]);

  return (
    <div
      className="detail"
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <div className="detail-head">
        <span className="detail-kind">{t("event.page")}</span>
        <span className="spacer" />
        {app.noteOfEvent(ev.id) && (
          <button
            type="button"
            className="icon-btn"
            title={t("event.openNote")}
            onClick={() => void app.openNote(ev.id)}
          >
            <ExternalLink size={15} />
          </button>
        )}
        <div className="menu-anchor">
          <button
            type="button"
            className="icon-btn"
            title={t("event.more")}
            onClick={() => setMenu((m) => !m)}
          >
            <MoreHorizontal size={16} />
          </button>
          <Menu open={menu} onClose={() => setMenu(false)} className="detail-menu">
            <button
              type="button"
              className="menu-item"
              onClick={() => {
                const copy = app.duplicateEvent(ev.id);
                if (copy) app.select(copy, true);
                setMenu(false);
              }}
            >
              <Copy size={14} /> {t("event.duplicate")}
            </button>
            <button
              type="button"
              className="menu-item danger"
              onClick={() => {
                setMenu(false);
                app.removeEvents([ev.id]);
              }}
            >
              <Trash2 size={14} /> {t("event.delete")}
            </button>
          </Menu>
        </div>
        <button
          type="button"
          className="icon-btn"
          title={mode === "panel" ? t("event.collapse") : t("event.expand")}
          onClick={() => app.setDetailMode(mode === "panel" ? "popover" : "panel")}
        >
          {mode === "panel" ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
        </button>
        <button type="button" className="icon-btn" title={t("event.close")} onClick={close}>
          <X size={16} />
        </button>
      </div>

      {/* A read-only calendar (a subscription): everything shows, nothing can be changed. */}
      <fieldset className="detail-fields" disabled={locked}>
        <div className="detail-title">
          <button
            type="button"
            className="task-toggle"
            disabled={!tasks}
            title={tasks ? (ev.isTask ? t("event.done") : t("event.task")) : undefined}
            style={{ "--c": cal?.color ?? "#888" } as CSSProperties}
            onClick={() => (ev.isTask ? update({ done: !ev.done }) : update({ isTask: true }))}
          >
            {ev.isTask ? (
              ev.done ? (
                <CheckSquare size={18} />
              ) : (
                <Square size={18} />
              )
            ) : (
              <span className="cal-dot" />
            )}
          </button>
          <DraftInput
            className="title-input"
            value={ev.title}
            placeholder={t("event.title")}
            autoFocus={isNew}
            onCommit={(v) => {
              update({ title: v });
              if (isNew) app.set({ newEventId: null });
            }}
          />
        </div>

        <div className="detail-section">
          <WhenEditor ev={ev} fmt={fmt} />
          {app.supportsRecurrence(ev.calendarId) && <RepeatRow ev={ev} />}
        </div>

        <div className="detail-section">
          <div className="prop-row">
            <span className="prop-icon">
              <span className="swatch sm" style={{ "--c": cal?.color } as CSSProperties} />
            </span>
            <span className="prop-name">{t("event.calendar")}</span>
            <div className="prop-value">
              <ChoicePicker
                choices={app.data.calendars
                  .filter((c) => !c.readOnly || c.id === ev.calendarId)
                  .map((c) => ({ id: c.id, label: c.name, color: c.color }))}
                selected={[ev.calendarId]}
                onChange={(ids) => ids[0] && update({ calendarId: ids[0] })}
                placeholder="—"
              />
            </div>
          </div>
          {tasks && (
            <div className="prop-row">
              <span className="prop-icon">
                <CheckSquare size={15} strokeWidth={1.8} />
              </span>
              <span className="prop-name">{t("event.type")}</span>
              <div className="prop-value">
                <div className="segmented small" role="radiogroup" aria-label={t("event.type")}>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={!ev.isTask}
                    className={ev.isTask ? "" : "on"}
                    onClick={() => ev.isTask && update({ isTask: false, done: false })}
                  >
                    {t("event.typeEvent")}
                  </button>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={ev.isTask}
                    className={ev.isTask ? "on" : ""}
                    onClick={() => !ev.isTask && update({ isTask: true })}
                  >
                    {t("event.typeTask")}
                  </button>
                </div>
              </div>
            </div>
          )}
          {tasks && ev.isTask && (
            <div className="prop-row">
              <span className="prop-icon" />
              <span className="prop-name">{t("event.done")}</span>
              <div className="prop-value">
                <input
                  type="checkbox"
                  className="check"
                  checked={ev.done}
                  onChange={(e) => update({ done: e.target.checked })}
                />
              </div>
            </div>
          )}
        </div>

        <div className="detail-section props">
          {cal?.schema.map((p) => (
            <PropEditor
              key={p.id}
              def={p}
              value={ev.props[p.id] ?? null}
              onChange={(v) => setProp(p.id, v)}
            />
          ))}
          <div className="prop-row">
            <span className="prop-icon">
              <MapPin size={15} strokeWidth={1.8} />
            </span>
            <span className="prop-name">{t("event.location")}</span>
            <div className="prop-value">
              <DraftInput
                value={ev.location}
                placeholder={t("event.empty")}
                onCommit={(v) => update({ location: v })}
              />
            </div>
          </div>
          <EventReminders ev={ev} locked={locked} />
          <div className="prop-row top">
            <span className="prop-icon">
              <AlignLeft size={15} strokeWidth={1.8} />
            </span>
            <span className="prop-name">{t("event.description")}</span>
            <div className="prop-value">
              <DraftInput
                multiline
                value={ev.description}
                placeholder={t("event.empty")}
                onCommit={(v) => update({ description: v })}
              />
            </div>
          </div>
        </div>
      </fieldset>

      <div className="detail-section meta">
        <MetaRow
          icon={<Hash size={15} strokeWidth={1.8} />}
          name={t("event.id")}
          value={ev.id.toUpperCase()}
        />
        <MetaRow
          icon={<Clock size={15} strokeWidth={1.8} />}
          name={t("event.updated")}
          value={ev.updated ? stamp(ev.updated, app.settings.tz, app.settings.locale, h24) : "—"}
        />
        <MetaRow
          icon={<Clock size={15} strokeWidth={1.8} />}
          name={t("event.created")}
          value={ev.created ? stamp(ev.created, app.settings.tz, app.settings.locale, h24) : "—"}
        />
      </div>
    </div>
  );
}

function RepeatRow({ ev }: { ev: CalEvent }) {
  const locale = useApp((s) => s.settings.locale);
  const [custom, setCustom] = useState(false);
  // A series kept as separate notes carries its rule on every note; otherwise the event is the master.
  const asNotes = useApp((s) => s.supportsSeries(ev.calendarId));
  const rule = asNotes ? (ev.series?.rule ?? null) : (ev.recurrence ?? null);
  const preset = presetOf(rule);
  const startDay = ev.occurrenceDay ?? whenStartDay(ev.when);
  const seriesId = ev.seriesId ?? ev.id;

  const apply = (rule: Recurrence | null) => {
    const app = useApp.getState();
    app.editEvents([ev.id], { recurrence: rule });
    // The event's id changes shape when it becomes (or stops being) a series: follow it.
    if (!asNotes) app.select(rule ? occurrenceId(seriesId, startDay) : seriesId, true);
  };
  const choices = (
    ["none", "daily", "weekly", "monthly", "yearly", "weekdays", "custom"] as const
  ).map((p) => ({
    id: p,
    label: p === "custom" ? t("rec.custom") : t(`rec.${p}` as "rec.none"),
  }));

  return (
    <>
      <div className="prop-row">
        <span className="prop-icon">
          <Repeat size={15} strokeWidth={1.8} />
        </span>
        <span className="prop-name">{t("rec.title")}</span>
        <div className="prop-value">
          <ChoicePicker
            choices={choices}
            selected={[preset === "custom" ? "custom" : preset]}
            placeholder={t("rec.none")}
            trigger={<span className={rule ? "" : "muted"}>{recurrenceLabel(rule, locale)}</span>}
            onChange={(ids) => {
              const p = (ids[0] ?? "none") as RecPreset;
              if (p === "custom") setCustom(true);
              else apply(ruleOf(p));
            }}
          />
        </div>
      </div>
      {custom && (
        <RecurrenceModal
          initial={rule}
          startDay={startDay}
          onClose={() => setCustom(false)}
          onSave={(r) => {
            setCustom(false);
            apply(r);
          }}
        />
      )}
    </>
  );
}

function stamp(ms: number, tz: string, locale: "es" | "en", h24: boolean): string {
  const l = toLocal(ms, tz);
  const { m, d } = civilFromDays(l.day);
  return `${monthNames(locale, "long")[m - 1]} ${d}, ${formatMinute(l.minute, h24)}`;
}

function MetaRow({ icon, name, value }: { icon: React.ReactNode; name: string; value: string }) {
  return (
    <div className="prop-row">
      <span className="prop-icon">{icon}</span>
      <span className="prop-name">{name}</span>
      <span className="prop-value ro">{value}</span>
    </div>
  );
}

const toIso = (day: number) => {
  const { y, m, d } = civilFromDays(day);
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
};
const fromIso = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return y && m && d ? Math.floor(Date.UTC(y, m - 1, d) / 86_400_000) : null;
};

function WhenEditor({ ev, fmt }: { ev: CalEvent; fmt: (m: number) => string }) {
  const settings = useApp((s) => s.settings);
  const update = (when: When) => useApp.getState().editEvents([ev.id], { when });
  const w = ev.when;
  const dateLabel = (day: number) => {
    const { y, m, d } = civilFromDays(day);
    const wd = weekdayNames(settings.locale, "short")[(((day + 4) % 7) + 7) % 7];
    return `${wd} ${d} ${monthNames(settings.locale, "short")[m - 1]} ’${String(y).slice(2)}`;
  };

  if (w.kind === "allday") {
    return (
      <>
        <div className="prop-row">
          <span className="prop-icon">
            <CalendarIcon size={15} strokeWidth={1.8} />
          </span>
          <span className="prop-name">{t("event.date")}</span>
        </div>
        <div className="when-row">
          <DateField
            label={dateLabel(w.startDay)}
            iso={toIso(w.startDay)}
            onChange={(iso) => {
              const d = fromIso(iso);
              if (d !== null)
                update({ kind: "allday", startDay: d, endDay: d + (w.endDay - w.startDay) });
            }}
          />
          <ArrowRight size={14} className="muted" />
          <DateField
            label={dateLabel(w.endDay)}
            iso={toIso(w.endDay)}
            min={toIso(w.startDay)}
            onChange={(iso) => {
              const d = fromIso(iso);
              if (d !== null)
                update({ kind: "allday", startDay: w.startDay, endDay: Math.max(d, w.startDay) });
            }}
          />
        </div>
        <div className="when-row flags">
          <label className="toggle-row">
            <input
              type="checkbox"
              checked
              onChange={() => {
                const start = fromLocal(w.startDay, 9 * 60, settings.tz);
                update({
                  kind: "timed",
                  start,
                  end: start + settings.defaultDuration * 60_000,
                  tz: settings.tz,
                });
              }}
            />
            {t("event.allDay")}
          </label>
        </div>
      </>
    );
  }

  const a = toLocal(w.start, w.tz);
  const b = toLocal(w.end, w.tz);
  const dur = eventDurationMinutes(ev);
  const crosses = b.day !== a.day;
  const setStart = (min: number) => {
    const start = fromLocal(a.day, min, w.tz);
    update({ kind: "timed", start, end: start + (w.end - w.start), tz: w.tz });
  };
  const setEnd = (min: number) => {
    let end = fromLocal(b.day, min, w.tz);
    if (end <= w.start) end = fromLocal(a.day + 1, min, w.tz);
    if (end <= w.start) end = w.start + 15 * 60_000;
    update({ kind: "timed", start: w.start, end, tz: w.tz });
  };
  const setDay = (day: number) => {
    const start = fromLocal(day, a.minute, w.tz);
    update({ kind: "timed", start, end: start + (w.end - w.start), tz: w.tz });
  };
  return (
    <>
      <div className="prop-row">
        <span className="prop-icon">
          <CalendarIcon size={15} strokeWidth={1.8} />
        </span>
        <span className="prop-name">{t("event.date")}</span>
      </div>
      <div className="when-row">
        <TimeInput minute={a.minute} format={fmt} onCommit={setStart} />
        <ArrowRight size={14} className="muted" />
        <TimeInput minute={b.minute} format={fmt} onCommit={setEnd} />
        <span className="duration">{formatDuration(dur)}</span>
      </div>
      <div className="when-row date-line">
        <DateField
          label={dateLabel(a.day)}
          iso={toIso(a.day)}
          onChange={(iso) => {
            const d = fromIso(iso);
            if (d !== null) setDay(d);
          }}
        />
        {crosses && <span className="muted small">→ {dateLabel(b.day)}</span>}
      </div>
      <div className="when-row flags">
        <label className="toggle-row">
          <input
            type="checkbox"
            checked={false}
            onChange={() =>
              update({
                kind: "allday",
                startDay: a.day,
                endDay: b.day - (b.minute === 0 && crosses ? 1 : 0),
              })
            }
          />
          {t("event.allDay")}
        </label>
        <span className="muted small tz-chip" title={t("event.timezone")}>
          <Globe size={12} /> {w.tz.replace("_", " ")} · {gmtLabel(w.start, w.tz)}
        </span>
      </div>
    </>
  );
}

function PropEditor({
  def,
  value,
  onChange,
}: {
  def: PropertyDef;
  value: PropValue;
  onChange: (v: PropValue) => void;
}) {
  const projects = useApp((s) => s.data.projects);
  const locale = useApp((s) => s.settings.locale);
  let control: React.ReactNode;
  switch (def.type) {
    case "number":
      control = (
        <DraftInput
          type="number"
          value={value === null ? "" : String(value)}
          placeholder={t("event.empty")}
          onCommit={(v) => onChange(v === "" ? null : Number(v))}
        />
      );
      break;
    case "checkbox":
      control = (
        <input
          type="checkbox"
          className="check"
          checked={value === true}
          onChange={(e) => onChange(e.target.checked)}
        />
      );
      break;
    case "select":
      control = (
        <ChoicePicker
          choices={def.options ?? []}
          selected={typeof value === "string" ? [value] : []}
          onChange={(ids) => onChange(ids[0] ?? null)}
          placeholder={t("event.empty")}
          noneLabel={t("prop.none")}
        />
      );
      break;
    case "multiselect":
      control = (
        <ChoicePicker
          multi
          choices={def.options ?? []}
          selected={Array.isArray(value) ? value : []}
          onChange={(ids) => onChange(ids)}
          placeholder={t("event.empty")}
        />
      );
      break;
    case "project":
      control = (
        <ChoicePicker
          choices={projects.map((p) => ({ id: p.id, label: p.name }))}
          selected={typeof value === "string" ? [value] : []}
          onChange={(ids) => onChange(ids[0] ?? null)}
          placeholder={t("event.empty")}
          noneLabel={t("prop.none")}
        />
      );
      break;
    case "date": {
      const iso = typeof value === "string" ? value : "";
      const day = iso ? fromIso(iso) : null;
      control = (
        <DateField
          label={
            day === null
              ? t("event.empty")
              : `${weekdayNames(locale, "short")[(((day + 4) % 7) + 7) % 7]} ${civilFromDays(day).d} ${monthNames(locale, "short")[civilFromDays(day).m - 1]}`
          }
          iso={iso}
          onChange={(v) => onChange(v)}
          className={day === null ? "empty" : ""}
        />
      );
      break;
    }
    case "url":
      control = (
        <DraftInput
          type="url"
          value={typeof value === "string" ? value : ""}
          placeholder={t("event.empty")}
          onCommit={(v) => onChange(v || null)}
        />
      );
      break;
    default:
      control = (
        <DraftInput
          value={typeof value === "string" ? value : ""}
          placeholder={t("event.empty")}
          onCommit={(v) => onChange(v || null)}
        />
      );
  }
  return (
    <div className="prop-row">
      <span className="prop-icon">
        <PropertyIcon type={def.type} />
      </span>
      <span className="prop-name">{def.name}</span>
      <div className="prop-value">{control}</div>
    </div>
  );
}
