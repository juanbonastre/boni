// Copies the built web UI next to the shell so electron-builder can package it.
import { cpSync, existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "..", "..", "boni-web", "dist");
const dst = join(here, "..", "web");
if (!existsSync(join(src, "index.html"))) throw new Error("Build the web UI first: pnpm build");
rmSync(dst, { recursive: true, force: true });
cpSync(src, dst, { recursive: true });
