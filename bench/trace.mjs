// Records a Chrome trace while the zoom phase runs and prints where time goes.

import { readFileSync } from "node:fs";
import { chromium } from "@playwright/test";

const url = process.argv[2] ?? "http://localhost:4173/?now=2025-09-17T14:29&tz=Europe/Madrid";
const browser = await chromium.launch({
  channel: "chrome",
  headless: false,
  args: ["--enable-gpu-rasterization", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.goto(url);
await page.waitForSelector(".ev");
await page.waitForTimeout(800);
await browser.startTracing(page, {
  path: "/tmp/claude-1000/trace.json",
  categories: ["devtools.timeline", "disabled-by-default-devtools.timeline", "gpu", "cc", "viz"],
});
await page.evaluate(async () => {
  const el = document.querySelector(".grid");
  const r = el.getBoundingClientRect();
  const sleep = (ms) => new Promise((x) => setTimeout(x, ms));
  for (let i = 0; i < 70; i++) {
    el.dispatchEvent(
      new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        clientX: r.left + 800,
        clientY: r.top + 400,
        deltaY: (Math.floor(i / 25) % 2 ? 1 : -1) * 100,
        ctrlKey: true,
      }),
    );
    await sleep(40);
  }
  await sleep(500);
});
await browser.stopTracing();
await browser.close();
const trace = JSON.parse(readFileSync("/tmp/claude-1000/trace.json", "utf8"));
const events = trace.traceEvents ?? trace;
const sums = new Map();
for (const e of events) {
  if (e.ph !== "X" || !e.dur) continue;
  const key = `${e.name}`;
  const cur = sums.get(key) ?? { n: 0, dur: 0, max: 0 };
  cur.n++;
  cur.dur += e.dur;
  cur.max = Math.max(cur.max, e.dur);
  sums.set(key, cur);
}
const top = [...sums.entries()].sort((a, b) => b[1].dur - a[1].dur).slice(0, 28);
for (const [k, v] of top)
  console.log(
    `${k.padEnd(44)} n=${String(v.n).padStart(5)}  total=${(v.dur / 1000).toFixed(1).padStart(8)} ms  max=${(v.max / 1000).toFixed(1)} ms`,
  );
