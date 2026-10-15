import {
  type CivilDay,
  daySegments,
  fromLocal,
  MS_MIN,
  toLocal,
  type When,
} from "@boni-calendar/core";
import { type RefObject, type PointerEvent as RPE, useEffect, useRef } from "react";
import type { DayIndex } from "../engine/dayIndex.ts";
import { useApp } from "../store.ts";
import { useViewport } from "../ViewportContext.tsx";

const THRESHOLD = 4;
export const NEW_ID = "__new__";

type Gesture =
  | { type: "press"; id: string; x: number; y: number; pointerId: number }
  | { type: "create-press"; x: number; y: number; day: CivilDay; anchor: number; pointerId: number }
  | { type: "create"; day: CivilDay; anchor: number }
  | {
      type: "move";
      id: string;
      grab: number;
      durMs: number;
      tz: string;
      origStart: number;
      /** Other selected events that travel with it. */
      group: { id: string; when: When }[];
    }
  | { type: "resize"; id: string; day: CivilDay; tz: string; startMs: number; segDay: CivilDay };

interface Args {
  bodyRef: RefObject<HTMLDivElement | null>;
  colsRef: RefObject<HTMLDivElement | null>;
  index: DayIndex;
}

/** Pointer interactions of the time grid: select, create by dragging, move and resize. */
export function useGridPointer({ bodyRef, colsRef, index }: Args) {
  const vp = useViewport();
  const gesture = useRef<Gesture | null>(null);
  const last = useRef({ x: 0, y: 0 });
  const edgeTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const indexRef = useRef(index);
  indexRef.current = index;

  const toGrid = (clientX: number, clientY: number) => {
    const cols = colsRef.current?.getBoundingClientRect();
    const body = bodyRef.current?.getBoundingClientRect();
    if (!cols || !body) return null;
    const day = Math.floor(vp.viewX + (clientX - cols.left) / vp.colW);
    const minute = ((vp.scrollY + (clientY - body.top)) / vp.hh) * 60;
    return { day, minute, py: clientY - body.top };
  };

  const snapOf = () => useApp.getState().settings.snap;
  const floorSnap = (m: number) => Math.floor(m / snapOf()) * snapOf();
  const roundSnap = (m: number) => Math.round(m / snapOf()) * snapOf();
  const clampMin = (m: number) => Math.min(1440, Math.max(0, m));

  const stopEdge = () => {
    if (edgeTimer.current) clearInterval(edgeTimer.current);
    edgeTimer.current = null;
  };

  const startEdge = () => {
    if (edgeTimer.current) return;
    edgeTimer.current = setInterval(() => {
      const body = bodyRef.current?.getBoundingClientRect();
      if (!body || !gesture.current) return;
      const y = last.current.y - body.top;
      const zone = 28;
      if (y < zone) vp.scrollBy(-((zone - y) / zone) * 16 - 2);
      else if (y > body.height - zone) vp.scrollBy(((y - (body.height - zone)) / zone) * 16 + 2);
      else return;
      applyMove(last.current.x, last.current.y);
    }, 16);
  };

  const cancel = () => {
    stopEdge();
    gesture.current = null;
    useApp.getState().setDrag(null);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && gesture.current) {
        e.stopPropagation();
        cancel();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      stopEdge();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const timedWhen = (day: CivilDay, startMin: number, endMin: number, tz: string) => ({
    kind: "timed" as const,
    start: fromLocal(day, startMin, tz),
    end: fromLocal(day, endMin, tz),
    tz,
  });

  const applyMove = (clientX: number, clientY: number) => {
    const g = gesture.current;
    const pos = toGrid(clientX, clientY);
    if (!g || !pos) return;
    const app = useApp.getState();
    const tz = app.settings.tz;
    if (g.type === "create") {
      const cur = clampMin(pos.minute);
      const snap = snapOf();
      let s = g.anchor;
      let e = g.anchor + snap;
      if (cur >= g.anchor) e = Math.max(g.anchor + snap, clampMin(Math.ceil(cur / snap) * snap));
      else s = clampMin(floorSnap(cur));
      if (cur < g.anchor) e = g.anchor + snap;
      if (e > 1440) {
        e = 1440;
        s = Math.min(s, 1440 - snap);
      }
      app.setDrag({ kind: "create", id: NEW_ID, when: timedWhen(g.day, s, e, tz) });
    } else if (g.type === "move") {
      const startMin = clampMin(roundSnap(pos.minute - g.grab));
      const start = fromLocal(pos.day, startMin, g.tz);
      let group: Record<string, When> | undefined;
      if (g.group.length > 0) {
        const delta = start - g.origStart;
        const dayDelta = toLocal(start, g.tz).day - toLocal(g.origStart, g.tz).day;
        group = {};
        for (const o of g.group) {
          group[o.id] =
            o.when.kind === "timed"
              ? { ...o.when, start: o.when.start + delta, end: o.when.end + delta }
              : {
                  kind: "allday",
                  startDay: o.when.startDay + dayDelta,
                  endDay: o.when.endDay + dayDelta,
                };
        }
      }
      app.setDrag({
        kind: "move",
        id: g.id,
        when: { kind: "timed", start, end: start + g.durMs, tz: g.tz },
        group,
      });
    } else if (g.type === "resize") {
      const snap = snapOf();
      const startLocal = toLocal(g.startMs, g.tz);
      const sameDay = g.segDay === startLocal.day;
      const lowest = sameDay ? startLocal.minute + snap : snap;
      const endMin = Math.max(lowest, clampMin(roundSnap(pos.minute)));
      const end = fromLocal(g.segDay, endMin, g.tz);
      app.setDrag({
        kind: "resize",
        id: g.id,
        when: { kind: "timed", start: g.startMs, end, tz: g.tz },
      });
    }
  };

  const onPointerDown = (e: RPE<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    const app = useApp.getState();
    if (target.closest("[data-check]")) {
      const id = (target.closest("[data-check]") as HTMLElement).dataset.check;
      const ev = app.data.events.find((x) => x.id === id);
      if (ev) app.updateEvent(ev.id, { done: !ev.done });
      e.stopPropagation();
      return;
    }
    last.current = { x: e.clientX, y: e.clientY };
    const resize = target.closest("[data-resize]") as HTMLElement | null;
    const evEl = target.closest(".ev, .bar") as HTMLElement | null;
    if (resize) {
      const ev = app.data.events.find((x) => x.id === resize.dataset.resize);
      if (ev && ev.when.kind === "timed") {
        const segs = daySegments(ev);
        const last_ = segs[segs.length - 1];
        gesture.current = {
          type: "resize",
          id: ev.id,
          day: last_?.day ?? 0,
          tz: ev.when.tz,
          startMs: ev.when.start,
          segDay: last_?.day ?? 0,
        };
        e.currentTarget.setPointerCapture(e.pointerId);
        app.select(ev.id, false);
        e.preventDefault();
      }
      return;
    }
    if (evEl?.dataset.id) {
      gesture.current = {
        type: "press",
        id: evEl.dataset.id,
        x: e.clientX,
        y: e.clientY,
        pointerId: e.pointerId,
      };
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }
    if (target.closest(".cols-viewport")) {
      const pos = toGrid(e.clientX, e.clientY);
      if (!pos) return;
      gesture.current = {
        type: "create-press",
        x: e.clientX,
        y: e.clientY,
        day: pos.day,
        anchor: clampMin(floorSnap(pos.minute)),
        pointerId: e.pointerId,
      };
      e.currentTarget.setPointerCapture(e.pointerId);
    }
  };

  const onPointerMove = (e: RPE<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g) return;
    last.current = { x: e.clientX, y: e.clientY };
    const app = useApp.getState();
    if (g.type === "press") {
      if (Math.hypot(e.clientX - g.x, e.clientY - g.y) < THRESHOLD) return;
      const ev = indexRef.current.byId.get(g.id) ?? app.data.events.find((x) => x.id === g.id);
      if (ev?.when.kind !== "timed") {
        gesture.current = null;
        return;
      }
      const pos = toGrid(g.x, g.y);
      const segs = daySegments(ev);
      const seg = segs.find((s) => s.day === pos?.day) ?? segs[0];
      const grab = pos && seg ? pos.minute - seg.start : 0;
      // Dragging one of several selected events moves the whole selection; otherwise just this one.
      const inSelection = app.selectedIds.includes(ev.id) && app.selectedIds.length > 1;
      const group = inSelection
        ? app.data.events
            .filter((x) => x.id !== ev.id && app.selectedIds.includes(x.id))
            .map((x) => ({ id: x.id, when: x.when }))
        : [];
      gesture.current = {
        type: "move",
        id: ev.id,
        grab,
        durMs: ev.when.end - ev.when.start,
        tz: ev.when.tz,
        origStart: ev.when.start,
        group,
      };
      if (!inSelection) app.select(ev.id, false);
      else app.set({ popoverId: null });
      startEdge();
    } else if (g.type === "create-press") {
      if (Math.hypot(e.clientX - g.x, e.clientY - g.y) < THRESHOLD) return;
      gesture.current = { type: "create", day: g.day, anchor: g.anchor };
      app.select(null);
      startEdge();
    } else if (g.type === "resize") {
      startEdge();
    }
    applyMove(e.clientX, e.clientY);
  };

  const onPointerUp = (e: RPE<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g) return;
    gesture.current = null;
    stopEdge();
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // pointer already released
    }
    const app = useApp.getState();
    if (g.type === "press") {
      app.clickSelect(g.id, { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey });
    } else if (g.type === "create-press") {
      // A click on empty space clears the selection, unless the user is building one with Ctrl/Shift.
      if (!(e.ctrlKey || e.metaKey || e.shiftKey)) app.clearSelection();
    } else if (g.type === "create") {
      const d = app.drag;
      app.setDrag(null);
      if (d) {
        const id = app.addEvent({ when: d.when });
        app.select(id, true);
      }
    } else if (g.type === "move" || g.type === "resize") {
      app.commitDrag();
      if (g.type === "resize" || g.group.length === 0) app.select(g.id, false);
    }
  };

  const onDoubleClick = (e: RPE<HTMLDivElement>) => {
    // The grid captures the pointer on press, so e.target is the grid itself: locate by coordinates.
    const under = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
    if (!under || under.closest(".ev, .bar")) return;
    const app = useApp.getState();
    const tz = app.settings.tz;
    const inside = (el: Element | null) => {
      const r = el?.getBoundingClientRect();
      return (
        !!r &&
        e.clientX >= r.left &&
        e.clientX <= r.right &&
        e.clientY >= r.top &&
        e.clientY <= r.bottom
      );
    };
    const allDayRect = e.currentTarget.querySelector(".allday-viewport");
    if (inside(allDayRect) && allDayRect) {
      const rect = allDayRect.getBoundingClientRect();
      const day = Math.floor(vp.viewX + (e.clientX - rect.left) / vp.colW);
      const id = app.addEvent({ when: { kind: "allday", startDay: day, endDay: day } });
      app.select(id, true);
      return;
    }
    if (!inside(colsRef.current)) return;
    const pos = toGrid(e.clientX, e.clientY);
    if (!pos) return;
    const start = clampMin(floorSnap(pos.minute));
    const dur = app.settings.defaultDuration;
    const id = app.addEvent({ when: timedWhen(pos.day, start, Math.min(1440, start + dur), tz) });
    app.select(id, true);
  };

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel: cancel,
    onDoubleClick,
  };
}

export { MS_MIN };
