const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

/** The packaged app must hold every module the shell loads (0.3.0 shipped without live.cjs and hung at start). */
const files = require("./package.json").build.files;
const globToRegExp = (g) =>
  new RegExp(
    `^${g
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*\*\/\*/g, ".*")
      .replace(/\*/g, "[^/]*")}$`,
  );
const included = (name) => {
  let ok = false;
  for (const f of files) {
    if (f.startsWith("!")) {
      if (globToRegExp(f.slice(1)).test(name)) ok = false;
    } else if (globToRegExp(f).test(name)) ok = true;
  }
  return ok;
};

function localRequires(file, seen = new Set()) {
  if (seen.has(file)) return seen;
  seen.add(file);
  const text = fs.readFileSync(path.join(__dirname, file), "utf8");
  for (const m of text.matchAll(/require\("\.\/([^"]+)"\)/g)) localRequires(m[1], seen);
  return seen;
}

test("every module the shell loads goes into the package, tests do not", () => {
  const needed = [...localRequires("main.cjs"), ...localRequires("preload.cjs")];
  for (const f of needed) assert.ok(included(f), `${f} is not in build.files`);
  assert.ok(included("icon.png") && included("tray.png") && included("web/index.html"));
  assert.equal(included("live.test.cjs"), false);
});
