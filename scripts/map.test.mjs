/**
 * The map stays true and the rules stay checkable (docs/principios.md, T-01 to T-03): every app, package and source file
 * says what it is for (`scripts/map.mjs` reads it), the instructions for agents stay short, and the principles name
 * files that exist. What still lacks a description is listed in `map-pending.json`, a list that may only shrink.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { headerOf, ROOT, trackedFiles, workspaces } from "./map.mjs";

const pending = JSON.parse(readFileSync(join(ROOT, "scripts/map-pending.json"), "utf8"));

/** Source files that must start with a comment saying what they are for (tests, evals and barrels need not). */
const isSource = (f) =>
  (/^(apps|packages)\/[^/]+\/src\//.test(f) || /^apps\/[^/]+\/[^/]+\.cjs$/.test(f)) &&
  /\.(ts|tsx|cjs|mjs)$/.test(f) &&
  !/\.(test|spec)\.|test-util|\/test\/|\/eval\/|\.d\.ts$/.test(f) &&
  !/^packages\/[^/]+\/src\/index\.ts$/.test(f);

test("every package and file says what it is", () => {
  const missingWorkspaces = workspaces()
    .filter((w) => !w.description)
    .map((w) => w.dir);
  const missingFiles = trackedFiles(".")
    .filter(isSource)
    .filter((f) => !headerOf(f));
  assert.deepEqual(
    missingWorkspaces.filter((d) => !pending.workspaces.includes(d)),
    [],
    "give these a description in their package.json (or a README.md)",
  );
  assert.deepEqual(
    missingFiles.filter((f) => !pending.files.includes(f)),
    [],
    "start these files with a comment saying what they are for",
  );
  // The pending list only shrinks: what has its description now leaves it.
  assert.deepEqual(
    [
      ...pending.workspaces.filter((d) => !missingWorkspaces.includes(d)),
      ...pending.files.filter((f) => !missingFiles.includes(f)),
    ],
    [],
    "these say what they are now: take them out of scripts/map-pending.json",
  );
});

test("AGENTS.md stays short", () => {
  for (const f of ["AGENTS.md", "docs/agents/calendar.md"]) {
    const lines = readFileSync(join(ROOT, f), "utf8").split("\n").length;
    assert.ok(
      lines <= 150,
      `${f} has ${lines} lines: at most 150 (T-01); the rest goes where it is used`,
    );
  }
  assert.doesNotMatch(
    readFileSync(join(ROOT, "AGENTS.md"), "utf8"),
    /^## Layout/m,
    "no inventory in AGENTS.md: `make map` computes it (T-02)",
  );
});

test("principles name files that exist", () => {
  const text = readFileSync(join(ROOT, "docs/principios.md"), "utf8");
  const named = [
    ...text.matchAll(/`((?:apps|packages|e2e[\w-]*|scripts|docs|bench)\/[^`\s]+)`/g),
  ].map((m) => (m[1] ?? "").replace(/[:#].*$/, ""));
  assert.ok(named.length > 20, "the principles name their tests");
  assert.deepEqual(
    named.filter((p) => !existsSync(join(ROOT, p))),
    [],
    "docs/principios.md names files that do not exist",
  );
});
