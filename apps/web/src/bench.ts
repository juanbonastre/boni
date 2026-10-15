/**
 * Built-in smoothness benchmark, run with `?bench=1`. It drives the real wheel pipeline (synthetic
 * WheelEvents on the grid) and records requestAnimationFrame deltas per scenario, so the same
 * numbers can be collected in Chrome, Electron and Tauri's WebView.
 */
import { useApp } from "./store.ts";

export interface PhaseResult {
  name: string;
  frames: number;
  avgMs: number;
  p50: number;
  p95: number;
  p99: number;
  maxMs: number;
  jank: number; // frames longer than 25 ms
  longTasks: number | null;
}

export interface BenchResult {
  engine: string;
  userAgent: string;
  dpr: number;
  viewport: string;
  idleFrameMs: number;
  phases: PhaseResult[];
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[i] ?? 0;
}

async function sample(
  durationMs: number,
  tick: (i: number) => void,
  intervalMs: number,
): Promise<
  PhaseResult["frames"] extends number ? { deltas: number[]; longTasks: number | null } : never
> {
  const deltas: number[] = [];
  let longTasks: number | null = null;
  let obs: PerformanceObserver | null = null;
  try {
    obs = new PerformanceObserver((list) => {
      longTasks = (longTasks ?? 0) + list.getEntries().length;
    });
    obs.observe({ entryTypes: ["longtask"] });
    longTasks = 0;
  } catch {
    longTasks = null;
  }
  let last = 0;
  let running = true;
  const frame = (t: number) => {
    if (last) deltas.push(t - last);
    last = t;
    if (running) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  let i = 0;
  const timer = setInterval(() => tick(i++), intervalMs);
  await sleep(durationMs);
  clearInterval(timer);
  await sleep(250); // let the last animation settle inside the sample
  running = false;
  obs?.disconnect();
  return { deltas, longTasks };
}

function summarize(name: string, deltas: number[], longTasks: number | null): PhaseResult {
  const sorted = [...deltas].sort((a, b) => a - b);
  const sum = deltas.reduce((a, b) => a + b, 0);
  return {
    name,
    frames: deltas.length,
    avgMs: round(sum / Math.max(1, deltas.length)),
    p50: round(percentile(sorted, 50)),
    p95: round(percentile(sorted, 95)),
    p99: round(percentile(sorted, 99)),
    maxMs: round(sorted[sorted.length - 1] ?? 0),
    jank: deltas.filter((d) => d > 25).length,
    longTasks,
  };
}

const round = (n: number) => Math.round(n * 100) / 100;

function wheel(target: Element, init: WheelEventInit) {
  const rect = target.getBoundingClientRect();
  target.dispatchEvent(
    new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
      deltaMode: 0,
      ...init,
    }),
  );
}

export async function runBench(only = ""): Promise<BenchResult> {
  const app = useApp.getState();
  const phases: PhaseResult[] = [];
  const grid = () => document.querySelector(".grid, .month") as Element;

  app.set({ popoverId: null, selectedId: null });
  app.setView("week");
  await sleep(800);
  const idle = await sample(1000, () => {}, 1000);
  const idleSorted = [...idle.deltas].sort((a, b) => a - b);

  const run = async (
    name: string,
    ms: number,
    interval: number,
    tick: (i: number, el: Element) => void,
  ) => {
    if (only && !name.includes(only)) return;
    const r = await sample(ms, (i) => tick(i, grid()), interval);
    phases.push(summarize(name, r.deltas, r.longTasks));
    await sleep(400);
  };

  await run("week scroll (wheel notches)", 3000, 45, (i, el) =>
    wheel(el, { deltaY: (Math.floor(i / 20) % 2 ? -1 : 1) * 100 }),
  );
  await run("week scroll (touchpad stream)", 3000, 8, (i, el) =>
    wheel(el, { deltaY: (Math.floor(i / 150) % 2 ? -1 : 1) * 6 }),
  );
  await run("week ctrl+wheel zoom", 3000, 40, (i, el) =>
    wheel(el, { deltaY: (Math.floor(i / 25) % 2 ? 1 : -1) * 100, ctrlKey: true }),
  );
  await run("week shift+wheel days", 3000, 60, (_i, el) =>
    wheel(el, { deltaY: 100, shiftKey: true }),
  );

  app.setView("days", 14);
  await sleep(800);
  await run("14 days: scroll + zoom", 3000, 40, (i, el) =>
    i % 2
      ? wheel(el, { deltaY: 100 * (Math.floor(i / 30) % 2 ? -1 : 1) })
      : wheel(el, { deltaY: 60 * (Math.floor(i / 30) % 2 ? 1 : -1), ctrlKey: true }),
  );

  app.setView("month");
  await sleep(800);
  await run("month scroll (wheel notches)", 3000, 45, (_i, el) => wheel(el, { deltaY: 100 }));

  app.setView("week");
  const ua = navigator.userAgent;
  const engine = /Electron\//.test(ua)
    ? "electron"
    : /Tauri|WebKit/.test(ua) && !/Chrome/.test(ua)
      ? "webkit"
      : "chromium";
  return {
    engine,
    userAgent: ua,
    dpr: window.devicePixelRatio,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    idleFrameMs: round(percentile(idleSorted, 50)),
    phases,
  };
}

declare global {
  interface Window {
    hostBridge?: { saveBench?: (json: string) => void; quit?: () => void };
    __TAURI__?: {
      core?: { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };
    };
    __benchResult?: BenchResult;
  }
}

export async function autoBench(): Promise<void> {
  await sleep(1200);
  const result = await runBench(new URLSearchParams(location.search).get("only") ?? "");
  window.__benchResult = result;
  const json = JSON.stringify(result, null, 2);
  if (window.hostBridge?.saveBench) window.hostBridge.saveBench(json);
  else if (window.__TAURI__?.core) await window.__TAURI__.core.invoke("save_bench", { json });
  console.log(`BENCH_RESULT ${json}`);
}
