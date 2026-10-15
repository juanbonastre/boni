// Runs the in-app benchmark in a real (headed) Chrome window: the baseline for Electron/Tauri.
// Usage: node bench/run-chrome.mjs [url]   (needs `pnpm build` and a static server, see Makefile `bench-chrome`)

import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";

const url =
  process.argv[2] ?? "http://localhost:4173/?bench=auto&now=2025-09-17T14:29&tz=Europe/Madrid";
const headless = process.env.HEADLESS === "1";
const browser = await chromium.launch({
  channel: "chrome",
  headless,
  args: (process.env.FLAGS ?? "--enable-gpu-rasterization --ignore-gpu-blocklist")
    .split(" ")
    .filter(Boolean),
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const result = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("bench timed out")), 120_000);
  page.on("console", (msg) => {
    const text = msg.text();
    if (text.startsWith("BENCH_RESULT ")) {
      clearTimeout(timer);
      resolve(JSON.parse(text.slice("BENCH_RESULT ".length)));
    }
  });
  if (process.env.STYLE)
    page.addInitScript(
      (css) =>
        addEventListener("DOMContentLoaded", () => {
          const st = document.createElement("style");
          st.textContent = css;
          document.head.append(st);
        }),
      process.env.STYLE,
    );
  page.goto(url).catch(reject);
});
await browser.close();
mkdirSync("bench/results", { recursive: true });
const file = `bench/results/${process.env.OUT ?? `chrome${headless ? "-headless" : ""}`}.json`;
writeFileSync(file, JSON.stringify(result, null, 2));
console.log(
  JSON.stringify(
    result.phases.map((p) => ({
      phase: p.name,
      frames: p.frames,
      p50: p.p50,
      p95: p.p95,
      p99: p.p99,
      max: p.maxMs,
      jank: p.jank,
    })),
    null,
    1,
  ),
);
console.log(
  `idle frame ${result.idleFrameMs} ms, dpr ${result.dpr}, ${result.viewport} -> ${file}`,
);
