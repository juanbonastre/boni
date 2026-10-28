import { fromLocal, PALETTE } from "@boni/calendar";
import {
  Bell,
  CalendarDays,
  CheckSquare,
  ChevronRight,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  Maximize2,
  Plus,
  SlidersHorizontal,
  Square,
  Trash2,
} from "lucide-react";
import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { isExternalCalendar } from "../external.ts";
import { appRect, appRoot, eventTarget, findInApp, onKeys } from "../host.ts";
import { t } from "../i18n.ts";
import { notesBridge } from "../notesBridge.ts";
import { type CtxTarget, useApp } from "../store.ts";
import { useViewport } from "../ViewportContext.tsx";
import { propertiesOf } from "./CalendarList.tsx";
import { lastPointerWasTouch } from "./useTouch.ts";

/** Opens the right-click menu for events, empty grid space, month cells and calendars. */
export function useContextMenuTrigger() {
  const vp = useViewport();
  useEffect(() => {
    const onContext = (e: MouseEvent) => {
      // The browser's own long-press menu: the touch gestures open ours (only if the finger did not drag).
      if (e.isTrusted && lastPointerWasTouch()) {
        e.preventDefault();
        return;
      }
      const el = eventTarget(e);
      if (!el) return;
      if (el.closest("input, textarea, select, .popover, .scrim, .menu, .ctx")) return;
      const app = useApp.getState();
      let target: CtxTarget | null = null;

      const ev = el.closest<HTMLElement>(".ev[data-id], .bar[data-id], .mchip[data-id]");
      const cal = el.closest<HTMLElement>(".cal-row[data-cal]");
      const col = el.closest<HTMLElement>(".col[data-day]");
      const cell = el.closest<HTMLElement>(".mcell[data-day]");
      if (ev?.dataset.id) {
        target = { kind: "event", id: ev.dataset.id };
        const keep = app.selectedIds.includes(ev.dataset.id) && app.selectedIds.length > 1;
        if (!keep) app.select(ev.dataset.id, false);
      } else if (cal?.dataset.cal) {
        target = { kind: "calendar", id: cal.dataset.cal };
      } else if (col?.dataset.day) {
        const body = findInApp(".body")?.getBoundingClientRect();
        const snap = app.settings.snap;
        const raw = body ? ((vp.scrollY + (e.clientY - body.top)) / vp.hh) * 60 : 540;
        const minute = Math.min(1440 - snap, Math.max(0, Math.floor(raw / snap) * snap));
        target = { kind: "slot", day: Number(col.dataset.day), minute };
      } else if (cell?.dataset.day) {
        target = { kind: "slot", day: Number(cell.dataset.day), minute: null };
      }
      if (!target) return;
      e.preventDefault();
      app.set({ popoverId: null, ctxMenu: { x: e.clientX, y: e.clientY, target } });
    };
    // Only right clicks inside the app: around it (another host) the native menu stays.
    const target = appRoot() ?? window;
    const h = onContext as EventListener;
    target.addEventListener("contextmenu", h);
    return () => target.removeEventListener("contextmenu", h);
  }, [vp]);
}

export function ContextMenu() {
  const menu = useApp((s) => s.ctxMenu);
  const close = () => useApp.getState().set({ ctxMenu: null });
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useEffect(() => {
    if (!menu) return;
    const down = (e: PointerEvent) => {
      if (!eventTarget(e)?.closest(".ctx")) close();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    };
    window.addEventListener("pointerdown", down, true);
    const offKeys = onKeys(key, true);
    window.addEventListener("wheel", close, { passive: true });
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("pointerdown", down, true);
      offKeys();
      window.removeEventListener("wheel", close);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
    };
  }, [menu]);

  useLayoutEffect(() => {
    if (!menu) {
      setPos(null);
      return;
    }
    const el = ref.current;
    const w = el?.offsetWidth ?? 240;
    const h = el?.offsetHeight ?? 200;
    // The menu is placed inside the app's box (its containing block), in coordinates relative to it.
    const box = appRect();
    setPos({
      left: Math.max(8, Math.min(menu.x - box.left, box.right - box.left - w - 8)),
      top: Math.max(8, Math.min(menu.y - box.top, box.bottom - box.top - h - 8)),
    });
  }, [menu]);

  if (!menu) return null;
  const flip = menu.x > appRect().right - 520;
  return (
    <div
      ref={ref}
      className={`ctx ${flip ? "flip" : ""}`}
      role="menu"
      style={{
        left: pos?.left ?? menu.x,
        top: pos?.top ?? menu.y,
        visibility: pos ? "visible" : "hidden",
      }}
    >
      {menu.target.kind === "event" && <EventItems id={menu.target.id} close={close} />}
      {menu.target.kind === "slot" && (
        <SlotItems day={menu.target.day} minute={menu.target.minute} close={close} />
      )}
      {menu.target.kind === "calendar" && <CalendarItems id={menu.target.id} close={close} />}
    </div>
  );
}

function Item({
  icon,
  children,
  onClick,
  danger = false,
  disabled = false,
  hint,
}: {
  icon?: ReactNode;
  children: ReactNode;
  onClick?: () => void;
  danger?: boolean;
  disabled?: boolean;
  hint?: string;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className={`menu-item ${danger ? "danger" : ""}`}
      disabled={disabled}
      onClick={onClick}
    >
      <span className="ctx-icon">{icon}</span>
      {children}
      {hint && <kbd>{hint}</kbd>}
    </button>
  );
}

function EventItems({ id, close }: { id: string; close: () => void }) {
  const events = useApp((s) => s.expanded());
  const calendars = useApp((s) => s.data.calendars);
  const selectedIds = useApp((s) => s.selectedIds);
  const [sub, setSub] = useState(false);
  // Right-clicking one of several selected events acts on the whole selection.
  const ids = selectedIds.includes(id) && selectedIds.length > 1 ? selectedIds : [id];
  const multi = ids.length > 1;
  const targets = events.filter((e) => ids.includes(e.id));
  const ev = events.find((e) => e.id === id);
  if (!ev || targets.length === 0) return null;
  const cal = calendars.find((c) => c.id === ev.calendarId);
  const locked = targets.some(
    (e) => calendars.find((c) => c.id === e.calendarId)?.readOnly === true,
  );
  const canTask = targets.every((e) => useApp.getState().supportsTasks(e.calendarId));
  const allTasks = targets.every((e) => e.isTask);
  const allDone = targets.every((e) => e.done);
  const suffix = multi ? ` (${ids.length})` : "";
  const app = useApp.getState();
  const run = (fn: () => void) => () => {
    close();
    fn();
  };
  return (
    <>
      {!multi && (
        <>
          <Item icon={<Maximize2 size={14} />} onClick={run(() => app.select(id, true))}>
            {t("ctx.open")}
          </Item>
          <div className="menu-sep" />
        </>
      )}
      {!multi && app.noteOfEvent(id) && (
        <Item icon={<ExternalLink size={14} />} onClick={run(() => void app.openNote(id))}>
          {t(notesBridge()?.noteApp === "boni" ? "event.openInBoni" : "ctx.openNote")}
        </Item>
      )}
      {canTask && allTasks && (
        <Item
          icon={allDone ? <Square size={14} /> : <CheckSquare size={14} />}
          disabled={locked}
          onClick={run(() => app.editEvents(ids, { done: !allDone }))}
        >
          {(allDone ? t("ctx.markUndone") : t("ctx.markDone")) + suffix}
        </Item>
      )}
      {canTask && (
        <Item
          icon={<CalendarDays size={14} />}
          disabled={locked}
          onClick={run(() =>
            app.editEvents(ids, allTasks ? { isTask: false, done: false } : { isTask: true }),
          )}
        >
          {(allTasks ? t("ctx.makeEvent") : t("ctx.makeTask")) + suffix}
        </Item>
      )}
      <Item
        icon={<Copy size={14} />}
        disabled={locked}
        onClick={run(() => {
          const copies = app.duplicateEvents(ids);
          if (copies.length === 1 && copies[0]) app.select(copies[0], true);
        })}
      >
        {t("ctx.duplicate") + suffix}
      </Item>
      <div
        className="ctx-sub-wrap"
        onMouseEnter={() => setSub(true)}
        onMouseLeave={() => setSub(false)}
      >
        <Item
          icon={<span className="swatch sm" style={{ "--c": cal?.color } as CSSProperties} />}
          disabled={locked}
          onClick={() => setSub((v) => !v)}
        >
          <span className="grow">{t("ctx.moveTo") + suffix}</span>
          <ChevronRight size={14} />
        </Item>
        {sub && !locked && (
          <div className="ctx-sub" role="menu">
            {calendars
              .filter((c) => !c.readOnly)
              .map((c) => (
                <Item
                  key={c.id}
                  icon={<span className="swatch sm" style={{ "--c": c.color } as CSSProperties} />}
                  onClick={run(() => app.editEvents(ids, { calendarId: c.id }))}
                  hint={targets.every((e) => e.calendarId === c.id) ? "✓" : undefined}
                >
                  {c.name}
                </Item>
              ))}
          </div>
        )}
      </div>
      <div className="menu-sep" />
      <Item
        icon={<Trash2 size={14} />}
        danger
        disabled={locked}
        onClick={run(() => app.removeEvents(ids))}
        hint="Supr"
      >
        {t("ctx.delete") + suffix}
      </Item>
      {locked && <div className="ctx-note">{t("ctx.readOnly")}</div>}
    </>
  );
}

function SlotItems({
  day,
  minute,
  close,
}: {
  day: number;
  minute: number | null;
  close: () => void;
}) {
  const run = (fn: () => void) => () => {
    close();
    fn();
  };
  const app = useApp.getState();
  const tz = app.settings.tz;
  return (
    <>
      {minute !== null && (
        <Item
          icon={<Plus size={14} />}
          onClick={run(() => {
            const dur = app.settings.defaultDuration;
            const id = app.addEvent({
              when: {
                kind: "timed",
                start: fromLocal(day, minute, tz),
                end: fromLocal(day, Math.min(1440, minute + dur), tz),
                tz,
              },
            });
            app.select(id, true);
          })}
        >
          {t("ctx.newHere")}
        </Item>
      )}
      <Item
        icon={<CalendarDays size={14} />}
        onClick={run(() => {
          const id = app.addEvent({ when: { kind: "allday", startDay: day, endDay: day } });
          app.select(id, true);
        })}
      >
        {t("ctx.newAllDay")}
      </Item>
      <div className="menu-sep" />
      <Item onClick={run(() => app.goToday())} hint="T">
        {t("ctx.goToday")}
      </Item>
    </>
  );
}

function CalendarItems({ id, close }: { id: string; close: () => void }) {
  const cal = useApp((s) => s.data.calendars.find((c) => c.id === id));
  const all = useApp((s) => s.data.calendars);
  if (!cal) return null;
  const app = useApp.getState();
  const run = (fn: () => void) => () => {
    close();
    fn();
  };
  const onlyThis = all.every((c) => c.visible === (c.id === id));
  return (
    <>
      <Item
        icon={cal.visible ? <EyeOff size={14} /> : <Eye size={14} />}
        onClick={run(() => app.toggleCalendar(id))}
      >
        {cal.visible ? t("ctx.hideCal") : t("ctx.showCal")}
      </Item>
      <Item
        icon={<Eye size={14} />}
        onClick={run(() => (onlyThis ? app.showAllCalendars() : app.showOnlyCalendar(id)))}
      >
        {onlyThis ? t("ctx.showAll") : t("ctx.onlyThis")}
      </Item>
      <Item icon={<SlidersHorizontal size={14} />} onClick={run(() => app.set(propertiesOf(id)))}>
        {t("ctx.properties")}
      </Item>
      {(!cal.readOnly || isExternalCalendar(id)) && (
        <Item
          icon={<Bell size={14} />}
          onClick={run(() => app.set({ settingsOpen: true, settingsFocus: "reminders" }))}
        >
          {t("ctx.reminders")}
        </Item>
      )}
      {!cal.readOnly && (
        <>
          <div className="menu-sep" />
          <div className="ctx-colors" role="group" aria-label={t("ctx.color")}>
            {Object.values(PALETTE).map((c) => (
              <button
                type="button"
                key={c}
                aria-label={c}
                className={`swatch pick ${c === cal.color ? "on" : ""}`}
                style={{ "--c": c } as CSSProperties}
                onClick={run(() => app.updateCalendar(id, { color: c }))}
              />
            ))}
          </div>
        </>
      )}
    </>
  );
}
