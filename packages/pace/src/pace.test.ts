// The pace of the machine (T-11): bounds as tight as written on a free machine, widened by a loaded one up to a cap,
// and A-15 still bites: a code three times over its bound fails at any load.
import { describe, expect, it } from "vitest";
import {
  CLOCK_CAP,
  CPU_CAP,
  clock,
  cpu,
  type Pace,
  pace,
  TIMEOUT_CAP,
  timeouts,
  under,
} from "./index.ts";

const free: Pace = { clock: 1, cpu: 1, load: 0.3 };
/** A machine whose reference ran `f` times longer on the clock than in CPU time, as `pace()` reads it. */
const loaded = (f: number): Pace => ({
  clock: Math.min(CLOCK_CAP, f),
  cpu: Math.min(CPU_CAP, 1 + (f - 1) / 10),
  load: 2.5,
});

/** Synchronous work of a fixed size: `n` rounds of it take `n` times as long. */
function work(n: number): number {
  let s = 0;
  for (let r = 0; r < n; r++) {
    const a: number[] = [];
    for (let i = 0; i < 40_000; i++) a.push((i * 2654435761) % 1000);
    a.sort((x, y) => x - y);
    s += a[a.length >> 1] ?? 0;
  }
  return s;
}

describe("the machine's pace (T-11, task 134)", () => {
  it("T-11: measures the machine now, each factor between 1 and its cap", () => {
    const p = pace();
    expect(p.clock).toBeGreaterThanOrEqual(1);
    expect(p.clock).toBeLessThanOrEqual(CLOCK_CAP);
    expect(p.cpu).toBeGreaterThanOrEqual(1);
    expect(p.cpu).toBeLessThanOrEqual(CPU_CAP);
    expect(p.load).toBeGreaterThanOrEqual(0);
  });

  it("T-11: on a free machine a bound is as tight as written", () => {
    expect(() => under(39.9, 40, "cpu", "it", free)).not.toThrow();
    expect(() => under(40.1, 40, "cpu", "it", free)).toThrow(
      /the machine is free: the code is slow/,
    );
    expect(() => under(100.5, 100, "clock", "it", free)).toThrow(/×1\.00/);
    // The reference ran free while the load average says busy: the verdict says both.
    expect(() => under(41, 40, "cpu", "it", { clock: 1, cpu: 1, load: 2 })).toThrow(
      /the reference ran free though the load is 2\.00 per core/,
    );
  });

  it("T-11: a loaded machine widens a bound by its factor, up to its cap, and the failure says the load", () => {
    // CPU time: 45.8 ms against 40 failed on a loaded laptop (storageVolume.test.ts, task 134).
    expect(() => under(45.8, 40, "cpu", "it", loaded(4))).not.toThrow();
    expect(() => under(104, 100, "clock", "typing", loaded(1.5))).not.toThrow();
    const failed = (() => {
      try {
        under(90, 40, "cpu", "the sum", loaded(5));
      } catch (e) {
        return (e as Error).message;
      }
    })();
    expect(failed).toMatch(
      /^the sum took 90\.0 ms of this thread's CPU time, not under 40 ms × 1\.40/,
    );
    expect(failed).toMatch(/load 2\.50 per core/);
    expect(failed).toMatch(/the bound already counts this load: the code is slow/);
    expect(() => under(70, 40, "cpu", "it", loaded(8))).toThrow(/at its cap/);
    expect(() => under(260, 100, "clock", "it", loaded(8))).toThrow(/at its cap/);
  });

  it("T-11, A-15: a code three times over its bound fails at any load, as the load slows it too", () => {
    // As written: both caps are under three, so three times the bound fails whatever the machine reads.
    for (const f of [1, 1.3, 2, 3, 8, 100]) {
      expect(() => under(300, 100, "clock", "it", loaded(f))).toThrow();
      expect(() => under(300, 100, "cpu", "it", loaded(f))).toThrow();
    }
    expect(CLOCK_CAP).toBeLessThan(3);
    expect(CPU_CAP).toBeLessThan(3);
    // And measured, on this machine now: the bound is one round's CPU time (what it takes on a free machine); three
    // rounds go over it on the clock and in CPU time, whatever the load.
    work(2);
    const c0 = cpu();
    work(1);
    const one = cpu() - c0;
    const w = clock();
    const c = cpu();
    work(3);
    const threeCpu = cpu() - c;
    const threeClock = clock() - w;
    const p = pace();
    expect(() => under(threeCpu, one, "cpu", "three rounds", p)).toThrow(/three rounds took/);
    expect(() => under(threeClock, one, "clock", "three rounds", p)).toThrow(/three rounds took/);
    under(one * 0.9, one, "cpu", "most of a round", p);
  });

  it("T-11: vitest's limits stretch with the machine, six times at most, so a hang still fails", () => {
    expect(timeouts(free)).toEqual({ testTimeout: 5000, hookTimeout: 10_000 });
    expect(timeouts({ clock: 1, cpu: 1, load: 1 })).toEqual({
      testTimeout: 10_000,
      hookTimeout: 20_000,
    });
    // 17 s at 2.5 per core, a test of mail.test.ts this morning (task 134), is under the limit then.
    expect(timeouts({ clock: 1, cpu: 1, load: 2.5 })).toEqual({
      testTimeout: 25_000,
      hookTimeout: 50_000,
    });
    expect(timeouts({ clock: CLOCK_CAP, cpu: 1.15, load: 0.5 })).toEqual({
      testTimeout: 12_500,
      hookTimeout: 25_000,
    });
    // A wave that just ebbed: a login of the API v1 took 14.2 s with the minute at 1 per core and the five minutes at
    // 2.5 (http.test.ts, task 134); 0.45 s free.
    expect(timeouts({ clock: 1, cpu: 1, load: 1, recent: 2.5 })).toEqual({
      testTimeout: 25_000,
      hookTimeout: 50_000,
    });
    expect(timeouts({ clock: CLOCK_CAP, cpu: CPU_CAP, load: 9 })).toEqual({
      testTimeout: 5000 * TIMEOUT_CAP,
      hookTimeout: 10_000 * TIMEOUT_CAP,
    });
  });

  it("T-11: what it adds is small: one measure of the machine is a few ms of CPU", () => {
    pace();
    const c = cpu();
    for (let i = 0; i < 5; i++) pace();
    under((cpu() - c) / 5, 40, "cpu", "a measure of the machine");
  });
});
