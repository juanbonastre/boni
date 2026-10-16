// Copies the built plugin (dist/main.js + manifest.json) into a vault:
//   node install.mjs /path/to/vault        (or: make install-obsidian VAULT=/path/to/vault)
// Then turn it on in Obsidian: Settings → Community plugins → Boni Calendar. Running it again
// updates the plugin (reload Obsidian, or turn the plugin off and on).
import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const vault = process.argv[2];
if (!vault) {
  console.error("Usage: node install.mjs /path/to/vault");
  process.exit(1);
}
const root = resolve(vault);
if (!existsSync(join(root, ".obsidian")) || !statSync(join(root, ".obsidian")).isDirectory()) {
  console.error(`Not an Obsidian vault (no .obsidian folder): ${root}`);
  process.exit(1);
}
const dist = join(dirname(fileURLToPath(import.meta.url)), "dist");
if (!existsSync(join(dist, "main.js"))) {
  console.error("Build the plugin first: make plugin");
  process.exit(1);
}
const target = join(root, ".obsidian", "plugins", "boni-calendar");
mkdirSync(target, { recursive: true });
for (const f of ["main.js", "manifest.json"]) copyFileSync(join(dist, f), join(target, f));
console.log(`Installed in ${target}`);
console.log(
  "Obsidian: Settings → Community plugins → turn on Boni Calendar (reload Obsidian if it was on).",
);
