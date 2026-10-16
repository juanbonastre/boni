import {
  allDaySpan,
  type CivilDay,
  daySegments,
  fromLocal,
  MS_MIN,
  resizeAllDay,
  shiftWhenByDays,
  toLocal,
  type When,
} from "@boni-calendar/core";
import { type RefObject, type PointerEvent as RPE, useEffect, useRef } from "react";
import type { DayIndex } from "../engine/dayIndex.ts";
import { elementsAt, onKeys } from "../host.ts";
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
      /** Wall-clock minutes (day * 1440 + minute) under the pointer when the drag began. */
      pressTotal: number;
      pressDay: CivilDay;
      /** Same for the event's own start. */
      origTotal: number;
      origDay: CivilDay;
      durMs: number;
      tz: string;
      origStart: number;
      /** Other selected events that travel with it. */
      group: { id: string; when: When }[];
    }
  | {
      type: "resize";
      id: string;
      edge: "start" | "end";
      tz: string;
      startMs: number;
      endMs: number;
    }
  | {
      type: "allday-move";
      id: string;
      grabDay: CivilDay;
      orig: When;
      group: { id: string; when: When }[];
    }
  | {
      type: "bar-resize";
      id: string;
      edge: "start" | "end";
      orig: Extract<When, { kind: "allday" }>;
    }
  | { type: "allday-create-press"; x: number; y: number; day: CivilDay; pointerId: number }
  | { type: "allday-create"; anchorDay: CivilDay };

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
    const offKeys = onKeys(onKey, true);
    return () => {
      offKeys();
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
    if (g.type === "allday-create") {
      app.setDrag({ kind: "create", id: NEW_ID, when: allDaySpan(g.anchorDay, pos.day) });
    } else if (g.type === "allday-move") {
      const dayDelta = pos.day - g.grabDay;
      const group: Record<string, When> = {};
      for (const o of g.group) group[o.id] = shiftWhenByDays(o.when, dayDelta);
      app.setDrag({
        kind: "move",
        id: g.id,
        when: shiftWhenByDays(g.orig, dayDelta),
        group: g.group.length ? group : undefined,
      });
    } else if (g.type === "bar-resize") {
      app.setDrag({
        kind: "resize",
        id: g.id,
        when: resizeAllDay(g.orig, g.edge, pos.day),
      });
    } else if (g.type === "create") {
      // Both ends follow the pointer in wall-clock minutes (day * 1440 + minute), so dragging into
      // the next or previous day's column creates an event that crosses midnight.
      const snap = snapOf();
      const anchorTotal = g.day * 1440 + g.anchor;
      const pointer = pos.day * 1440 + clampMin(pos.minute);
      let s = anchorTotal;
      let e = anchorTotal + snap;
      if (pointer >= anchorTotal) e = Math.max(e, Math.ceil(pointer / snap) * snap);
      else s = Math.floor(pointer / snap) * snap;
      const sd = Math.floor(s / 1440);
      const ed = Math.floor(e / 1440);
      app.setDrag({
        kind: "create",
        id: NEW_ID,
        when: {
          kind: "timed",
          start: fromLocal(sd, s - sd * 1440, tz),
          end: fromLocal(ed, e - ed * 1440, tz),
          tz,
        },
      });
    } else if (g.type === "move") {
      // Follow the pointer in wall-clock minutes, so events spanning midnight move as a whole.
      const delta = pos.day * 1440 + pos.minute - g.pressTotal;
      const dayStart = (g.origDay + (pos.day - g.pressDay)) * 1440;
      const total = Math.min(dayStart + 1440, Math.max(dayStart, roundSnap(g.origTotal + delta)));
      const startDay = Math.floor(total / 1440);
      const start = fromLocal(startDay, total - startDay * 1440, g.tz);
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
      // The edge follows the pointer in both axes, so an event can be stretched past midnight
      // by dragging into the next (or previous) day's column.
      const snap = snapOf();
      const a = toLocal(g.startMs, g.tz);
      const b = toLocal(g.endMs, g.tz);
      const pointer = pos.day * 1440 + clampMin(roundSnap(pos.minute));
      let startMs = g.startMs;
      let endMs = g.endMs;
      if (g.edge === "end") {
        const t = Math.max(pointer, a.day * 1440 + a.minute + snap);
        const d = Math.floor(t / 1440);
        endMs = fromLocal(d, t - d * 1440, g.tz);
      } else {
        const t = Math.min(pointer, b.day * 1440 + b.minute - snap);
        const d = Math.floor(t / 1440);
        startMs = fromLocal(d, t - d * 1440, g.tz);
      }
      app.setDrag({
        kind: "resize",
        id: g.id,
        when: { kind: "timed", start: startMs, end: endMs, tz: g.tz },
      });
    }
  };

  const onPointerDown = (e: RPE<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    const app = useApp.getState();
    if (target.closest("[data-check]")) {
      const id = (target.closest("[data-check]") as HTMLElement).dataset.check;
      const ev = app.getEvent(id ?? "");
      if (ev) app.editEvents([ev.id], { done: !ev.done });
      e.stopPropagation();
      return;
    }
    last.current = { x: e.clientX, y: e.clientY };
    const edge = target.closest<HTMLElement>("[data-bar-edge]");
    if (edge?.dataset.barId) {
      const ev = app.getEvent(edge.dataset.barId);
      if (ev?.when.kind === "allday" && !app.isLocked(ev.id)) {
        gesture.current = {
          type: "bar-resize",
          id: ev.id,
          edge: edge.dataset.barEdge === "start" ? "start" : "end",
          orig: ev.when,
        };
        e.currentTarget.setPointerCapture(e.pointerId);
        app.select(ev.id, false);
        e.preventDefault();
      }
      return;
    }
    const resize = target.closest("[data-resize]") as HTMLElement | null;
    const evEl = target.closest(".ev, .bar") as HTMLElement | null;
    if (resize) {
      const ev = app.getEvent(resize.dataset.resize ?? "");
      if (ev && ev.when.kind === "timed" && !app.isLocked(ev.id)) {
        gesture.current = {
          type: "resize",
          id: ev.id,
          edge: resize.dataset.edge === "start" ? "start" : "end",
          tz: ev.when.tz,
          startMs: ev.when.start,
          endMs: ev.when.end,
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
    if (target.closest(".allday-viewport")) {
      const pos = toGrid(e.clientX, e.clientY);
      if (!pos) return;
      gesture.current = {
        type: "allday-create-press",
        x: e.clientX,
        y: e.clientY,
        day: pos.day,
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

  /** Other selected events that travel with `primary` when it is dragged. */
  const groupOf = (primaryId: string) => {
    const app = useApp.getState();
    const inSelection = app.selectedIds.includes(primaryId) && app.selectedIds.length > 1;
    const group = inSelection
      ? app
          .expanded()
          .filter((x) => x.id !== primaryId && app.selectedIds.includes(x.id))
          .map((x) => ({ id: x.id, when: x.when }))
      : [];
    return { inSelection, group };
  };

  const onPointerMove = (e: RPE<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g) return;
    last.current = { x: e.clientX, y: e.clientY };
    const app = useApp.getState();
    const moved = (x: number, y: number) => Math.hypot(e.clientX - x, e.clientY - y) >= THRESHOLD;

    if (g.type === "press") {
      if (!moved(g.x, g.y)) return;
      const ev = indexRef.current.byId.get(g.id) ?? app.getEvent(g.id);
      if (!ev || app.isLocked(ev.id)) {
        gesture.current = null;
        return;
      }
      const { inSelection, group } = groupOf(ev.id);
      if (ev.when.kind === "allday") {
        gesture.current = {
          type: "allday-move",
          id: ev.id,
          grabDay: toGrid(g.x, g.y)?.day ?? 0,
          orig: ev.when,
          group,
        };
      } else {
        const pos = toGrid(g.x, g.y);
        const origStart = toLocal(ev.when.start, ev.when.tz);
        gesture.current = {
          type: "move",
          id: ev.id,
          pressTotal: pos ? pos.day * 1440 + pos.minute : 0,
          pressDay: pos?.day ?? origStart.day,
          origTotal: origStart.day * 1440 + origStart.minute,
          origDay: origStart.day,
          durMs: ev.when.end - ev.when.start,
          tz: ev.when.tz,
          origStart: ev.when.start,
          group,
        };
        startEdge();
      }
      // Dragging one of several selected events moves the whole selection; otherwise just this one.
      if (!inSelection) app.select(ev.id, false);
      else app.set({ popoverId: null });
    } else if (g.type === "create-press") {
      if (!moved(g.x, g.y)) return;
      gesture.current = { type: "create", day: g.day, anchor: g.anchor };
      app.select(null);
      startEdge();
    } else if (g.type === "allday-create-press") {
      if (!moved(g.x, g.y)) return;
      gesture.current = { type: "allday-create", anchorDay: g.day };
      app.select(null);
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
    const mods = { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey };
    if (g.type === "press") {
      app.clickSelect(g.id, mods);
    } else if (g.type === "create-press" || g.type === "allday-create-press") {
      // A click on empty space clears the selection, unless the user is building one with Ctrl/Shift.
      if (!(mods.ctrl || mods.shift)) app.clearSelection();
    } else if (g.type === "create" || g.type === "allday-create") {
      const d = app.drag;
      app.setDrag(null);
      if (d) {
        const id = app.addEvent({ when: d.when });
        app.select(id, true);
      }
    } else if (g.type === "move" || g.type === "allday-move") {
      app.finishDrag();
      if (g.group.length === 0) app.select(g.id, false);
    } else if (g.type === "resize" || g.type === "bar-resize") {
      app.finishDrag();
      app.select(g.id, false);
    }
  };

  const onDoubleClick = (e: RPE<HTMLDivElement>) => {
    // The grid captures the pointer on press, so e.target is the grid itself: locate by coordinates.
    const under = (elementsAt(e.clientX, e.clientY)[0] ?? null) as HTMLElement | null;
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
