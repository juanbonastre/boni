import { defineConfig } from "@playwright/test";

const PORT = 4174;

export default defineConfig({
  testDir: "e2e-boni",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1280, height: 900 },
    // The system's Google Chrome, here and in CI (GitHub's Ubuntu runners have it): installing Playwright's own
    // browser with its system packages took from 12 s to over 10 min per job (apt), most of the CI's time.
    channel: "chrome",
    colorScheme: "dark",
    locale: "es-ES",
    timezoneId: "Europe/Madrid",
  },
  webServer: {
    command: `pnpm --filter @boni/boni-web build && pnpm --filter @boni/boni-web exec vite preview --port ${PORT} --strictPort`,
    port: PORT,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
