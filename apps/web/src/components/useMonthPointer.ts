import {
  allDaySpan,
  type CivilDay,
  resizeAllDay,
  shiftWhenByDays,
  type When,
} from "@boni-calendar/core";
import { type PointerEvent as RPE, useEffect, useRef } from "react";
import { elementsAt, onKeys } from "../host.ts";
import { useApp } from "../store.ts";
import { NEW_ID } from "./useGridPointer.ts";

const THRESHOLD = 4;

type Gesture =
  | { type: "press"; id: string; x: number; y: number; grabDay: CivilDay }
  | {
      type: "move";
      id: string;
      grabDay: CivilDay;
      orig: When;
      group: { id: string; when: When }[];
    }
  | { type: "resize"; id: string; edge: "start" | "end"; orig: Extract<When, { kind: "allday" }> }
  | { type: "create-press"; x: number; y: number; day: CivilDay }
  | { type: "create"; anchorDay: CivilDay };

/** The month cell under a screen point (bars and chips sit on top of the cells, hence elementsFromPoint). */
function dayAt(x: number, y: number): CivilDay | null {
  for (const el of elementsAt(x, y)) {
    const cell = (el as HTMLElement).closest<HTMLElement>(".mcell[data-day]");
    if (cell?.dataset.day) return Number(cell.dataset.day);
  }
  return null;
}

/** Pointer interactions of the month view: select, move across days, resize all-day bars, drag to create. */
export function useMonthPointer() {
  const gesture = useRef<Gesture | null>(null);

  const cancel = () => {
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
    return onKeys(onKey, true);
  }, []);

  const applyMove = (x: number, y: number) => {
    const g = gesture.current;
    const day = dayAt(x, y);
    if (!g || day === null) return;
    const app = useApp.getState();
    if (g.type === "create") {
      app.setDrag({ kind: "create", id: NEW_ID, when: allDaySpan(g.anchorDay, day) });
    } else if (g.type === "move") {
      const delta = day - g.grabDay;
      const group: Record<string, When> = {};
      for (const o of g.group) group[o.id] = shiftWhenByDays(o.when, delta);
      app.setDrag({
        kind: "move",
        id: g.id,
        when: shiftWhenByDays(g.orig, delta),
        group: g.group.length ? group : undefined,
      });
    } else if (g.type === "resize") {
      app.setDrag({ kind: "resize", id: g.id, when: resizeAllDay(g.orig, g.edge, day) });
    }
  };

  const onPointerDown = (e: RPE<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest(".mnum, .more")) return; // plain buttons: let their own click run
    const app = useApp.getState();

    const edge = target.closest<HTMLElement>("[data-bar-edge]");
    if (edge?.dataset.barId) {
      const ev = app.getEvent(edge.dataset.barId);
      if (ev?.when.kind === "allday" && !app.isLocked(ev.id)) {
        gesture.current = {
          type: "resize",
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
    const item = target.closest<HTMLElement>(".mchip[data-id], .bar[data-id]");
    const day = dayAt(e.clientX, e.clientY);
    if (item?.dataset.id && day !== null) {
      gesture.current = {
        type: "press",
        id: item.dataset.id,
        x: e.clientX,
        y: e.clientY,
        grabDay: day,
      };
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }
    if (day !== null) {
      gesture.current = { type: "create-press", x: e.clientX, y: e.clientY, day };
      e.currentTarget.setPointerCapture(e.pointerId);
    }
  };

  const onPointerMove = (e: RPE<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g) return;
    const app = useApp.getState();
    const moved = (x: number, y: number) => Math.hypot(e.clientX - x, e.clientY - y) >= THRESHOLD;
    if (g.type === "press") {
      if (!moved(g.x, g.y)) return;
      const ev = app.getEvent(g.id);
      if (!ev || app.isLocked(ev.id)) {
        gesture.current = null;
        return;
      }
      const inSelection = app.selectedIds.includes(ev.id) && app.selectedIds.length > 1;
      const group = inSelection
        ? app
            .expanded()
            .filter((x) => x.id !== ev.id && app.selectedIds.includes(x.id))
            .map((x) => ({ id: x.id, when: x.when }))
        : [];
      gesture.current = { type: "move", id: ev.id, grabDay: g.grabDay, orig: ev.when, group };
      if (!inSelection) app.select(ev.id, false);
      else app.set({ popoverId: null });
    } else if (g.type === "create-press") {
      if (!moved(g.x, g.y)) return;
      gesture.current = { type: "create", anchorDay: g.day };
      app.select(null);
    }
    applyMove(e.clientX, e.clientY);
  };

  const onPointerUp = (e: RPE<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g) return;
    gesture.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // pointer already released
    }
    const app = useApp.getState();
    const mods = { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey };
    if (g.type === "press") {
      app.clickSelect(g.id, mods);
    } else if (g.type === "create-press") {
      if (!(mods.ctrl || mods.shift)) app.clearSelection();
    } else if (g.type === "create") {
      const d = app.drag;
      app.setDrag(null);
      if (d) app.select(app.addEvent({ when: d.when }), true);
    } else {
      app.finishDrag();
      if (g.type === "resize" || g.group.length === 0) app.select(g.id, false);
    }
  };

  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: cancel };
}
