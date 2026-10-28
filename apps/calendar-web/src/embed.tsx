import { fromLocal, systemTimeZone } from "@boni/calendar";
import { initClock } from "./clock.ts";
import type { HostStorage } from "./host.ts";
import { mountApp } from "./mount.tsx";
import css from "./styles.css?inline";

/**
 * Test page: the app mounted inside another app's pane (embed.html), the way the Obsidian plugin
 * mounts it. By default the app lives in a shadow root, so neither app's CSS reaches the other;
 * `?shadow=0` mounts it straight into the page. Only built for the e2e tests (BONI_TEST_PAGES=1).
 */
function parseIso(iso: string, tz: string): number | null {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/);
  if (!m) return null;
  const day = Math.floor(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86_400_000);
  return fromLocal(day, Number(m[4] ?? 0) * 60 + Number(m[5] ?? 0), tz);
}

const memory = new Map<string, string>();
const storage: HostStorage = {
  get: (key) => memory.get(key) ?? null,
  set: (key, value) => void memory.set(key, value),
};

async function boot() {
  const params = new URLSearchParams(location.search);
  initClock(location.search, params.get("tz") ?? systemTimeZone(), parseIso);
  const pane = document.getElementById("pane");
  if (!pane) return;
  const shadow = params.get("shadow") !== "0" ? pane.attachShadow({ mode: "open" }) : null;
  const style = document.createElement("style");
  style.textContent = css;
  const container = document.createElement("div");
  container.style.height = "100%";
  if (shadow) shadow.append(style, container);
  else {
    document.head.append(style);
    pane.append(container);
  }
  await mountApp(container, { notes: null, storage, keys: "root" });
  const { useApp } = await import("./store.ts");
  (window as unknown as { __app: unknown }).__app = useApp;
}

void boot();
