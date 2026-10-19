// Builds the plugin into dist/ (main.js + manifest.json), the two files Obsidian loads from
// .obsidian/plugins/boni-calendar/. The calendar's stylesheet is scoped like the web build does
// (scopeCss) and inlined: the view puts it in its shadow root, so there is no styles.css (Obsidian
// would add that one to its own page).
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";
import postcss from "postcss";

const here = dirname(fileURLToPath(import.meta.url));
const web = join(here, "..", "calendar-web");
const { scopeCss } = await import(join(web, "scopeCss.ts"));

const cssFile = join(web, "src", "styles.css");
const css = (await postcss([scopeCss()]).process(readFileSync(cssFile, "utf8"), { from: cssFile }))
  .css;

const out = join(here, "dist");
mkdirSync(out, { recursive: true });
await esbuild.build({
  entryPoints: [join(here, "src", "main.ts")],
  outfile: join(out, "main.js"),
  bundle: true,
  format: "cjs",
  platform: "browser",
  target: "es2022",
  jsx: "automatic",
  minify: true,
  legalComments: "none",
  // Provided by Obsidian at run time.
  external: ["obsidian", "electron", "@codemirror/*", "@lezer/*"],
  define: {
    __BONI_CSS__: JSON.stringify(css),
    "process.env.NODE_ENV": '"production"',
  },
  logLevel: "warning",
});
copyFileSync(join(here, "manifest.json"), join(out, "manifest.json"));
console.log(`built ${join(out, "main.js")}`);
