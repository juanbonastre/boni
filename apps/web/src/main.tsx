import { fromLocal, systemTimeZone } from "@boni-calendar/core";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { initClock } from "./clock.ts";
import "./styles.css";

// Optional fixed clock: ?now=2025-09-17T14:29 (used by tests and screenshots).
function parseIso(iso: string, tz: string): number | null {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/);
  if (!m) return null;
  const day = Math.floor(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86_400_000);
  return fromLocal(day, Number(m[4] ?? 0) * 60 + Number(m[5] ?? 0), tz);
}

async function boot() {
  const params = new URLSearchParams(location.search);
  initClock(location.search, params.get("tz") ?? systemTimeZone(), parseIso);
  // The store reads the clock when it is created, so load the app only after the clock is set.
  const [{ App }, { ViewportProvider }, { useApp }] = await Promise.all([
    import("./App.tsx"),
    import("./ViewportContext.tsx"),
    import("./store.ts"),
  ]);
  const root = document.getElementById("root");
  if (!root) return;
  createRoot(root).render(
    <StrictMode>
      <ViewportProvider>
        <App />
      </ViewportProvider>
    </StrictMode>,
  );
  (window as unknown as { __app: unknown }).__app = useApp;
  if (useApp.getState().source === "vault") void useApp.getState().loadVault();
  if (params.has("bench")) {
    const { autoBench, runBench } = await import("./bench.ts");
    (window as unknown as { __runBench: unknown }).__runBench = runBench;
    if (params.get("bench") === "auto") void autoBench();
  }
}

void boot();
