/**
 * The map stays true and the rules stay checkable (docs/principios.md, T-01 to T-03, T-06): every app, package and
 * source file says what it is for (`scripts/map.mjs` reads it), the instructions for agents stay short, the principles
 * name files that exist, every agent of `.claude/agents/` names its model and effort, and every e2e suite runs on a
 * change to the code it starts (T-07). What still lacks a description is listed in `map-pending.json`, a list that may only shrink.
 */
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
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

test("every agent names its model and effort", () => {
  const dir = join(ROOT, ".claude/agents");
  const agents = readdirSync(dir).filter((f) => f.endsWith(".md"));
  assert.ok(
    agents.length >= 2,
    "the explorer and the conformance reviewer live in .claude/agents/",
  );
  for (const f of agents) {
    const front = readFileSync(join(dir, f), "utf8").match(/^---\n([\s\S]*?)\n---\n/)?.[1] ?? "";
    assert.match(
      front,
      /^model: *\S+/m,
      `.claude/agents/${f} declares no model in its frontmatter (T-06)`,
    );
    assert.match(
      front,
      /^effort: *\S+/m,
      `.claude/agents/${f} declares no effort in its frontmatter (T-06)`,
    );
  }
});

test("every e2e suite runs on a change to the code it starts", () => {
  const ci = readFileSync(join(ROOT, ".github/workflows/ci.yml"), "utf8");
  // The calendar's filter in the `changes` job: the regex `has` is called with.
  const re = ci.match(/echo "calendar=\$\(has '([^']+)'\)"/)?.[1];
  assert.ok(re, "ci.yml's changes job has no calendar filter");
  const filter = new RegExp(re);
  const starts = readdirSync(join(ROOT, "e2e")).filter(
    (f) =>
      f.endsWith(".spec.ts") &&
      readFileSync(join(ROOT, "e2e", f), "utf8").includes("apps/server/src/main.ts"),
  );
  assert.ok(starts.length > 0, "no calendar spec starts Boni's server: update this test");
  // A spec that starts the real server runs when the server or a package it loads changes (T-07).
  for (const path of ["apps/server/src/agent.ts", "packages/store/src/store.ts"])
    assert.ok(
      filter.test(path),
      `${starts.join(", ")} start Boni's server, but a change to ${path} skips e2e-calendar (T-07)`,
    );
});
