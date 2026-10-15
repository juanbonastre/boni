import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  base: "./",
  server: { port: 5173, strictPort: true },
  build: { target: "es2022", sourcemap: true },
  test: { environment: "happy-dom", include: ["src/**/*.test.{ts,tsx}"] },
});
