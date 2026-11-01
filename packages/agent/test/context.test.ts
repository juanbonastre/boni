// A-12: what the planner gets each turn is the list in docs/preferencias.md, and nothing more.
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { fakePlanner } from "../src/providers.ts";
import { type Env, makeEnv, PERSONAL } from "./fixture.ts";

let env: Env;
afterEach(() => env?.close());

/**
 * Each thing Boni knows of Juan has one home (docs/preferencias.md §4, Juan 2026-11-01: «que no se solapen»). A new
 * source of context for the planner is a new home: this fails until the design names it, so it is never added unseen.
 */
const SOURCES = ["history", "memories", "request", "schema", "today", "tools"];

describe("what the planner sees (A-12)", () => {
  it("is exactly the sources the design lists", async () => {
    env = makeEnv();
    const planner = fakePlanner([
      {
        version: 1,
        steps: [{ id: "r", op: "reply", component: "text", data: { template: { lit: "Hola" } } }],
      },
    ]);
    await env.agent(planner).turn({ text: "Hola", origin: PERSONAL });
    const input = planner.requests[0]?.input as Record<string, unknown>;
    expect(Object.keys(input).sort()).toEqual(SOURCES);
    const doc = readFileSync(new URL("../../../docs/preferencias.md", import.meta.url), "utf8");
    for (const s of SOURCES)
      expect(doc, `docs/preferencias.md names \`${s}\``).toContain(`\`${s}\``);
  });
});
