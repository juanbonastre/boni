// The pace of the machine (T-11): bounds as tight as written on a free machine, widened by a loaded one up to a cap,
// and A-15 still bites: a code three times over its bound fails at any load.
import { describe, expect, it } from "vitest";
import {
  CLOCK_CAP,
  CPU_CAP,
  clock,
  cpu,
  factors,
  type Pace,
  pace,
  TIMEOUT_CAP,
  TIMEOUT_FLOOR,
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

  it("T-11: the clock's factor is at least the load per core past one, up to its cap, as what a test waits for may run in other threads (task 143)", () => {
    // At a load of one per core or less, with the reference free, a bound is exactly as written.
    for (const load of [0, 0.5, 1]) {
      expect(factors(1, load)).toMatchObject({ clock: 1, cpu: 1, load });
      expect(() => under(599.9, 600, "clock", "it", factors(1, load))).not.toThrow();
      expect(() => under(600.1, 600, "clock", "it", factors(1, load))).toThrow(/×1\.00/);
    }
    // Over one it grows with the load, though the reference ran free; the CPU's factor does not move with it.
    expect(factors(1, 1.13).clock).toBeCloseTo(1.13);
    expect(factors(1, 2.27)).toMatchObject({ clock: 2.27, cpu: 1 });
    expect(() => under(935, 600, "clock", "a call of the box", factors(1, 2.27))).not.toThrow();
    // The reference's own ratio still counts when it is the larger.
    expect(factors(2.1, 1.5).clock).toBeCloseTo(2.1);
    // The cap holds: three times the bound fails at any load, and the failure says the factor and the load.
    for (const load of [2.5, 4, 20]) {
      expect(factors(1, load).clock).toBe(CLOCK_CAP);
      expect(() => under(1800, 600, "clock", "it", factors(1, load))).toThrow(
        new RegExp(`×2\\.50 slower.*load ${load.toFixed(2).replace(".", "\\.")} per core`),
      );
    }
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
    // One round is the median of five: a single round slowed by a pause would make the bound three rounds are held
    // to as wide as they are, and nothing would fail (task 142).
    work(2);
    const rounds: number[] = [];
    for (let r = 0; r < 5; r++) {
      const c0 = cpu();
      work(1);
      rounds.push(cpu() - c0);
    }
    const one = rounds.sort((a, b) => a - b)[2]!;
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

  it("T-11: vitest's limits stretch with the machine, four times at least and six at most, so a hang still fails", () => {
    // Four times on any machine: a load that comes after a package's tests start is not in the factor read then.
    expect(timeouts(free)).toEqual({ testTimeout: 20_000, hookTimeout: 40_000 });
    expect(timeouts({ clock: CLOCK_CAP, cpu: 1.15, load: 0.5 })).toEqual({
      testTimeout: 20_000,
      hookTimeout: 40_000,
    });
    expect(timeouts({ clock: 1, cpu: 1, load: 2 })).toEqual({
      testTimeout: 20_000,
      hookTimeout: 40_000,
    });
    // 17 s at 2.5 per core, a test of mail.test.ts (task 134), is under the limit then.
    expect(timeouts({ clock: 1, cpu: 1, load: 2.5 })).toEqual({
      testTimeout: 25_000,
      hookTimeout: 50_000,
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
    expect(TIMEOUT_FLOOR).toBeLessThan(TIMEOUT_CAP);
  });

  it("T-11: what it adds is small: one measure of the machine is a few ms of CPU", () => {
    pace();
    const c = cpu();
    for (let i = 0; i < 5; i++) pace();
    under((cpu() - c) / 5, 40, "cpu", "a measure of the machine");
  });
});
