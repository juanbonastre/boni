import { fromLocal, PALETTE } from "@boni-calendar/core";
import {
  CalendarDays,
  CheckSquare,
  ChevronRight,
  Copy,
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
import { t } from "../i18n.ts";
import { type CtxTarget, useApp } from "../store.ts";
import { useViewport } from "../ViewportContext.tsx";

/** Opens the right-click menu for events, empty grid space, month cells and calendars. */
export function useContextMenuTrigger() {
  const vp = useViewport();
  useEffect(() => {
    const onContext = (e: MouseEvent) => {
      const el = e.target as HTMLElement | null;
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
        app.select(ev.dataset.id, false);
      } else if (cal?.dataset.cal) {
        target = { kind: "calendar", id: cal.dataset.cal };
      } else if (col?.dataset.day) {
        const body = document.querySelector(".body")?.getBoundingClientRect();
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
    window.addEventListener("contextmenu", onContext);
    return () => window.removeEventListener("contextmenu", onContext);
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
      if (!(e.target as HTMLElement).closest(".ctx")) close();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    };
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("keydown", key, true);
    window.addEventListener("wheel", close, { passive: true });
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("keydown", key, true);
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
    setPos({
      left: Math.max(8, Math.min(menu.x, window.innerWidth - w - 8)),
      top: Math.max(8, Math.min(menu.y, window.innerHeight - h - 8)),
    });
  }, [menu]);

  if (!menu) return null;
  const flip = menu.x > window.innerWidth - 520;
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
  const ev = useApp((s) => s.data.events.find((e) => e.id === id));
  const calendars = useApp((s) => s.data.calendars);
  const [sub, setSub] = useState(false);
  if (!ev) return null;
  const cal = calendars.find((c) => c.id === ev.calendarId);
  const locked = cal?.readOnly === true;
  const app = useApp.getState();
  const run = (fn: () => void) => () => {
    close();
    fn();
  };
  return (
    <>
      <Item icon={<Maximize2 size={14} />} onClick={run(() => app.select(id, true))}>
        {t("ctx.open")}
      </Item>
      <div className="menu-sep" />
      {ev.isTask && (
        <Item
          icon={ev.done ? <Square size={14} /> : <CheckSquare size={14} />}
          disabled={locked}
          onClick={run(() => app.updateEvent(id, { done: !ev.done }))}
        >
          {ev.done ? t("ctx.markUndone") : t("ctx.markDone")}
        </Item>
      )}
      <Item
        icon={<CalendarDays size={14} />}
        disabled={locked}
        onClick={run(() =>
          app.updateEvent(id, ev.isTask ? { isTask: false, done: false } : { isTask: true }),
        )}
      >
        {ev.isTask ? t("ctx.makeEvent") : t("ctx.makeTask")}
      </Item>
      <Item
        icon={<Copy size={14} />}
        disabled={locked}
        onClick={run(() => {
          const copy = app.duplicateEvent(id);
          if (copy) app.select(copy, true);
        })}
      >
        {t("ctx.duplicate")}
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
          <span className="grow">{t("ctx.moveTo")}</span>
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
                  onClick={run(
                    () => c.id !== ev.calendarId && app.updateEvent(id, { calendarId: c.id }),
                  )}
                  hint={c.id === ev.calendarId ? "✓" : undefined}
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
        onClick={run(() => app.deleteEvent(id))}
        hint="Supr"
      >
        {t("ctx.delete")}
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
      <Item
        icon={<SlidersHorizontal size={14} />}
        onClick={run(() => app.set({ schemaCalendarId: id }))}
      >
        {t("ctx.properties")}
      </Item>
      {!cal.readOnly && (
        <>
          <div className="menu-sep" />
          <div className="ctx-colors" aria-label={t("ctx.color")}>
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
