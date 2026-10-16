import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { scopeCss } from "./scopeCss.ts";

export default defineConfig({
  plugins: [react()],
  base: "./",
  css: { postcss: { plugins: [scopeCss()] } },
  server: { port: 5173, strictPort: true },
  build: {
    target: "es2022",
    sourcemap: true,
    // The e2e tests also need the page that mounts the app inside another app (embed.html).
    ...(process.env.BONI_TEST_PAGES
      ? {
          rolldownOptions: {
            input: {
              main: fileURLToPath(new URL("index.html", import.meta.url)),
              embed: fileURLToPath(new URL("embed.html", import.meta.url)),
            },
          },
        }
      : {}),
  },
  test: { environment: "happy-dom", include: ["src/**/*.test.{ts,tsx}"] },
});
