import { defineConfig } from "@playwright/test";

/**
 * The plugin in the Obsidian installed on this machine (`make e2e-obsidian`, `make bench-obsidian`):
 * each run starts Obsidian on a temporary profile and an invented vault (e2e-obsidian/obsidian.ts).
 * Not run in CI (it needs Obsidian and a display).
 */
export default defineConfig({
  testDir: "e2e-obsidian",
  timeout: 240_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
});
