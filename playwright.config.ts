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
    channel: process.env.CI ? undefined : "chrome",
    launchOptions: { args: ["--enable-gpu-rasterization", "--ignore-gpu-blocklist"] },
    colorScheme: "dark",
    locale: "es-ES",
    timezoneId: "Europe/Madrid",
  },
  webServer: {
    command: `pnpm --filter @boni-calendar/web build && pnpm --filter @boni-calendar/web exec vite preview --port ${PORT} --strictPort`,
    port: PORT,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
