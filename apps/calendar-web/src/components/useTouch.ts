import { type PointerEvent as RPE, useRef } from "react";

type PE = RPE<HTMLDivElement>;

export interface PointerHandlers {
  onPointerDown: (e: PE) => void;
  onPointerMove: (e: PE) => void;
  onPointerUp: (e: PE) => void;
  onPointerCancel: () => void;
}

export interface TouchActions {
  /** The finger moved by (dx, dy) px: the view follows it. */
  pan: (dx: number, dy: number) => void;
  /** The finger left with this velocity (px/ms, only along the axis it was moving). */
  fling: (vx: number, vy: number) => void;
  /** Two fingers: spread by `factor`, around this point (client coordinates). */
  pinch?: (factor: number, x: number, y: number) => void;
}

/** How long a finger must rest before it picks something up (create, move, resize) or opens the menu. */
export const LONG_PRESS_MS = 450;
/** How far a finger may wander and still be a tap or a long press. */
const SLOP = 10;

let lastWasTouch = false;
/**
 * True when the last pointer that went down was a finger. The browser's own long-press
 * `contextmenu` is ignored then: the gestures below open the menu themselves, and only when the
 * finger did not start dragging.
 */
export const lastPointerWasTouch = (): boolean => lastWasTouch;

/**
 * Touch gestures on a calendar surface, in front of its mouse handlers (`inner`, unchanged):
 *  - a finger that moves at once pans the view (locked to the axis it started on) and glides on;
 *  - two fingers pinch (zoom) and pan;
 *  - a tap is a click (select, open the detail);
 *  - a long press hands the finger to `inner`, so dragging then creates, moves or resizes exactly as
 *    with the mouse; a long press released without moving opens the context menu instead.
 * Mouse and pen events go straight to `inner`.
 */
export function useTouchGestures(inner: PointerHandlers, actions: TouchActions): PointerHandlers {
  const st = useRef({
    mode: "idle" as "idle" | "pending" | "pan-x" | "pan-y" | "pinch" | "held",
    pointers: new Map<number, { x: number; y: number }>(),
    start: null as null | {
      x: number;
      y: number;
      target: EventTarget;
      el: HTMLDivElement;
      id: number;
    },
    last: { x: 0, y: 0 },
    samples: [] as { x: number; y: number; t: number }[],
    timer: 0 as ReturnType<typeof setTimeout> | 0,
    heldMoved: false,
    pinchDist: 0,
    pinchMid: { x: 0, y: 0 },
  });

  const fake = (s: NonNullable<typeof st.current.start>): PE =>
    ({
      button: 0,
      pointerType: "touch",
      pointerId: s.id,
      clientX: s.x,
      clientY: s.y,
      target: s.target,
      currentTarget: s.el,
      ctrlKey: false,
      shiftKey: false,
      metaKey: false,
      altKey: false,
      preventDefault() {},
      stopPropagation() {},
    }) as unknown as PE;

  const clearTimer = () => {
    if (st.current.timer) clearTimeout(st.current.timer);
    st.current.timer = 0;
  };

  const twoFingers = () => {
    const [a, b] = [...st.current.pointers.values()];
    if (!a || !b) return null;
    return {
      dist: Math.hypot(a.x - b.x, a.y - b.y),
      mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
    };
  };

  const onPointerDown = (e: PE) => {
    lastWasTouch = e.pointerType === "touch";
    if (e.pointerType !== "touch") return inner.onPointerDown(e);
    const s = st.current;
    s.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (
      s.pointers.size === 2 &&
      (s.mode === "pending" || s.mode === "pan-x" || s.mode === "pan-y")
    ) {
      clearTimer();
      const f = twoFingers();
      s.mode = "pinch";
      s.pinchDist = f?.dist ?? 0;
      s.pinchMid = f?.mid ?? { x: 0, y: 0 };
    }
    if (s.pointers.size !== 1) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // the pointer may already be gone
    }
    s.mode = "pending";
    s.start = {
      x: e.clientX,
      y: e.clientY,
      target: e.target,
      el: e.currentTarget,
      id: e.pointerId,
    };
    s.last = { x: e.clientX, y: e.clientY };
    s.samples = [{ x: e.clientX, y: e.clientY, t: e.timeStamp }];
    s.heldMoved = false;
    clearTimer();
    s.timer = setTimeout(() => {
      s.timer = 0;
      if (s.mode !== "pending" || !s.start) return;
      s.mode = "held";
      inner.onPointerDown(fake(s.start));
      navigator.vibrate?.(8);
    }, LONG_PRESS_MS);
  };

  const onPointerMove = (e: PE) => {
    if (e.pointerType !== "touch") return inner.onPointerMove(e);
    const s = st.current;
    if (!s.pointers.has(e.pointerId)) return;
    s.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (s.mode === "pinch") {
      const f = twoFingers();
      if (!f) return;
      if (s.pinchDist > 0 && f.dist > 0) actions.pinch?.(f.dist / s.pinchDist, f.mid.x, f.mid.y);
      actions.pan(0, f.mid.y - s.pinchMid.y);
      s.pinchDist = f.dist;
      s.pinchMid = f.mid;
      return;
    }
    if (e.pointerId !== s.start?.id) return;
    if (s.mode === "held") {
      if (Math.hypot(e.clientX - s.start.x, e.clientY - s.start.y) > SLOP / 2) s.heldMoved = true;
      return inner.onPointerMove(e);
    }
    if (s.mode === "pending") {
      const dx = e.clientX - s.start.x;
      const dy = e.clientY - s.start.y;
      if (Math.hypot(dx, dy) < SLOP) return;
      clearTimer();
      s.mode = Math.abs(dx) > Math.abs(dy) ? "pan-x" : "pan-y";
    }
    const dx = e.clientX - s.last.x;
    const dy = e.clientY - s.last.y;
    s.last = { x: e.clientX, y: e.clientY };
    s.samples.push({ x: e.clientX, y: e.clientY, t: e.timeStamp });
    if (s.samples.length > 8) s.samples.shift();
    if (s.mode === "pan-x") actions.pan(dx, 0);
    else actions.pan(0, dy);
  };

  const finish = (e: PE | null) => {
    const s = st.current;
    if (e) s.pointers.delete(e.pointerId);
    if (s.mode === "pinch") {
      if (s.pointers.size === 0) s.mode = "idle";
      return;
    }
    if (e && e.pointerId !== s.start?.id) return;
    clearTimer();
    const mode = s.mode;
    s.mode = "idle";
    s.pointers.clear();
    const start = s.start;
    s.start = null;
    if (!start) return;
    if (mode === "pending") {
      // A tap: what a click does.
      if (!e) return;
      inner.onPointerDown(fake(start));
      inner.onPointerUp(e);
    } else if (mode === "pan-x" || mode === "pan-y") {
      const now = e?.timeStamp ?? s.samples[s.samples.length - 1]?.t ?? 0;
      const recent = s.samples.filter((p) => now - p.t < 90);
      const a = recent[0];
      const b = recent[recent.length - 1];
      const dt = a && b ? b.t - a.t : 0;
      const v = (k: "x" | "y") => (a && b && dt > 0 ? (b[k] - a[k]) / dt : 0);
      actions.fling(mode === "pan-x" ? v("x") : 0, mode === "pan-y" ? v("y") : 0);
    } else if (mode === "held") {
      if (!e) return inner.onPointerCancel();
      if (s.heldMoved) return inner.onPointerUp(e);
      // A long press that did not drag: the context menu of what is under the finger.
      inner.onPointerCancel();
      start.target.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          composed: true,
          clientX: start.x,
          clientY: start.y,
        }),
      );
    }
  };

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: (e) => (e.pointerType === "touch" ? finish(e) : inner.onPointerUp(e)),
    onPointerCancel: () => {
      if (st.current.mode !== "idle") finish(null);
      inner.onPointerCancel();
    },
  };
}
