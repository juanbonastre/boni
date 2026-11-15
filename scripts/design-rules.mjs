#!/usr/bin/env node
/**
 * A design's numbered rules against the tests (docs/principios.md, T-10; task 66). A design listed in `DESIGNS`
 * writes each rule as `- **AU-12** (F14a, pendiente) · text`, and its phase table has a column «Estado». This reads
 * both and the titles of the repo's tests, and says what does not hold: a rule said to be done with no test that
 * names it, a phase said to be in main with a rule still pending, a phase begun with a rule no test names yet.
 * Run by `scripts/design-rules.test.mjs` inside `make check`; by hand (`make rules`) it also lists what is left.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ROOT, trackedFiles } from "./map.mjs";

/** The designs checked. Another joins with one line: its file and the prefix of its rules' ids. */
export const DESIGNS = [{ file: "docs/automatizaciones.md", prefix: "AU" }];

/**
 * A rule's state. `hecho` and `en parte` (what is missing is written in the rule) need a test that runs;
 * `descartado` says why in the rule and needs none.
 */
export const RULE_STATES = ["pendiente", "en parte", "hecho", "descartado"];
/** A rule that belongs to no phase: written down, not planned. */
export const NO_PHASE = "sin fase";
/**
 * A phase's state, in the column «Estado» of the design's phase table. `en curso`: its first PR is in, with one
 * pending test per rule (task 66, measure B). `en main`: merged with CI green. `hecha`: Juan tried it.
 */
export const PHASE_STATES = ["pendiente", "en curso", "en main", "hecha"];

/** Files whose tests count: what the runners of CI run (vitest, node --test, Playwright). */
const TEST_FILE = /\.(test|spec)\.(ts|tsx|mts|mjs|js|cjs)$/;
/** A test that does not run yet: `it.todo`, `it.skip`, Playwright's `test.fixme`. */
const PENDING = new Set(["todo", "skip", "fixme"]);

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const idsIn = (text, prefix) =>
  text.match(new RegExp(`\\b${escapeRegExp(prefix)}-\\d+\\b`, "g")) ?? [];

/**
 * A design's rules and phases, read from its Markdown.
 * Gives `{ rules: [{ id, phase, state, line }], phases: Map<phase, state>, problems: string[] }`; `phase` and
 * `state` are null for a rule «sin fase».
 */
export function readDesign(text, prefix, file = "the design") {
  const rules = [];
  const phases = new Map();
  const problems = [];
  const start = new RegExp(`^- \\*\\*${escapeRegExp(prefix)}-`);
  const whole = new RegExp(`^- \\*\\*(${escapeRegExp(prefix)}-\\d+)\\*\\* \\(([^)]*)\\) · \\S`);
  const lines = text.split("\n");
  let stateColumn = -1;
  lines.forEach((raw, i) => {
    const at = `${file}:${i + 1}`;
    if (start.test(raw)) {
      const m = whole.exec(raw);
      if (!m) {
        problems.push(`${at}: a rule is written «- **${prefix}-12** (phase, state) · text»`);
        return;
      }
      const [, id, tag] = m;
      if (rules.some((r) => r.id === id)) problems.push(`${at}: ${id} is the id of two rules`);
      if (tag === NO_PHASE) {
        rules.push({ id, phase: null, state: null, line: i + 1 });
        return;
      }
      const comma = tag.indexOf(", ");
      const phase = comma < 0 ? "" : tag.slice(0, comma);
      const state = comma < 0 ? "" : tag.slice(comma + 2);
      if (!phase || !RULE_STATES.includes(state)) {
        problems.push(
          `${at}: ${id} says «(${tag})»: «(phase, state)» with one of ${RULE_STATES.join(", ")}, or «(${NO_PHASE})»`,
        );
        return;
      }
      rules.push({ id, phase, state, line: i + 1 });
      return;
    }
    // The phase table: the one whose header starts with «Fase» and has a column «Estado».
    if (!raw.startsWith("|")) {
      stateColumn = -1;
      return;
    }
    const cells = raw
      .slice(1, raw.endsWith("|") ? -1 : undefined)
      .split("|")
      .map((c) => c.trim());
    if (cells[0] === "Fase") {
      stateColumn = cells.indexOf("Estado");
      return;
    }
    if (stateColumn < 0 || /^:?-+:?$/.test(cells[0])) return;
    const phase = cells[0].replaceAll("*", "").split(" ")[0];
    const state = cells[stateColumn] ?? "";
    if (phases.has(phase)) problems.push(`${at}: the phase ${phase} has two rows`);
    if (!PHASE_STATES.includes(state))
      problems.push(
        `${at}: the phase ${phase} says «${state}» in «Estado»: one of ${PHASE_STATES.join(", ")}`,
      );
    // A state that cannot be read is kept as it is, so the phase is not also reported as missing.
    phases.set(phase, state);
  });
  const missing = new Set();
  for (const r of rules) {
    if (!r.phase || phases.has(r.phase) || missing.has(r.phase)) continue;
    missing.add(r.phase);
    problems.push(
      `${file}:${r.line}: ${r.id} is of the phase ${r.phase}, which has no row with its «Estado» in the phase table`,
    );
  }
  return { rules, phases, problems };
}

/**
 * The tests of a file that name a rule in their title: `[{ id, title, pending }]`. A test is a call of `it` or
 * `test` with its title as a literal first argument; `pending` when it is `.todo`, `.skip` or `.fixme`.
 */
export function readTests(source, prefix) {
  const found = [];
  const call = /(?<![.\w$])(?:it|test)((?:\.\w+)*)\s*\(\s*(["'`])((?:\\.|(?!\2)[^\\])*)\2/g;
  for (const m of source.matchAll(call)) {
    const pending = m[1].split(".").some((word) => PENDING.has(word));
    for (const id of new Set(idsIn(m[3], prefix))) found.push({ id, title: m[3], pending });
  }
  return found;
}

/**
 * What does not hold between a design and the tests (`[{ id, file, title, pending }]`): a list of sentences, empty
 * when all is well.
 */
export function check(design, tests, file = "the design") {
  const problems = [...design.problems];
  const byId = new Map();
  for (const t of tests) byId.set(t.id, [...(byId.get(t.id) ?? []), t]);
  for (const r of design.rules) {
    const own = byId.get(r.id) ?? [];
    const at = `${file}:${r.line}: ${r.id}`;
    if ((r.state === "hecho" || r.state === "en parte") && !own.some((t) => !t.pending))
      problems.push(
        `${at} is «${r.state}» and no test that runs has ${r.id} in its name${own.length ? ` (${own.length} pending)` : ""}`,
      );
    const phase = r.phase ? design.phases.get(r.phase) : undefined;
    if (!phase || !PHASE_STATES.includes(phase)) continue;
    if ((phase === "en main" || phase === "hecha") && r.state === "pendiente")
      problems.push(`${at} is «pendiente» and its phase ${r.phase} is «${phase}»`);
    if (phase !== "pendiente" && r.state !== "descartado" && own.length === 0)
      problems.push(
        `${at}: its phase ${r.phase} is «${phase}» and no test, pending or not, has ${r.id} in its name`,
      );
  }
  const known = new Set(design.rules.map((r) => r.id));
  for (const t of tests)
    if (!known.has(t.id))
      problems.push(`${t.file}: the test «${t.title}» names ${t.id}, which ${file} does not have`);
  return problems;
}

/** What is left of a design, phase by phase: lines to print. */
export function left(design, tests) {
  const running = new Set(tests.filter((t) => !t.pending).map((t) => t.id));
  const lines = [];
  for (const [phase, state] of design.phases) {
    const rules = design.rules.filter((r) => r.phase === phase);
    if (rules.length === 0) continue;
    const open = rules.filter((r) => r.state === "pendiente" || r.state === "en parte");
    lines.push(`${phase} (${state}): ${rules.length - open.length} of ${rules.length} rules done`);
    if (state === "pendiente") continue;
    for (const r of open)
      lines.push(`  ${r.id} ${r.state}${running.has(r.id) ? " (has a test that runs)" : ""}`);
  }
  return lines;
}

/** Every test of the repo that names a rule of a design. */
export function repoTests(prefix) {
  const mark = `${prefix}-`;
  return trackedFiles(".")
    .filter((f) => TEST_FILE.test(f))
    .flatMap((f) => {
      const source = readFileSync(join(ROOT, f), "utf8");
      return source.includes(mark) ? readTests(source, prefix).map((t) => ({ ...t, file: f })) : [];
    });
}

/** The check over the repo: `[{ file, design, tests, problems }]`, one per design. */
export function checkRepo() {
  return DESIGNS.map(({ file, prefix }) => {
    const design = readDesign(readFileSync(join(ROOT, file), "utf8"), prefix, file);
    const tests = repoTests(prefix);
    return { file, design, tests, problems: check(design, tests, file) };
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let failed = false;
  for (const { file, design, tests, problems } of checkRepo()) {
    console.log(`${file}: ${design.rules.length} rules`);
    for (const line of left(design, tests)) console.log(`  ${line}`);
    for (const p of problems) console.error(p);
    failed ||= problems.length > 0;
  }
  process.exit(failed ? 1 : 0);
}
