import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { coreTools, EFFECTS } from "@boni/agent";
import { describe, expect, it } from "vitest";

/**
 * A-18 (docs/principios.md; Juan, 2026-11-05, task 64, measure E): every tool a model can call has its scenario, a test
 * that runs it for real through the agent and checks what reaches Juan or whoever reads it afterwards (the planner,
 * the scheduler, a device). A tool without one does not go in: `jobs.create` saved jobs that nothing ever ran, and no
 * test noticed (audit of 2026-11-05, task 63). Here each tool names its scenarios by file and exact title; adding a
 * tool means writing its scenario, and the review of that scenario is where «who runs this?» gets asked.
 */
const ROOT = join(import.meta.dirname, "..", "..", "..");
const AGENT = "packages/agent/test/agent.test.ts";

const SCENARIOS: Record<string, { file: string; test: string }[]> = {
  "entities.query": [
    {
      file: AGENT,
      test: "reads several mails in one call: a line per mail, and the counts by kind are the code's",
    },
  ],
  "entities.get": [
    {
      file: AGENT,
      test: "every task of every mail in one loop, a mail with none included (the plan the real planner wrote)",
    },
  ],
  "entities.aggregate": [
    { file: AGENT, test: "answers about data with numbers the code computed" },
  ],
  "entities.search": [
    {
      file: AGENT,
      test: "every task of every mail in one loop, a mail with none included (the plan the real planner wrote)",
    },
  ],
  "schema.describe": [
    {
      file: AGENT,
      test: "says what collections Juan has and their fields, from the schema (schema.describe)",
    },
  ],
  "entities.create": [
    { file: AGENT, test: "creates what Juan asks for, quoting him, and undoes the whole run" },
  ],
  "entities.update": [
    {
      file: AGENT,
      test: "changes a record at Juan's request, in his words, and Undo puts it back as it was",
    },
  ],
  "entities.delete": [
    { file: AGENT, test: "asks Juan to confirm a deletion, bound to those values, once" },
  ],
  "schema.create_type": [{ file: AGENT, test: "changes the schema at Juan's request and says so" }],
  "schema.add_field": [{ file: AGENT, test: "changes the schema at Juan's request and says so" }],
  "memory.save": [
    {
      file: AGENT,
      test: "a memory in Juan's own words reaches the planner in the turns after (A11)",
    },
    {
      file: AGENT,
      test: "tells Juan about a memory a model wrote, and keeps it out of the planner until he confirms (A11)",
    },
  ],
  "flows.run": [
    {
      file: AGENT,
      test: "asks to confirm it, by its name; once confirmed it runs as a run of its own and its answers come in the turn",
    },
  ],
  "flows.save": [
    {
      file: AGENT,
      test: "only waits in the inbox; accepting it saves it as the user's and turns it on",
    },
    // Who runs what it saved: the scheduler, once per slot.
    {
      file: "apps/server/src/flowScheduler.test.ts",
      test: "is due once: not for a time before the version was saved, nor again after it ran, nor long after",
    },
  ],
  notify: [
    {
      file: "apps/server/src/agent.test.ts",
      test: "tells the account's devices what the agent notifies",
    },
    {
      file: "apps/server/src/reminders.test.ts",
      test: "a scheduled flow's «Avisar» reaches the phone with Boni closed, sealed for it alone; the calendar's address only hears «reminders»",
    },
  ],
};
/**
 * Effects no tool of the registry has yet, with their policy ready (docs/nucleo.md §7.5): a write with no Undo
 * (deleting goes to the trash), and a tool that fetches or sends, registered only on purpose.
 */
const NO_TOOL_YET = ["write_irreversible", "egress", "send"];

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

describe("every tool a model can call has its scenario (A-18)", () => {
  const tools = coreTools()
    .all()
    .map((t) => t.name)
    .sort();

  it("each tool of the registry names its scenarios, and nothing else is named", () => {
    expect(Object.keys(SCENARIOS).sort()).toEqual(tools);
  });

  it("each scenario is a test that exists, by its exact title", () => {
    const missing: string[] = [];
    for (const [tool, list] of Object.entries(SCENARIOS)) {
      expect(list.length, tool).toBeGreaterThan(0);
      for (const s of list) {
        const path = join(ROOT, s.file);
        const text = existsSync(path) ? readFileSync(path, "utf8") : "";
        if (!new RegExp(`\\b(?:it|test)\\(\\s*"${escapeRe(s.test)}"`).test(text))
          missing.push(`${tool}: ${s.file} «${s.test}»`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("every effect has a tool that runs it, or is one no tool has yet", () => {
    const used = new Set(
      coreTools()
        .all()
        .map((t) => t.effect as string),
    );
    expect(EFFECTS.filter((e) => !used.has(e))).toEqual(NO_TOOL_YET);
  });
});
