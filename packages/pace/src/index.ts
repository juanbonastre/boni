/**
 * Tests that bound time, held to how loaded the machine is at that moment (T-11, task 134). Several sessions and other
 * work share the development machine, and `make check` runs many packages' tests at once, so a bound on time failed
 * although the code was right. Every test that bounds time reads its clock here and checks its bound with `under`;
 * vitest's own limits come from `timeouts`.
 *
 * How loaded the machine is, is measured right then: a short fixed workload, timed on the clock and in this thread's
 * CPU time. Its CPU time barely moves with the load; its clock stretches as much as other work stops this thread
 * (task 134, measured with 16 busy loops on 8 cores: the clock ×4 to ×7, CPU time ×1.1 to ×1.25). Their ratio is the
 * factor, so nothing here knows any machine's speed: the same code is as tight in CI as on a laptop. The load average
 * per core is the second signal: it is printed with every failure, and it widens vitest's limits, which are set once
 * when a package's tests start, before the other packages of the same run load the machine.
 *
 * On a free machine every factor is 1 and every bound is as tight as it was written. Each factor has a cap, so a hang
 * still fails, and a code three times over its bound fails at any load: the same load that widens the bound slows the
 * code it measures (`pace.test.ts` proves both).
 */
import { availableParallelism, loadavg } from "node:os";

/** This thread's CPU time, in ms: what a test of synchronous code measures (tasks 113 and 116). */
export const cpu = (): number => {
  const u = process.threadCpuUsage();
  return (u.user + u.system) / 1000;
};

/** The clock, in ms: what a test of something that waits (a timer, a child process, a browser) measures. */
export const clock = (): number => performance.now();

/** How loaded the machine is now: what each kind of bound is multiplied by. */
export interface Pace {
  /** The factor for a bound on the clock: how much longer the clock ran than the CPU on the reference. 1 to 2.5. */
  clock: number;
  /** The factor for a bound in this thread's CPU time: what a busy machine adds to it (shared caches, cores). 1 to 1.5. */
  cpu: number;
  /** The load average of the last minute per core. */
  load: number;
  /** The load average of the last five minutes per core: load comes in waves, and a wave that just ebbed comes back. */
  recent?: number;
}

/** A clock ratio below this is a free machine (timer grain, a collection): the factor stays 1. */
const FREE = 1.25;
/**
 * The caps: past them a test fails, loaded or not. Both under three, so a code three times over its bound fails at any
 * load as written (A-15), not only because the load slows it too.
 */
export const CLOCK_CAP = 2.5;
export const CPU_CAP = 1.5;
/** How many times the reference runs: its median ratio is the factor. */
const SAMPLES = 3;

/** The reference: about four milliseconds of the work (longer than a turn of the scheduler, so a loaded machine stops it) tests time (objects, strings, a map, a sort), always the same. */
function reference(): number {
  const rows: { i: number; t: string }[] = [];
  for (let i = 0; i < 2500; i++) rows.push({ i, t: `r${(i * 7919) % 2500}` });
  const m = new Map<string, number>();
  for (const r of rows) m.set(r.t, (m.get(r.t) ?? 0) + r.i);
  rows.sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
  return JSON.parse(JSON.stringify(rows)).length + m.size;
}

const clamp = (x: number, cap: number) => Math.min(cap, Math.max(1, x));

/**
 * The machine now: the reference timed `SAMPLES` times. Costs about 15 ms of CPU (and its clock, longer on a loaded
 * machine); call it right before or after what is measured, never once for a whole file.
 */
export function pace(): Pace {
  reference(); // warm
  const ratios: number[] = [];
  for (let i = 0; i < SAMPLES; i++) {
    const w = clock();
    const c = cpu();
    reference();
    const dc = cpu() - c;
    const dw = clock() - w;
    ratios.push(dc > 0 ? dw / dc : 1);
  }
  ratios.sort((a, b) => a - b);
  const ratio = ratios[SAMPLES >> 1] ?? 1;
  const over = ratio < FREE ? 1 : ratio;
  const [one = 0, five = 0] = loadavg();
  const cores = availableParallelism();
  return {
    clock: clamp(over, CLOCK_CAP),
    // From the ratio before its cap: CPU time grew about a tenth of what the clock did (task 134, measured).
    cpu: clamp(1 + (over - 1) / 10, CPU_CAP),
    load: one / cores,
    recent: five / cores,
  };
}

/** The machine as one line, for a failure or a log. */
export const said = (p: Pace): string =>
  `the clock ×${p.clock.toFixed(2)} slower than the CPU, CPU time ×${p.cpu.toFixed(2)}, load ${p.load.toFixed(2)} per core`;

/**
 * Checks a time against its bound at the machine's pace: `ms` must be under `bound` times the factor of its kind
 * (`cpu` for an elapsed `cpu()`, `clock` for an elapsed `clock()`). A failure says the factor and the load, and whether
 * the machine was loaded past what the bound allows or the code is slow. `p` is the machine measured; by default, now.
 */
export function under(
  ms: number,
  bound: number,
  on: "cpu" | "clock",
  what = "it",
  p: Pace = pace(),
): void {
  const f = on === "cpu" ? p.cpu : p.clock;
  const limit = bound * f;
  if (ms < limit) return;
  const capped = f >= (on === "cpu" ? CPU_CAP : CLOCK_CAP);
  const verdict =
    f === 1
      ? p.load >= 1
        ? `the reference ran free though the load is ${p.load.toFixed(2)} per core: the code is slow, or the load came after it was measured`
        : "the machine is free: the code is slow"
      : capped
        ? "the factor is at its cap: the machine is loaded past what the bound allows, or the code is slow"
        : "the bound already counts this load: the code is slow";
  throw new Error(
    `${what} took ${ms.toFixed(1)} ms of ${on === "cpu" ? "this thread's CPU time" : "the clock"}, not under ${bound} ms × ${f.toFixed(2)} = ${limit.toFixed(1)} ms (${said(p)}): ${verdict}`,
  );
}

/** The cap of vitest's limits: 30 s for a test, 60 s for a hook; a hang still fails. */
export const TIMEOUT_CAP = 6;
/**
 * The floor of vitest's limits: 20 s for a test, 40 s for a hook, on any machine. They are set once, when a package's
 * tests start, and a load that comes after is not in them: with ten busy loops starting with the run, the factor read
 * at the start went from 1.3 to 2.5 under the same load (the load average lags, and the reference sometimes ran
 * between the loops), while the heavy tests under such a load took up to 17 s, and a hook 16 s (task 134). These limits
 * only catch a hang; how fast the code is, is `under`'s.
 */
export const TIMEOUT_FLOOR = 4;

/**
 * The factor for a limit on the clock that only catches a hang: `TIMEOUT_FLOOR`, the reference's, or twice the load per
 * core of the last minute or of the last five, whichever is more, up to `TIMEOUT_CAP` (the reference's counts only if
 * `CLOCK_CAP` ever rises above the floor). Twice, because it is taken when a package's tests
 * start, and the heavy tests then ran slower than the load alone says; the five minutes too, because the load comes in
 * waves (task 134, measured: «brings the mail through its piece…» 17 s at 2.5 per core, the planner's evaluation 1.8 s
 * free and 18.8 to 21 s at 3.7 per core, a hook of AU-60 16 s at 2.5 per core; a login of the API v1 0.45 s free and
 * 14.2 s with the minute at 1 per core and the five minutes at 2.5).
 */
export function stretch(p: Pace = pace()): number {
  const load = Math.max(p.load, p.recent ?? 0);
  return Math.min(TIMEOUT_CAP, Math.max(TIMEOUT_FLOOR, p.clock, 2 * load));
}

export function timeouts(p: Pace = pace()): { testTimeout: number; hookTimeout: number } {
  const f = stretch(p);
  return { testTimeout: Math.round(5000 * f), hookTimeout: Math.round(10_000 * f) };
}
