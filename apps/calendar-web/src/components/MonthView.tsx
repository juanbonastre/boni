/** The month view: weeks as rows on an epoch so scrolling never moves them, all-day bars and timed chips per day. */
import {
  type CivilDay,
  civilFromDays,
  formatMinute,
  isProposalId,
  layoutSpans,
  monthNames,
  startOfMonth,
  startOfWeek,
  weekdayNames,
} from "@boni/calendar";
import { Repeat } from "lucide-react";
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
import { elementsAt } from "../host.ts";
import { t } from "../i18n.ts";
import { useApp, useVisible } from "../store.ts";
import { NEW_ID } from "./useGridPointer.ts";
import { useMonthPointer } from "./useMonthPointer.ts";
import { useTouchGestures } from "./useTouch.ts";

const ROWS = 6;
const LANE = 19;
const HEAD = 26;
const BUFFER = 3;
/** Rows are positioned relative to an epoch that only moves every this many weeks, so scrolling never shifts existing rows. */
const EPOCH_WEEKS = 26;

export function MonthView() {
  const settings = useApp((s) => s.settings);
  const nav = useApp((s) => s.nav);
  const index = useDayIndex();
  const calMap = useCalendarMap();
  const first = settings.firstDay;
  const today = useApp.getState().today();
  const selectedIds = useApp((s) => s.selectedIds);
  // The event being dragged out is a draft too, from the first moment (only its range shows).
  const newId = useApp((s) => (s.drag?.kind === "create" ? NEW_ID : s.newEventId));

  const pointer = useMonthPointer();
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
  const epoch = Math.floor(block / EPOCH_WEEKS) * EPOCH_WEEKS;
  const epochRef = useRef(epoch);
  const lastVis = useRef(Number.NaN);

  const apply = () => {
    const strip = stripRef.current;
    const x = pos.current.x;
    const wk = (x - w0) / 7;
    if (strip) {
      const dpr = window.devicePixelRatio || 1;
      const y = Math.round(-(wk - epochRef.current) * rowHRef.current * dpr) / dpr; // whole pixels keep text sharp
      strip.style.transform = `translate3d(0, ${y}px, 0)`;
    }
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
    epochRef.current = epoch;
    const from = w0 + 7 * (block - BUFFER) - 7;
    useApp.getState().setWindow(from, from + 7 * (ROWS + 2 * BUFFER + 3));
    apply();
  });

  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const measure = () => {
      const dpr = window.devicePixelRatio || 1;
      // Whole device pixels for rows and columns: fractional boxes soften the text inside them.
      setRowH(Math.floor((body.clientHeight * dpr) / ROWS) / dpr);
      (body.parentElement ?? body).style.setProperty(
        "--mcol",
        `${Math.floor((body.clientWidth * dpr) / 7) / dpr}px`,
      );
    };
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

  // Fingers: the weeks follow a vertical swipe and glide on to a whole week; a long press hands over
  // to the mouse gestures (move, resize, create).
  const touch = useTouchGestures(pointer, {
    pan: (_dx, dy) => {
      const p = pos.current;
      if (p.snap) clearTimeout(p.snap);
      p.x -= (dy / rowHRef.current) * 7;
      p.target = p.x;
      apply();
    },
    fling: (_vx, vy) => {
      const p = pos.current;
      const ahead = p.x - ((vy * 320) / rowHRef.current) * 7;
      p.target = w0 + Math.round((ahead - w0) / 7) * 7;
      kick();
    },
  });

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
      <div
        className="month-body"
        ref={bodyRef}
        style={{ "--rowh": `${rowH}px` } as CSSProperties}
        {...pointer}
        {...touch}
        onDoubleClick={(e) => {
          // The press on an item captured the pointer, so the target is this body: locate by coordinates.
          const item = (
            elementsAt(e.clientX, e.clientY)[0] as HTMLElement | undefined
          )?.closest<HTMLElement>(".mchip[data-id], .bar[data-id]");
          if (item?.dataset.id) useApp.getState().peekEvent(item.dataset.id);
        }}
      >
        <div className="month-strip" ref={stripRef}>
          {rows.map((r) => (
            <WeekRow
              key={r}
              weekStart={w0 + 7 * r}
              top={r - epoch}
              rowH={rowH}
              today={today}
              index={index}
              calMap={calMap}
              selectedIds={selectedIds}
              newId={newId}
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
  /** Row position inside the strip, relative to the current epoch (stable while scrolling). */
  top: number;
  rowH: number;
  today: CivilDay;
  index: DayIndex;
  calMap: Map<string, { color: string }>;
  selectedIds: string[];
  /** The event just created: without a title it shows only as a highlighted range. */
  newId: string | null;
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
                  className={`mchip ${p.selectedIds.includes(ev.id) ? "selected" : ""} ${ev.id === p.newId && !ev.title ? "draft" : ""} ${ev.done ? "done" : ""} ${isProposalId(ev.id) ? "proposal" : ""}`}
                  style={{ "--c": p.calMap.get(ev.calendarId)?.color ?? "#888" } as CSSProperties}
                >
                  <span className="mchip-time">{formatMinute(seg.start, p.h24)}</span>
                  <span className="mchip-title">{ev.title || t("event.untitled")}</span>
                  {ev.recurrence && <Repeat size={10} className="rep" />}
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
            className={`bar ${p.selectedIds.includes(b.id) ? "selected" : ""} ${b.id === p.newId && !ev.title ? "draft" : ""} ${b.clippedStart ? "cut-start" : ""} ${b.clippedEnd ? "cut-end" : ""} ${isProposalId(ev.id) ? "proposal" : ""}`}
            style={
              {
                "--c": p.calMap.get(ev.calendarId)?.color ?? "#888",
                left: `calc(${((b.startDay - weekStart) / 7) * 100}% + 2px)`,
                width: `calc(${((b.endDay - b.startDay + 1) / 7) * 100}% - 4px)`,
                top: `${HEAD + b.lane * LANE}px`,
                height: `${LANE - 2}px`,
              } as CSSProperties
            }
          >
            {!b.clippedStart && (
              <span className="bar-handle start" data-bar-edge="start" data-bar-id={b.id} />
            )}
            <span className="bar-title">{ev.title || t("event.untitled")}</span>
            {ev.recurrence && <Repeat size={10} className="rep" />}
            {!b.clippedEnd && (
              <span className="bar-handle end" data-bar-edge="end" data-bar-id={b.id} />
            )}
          </button>
        );
      })}
    </div>
  );
});
