import { describe, expect, it } from "vitest";
import { clamp, looksLikeNotch, Viewport, wheelPixels } from "./viewport.ts";

function harness() {
  let t = 0;
  const queue: ((t: number) => void)[] = [];
  const vp = new Viewport({
    now: () => t,
    schedule: (cb) => queue.push(cb),
    cancel: () => {},
  });
  vp.setSize(600, 200, 7);
  vp.reset({ hh: 60, scrollY: 0, viewX: 0 });
  const run = (frames: number, dt = 16) => {
    for (let i = 0; i < frames && queue.length; i++) {
      t += dt;
      queue.shift()?.(t);
    }
  };
  return { vp, run };
}
const ev = (o: Partial<Parameters<Viewport["wheel"]>[0]> = {}) => ({
  deltaX: 0,
  deltaY: 0,
  deltaMode: 0,
  ctrlKey: false,
  shiftKey: false,
  metaKey: false,
  ...o,
});

describe("helpers", () => {
  it("normalises wheel units and detects notches", () => {
    expect(wheelPixels(3, 1, 600)).toBe(48);
    expect(wheelPixels(1, 2, 600)).toBe(600);
    expect(looksLikeNotch(100)).toBe(true);
    expect(looksLikeNotch(4.5)).toBe(false);
    expect(clamp(5, 0, 3)).toBe(3);
  });
});

describe("Viewport", () => {
  it("scrolls vertically toward the target and stops there", () => {
    const { vp, run } = harness();
    vp.wheel(ev({ deltaY: 100 }), 0);
    run(2);
    expect(vp.scrollY).toBeGreaterThan(0);
    expect(vp.scrollY).toBeLessThan(100);
    run(200);
    expect(vp.scrollY).toBe(100);
    expect(vp.animating).toBe(false);
  });
  it("clamps scroll to the day", () => {
    const { vp, run } = harness();
    vp.wheel(ev({ deltaY: -500 }), 0);
    run(100);
    expect(vp.scrollY).toBe(0);
    vp.wheel(ev({ deltaY: 100000 }), 0);
    run(300);
    expect(vp.scrollY).toBe(24 * 60 - 600);
  });
  it("zooms with Ctrl keeping the time under the pointer fixed", () => {
    const { vp, run } = harness();
    vp.reset({ hh: 60, scrollY: 300 });
    const py = 200;
    const minuteBefore = ((vp.scrollY + py) / vp.hh) * 60;
    vp.wheel(ev({ deltaY: -200, ctrlKey: true }), py);
    for (let i = 0; i < 10; i++) {
      run(1);
      const m = ((vp.scrollY + py) / vp.hh) * 60;
      expect(Math.abs(m - minuteBefore)).toBeLessThan(0.5);
    }
    run(200);
    expect(vp.hh).toBeGreaterThan(60);
    expect(Math.abs(((vp.scrollY + py) / vp.hh) * 60 - minuteBefore)).toBeLessThan(0.5);
  });
  it("keeps the committed hour height a multiple of 4 px, even for tiny pinch steps", () => {
    const { vp, run } = harness();
    vp.reset({ hh: 60 });
    for (let i = 0; i < 12; i++) vp.wheel(ev({ deltaY: -3, ctrlKey: true }), 100); // 12 tiny steps add up
    run(300);
    expect(vp.hh % 4).toBe(0);
    expect(vp.hh).toBeGreaterThan(60);
  });
  it("never zooms out beyond fitting 24 hours", () => {
    const { vp, run } = harness();
    vp.wheel(ev({ deltaY: 100000, ctrlKey: true }), 0);
    run(300);
    expect(vp.hh).toBe(28); // 600 / 24 = 25, rounded up to a multiple of the 4 px step
  });
  it("moves horizontally with Shift and snaps to a whole day", async () => {
    const { vp, run } = harness();
    vp.wheel(ev({ deltaY: 100, shiftKey: true }), 0);
    vp.wheel(ev({ deltaY: 50, shiftKey: true }), 0);
    run(60);
    expect(vp.viewX).toBeGreaterThan(1);
    await new Promise((r) => setTimeout(r, 200));
    run(200);
    expect(Number.isInteger(vp.viewX)).toBe(true);
    expect(vp.viewX).toBe(2); // 1.5 rounds up
  });
  it("reports every frame to subscribers", () => {
    const { vp, run } = harness();
    let frames = 0;
    vp.subscribe(() => frames++);
    vp.goTo(7);
    run(300);
    expect(frames).toBeGreaterThan(5);
    expect(vp.viewX).toBe(7);
  });
});
