import { defineConfig } from "@playwright/test";

/**
 * Boni Calendar's desktop app (apps/calendar-desktop) driven for real: Electron with a temporary profile and the
 * real server started locally (an invented account and vault, Boni's web app at /boni/). Opens windows on the
 * screen (`make e2e-calendar-desktop`); CI runs it on a virtual screen (I-06).
 */
export default defineConfig({
  testDir: "e2e-calendar-desktop",
  timeout: 120_000,
  workers: 1,
  reporter: [["list"]],
});
