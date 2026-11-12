import { defineConfig } from "@playwright/test";

/**
 * Boni's desktop app (apps/boni-desktop) driven for real: Electron with a temporary profile, the real server
 * started locally with an invented account and an invented vault imported as its collections. Run with
 * `make e2e-boni-desktop`: on a virtual screen, here and in CI (I-06, T-08).
 */
export default defineConfig({
  testDir: "e2e-boni-desktop",
  timeout: 120_000,
  workers: 1,
  reporter: [["list"]],
});
