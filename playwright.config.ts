import { defineConfig } from "@playwright/test";

const PORT = 4173;

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1920, height: 1080 },
    // The system's Google Chrome, here and in CI (GitHub's Ubuntu runners have it): installing Playwright's own
    // browser with its system packages took from 12 s to over 10 min per job (apt), most of the CI's time.
    channel: "chrome",
    launchOptions: { args: ["--enable-gpu-rasterization", "--ignore-gpu-blocklist"] },
    colorScheme: "dark",
    locale: "es-ES",
    timezoneId: "Europe/Madrid",
  },
  webServer: {
    command: `BONI_TEST_PAGES=1 pnpm --filter @boni/calendar-web build && pnpm --filter @boni/calendar-web exec vite preview --port ${PORT} --strictPort`,
    port: PORT,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
