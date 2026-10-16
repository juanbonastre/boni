/**
 * Smooth viewport for the time grid. Wheel input only moves *targets*; a requestAnimationFrame
 * loop eases the rendered values toward them (frame-rate independent exponential smoothing) and
 * reports each frame so the view can write transforms straight to the DOM without going through
 * React. Axes:
 *   scrollY  vertical scroll in px (0 = midnight at the top)
 *   hh       hour height in px (zoom)
 *   viewX    leftmost visible position in days (fractional), absolute civil day number
 */

export const MIN_HH = 12;
export const MAX_HH = 320;
/**
 * Committed hour heights are multiples of this, so a 15-minute slot is a whole number of pixels: event cards, hour
 * lines and labels then sit on whole pixels, which keeps text sharp (fractional offsets blur text on GPU layers).
 */
export const HH_STEP = 4;
const EPS_PX = 0.05;
/** A released swipe keeps going for about this long at the speed it had (touch). */
const FLING_MS = 320;
const EPS_DAY = 0.0005;

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Wheel deltas normalised to CSS pixels. */
export function wheelPixels(delta: number, mode: number, pageSize: number): number {
  if (mode === 1) return delta * 16;
  if (mode === 2) return delta * pageSize;
  return delta;
}

/** A mouse-wheel notch comes as a big integer delta; touchpads stream small, fine deltas. */
export function looksLikeNotch(delta: number): boolean {
  return Math.abs(delta) >= 50 && Number.isInteger(delta);
}

export interface Frame {
  scrollY: number;
  hh: number;
  viewX: number;
}

export interface ViewportOptions {
  tauScroll?: number;
  tauZoom?: number;
  tauX?: number;
  /** Time source and scheduler are injectable for tests. */
  now?: () => number;
  schedule?: (cb: (t: number) => void) => number;
  cancel?: (id: number) => void;
}

export class Viewport {
  scrollY = 0;
  hh = 56;
  viewX = 0;
  private tScrollY = 0;
  private tHh = 56;
  /** Unquantised zoom target: tiny pinch steps accumulate here and only snap when they add up to a step. */
  private rawHh = 56;
  private tViewX = 0;
  private anchor: { min: number; py: number } | null = null;

  bodyHeight = 600;
  colW = 200;
  nDays = 7;
  /** True once the first position was set; later mounts keep zoom and scroll. */
  initialized = false;
  /** True while the hour height is still easing toward its target (zoom animation in flight). */
  isZooming = false;

  private raf = 0;
  private last = 0;
  private snapTimer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<(f: Frame) => void>();
  private readonly tauScroll: number;
  private readonly tauZoom: number;
  private readonly tauX: number;
  private readonly schedule: (cb: (t: number) => void) => number;
  private readonly cancel: (id: number) => void;
  private readonly now: () => number;

  constructor(opts: ViewportOptions = {}) {
    this.tauScroll = opts.tauScroll ?? 75;
    this.tauZoom = opts.tauZoom ?? 70;
    this.tauX = opts.tauX ?? 85;
    this.now = opts.now ?? (() => performance.now());
    this.schedule = opts.schedule ?? ((cb) => requestAnimationFrame(cb));
    this.cancel = opts.cancel ?? ((id) => cancelAnimationFrame(id));
  }

  subscribe(fn: (f: Frame) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  frame(): Frame {
    return { scrollY: this.scrollY, hh: this.hh, viewX: this.viewX };
  }

  get minHh(): number {
    return Math.max(MIN_HH, Math.ceil(this.bodyHeight / 24 / HH_STEP) * HH_STEP);
  }

  private quantize(hh: number): number {
    return clamp(Math.round(hh / HH_STEP) * HH_STEP, this.minHh, MAX_HH);
  }

  get maxScroll(): number {
    return Math.max(0, 24 * this.hh - this.bodyHeight);
  }

  get animating(): boolean {
    return this.raf !== 0;
  }

  setSize(bodyHeight: number, colW: number, nDays: number): void {
    this.bodyHeight = bodyHeight;
    this.colW = colW;
    this.nDays = nDays;
    this.tHh = clamp(this.tHh, this.minHh, MAX_HH);
    this.rawHh = clamp(this.rawHh, this.minHh, MAX_HH);
    this.hh = clamp(this.hh, this.minHh, MAX_HH);
    this.scrollY = clamp(this.scrollY, 0, this.maxScroll);
    this.tScrollY = clamp(this.tScrollY, 0, Math.max(0, 24 * this.tHh - bodyHeight));
    this.emit();
  }

  /** Jump (no animation) to a state; used for initial position. */
  reset(f: Partial<Frame>): void {
    this.initialized = true;
    if (f.hh !== undefined) {
      this.tHh = this.quantize(f.hh);
      this.hh = this.tHh;
      this.rawHh = this.tHh;
    }
    if (f.scrollY !== undefined) this.scrollY = this.tScrollY = clamp(f.scrollY, 0, this.maxScroll);
    if (f.viewX !== undefined) this.viewX = this.tViewX = f.viewX;
    this.anchor = null;
    this.emit();
  }

  /** Animate the horizontal position to `day` (a civil day number, may be fractional). */
  goTo(day: number, animate = true): void {
    this.tViewX = day;
    if (!animate) this.viewX = day;
    this.kick();
  }

  shiftDays(delta: number): void {
    this.goTo(Math.round(this.tViewX) + delta);
  }

  get targetX(): number {
    return this.tViewX;
  }

  /** Nudge the vertical target (used for auto-scroll while dragging near the edges). */
  scrollBy(dy: number): void {
    this.tScrollY = clamp(this.tScrollY + dy, 0, Math.max(0, 24 * this.tHh - this.bodyHeight));
    this.anchor = null;
    this.kick();
  }

  scrollToMinute(minute: number, animate = true): void {
    const y = clamp((minute / 60) * this.tHh, 0, Math.max(0, 24 * this.tHh - this.bodyHeight));
    this.tScrollY = y;
    if (!animate) this.scrollY = y;
    this.kick();
  }

  /** Handles a wheel event inside the grid body. `py` = pointer y relative to the body top. */
  wheel(
    e: {
      deltaX: number;
      deltaY: number;
      deltaMode: number;
      ctrlKey: boolean;
      shiftKey: boolean;
      metaKey: boolean;
    },
    py: number,
  ): void {
    const page = this.bodyHeight;
    const dy = wheelPixels(e.deltaY, e.deltaMode, page);
    const dx = wheelPixels(e.deltaX, e.deltaMode, page);
    if (e.ctrlKey || e.metaKey) {
      this.zoomBy(Math.exp(-dy * 0.0022), py);
      return;
    }
    const horizontal = e.shiftKey || Math.abs(dx) > Math.abs(dy);
    if (horizontal) {
      const d = e.shiftKey ? dx || dy : dx;
      const days = looksLikeNotch(d) ? d / 100 : d / Math.max(80, this.colW);
      this.tViewX += days;
      this.armSnap();
      this.kick();
      return;
    }
    const max = Math.max(0, 24 * this.tHh - this.bodyHeight);
    this.tScrollY = clamp(this.tScrollY + dy, 0, max);
    this.anchor = null;
    this.kick();
  }

  /**
   * Touch: the content follows the finger at once (no easing). `dx`/`dy` are how far the finger moved
   * (px, positive = right/down), so the view moves the other way.
   */
  panBy(dx: number, dy: number): void {
    if (this.snapTimer) {
      clearTimeout(this.snapTimer);
      this.snapTimer = null;
    }
    this.anchor = null;
    if (dy) {
      this.scrollY = clamp(this.scrollY - dy, 0, this.maxScroll);
      this.tScrollY = this.scrollY;
    }
    if (dx) {
      this.viewX -= dx / this.colW;
      this.tViewX = this.viewX;
    }
    this.emit();
  }

  /**
   * Touch released with a velocity (px/ms, finger direction): a vertical swipe glides on and slows
   * down; a horizontal one settles on a whole day, further along the faster it was.
   */
  fling(vx: number, vy: number): void {
    if (vy) {
      this.tScrollY = clamp(
        this.scrollY - vy * FLING_MS,
        0,
        Math.max(0, 24 * this.tHh - this.bodyHeight),
      );
    }
    if (vx || !Number.isInteger(this.viewX)) {
      const ahead = this.viewX - (vx * FLING_MS) / this.colW;
      // A flick, even a short one, turns at least to the next day in its direction.
      this.tViewX =
        Math.abs(vx) > 0.25
          ? vx < 0
            ? Math.max(Math.ceil(this.viewX), Math.round(ahead))
            : Math.min(Math.floor(this.viewX), Math.round(ahead))
          : Math.round(this.viewX);
    }
    this.kick();
  }

  zoomBy(factor: number, py: number): void {
    this.rawHh = clamp(this.rawHh * factor, this.minHh, MAX_HH);
    const nextHh = this.quantize(this.rawHh);
    if (nextHh === this.tHh) return;
    // Keep the instant under the pointer fixed, measured from what is on screen right now.
    this.anchor = { min: ((this.scrollY + py) / this.hh) * 60, py };
    this.tHh = nextHh;
    this.tScrollY = clamp(
      (this.anchor.min / 60) * nextHh - py,
      0,
      Math.max(0, 24 * nextHh - this.bodyHeight),
    );
    this.kick();
  }

  setZoom(hh: number, animate = true): void {
    this.anchor = {
      min: ((this.scrollY + this.bodyHeight / 2) / this.hh) * 60,
      py: this.bodyHeight / 2,
    };
    this.rawHh = clamp(hh, this.minHh, MAX_HH);
    this.tHh = this.quantize(hh);
    this.tScrollY = clamp(
      (this.anchor.min / 60) * this.tHh - this.bodyHeight / 2,
      0,
      Math.max(0, 24 * this.tHh - this.bodyHeight),
    );
    if (!animate) {
      this.hh = this.tHh;
      this.scrollY = this.tScrollY;
      this.anchor = null;
    }
    this.kick();
  }

  /** After horizontal input stops, settle on a whole day so columns align with the grid. */
  private armSnap(): void {
    if (this.snapTimer) clearTimeout(this.snapTimer);
    this.snapTimer = setTimeout(() => {
      this.snapTimer = null;
      this.tViewX = Math.round(this.tViewX);
      this.kick();
    }, 130);
  }

  private kick(): void {
    if (this.raf === 0) {
      this.last = this.now();
      this.raf = this.schedule((t) => this.tick(t));
    }
  }

  private tick(_t: number): void {
    const now = this.now();
    const dt = clamp(now - this.last, 1, 64);
    this.last = now;
    const ease = (tau: number) => 1 - Math.exp(-dt / tau);

    this.hh += (this.tHh - this.hh) * ease(this.tauZoom);
    const zooming = Math.abs(this.tHh - this.hh) > EPS_PX * 0.2;
    if (!zooming) this.hh = this.tHh;
    this.isZooming = zooming;

    if (this.anchor && zooming) {
      this.scrollY = clamp((this.anchor.min / 60) * this.hh - this.anchor.py, 0, this.maxScroll);
    } else {
      if (this.anchor) this.anchor = null;
      this.scrollY += (this.tScrollY - this.scrollY) * ease(this.tauScroll);
      if (Math.abs(this.tScrollY - this.scrollY) < EPS_PX) this.scrollY = this.tScrollY;
      this.scrollY = clamp(this.scrollY, 0, this.maxScroll);
    }

    this.viewX += (this.tViewX - this.viewX) * ease(this.tauX);
    if (Math.abs(this.tViewX - this.viewX) < EPS_DAY) this.viewX = this.tViewX;

    this.emit();

    const busy = zooming || this.scrollY !== this.tScrollY || this.viewX !== this.tViewX;
    this.raf = busy ? this.schedule((t) => this.tick(t)) : 0;
  }

  private emit(): void {
    const f = this.frame();
    for (const l of this.listeners) l(f);
  }

  dispose(): void {
    if (this.raf) this.cancel(this.raf);
    if (this.snapTimer) clearTimeout(this.snapTimer);
    this.raf = 0;
    this.listeners.clear();
  }
}
