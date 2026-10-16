import { fromLocal, systemTimeZone } from "@boni-calendar/core";
import { initClock } from "./clock.ts";
import { type Host, localStorageStore } from "./host.ts";
import { mountApp } from "./mount.tsx";
import type { VaultBridge } from "./vaultBridge.ts";
import "./page.css";
import "./styles.css";

// Optional fixed clock: ?now=2025-09-17T14:29 (used by tests and screenshots).
function parseIso(iso: string, tz: string): number | null {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/);
  if (!m) return null;
  const day = Math.floor(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86_400_000);
  return fromLocal(day, Number(m[4] ?? 0) * 60 + Number(m[5] ?? 0), tz);
}

/** The standalone app: a browser tab, or the desktop shell (which exposes `window.boniVault`). */
async function boot() {
  const params = new URLSearchParams(location.search);
  initClock(location.search, params.get("tz") ?? systemTimeZone(), parseIso);
  const root = document.getElementById("root");
  if (!root) return;
  const w = window as unknown as { boniVault?: VaultBridge; boniNet?: Pick<Host, "fetchText"> };
  await mountApp(root, {
    vault: w.boniVault ?? null,
    storage: localStorageStore,
    keys: "window",
    // The desktop shell downloads external calendars itself; a plain browser uses fetch.
    fetchText: w.boniNet?.fetchText,
  });
  const { useApp } = await import("./store.ts");
  (window as unknown as { __app: unknown }).__app = useApp;
  if (params.has("bench")) {
    const { autoBench, runBench } = await import("./bench.ts");
    (window as unknown as { __runBench: unknown }).__runBench = runBench;
    if (params.get("bench") === "auto") void autoBench();
  }
}

void boot();
