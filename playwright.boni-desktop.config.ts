import { defineConfig } from "@playwright/test";

/**
 * Boni's desktop app (apps/boni-desktop) driven for real: Electron with a temporary profile, the real server
 * started locally with an invented account and an invented vault imported as its collections. Opens a window
 * on the screen, so it runs by hand (`make e2e-boni-desktop`), not in CI.
 */
export default defineConfig({
  testDir: "e2e-boni-desktop",
  timeout: 120_000,
  workers: 1,
  reporter: [["list"]],
});
