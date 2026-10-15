import {
  type CivilDay,
  civilFromDays,
  formatMinute,
  layoutSpans,
  monthNames,
  startOfMonth,
  startOfWeek,
  weekdayNames,
} from "@boni-calendar/core";
import {
  type CSSProperties,
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { DayIndex } from "../engine/dayIndex.ts";
import { clamp, looksLikeNotch, wheelPixels } from "../engine/viewport.ts";
import { useCalendarMap, useDayIndex } from "../hooks.ts";
import { t } from "../i18n.ts";
import { useApp, useVisible } from "../store.ts";

const ROWS = 6;
const LANE = 19;
const HEAD = 26;
const BUFFER = 4;

export function MonthView() {
  const settings = useApp((s) => s.settings);
  const nav = useApp((s) => s.nav);
  const index = useDayIndex();
  const calMap = useCalendarMap();
  const first = settings.firstDay;
  const today = useApp.getState().today();
  const selectedIds = useApp((s) => s.selectedIds);

  const bodyRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const [rowH, setRowH] = useState(120);
  const w0 = startOfWeek(0, first);
  const align = (day: CivilDay) => startOfWeek(startOfMonth(day), first);

  // Position in days (float, civil day of the top row's first day).
  const pos = useRef({
    x: align(nav.day),
    target: align(nav.day),
    raf: 0,
    last: 0,
    snap: null as ReturnType<typeof setTimeout> | null,
  });
  const rowHRef = useRef(rowH);
  rowHRef.current = rowH;
  const [block, setBlock] = useState(() => Math.floor((pos.current.x - w0) / 7));
  const blockRef = useRef(block);
  const firstRowRef = useRef(block - BUFFER);
  const lastVis = useRef(Number.NaN);

  const apply = () => {
    const strip = stripRef.current;
    const x = pos.current.x;
    const wk = (x - w0) / 7;
    if (strip)
      strip.style.transform = `translate3d(0, ${-(wk - firstRowRef.current) * rowHRef.current}px, 0)`;
    const nb = Math.floor(wk);
    if (nb !== blockRef.current) {
      blockRef.current = nb;
      setBlock(nb);
    }
    const centerRowStart = w0 + 7 * (Math.round(wk) + 2);
    const centerDay = centerRowStart + 3;
    if (centerDay !== lastVis.current) {
      lastVis.current = centerDay;
      useVisible.setState({ start: centerDay, weekStart: centerRowStart });
    }
  };

  const tick = () => {
    const p = pos.current;
    const now = performance.now();
    const dt = clamp(now - p.last, 1, 64);
    p.last = now;
    p.x += (p.target - p.x) * (1 - Math.exp(-dt / 80));
    if (Math.abs(p.target - p.x) < 0.002) p.x = p.target;
    apply();
    p.raf = p.x !== p.target ? requestAnimationFrame(tick) : 0;
  };
  const kick = () => {
    const p = pos.current;
    if (!p.raf) {
      p.last = performance.now();
      p.raf = requestAnimationFrame(tick);
    }
  };

  useLayoutEffect(() => {
    firstRowRef.current = block - BUFFER;
    apply();
  });

  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const measure = () => setRowH(body.clientHeight / ROWS);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(body);
    return () => ro.disconnect();
  }, []);

  // Navigation requests.
  const firstRun = useRef(true);
  useEffect(() => {
    const target = align(nav.day);
    if (firstRun.current) {
      firstRun.current = false;
      pos.current.x = pos.current.target = target;
      apply();
      return;
    }
    pos.current.target = target;
    if (!nav.animate) pos.current.x = target;
    kick();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nav.seq]);

  useEffect(() => {
    const el = bodyRef.current?.parentElement;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.shiftKey) return;
      const dy = wheelPixels(e.deltaY, e.deltaMode, rowHRef.current * ROWS);
      const weeks = looksLikeNotch(dy) ? dy / 100 : dy / rowHRef.current;
      pos.current.target += weeks * 7;
      if (pos.current.snap) clearTimeout(pos.current.snap);
      pos.current.snap = setTimeout(() => {
        pos.current.target = w0 + Math.round((pos.current.target - w0) / 7) * 7;
        kick();
      }, 140);
      kick();
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [w0]);

  useEffect(() => {
    const p = pos.current;
    return () => {
      if (p.raf) cancelAnimationFrame(p.raf);
      if (p.snap) clearTimeout(p.snap);
    };
  }, []);

  const rows = useMemo(
    () => Array.from({ length: ROWS + 2 * BUFFER + 1 }, (_, i) => block - BUFFER + i),
    [block],
  );
  const dow = weekdayNames(settings.locale, "short");

  return (
    <div className="month">
      <div className="month-dow">
        {Array.from({ length: 7 }, (_, i) => (
          <span key={i}>{dow[(first + i) % 7]}</span>
        ))}
      </div>
      <div className="month-body" ref={bodyRef} style={{ "--rowh": `${rowH}px` } as CSSProperties}>
        <div className="month-strip" ref={stripRef}>
          {rows.map((r, i) => (
            <WeekRow
              key={r}
              weekStart={w0 + 7 * r}
              top={i}
              rowH={rowH}
              today={today}
              index={index}
              calMap={calMap}
              selectedIds={selectedIds}
              h24={settings.h24}
              locale={settings.locale}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

const WeekRow = memo(function WeekRow(p: {
  weekStart: CivilDay;
  top: number;
  rowH: number;
  today: CivilDay;
  index: DayIndex;
  calMap: Map<string, { color: string }>;
  selectedIds: string[];
  h24: boolean;
  locale: "es" | "en";
}) {
  const { weekStart, index } = p;
  const bars = useMemo(() => {
    const items = index.allDay.flatMap((e) =>
      e.when.kind === "allday"
        ? [{ id: e.id, startDay: e.when.startDay, endDay: e.when.endDay }]
        : [],
    );
    return layoutSpans(items, weekStart, weekStart + 6);
  }, [index.allDay, weekStart]);
  const lanes = bars.reduce((m, b) => Math.max(m, b.lane + 1), 0);
  const capacity = Math.max(1, Math.floor((p.rowH - HEAD - 4) / LANE));
  const chipCap = Math.max(0, capacity - lanes);

  return (
    <div className="week-row" style={{ top: `${p.top * p.rowH}px`, height: `${p.rowH}px` }}>
      {Array.from({ length: 7 }, (_, i) => {
        const day = weekStart + i;
        const { y, m, d } = civilFromDays(day);
        const segs = [...(index.timed.get(day) ?? [])].sort(
          (a, b) => a.start - b.start || a.eventId.localeCompare(b.eventId),
        );
        const overflow = segs.length > chipCap;
        const shown = overflow ? segs.slice(0, Math.max(0, chipCap - 1)) : segs;
        const hidden = segs.length - shown.length;
        const odd = (y * 12 + m) % 2 === 1;
        return (
          <div
            key={day}
            className={`mcell ${odd ? "odd" : ""} ${day === p.today ? "today" : ""}`}
            style={{ paddingTop: HEAD + lanes * LANE }}
            data-day={day}
            onDoubleClick={(e) => {
              if ((e.target as HTMLElement).closest(".mchip, .bar")) return;
              const s = useApp.getState();
              const id = s.addEvent({ when: { kind: "allday", startDay: day, endDay: day } });
              s.select(id, true);
            }}
            onClick={(e) => {
              if ((e.target as HTMLElement).closest(".mchip, .mnum, .more")) return;
              useApp.getState().select(null);
            }}
          >
            <button
              type="button"
              className="mnum"
              onClick={() => {
                const s = useApp.getState();
                s.setView("day");
                s.goTo(day, false);
              }}
            >
              {d === 1 ? `${d} ${monthNames(p.locale, "short")[m - 1]?.toLowerCase()}` : d}
            </button>
            {shown.map((seg) => {
              const ev = index.byId.get(seg.eventId);
              if (!ev) return null;
              return (
                <button
                  type="button"
                  key={`${seg.eventId}:${day}`}
                  data-id={ev.id}
                  className={`mchip ${p.selectedIds.includes(ev.id) ? "selected" : ""} ${ev.done ? "done" : ""}`}
                  style={{ "--c": p.calMap.get(ev.calendarId)?.color ?? "#888" } as CSSProperties}
                  onClick={(e) =>
                    useApp
                      .getState()
                      .clickSelect(ev.id, { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey })
                  }
                >
                  <span className="dot" />
                  <span className="mchip-time">{formatMinute(seg.start, p.h24)}</span>
                  <span className="mchip-title">{ev.title || t("event.untitled")}</span>
                </button>
              );
            })}
            {hidden > 0 && (
              <button
                type="button"
                className="more"
                onClick={() => {
                  const s = useApp.getState();
                  s.setView("day");
                  s.goTo(day, false);
                }}
              >
                {t("month.more", { n: hidden })}
              </button>
            )}
          </div>
        );
      })}
      {bars.map((b) => {
        const ev = index.byId.get(b.id);
        if (!ev) return null;
        return (
          <button
            type="button"
            key={b.id}
            data-id={b.id}
            className={`bar ${p.selectedIds.includes(b.id) ? "selected" : ""} ${b.clippedStart ? "cut-start" : ""} ${b.clippedEnd ? "cut-end" : ""}`}
            style={
              {
                "--c": p.calMap.get(ev.calendarId)?.color ?? "#888",
                left: `calc(${((b.startDay - weekStart) / 7) * 100}% + 2px)`,
                width: `calc(${((b.endDay - b.startDay + 1) / 7) * 100}% - 4px)`,
                top: `${HEAD + b.lane * LANE}px`,
                height: `${LANE - 2}px`,
              } as CSSProperties
            }
            onClick={(e) =>
              useApp
                .getState()
                .clickSelect(b.id, { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey })
            }
          >
            <span className="bar-title">{ev.title || t("event.untitled")}</span>
          </button>
        );
      })}
    </div>
  );
});
