/**
 * A design's numbered rules hold against the tests (docs/principios.md, T-10; task 66, measures A and B): a rule said
 * to be done has a test that runs with its id in the name, a phase said to be in main has no rule pending, and a
 * phase begun has a test, pending or not, for each of its rules. The last test here is the check itself over this
 * repo; the others try it with an invented design, whose ids start with ZZ so that they are never read as tests of
 * a real one.
 */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { check, checkRepo, DESIGNS, left, readDesign, readTests } from "./design-rules.mjs";
import { ROOT } from "./map.mjs";

const design = (rules, table) =>
  [
    "## 5. Rules",
    "",
    ...rules,
    "",
    "## 8. Phases",
    "",
    "| Fase | Qué | Criterio de hecho | Estado |",
    "|---|---|---|---|",
    ...table,
    "",
    "Text after the table.",
  ].join("\n");

const tests = (source, file = "packages/x/src/x.test.ts") =>
  readTests(source, "ZZ").map((t) => ({ ...t, file }));

const problemsOf = (rules, table, source = "") =>
  check(readDesign(design(rules, table), "ZZ", "docs/zz.md"), tests(source), "docs/zz.md");

test("a design's rules and phases are read from its Markdown", () => {
  const d = readDesign(
    design(
      [
        "- **ZZ-01** (P1, hecho) · One.",
        "  Its second line, with **ZZ-99** named in passing.",
        "- **ZZ-02** (P1, en parte) · Two: the second half is missing.",
        "- **ZZ-03** (P2, pendiente) · Three.",
        "- **ZZ-04** (P2, descartado) · Four: not needed.",
        "- **ZZ-05** (sin fase) · Five.",
      ],
      ["| **P1** The first | What | Seen | en main |", "| P2 | What | Seen | pendiente |"],
    ),
    "ZZ",
  );
  assert.deepEqual(d.problems, []);
  assert.deepEqual(
    d.rules.map((r) => [r.id, r.phase, r.state]),
    [
      ["ZZ-01", "P1", "hecho"],
      ["ZZ-02", "P1", "en parte"],
      ["ZZ-03", "P2", "pendiente"],
      ["ZZ-04", "P2", "descartado"],
      ["ZZ-05", null, null],
    ],
  );
  assert.deepEqual(
    [...d.phases],
    [
      ["P1", "en main"],
      ["P2", "pendiente"],
    ],
  );
});

test("a rule or a phase written another way is a problem, never skipped", () => {
  const table = ["| P1 | What | Seen | pendiente |"];
  const bad = (rule) => problemsOf([rule], table);
  assert.match(bad("- **ZZ-01** P1, pendiente · No brackets.")[0], /a rule is written/);
  assert.match(bad("- **ZZ-01** (P1, pendiente) No dot.")[0], /a rule is written/);
  assert.match(bad("- **ZZ-01** (P1, done) · Another word.")[0], /«\(P1, done\)»/);
  assert.match(bad("- **ZZ-01** (pendiente) · No phase.")[0], /«\(pendiente\)»/);
  assert.match(
    bad("- **ZZ-01** (P7, pendiente) · A phase the table lacks.")[0],
    /P7, which has no row/,
  );
  assert.match(
    problemsOf(
      ["- **ZZ-01** (P1, pendiente) · One.", "- **ZZ-01** (P1, pendiente) · Again."],
      table,
    )[0],
    /ZZ-01 is the id of two rules/,
  );
  assert.match(
    problemsOf(["- **ZZ-01** (P1, pendiente) · One."], ["| P1 | What | Seen | casi |"])[0],
    /P1 says «casi» in «Estado»/,
  );
  // A phase missing from the table is said once, not once per rule.
  assert.equal(
    problemsOf(["- **ZZ-01** (P7, pendiente) · One.", "- **ZZ-02** (P7, pendiente) · Two."], table)
      .length,
    1,
  );
});

test("tests are found by their title, and a todo, a skip or a fixme is pending", () => {
  const found = readTests(
    [
      'it("ZZ-01 · runs", () => {});',
      "test('with ZZ-02 and ZZ-03 in one', async () => {});",
      'it.todo("ZZ-04 · later");',
      "it.todo(",
      '  "ZZ-05 · on its own line",',
      ");",
      'test.fixme("ZZ-06 · in the browser", async ({ page }) => {});',
      "it.skip(`ZZ-07 · quarantined`, () => {});",
      'it.concurrent("ZZ-08 · runs too", () => {});',
      'it("ZZ-120 is one rule, and ZZ-08 named twice is ZZ-08 once", () => {});',
      "// ZZ-90 in a comment is not a test",
      'const title = "ZZ-91 in a string is not one either";',
      'expect("ZZ-92").toBe("ZZ-92");',
      'if (/ZZ-\\d+/.test("ZZ-93 is a regular expression\'s test")) retest("ZZ-94");',
    ].join("\n"),
    "ZZ",
  );
  assert.deepEqual(
    found.map((t) => [t.id, t.pending]),
    [
      ["ZZ-01", false],
      ["ZZ-02", false],
      ["ZZ-03", false],
      ["ZZ-04", true],
      ["ZZ-05", true],
      ["ZZ-06", true],
      ["ZZ-07", true],
      ["ZZ-08", false],
      ["ZZ-120", false],
      ["ZZ-08", false],
    ],
  );
});

test("a rule said to be done needs a test that runs with its id in the name", () => {
  const table = ["| P1 | What | Seen | en curso |"];
  const rules = ["- **ZZ-12** (P1, hecho) · Done.", "- **ZZ-13** (P1, en parte) · Half: the rest."];
  assert.deepEqual(
    problemsOf(rules, table, 'it("ZZ-12 · a", () => {}); it("ZZ-13 · b", () => {});'),
    [],
  );
  // A pending test is not enough, and neither is the test of a rule whose id only starts the same.
  const pending = problemsOf(rules, table, 'it.todo("ZZ-12 · a"); it("ZZ-13 · b", () => {});');
  assert.equal(pending.length, 1);
  assert.match(pending[0], /docs\/zz\.md:3: ZZ-12 is «hecho» and no test that runs.*\(1 pending\)/);
  const other = problemsOf(
    rules,
    table,
    'it("ZZ-120 · a", () => {}); it.skip("ZZ-13 · b", () => {});',
  );
  assert.match(other[0], /ZZ-12 is «hecho»/);
  assert.match(other.join("\n"), /ZZ-13 is «en parte» and no test that runs/);
});

test("a phase in main or done has no rule pending", () => {
  const rules = ["- **ZZ-01** (P1, hecho) · Done.", "- **ZZ-02** (P1, pendiente) · Not yet."];
  const source = 'it("ZZ-01 · a", () => {}); it.todo("ZZ-02 · b");';
  for (const state of ["en main", "hecha"]) {
    const problems = problemsOf(rules, [`| P1 | What | Seen | ${state} |`], source);
    assert.equal(problems.length, 1);
    assert.match(problems[0], new RegExp(`ZZ-02 is «pendiente» and its phase P1 is «${state}»`));
  }
  assert.deepEqual(problemsOf(rules, ["| P1 | What | Seen | en curso |"], source), []);
  // What is partly done or left out on purpose does not hold a phase back: the rule says what is missing or why.
  assert.deepEqual(
    problemsOf(
      [
        "- **ZZ-01** (P1, en parte) · Half: the rest is task 9.",
        "- **ZZ-02** (P1, descartado) · No: why.",
      ],
      ["| P1 | What | Seen | hecha |"],
      'it("ZZ-01 · a", () => {});',
    ),
    [],
  );
});

test("a phase begun has a test, pending or not, for each of its rules", () => {
  const rules = [
    "- **ZZ-01** (P1, pendiente) · One.",
    "- **ZZ-02** (P1, pendiente) · Two.",
    "- **ZZ-03** (P2, pendiente) · Of a phase not begun.",
    "- **ZZ-04** (P1, descartado) · Left out: why.",
    "- **ZZ-05** (sin fase) · Of no phase.",
  ];
  const table = ["| P1 | What | Seen | en curso |", "| P2 | What | Seen | pendiente |"];
  assert.deepEqual(problemsOf(rules, table, 'it.todo("ZZ-01 · a"); it.todo("ZZ-02 · b");'), []);
  const problems = problemsOf(rules, table, 'it.todo("ZZ-01 · a");');
  assert.equal(problems.length, 1);
  assert.match(problems[0], /ZZ-02: its phase P1 is «en curso» and no test, pending or not/);
});

test("a test that names a rule the design does not have is a problem", () => {
  const problems = problemsOf(
    ["- **ZZ-01** (P1, pendiente) · One."],
    ["| P1 | What | Seen | pendiente |"],
    'it("ZZ-10 · a typo of ZZ-01", () => {});',
  );
  assert.equal(problems.length, 1);
  assert.match(problems[0], /packages\/x\/src\/x\.test\.ts: the test «.*» names ZZ-10/);
});

test("what is left is listed phase by phase", () => {
  const d = readDesign(
    design(
      [
        "- **ZZ-01** (P1, hecho) · One.",
        "- **ZZ-02** (P1, pendiente) · Two.",
        "- **ZZ-03** (P1, pendiente) · Three.",
        "- **ZZ-04** (P2, pendiente) · Four.",
      ],
      ["| P1 | What | Seen | en curso |", "| P2 | What | Seen | pendiente |"],
    ),
    "ZZ",
  );
  const source = 'it("ZZ-01 · a", () => {}); it("ZZ-02 · b", () => {}); it.todo("ZZ-03 · c");';
  assert.deepEqual(left(d, tests(source)), [
    "P1 (en curso): 1 of 3 rules done",
    "  ZZ-02 pendiente (has a test that runs)",
    "  ZZ-03 pendiente",
    "P2 (pendiente): 0 of 1 rules done",
  ]);
});

test("the designs of this repo hold: no rule done without its test, no phase in main with a rule pending", () => {
  for (const { file } of DESIGNS) assert.ok(existsSync(join(ROOT, file)), `${file} does not exist`);
  for (const { file, design: d, tests: found, problems } of checkRepo()) {
    assert.ok(d.rules.length > 0, `${file} has no numbered rules`);
    assert.ok(d.phases.size > 0, `${file} has no phase table with a column «Estado»`);
    assert.deepEqual(problems, [], `${file} and the tests disagree`);
    // What CI lists: the rules left in every phase begun.
    console.log([`${file}: ${d.rules.length} rules`, ...left(d, found)].join("\n"));
  }
});
