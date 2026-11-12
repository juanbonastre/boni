import { defineConfig } from "@playwright/test";

/**
 * Boni Calendar's desktop app (apps/calendar-desktop) driven for real: Electron with a temporary profile and the
 * real server started locally (an invented account and vault, Boni's web app at /boni/). Run with
 * `make e2e-calendar-desktop`: on a virtual screen, here and in CI (I-06, T-08).
 */
export default defineConfig({
  testDir: "e2e-calendar-desktop",
  timeout: 120_000,
  workers: 1,
  reporter: [["list"]],
});
