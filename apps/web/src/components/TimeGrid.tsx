import {
  type CalEvent,
  type CalendarDef,
  type CivilDay,
  civilFromDays,
  type DaySegment,
  formatMinute,
  fromLocal,
  gmtLabel,
  isoWeek,
  layoutColumns,
  layoutSpans,
  startOfWeek,
  toLocal,
  tzOffsetMs,
  weekdayNames,
} from "@boni-calendar/core";
import { Check, Plus } from "lucide-react";
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
import { useCalendarMap, useDayIndex, useNow } from "../hooks.ts";
import { t } from "../i18n.ts";
import { alignForView, useApp, useVisible, visibleDays } from "../store.ts";
import { useViewport } from "../ViewportContext.tsx";
import { useGridPointer } from "./useGridPointer.ts";

const BLOCK = 1;
/** While zooming, scale the committed layout on the compositor up to this stretch, then re-layout. */
const ZOOM_STRETCH_LIMIT = 0.5;
const GUTTER = 64;

export function TimeGrid() {
  const vp = useViewport();
  const view = useApp((s) => s.view);
  const nDays = useApp((s) => s.nDays);
  const nav = useApp((s) => s.nav);
  const settings = useApp((s) => s.settings);
  const sidebarOpen = useApp((s) => s.sidebarOpen);
  const detailMode = useApp((s) => s.detailMode);
  const popoverId = useApp((s) => s.popoverId);
  const n = visibleDays(view, nDays);
  const index = useDayIndex();
  const calMap = useCalendarMap();
  const now = useNow();

  const rootRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const colsRef = useRef<HTMLDivElement>(null);
  const colsStripRef = useRef<HTMLDivElement>(null);
  const headStripRef = useRef<HTMLDivElement>(null);
  const alldayStripRef = useRef<HTMLDivElement>(null);
  const gutterInnerRef = useRef<HTMLDivElement>(null);
  const gutter2InnerRef = useRef<HTMLDivElement>(null);
  const linesRef = useRef<HTMLDivElement>(null);

  const [block, setBlock] = useState(() => Math.floor(vp.viewX / BLOCK) * BLOCK);
  const renderStart = block - BLOCK;
  const renderCount = n + 3 * BLOCK;
  const renderStartRef = useRef(renderStart);
  const blockRef = useRef(block);
  const lastHh = useRef(-1);
  const lastVisible = useRef(Number.NaN);

  const apply = (hh: number, scrollY: number, viewX: number) => {
    const root = rootRef.current;
    if (!root) return;
    const stretching =
      vp.isZooming && lastHh.current > 0 && Math.abs(hh / lastHh.current - 1) < ZOOM_STRETCH_LIMIT;
    if (!stretching && hh !== lastHh.current) {
      const total = `${hh * 24}px`;
      const cs0 = colsStripRef.current;
      if (cs0) cs0.style.height = total;
      const g0 = gutterInnerRef.current;
      if (g0) g0.style.height = total;
      const g20 = gutter2InnerRef.current;
      if (g20) g20.style.height = total;
      const ln = linesRef.current;
      if (ln) {
        ln.style.height = total;
        ln.style.backgroundSize = `100% ${hh}px, 100% ${hh / 2}px`;
        ln.classList.toggle("fine", hh >= 90);
      }
      root.classList.toggle("zoom-coarse", hh < 34);
      lastHh.current = hh;
    }
    const x = -(viewX - renderStartRef.current) * vp.colW;
    const scale = hh === lastHh.current ? "" : ` scaleY(${hh / lastHh.current})`;
    const cs = colsStripRef.current;
    if (cs) cs.style.transform = `translate3d(${x}px, ${-scrollY}px, 0)${scale}`;
    const hs = headStripRef.current;
    if (hs) hs.style.transform = `translate3d(${x}px, 0, 0)`;
    const as = alldayStripRef.current;
    if (as) as.style.transform = `translate3d(${x}px, 0, 0)`;
    const g = gutterInnerRef.current;
    if (g) g.style.transform = `translate3d(0, ${-scrollY}px, 0)${scale}`;
    const ln2 = linesRef.current;
    if (ln2) ln2.style.transform = `translate3d(0, ${-scrollY}px, 0)${scale}`;
    const g2 = gutter2InnerRef.current;
    if (g2) g2.style.transform = `translate3d(0, ${-scrollY}px, 0)${scale}`;

    const nb = Math.floor(viewX / BLOCK) * BLOCK;
    if (nb !== blockRef.current) {
      blockRef.current = nb;
      setBlock(nb);
    }
    const vis = Math.round(viewX);
    if (vis !== lastVisible.current) {
      lastVisible.current = vis;
      const first = useApp.getState().settings.firstDay;
      useVisible.setState({ start: vis, weekStart: startOfWeek(vis, first) });
    }
  };

  // Keep the committed render window in sync with the transform, right after React commits.
  useLayoutEffect(() => {
    renderStartRef.current = renderStart;
    apply(vp.hh, vp.scrollY, vp.viewX);
  });

  // Size tracking.
  useLayoutEffect(() => {
    const body = bodyRef.current;
    const cols = colsRef.current;
    const root = rootRef.current;
    if (!body || !cols || !root) return;
    const measure = () => {
      const w = cols.clientWidth;
      const h = body.clientHeight;
      if (w === 0 || h === 0) return;
      const colW = w / n;
      root.style.setProperty("--colw", `${colW}px`);
      vp.setSize(h, colW, n);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(cols);
    ro.observe(body);
    return () => ro.disconnect();
  }, [n, vp, sidebarOpen, detailMode, popoverId]);

  // Per-frame DOM updates.
  useEffect(() => vp.subscribe((f) => apply(f.hh, f.scrollY, f.viewX)));

  // Initial position once, and navigation requests.
  const first = useRef(true);
  const firstDay = settings.firstDay;
  useEffect(() => {
    const target = alignForView(nav.day, view, firstDay);
    if (first.current) {
      first.current = false;
      if (vp.initialized) {
        vp.reset({ viewX: target });
      } else {
        vp.reset({ viewX: target, hh: Math.min(72, Math.max(44, vp.bodyHeight / 14)) });
        vp.scrollToMinute(7 * 60, false);
      }
      blockRef.current = Math.floor(target / BLOCK) * BLOCK;
      setBlock(blockRef.current);
      return;
    }
    vp.goTo(target, nav.animate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nav.seq]);

  const wheelHandler = useRef<(e: WheelEvent) => void>(() => {});
  wheelHandler.current = (e) => {
    e.preventDefault();
    const rect = bodyRef.current?.getBoundingClientRect();
    vp.wheel(e, rect ? e.clientY - rect.top : 0);
  };
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const h = (e: WheelEvent) => wheelHandler.current(e);
    el.addEventListener("wheel", h, { passive: false });
    return () => el.removeEventListener("wheel", h);
  }, []);

  const pointer = useGridPointer({ bodyRef, colsRef, index });

  const days = useMemo(
    () => Array.from({ length: renderCount }, (_, i) => renderStart + i),
    [renderStart, renderCount],
  );
  const today = useApp.getState().today();
  const tz = settings.tz;
  const nowLocal = toLocal(now, tz);
  const selectedId = useApp((s) => s.selectedId);
  const dragId = useApp((s) => s.drag?.id ?? null);
  const showNow = useVisibleHasToday(today);

  const allDay = useMemo(() => {
    const items = index.allDay.map((e) => {
      const w = e.when;
      return w.kind === "allday" ? { id: e.id, startDay: w.startDay, endDay: w.endDay } : null;
    });
    const spans = layoutSpans(
      items.filter((x): x is NonNullable<typeof x> => x !== null),
      renderStart,
      renderStart + renderCount - 1,
    );
    return spans;
  }, [index.allDay, renderStart, renderCount]);
  const lanes = Math.min(
    5,
    Math.max(
      1,
      allDay.reduce((m, s) => Math.max(m, s.lane + 1), 0),
    ),
  );

  const offsetLabel = gmtLabel(now, tz);
  const second = settings.secondTz;
  const secondShift = second
    ? Math.round((tzOffsetMs(now, second) - tzOffsetMs(now, tz)) / 60000)
    : 0;
  const names = weekdayNames(settings.locale, "short");

  return (
    <div
      ref={rootRef}
      className="grid"
      style={
        {
          "--n": n,
          "--lanes": lanes,
          "--gutter": `${GUTTER}px`,
          "--gutters": second ? 2 : 1,
        } as CSSProperties
      }
      onPointerDown={pointer.onPointerDown}
      onPointerMove={pointer.onPointerMove}
      onPointerUp={pointer.onPointerUp}
      onPointerCancel={pointer.onPointerCancel}
      onDoubleClick={pointer.onDoubleClick}
    >
      <div className="grid-head">
        <div className="gutter-head">
          <span className="tz-label">{offsetLabel}</span>
          <button
            type="button"
            className="icon-btn tiny"
            title={t("grid.addTimezone")}
            onClick={() => useApp.getState().set({ settingsOpen: true })}
          >
            <Plus size={12} />
          </button>
          {second && <span className="tz-label">{gmtLabel(now, second)}</span>}
          {settings.weekNumbers && (
            <span className="week-no">
              {t("grid.week", { n: isoWeek(useVisible.getState().start) })}
            </span>
          )}
        </div>
        <div className="head-viewport">
          <div className="strip" ref={headStripRef}>
            {days.map((d) => (
              <DayHead
                key={d}
                day={d}
                index={d - renderStart}
                isToday={d === today}
                names={names}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="allday-row" style={{ height: `calc(${lanes} * 22px + 8px)` }}>
        <div className="gutter-head allday-label">{t("grid.allDay")}</div>
        <div className="allday-viewport">
          <div className="strip" ref={alldayStripRef}>
            {days.map((d) => (
              <div
                key={d}
                className="col-line"
                style={{ left: `calc(${d - renderStart} * var(--colw))` }}
              />
            ))}
            {allDay.map((s) => {
              if (s.lane >= 5) return null;
              const ev = index.byId.get(s.id);
              if (!ev) return null;
              const cal = calMap.get(ev.calendarId);
              return (
                <button
                  type="button"
                  key={s.id}
                  data-id={s.id}
                  className={`bar ${selectedId === s.id ? "selected" : ""} ${s.clippedStart ? "cut-start" : ""} ${s.clippedEnd ? "cut-end" : ""}`}
                  style={
                    {
                      "--c": cal?.color ?? "#888",
                      left: `calc(${s.startDay - renderStart} * var(--colw) + 2px)`,
                      width: `calc(${s.endDay - s.startDay + 1} * var(--colw) - 4px)`,
                      top: `${4 + s.lane * 22}px`,
                    } as CSSProperties
                  }
                >
                  <span className="bar-title">{ev.title || t("event.untitled")}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="body" ref={bodyRef}>
        <div className="gutter">
          <div className="gutter-inner" ref={gutterInnerRef}>
            <HourLabels
              h24={settings.h24}
              shift={0}
              nowMinute={nowLocal.minute}
              showNow={showNow}
            />
          </div>
        </div>
        {second && (
          <div className="gutter gutter2">
            <div className="gutter-inner" ref={gutter2InnerRef}>
              <HourLabels
                h24={settings.h24}
                shift={secondShift}
                nowMinute={nowLocal.minute}
                showNow={false}
              />
            </div>
          </div>
        )}
        <div className="cols-viewport" ref={colsRef}>
          <div className="lines" ref={linesRef} />
          <div className="strip cols-strip" ref={colsStripRef}>
            {days.map((d) => (
              <DayColumn
                key={d}
                day={d}
                position={d - renderStart}
                segs={index.timed.get(d)}
                byId={index.byId}
                calMap={calMap}
                isToday={d === today}
                nowMinute={nowLocal.minute}
                selectedId={selectedId}
                dragId={dragId}
                h24={settings.h24}
                weekend={isWeekend(d)}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function useVisibleHasToday(today: CivilDay): boolean {
  const start = useVisible((s) => s.start);
  const view = useApp((s) => s.view);
  const nDays = useApp((s) => s.nDays);
  const n = visibleDays(view, nDays);
  return today >= start - 1 && today <= start + n;
}

function isWeekend(day: CivilDay): boolean {
  const w = (((day + 4) % 7) + 7) % 7;
  return w === 0 || w === 6;
}

const DayHead = memo(function DayHead({
  day,
  index,
  isToday,
  names,
}: {
  day: CivilDay;
  index: number;
  isToday: boolean;
  names: string[];
}) {
  const { d } = civilFromDays(day);
  const wd = (((day + 4) % 7) + 7) % 7;
  return (
    <button
      type="button"
      className={`day-head ${isToday ? "today" : ""}`}
      style={{ left: `calc(${index} * var(--colw))` }}
      onClick={() => {
        const s = useApp.getState();
        s.setView("day");
        s.goTo(day);
      }}
    >
      <span className="dh-name">{names[wd]}</span>
      <span className="dh-num">{d}</span>
    </button>
  );
});

const HourLabels = memo(function HourLabels({
  h24,
  shift,
  nowMinute,
  showNow,
}: {
  h24: boolean;
  shift: number;
  nowMinute: number;
  showNow: boolean;
}) {
  const labels = [];
  for (let h = 1; h < 24; h++) {
    const minute = (((h * 60 + shift) % 1440) + 1440) % 1440;
    const dist = Math.abs(h * 60 - nowMinute);
    labels.push(
      <span
        key={h}
        className="hour-label"
        style={{
          top: `${(h / 24) * 100}%`,
          opacity: showNow && dist < 14 && shift === 0 ? 0 : undefined,
        }}
      >
        {formatMinute(minute, h24)}
      </span>,
    );
  }
  return (
    <>
      {labels}
      {showNow && shift === 0 && (
        <span className="now-label" style={{ top: `${(nowMinute / 1440) * 100}%` }}>
          {formatMinute(nowMinute, true)}
        </span>
      )}
    </>
  );
});

interface DayColumnProps {
  day: CivilDay;
  position: number;
  segs: DaySegment[] | undefined;
  byId: DayIndex["byId"];
  calMap: Map<string, CalendarDef>;
  isToday: boolean;
  nowMinute: number;
  selectedId: string | null;
  dragId: string | null;
  h24: boolean;
  weekend: boolean;
}

const DayColumn = memo(function DayColumn(p: DayColumnProps) {
  const placed = useMemo(() => {
    if (!p.segs) return [];
    const layout = layoutColumns(
      p.segs.map((s) => ({ id: s.eventId, start: s.start, end: s.end })),
    );
    const bySeg = new Map(p.segs.map((s) => [s.eventId, s]));
    return layout.flatMap((l) => {
      const seg = bySeg.get(l.id);
      return seg ? [{ seg, l }] : [];
    });
  }, [p.segs]);

  return (
    <div
      className={`col ${p.isToday ? "is-today" : ""} ${p.weekend ? "weekend" : ""}`}
      data-day={p.day}
      style={{ left: `calc(${p.position} * var(--colw))` }}
    >
      {placed.map(({ seg, l }) => {
        const ev = p.byId.get(seg.eventId);
        if (!ev) return null;
        return (
          <EventBlock
            key={`${seg.eventId}:${seg.day}`}
            ev={ev}
            seg={seg}
            col={l.col}
            cols={l.cols}
            span={l.span}
            color={p.calMap.get(ev.calendarId)?.color ?? "#888"}
            selected={p.selectedId === ev.id}
            dragging={p.dragId === ev.id}
            h24={p.h24}
          />
        );
      })}
      {p.isToday && <div className="now-line" style={{ top: `${(p.nowMinute / 1440) * 100}%` }} />}
    </div>
  );
});

function evTime(ev: CalEvent, seg: DaySegment, h24: boolean): string {
  if (ev.when.kind !== "timed") return "";
  const a = formatMinute(seg.start, h24);
  const b = formatMinute(seg.end >= 1440 ? 0 : seg.end, h24);
  return `${a}–${b}`;
}

const EventBlock = memo(function EventBlock(p: {
  ev: CalEvent;
  seg: DaySegment;
  col: number;
  cols: number;
  span: number;
  color: string;
  selected: boolean;
  dragging: boolean;
  h24: boolean;
}) {
  const { ev, seg } = p;
  const minutes = Math.max(seg.end - seg.start, 20);
  const style = {
    "--c": p.color,
    top: `${(seg.start / 1440) * 100}%`,
    height: `calc(${(minutes / 1440) * 100}% - 2px)`,
    left: `calc(${(p.col / p.cols) * 100}% + 1px)`,
    width: `calc(${(p.span / p.cols) * 100}% - 3px)`,
  } as CSSProperties;
  return (
    <div
      className={`ev ${p.selected ? "selected" : ""} ${p.dragging ? "dragging" : ""} ${ev.isTask ? "task" : ""} ${ev.done ? "done" : ""} ${seg.continuesBefore ? "cut-top" : ""} ${seg.continuesAfter ? "cut-bottom" : ""}`}
      data-id={ev.id}
      style={style}
    >
      <div className="ev-body">
        {ev.isTask && (
          <span className="ev-check" data-check={ev.id}>
            {ev.done && <Check size={9} strokeWidth={3.5} />}
          </span>
        )}
        <span className="ev-title">{ev.title || t("event.untitled")}</span>
        <span className="ev-time">{evTime(ev, seg, p.h24)}</span>
      </div>
      {!seg.continuesAfter && <div className="ev-resize" data-resize={ev.id} />}
    </div>
  );
});

export { fromLocal };
