#!/usr/bin/env node
/**
 * The repo's map, computed rather than written (docs/principios.md, T-02). With no argument: every app and package
 * with what it is for (its package.json `description`, or the first paragraph of its README.md), and the other
 * top-level folders. With a path: every file kept in git under it, with the first sentence of the comment it starts
 * with (a document's title for Markdown); with a file, its whole header. `make map` and `make map P=<path>` run it.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

/** Files git keeps under `path` (relative to the repo), sorted. */
export function trackedFiles(path = ".") {
  const out = execFileSync("git", ["ls-files", "-z", "--", path], { cwd: ROOT, encoding: "utf8" });
  return out
    .split("\0")
    .filter(Boolean)
    .filter((f) => existsSync(join(ROOT, f)))
    .sort();
}

const CODE = new Set([".ts", ".tsx", ".mjs", ".cjs", ".js", ".kt", ".kts", ".css"]);

/** The comment a file starts with (code) or its first heading (Markdown), as plain text; null when it has none. */
export function headerOf(file) {
  const text = readFileSync(join(ROOT, file), "utf8");
  if (extname(file) === ".md") {
    const h = /^#\s+(.+)$/m.exec(text);
    return h ? (h[1] ?? "").trim() : null;
  }
  if (!CODE.has(extname(file))) return null;
  const lines = text.split("\n");
  // A module's header comes before its first declaration: only imports, a package line, a shebang or
  // "use strict" may come first.
  let i = 0;
  while (i < lines.length) {
    const l = lines[i] ?? "";
    if (/^\s*$|^#!|^package\s|^\s*["']use strict["'];?\s*$/.test(l)) i++;
    else if (/^import\b/.test(l)) {
      // To the end of the statement: `from "…"`, a bare `import "…"`, or a Kotlin import.
      const end =
        /\bfrom\s+["'][^"']+["'];?\s*$|^import\s+["'][^"']+["'];?\s*$|^import\s+[\w.*]+\s*$/;
      while (i < lines.length && !end.test(lines[i] ?? "")) i++;
      i++;
    } else break;
  }
  const first = lines[i] ?? "";
  if (/^\s*\/\*/.test(first)) {
    const body = [];
    for (; i < lines.length; i++) {
      const l = lines[i] ?? "";
      body.push(l);
      if (l.includes("*/")) break;
    }
    return clean(
      body
        .join("\n")
        .replace(/^\s*\/\*+/, "")
        .replace(/\*\/[\s\S]*$/, "")
        .split("\n")
        .map((l) => l.replace(/^\s*\* ?/, ""))
        .join("\n"),
    );
  }
  if (/^\s*\/\//.test(first)) {
    const body = [];
    for (; i < lines.length && /^\s*\/\//.test(lines[i] ?? ""); i++)
      body.push((lines[i] ?? "").replace(/^\s*\/\/+ ?/, ""));
    return clean(body.join("\n"));
  }
  return null;
}

const clean = (s) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t ? t : null;
};

/** The first sentence of a text (a period followed by a space or the end), at most 200 characters. */
export function firstSentence(text) {
  const m = /^(.+?[.!?])(\s|$)/.exec(text);
  const s = m ? (m[1] ?? text) : text;
  return s.length > 200 ? `${s.slice(0, 199)}…` : s;
}

/** Every app and package: its folder, its name and what it is for. */
export function workspaces() {
  const out = [];
  for (const group of ["apps", "packages"]) {
    const dirs = [...new Set(trackedFiles(group).map((f) => f.split("/").slice(0, 2).join("/")))];
    for (const dir of dirs) {
      if (!statSync(join(ROOT, dir)).isDirectory()) continue;
      const pkg = join(ROOT, dir, "package.json");
      const readme = join(ROOT, dir, "README.md");
      let name = "";
      let description = "";
      if (existsSync(pkg)) {
        const p = JSON.parse(readFileSync(pkg, "utf8"));
        name = p.name ?? "";
        description = p.description ?? "";
      }
      if (!description && existsSync(readme)) description = readmeSummary(readme);
      out.push({ dir, name, description });
    }
  }
  return out;
}

/** A README's first paragraph after its title. */
function readmeSummary(path) {
  const paras = readFileSync(path, "utf8")
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p && !p.startsWith("#"));
  return clean(paras[0] ?? "") ?? "";
}

const isTest = (f) => /\.(test|spec)\.|test-util|\/test\/|\/e2e\//.test(f);

function overview() {
  const rows = workspaces().map((w) => [
    w.dir,
    [w.name && w.name !== w.dir.split("/")[1] ? w.name : "", w.description]
      .filter(Boolean)
      .join(" — ") || "—",
  ]);
  const others = [
    ...new Set(
      trackedFiles(".")
        .filter((f) => f.includes("/") && !/^(apps|packages)\//.test(f))
        .map((f) => f.split("/")[0]),
    ),
  ];
  for (const dir of others) {
    const readme = join(ROOT, dir, "README.md");
    const n = trackedFiles(dir).length;
    rows.push([
      `${dir}/`,
      existsSync(readme) ? readmeSummary(readme) : `${n} file${n === 1 ? "" : "s"}`,
    ]);
  }
  print(rows);
  console.log("\nmake map P=<path> lists the files under a folder, each with what it is for.");
}

function files(path) {
  const full = join(ROOT, path);
  if (existsSync(full) && statSync(full).isFile()) {
    console.log(headerOf(path) ?? "(no header comment)");
    return;
  }
  const rows = trackedFiles(path)
    .filter((f) => CODE.has(extname(f)) || extname(f) === ".md")
    .map((f) => {
      const h = headerOf(f);
      return [relative(path, f) || f, `${isTest(f) ? "(test) " : ""}${h ? firstSentence(h) : "—"}`];
    });
  if (!rows.length) console.log(`nothing kept in git under ${path}`);
  print(rows);
}

function print(rows) {
  const width = Math.min(40, Math.max(...rows.map((r) => r[0].length), 0) + 2);
  for (const [a, b] of rows) console.log(`${a.padEnd(width)}${b}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const target = process.argv[2];
  if (target) files(target.replace(/\/+$/, ""));
  else overview();
}
