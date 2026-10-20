import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// `pnpm dev` talks to a real server through the dev proxy (BONI_SERVER=https://...), since the API
// has no CORS: in the desktop app requests go through the main process instead.
const server = process.env.BONI_SERVER;

export default defineConfig({
  plugins: [react()],
  base: "./",
  server: {
    port: 5174,
    strictPort: true,
    ...(server ? { proxy: { "/api": { target: server, changeOrigin: true, secure: true } } } : {}),
  },
  build: { target: "es2022", sourcemap: true },
  test: { environment: "happy-dom", include: ["src/**/*.test.{ts,tsx}"] },
});
