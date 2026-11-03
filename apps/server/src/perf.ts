// What makes the server slow, said in its log once a minute (task 35, 2026-11-03): requests over a second by route, named work over its budget, and how long the event loop was held.
import { monitorEventLoopDelay } from "node:perf_hooks";

/** A request slower than this is counted (a person notices a second, NN/g). */
export const SLOW_REQUEST_MS = 1000;
/** Long-lived answers (the live streams) are not requests that take long. */
const LIVE = /^GET \/api\/(stream|agent\/events|agent\/live\/:id|events)$/;

interface Tally {
  count: number;
  max: number;
}
const slow = new Map<string, Tally>();

/** Counts `name` when it took `ms` over `budget` (the minute's line says how often and the worst). */
export function note(name: string, ms: number, budget: number): void {
  if (ms <= budget) return;
  const t = slow.get(name) ?? { count: 0, max: 0 };
  t.count++;
  t.max = Math.max(t.max, ms);
  slow.set(name, t);
}

/** A request by its route ("GET /api/agent/runs/:id", never its ids or query), counted when slow. */
export function noteRequest(route: string, ms: number): void {
  if (!LIVE.test(route)) note(route, ms, SLOW_REQUEST_MS);
}

/** Runs `f`, counted as `name` when it takes more than `budget` ms. */
export function timed<T>(name: string, budget: number, f: () => T): T {
  const t0 = performance.now();
  try {
    return f();
  } finally {
    note(name, performance.now() - t0, budget);
  }
}

/** The minute's line, or null when nothing was slow and the loop was never held long. */
export function minuteLine(loopMax: number, loopP99: number): string | null {
  const parts = [...slow.entries()]
    .sort((a, b) => b[1].max - a[1].max)
    .slice(0, 8)
    .map(([name, t]) => `${name} ${t.count}× (max ${Math.round(t.max)} ms)`);
  slow.clear();
  if (!parts.length && loopMax < 500) return null;
  return `slow in the last minute: ${parts.join("; ") || "nothing named"}; event loop held up to ${Math.round(loopMax)} ms (p99 ${Math.round(loopP99)} ms)`;
}

/** Starts the minute's line in the log; returns how to stop it. */
export function watchSlowness(log: (line: string) => void = console.warn): () => void {
  const h = monitorEventLoopDelay({ resolution: 20 });
  h.enable();
  const timer = setInterval(() => {
    const line = minuteLine(h.max / 1e6, h.percentile(99) / 1e6);
    h.reset();
    if (line) log(line);
  }, 60_000);
  timer.unref();
  return () => {
    clearInterval(timer);
    h.disable();
  };
}

/** Tests only. */
export function resetSlowness(): void {
  slow.clear();
}
