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
    channel: process.env.CI ? undefined : "chrome",
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
