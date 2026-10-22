import { defineConfig } from "@playwright/test";

/**
 * Boni Calendar's desktop app (apps/calendar-desktop) driven for real: Electron with a temporary profile and the
 * real server started locally (an invented account and vault, Boni's web app at /boni/). Opens windows on the
 * screen, so it runs by hand (`make e2e-calendar-desktop`), not in CI.
 */
export default defineConfig({
  testDir: "e2e-calendar-desktop",
  timeout: 120_000,
  workers: 1,
  reporter: [["list"]],
});
