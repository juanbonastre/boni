// What makes the server slow, said in its log once a minute (task 35, 2026-11-03): requests over a second by route, named work over its budget, how long the event loop was held and, then, what held it longest (task 43).
import { monitorEventLoopDelay } from "node:perf_hooks";
import { Worker } from "node:worker_threads";

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

/** The loop held this long makes the minute's line, and then what held it is looked for. */
const HELD_MS = 500;

/** What held the loop longest in the minute: how long, what ran most meanwhile, and its share of that time. */
export interface Hold {
  ms: number;
  what: string;
  share: number;
}

/** The minute's line, or null when nothing was slow and the loop was never held long. */
export function minuteLine(loopMax: number, loopP99: number, hold?: Hold | null): string | null {
  const parts = [...slow.entries()]
    .sort((a, b) => b[1].max - a[1].max)
    .slice(0, 8)
    .map(([name, t]) => `${name} ${t.count}× (max ${Math.round(t.max)} ms)`);
  slow.clear();
  if (!parts.length && loopMax < HELD_MS) return null;
  const by =
    hold && loopMax >= HELD_MS
      ? `; held longest by ${hold.what} (${Math.round(hold.ms)} ms${hold.share < 0.9 ? `, ${Math.round(hold.share * 100)} % of it` : ""})`
      : "";
  return `slow in the last minute: ${parts.join("; ") || "nothing named"}; event loop held up to ${Math.round(loopMax)} ms (p99 ${Math.round(loopP99)} ms)${by}`;
}

/** A CPU profile as V8 gives it (the parts read here). */
export interface CpuProfile {
  nodes: {
    id: number;
    callFrame: { functionName: string; url: string; lineNumber: number };
    children?: number[];
  }[];
  samples: number[];
  timeDeltas: number[];
}

/** A frame of Boni's own code (the server or a package of the core): its file. */
const OURS = /\/(?:apps|packages)\/[^/]+\/src\/(?:[^?#]*\/)?([^/?#]+\.ts)(?:[?#]|$)/;
/** Any other script, short: a package by its name, else the file's name; Node's own (`node:`) are left out. */
function scriptOf(url: string): string | null {
  if (!url || url.startsWith("node:")) return null;
  const pkg = /node_modules\/((?:@[^/]+\/)?[^/]+)\/(?!.*node_modules\/)/.exec(url)?.[1];
  return pkg ?? url.split(/[?#]/)[0]?.split("/").at(-1) ?? null;
}

/**
 * The longest stretch a profile shows the loop busy (no «(idle)» sample in it) and what ran most in it: the three
 * innermost of Boni's own functions ("store.ts entities ← data.ts listTypes ← http.ts handle"); when none of Boni's
 * ran, the innermost of a package or a script ("imapflow fetch"), else V8's own («(garbage collector)»).
 */
export function longestHold(p: CpuProfile): Hold | null {
  const byId = new Map(p.nodes.map((n) => [n.id, n]));
  const parent = new Map<number, number>();
  for (const n of p.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
  const idle = (id: number) => byId.get(id)?.callFrame.functionName === "(idle)";
  let best: { from: number; to: number; ms: number } | null = null;
  let from = -1;
  let ms = 0;
  for (let i = 0; i <= p.samples.length; i++) {
    const id = p.samples[i];
    if (id !== undefined && !idle(id)) {
      if (from < 0) {
        from = i;
        ms = 0;
      }
      ms += (p.timeDeltas[i] ?? 0) / 1000;
    } else if (from >= 0) {
      if (!best || ms > best.ms) best = { from, to: i, ms };
      from = -1;
    }
  }
  if (!best) return null;
  const label = (id: number): string => {
    const chain: string[] = [];
    for (let n = byId.get(id); n && chain.length < 3; n = byId.get(parent.get(n.id) ?? -1)) {
      const file = OURS.exec(n.callFrame.url)?.[1];
      if (!file) continue;
      const name = `${file} ${n.callFrame.functionName || "(anonymous)"}`;
      if (chain.at(-1) !== name) chain.push(name);
    }
    if (chain.length) return chain.join(" ← ");
    for (let n = byId.get(id); n; n = byId.get(parent.get(n.id) ?? -1)) {
      const script = scriptOf(n.callFrame.url);
      if (script) return `${script} ${n.callFrame.functionName || "(anonymous)"}`;
    }
    return byId.get(id)?.callFrame.functionName || "(unknown)";
  };
  const time = new Map<string, number>();
  for (let i = best.from; i < best.to; i++) {
    const what = label(p.samples[i] as number);
    time.set(what, (time.get(what) ?? 0) + (p.timeDeltas[i] ?? 0) / 1000);
  }
  const [what, t] = [...time.entries()].sort((a, b) => b[1] - a[1])[0] as [string, number];
  return { ms: best.ms, what, share: best.ms ? t / best.ms : 1 };
}

/** The loop beats this often; this long without a beat, the watchdog profiles it. */
const BEAT_MS = 20;
const STUCK_MS = 150;

/**
 * Says what held the loop (task 43): a watchdog thread sees the loop stop beating and only then profiles it, a
 * sample every 10 ms, until it beats again; the longest hold of the minute is kept. Nothing is profiled while the
 * loop is free: restarting a profile every minute would itself hold the NAS a quarter of a second. Null where it
 * cannot run (the line then says only how long).
 */
export function holdWatcher(failed: (why: string) => void = () => {}): {
  take: () => Hold | null;
  /** Ends the watchdog's thread (its session to this one with it: an exit then waits for no debugger). */
  stop: () => Promise<void>;
  /** Once the watchdog watches (the tests wait for it). */
  ready: Promise<void>;
} | null {
  try {
    const beat = new Int32Array(new SharedArrayBuffer(4));
    const heart = setInterval(() => Atomics.add(beat, 0, 1), BEAT_MS);
    heart.unref();
    const worker = new Worker(WATCHDOG, {
      eval: true,
      workerData: { beat, after: STUCK_MS },
      // A small thread: it only keeps the profile of one hold at a time (the container has 384 MB).
      resourceLimits: { maxOldGenerationSizeMb: 32 },
    });
    // Never unref'd (stop() ends it).
    let longest: Hold | null = null;
    let watching = () => {};
    const ready = new Promise<void>((ok) => {
      watching = ok;
    });
    worker.on("message", (m: CpuProfile | "watching" | { failed: string }) => {
      if (m === "watching") return watching();
      if ("failed" in m) return failed(m.failed);
      const h = longestHold(m);
      if (h && (!longest || h.ms > longest.ms)) longest = h;
    });
    // What cannot be watched is only not said (and why, once, in the log).
    worker.on("error", (e) => {
      clearInterval(heart);
      failed(String(e));
    });
    return {
      take: () => {
        const h = longest;
        longest = null;
        return h;
      },
      stop: async () => {
        clearInterval(heart);
        await worker.terminate();
      },
      ready,
    };
  } catch (e) {
    failed(String(e));
    return null;
  }
}

/** The watchdog's thread, plain JavaScript run as it is: it profiles the server's thread while that does not beat. */
const WATCHDOG = `
const { workerData, parentPort } = require("node:worker_threads");
const { Session } = require("node:inspector");
const { beat, after } = workerData;
const session = new Session();
session.connectToMainThread();
const post = (method, params) =>
  new Promise((ok, no) => session.post(method, params ?? {}, (e, r) => (e ? no(e) : ok(r))));
let enabled = false;
let last = 0;
let since = 0;
let profiling = false;
const watch = () => {
  if (!enabled) return;
  const now = Atomics.load(beat, 0);
  if (now === last) {
    if (!profiling && Date.now() - since >= after) {
      profiling = true;
      post("Profiler.start").catch(() => {});
    }
    return;
  }
  last = now;
  since = Date.now();
  if (!profiling) return;
  profiling = false;
  post("Profiler.stop").then((r) => parentPort.postMessage(r.profile), () => {});
};
// The watch first: it also keeps this thread alive while the first answers come (with nothing to do, a thread ends,
// and a busy server answers late).
setInterval(watch, 20);
Promise.all([post("Profiler.enable"), post("Profiler.setSamplingInterval", { interval: 10000 })]).then(
  () => {
    last = Atomics.load(beat, 0);
    since = Date.now();
    enabled = true;
    parentPort.postMessage("watching");
  },
  (e) => parentPort.postMessage({ failed: String(e && e.message ? e.message : e) }),
);
`;

/**
 * Starts the minute's line in the log; returns how to stop it (before the process exits). `sample`: also say what
 * held the loop (task 43).
 */
export function watchSlowness(
  log: (line: string) => void = console.warn,
  o: { sample?: boolean } = {},
): () => Promise<void> {
  const h = monitorEventLoopDelay({ resolution: 20 });
  h.enable();
  const holds = o.sample
    ? holdWatcher((why) => log(`slowness: what holds the loop cannot be said (${why})`))
    : null;
  const timer = setInterval(() => {
    const line = minuteLine(h.max / 1e6, h.percentile(99) / 1e6, holds?.take());
    h.reset();
    if (line) log(line);
  }, 60_000);
  timer.unref();
  return async () => {
    clearInterval(timer);
    h.disable();
    await holds?.stop();
  };
}

/** Tests only. */
export function resetSlowness(): void {
  slow.clear();
}
