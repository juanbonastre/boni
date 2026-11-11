import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ACTION_MCP,
  FLOW_ONLY_AREAS,
  JUAN_ONLY,
  NO_CONTROL_YET,
  NOT_ACTIONS,
  NOT_YET,
  ROUTE_ACTIONS,
  serverRegistry,
  UNDO_ROUTES,
} from "./actions.ts";
import { mcpToolNames } from "./mcp.ts";
import { ROUTES } from "./routes.ts";

/**
 * D-41 (docs/principios.md), extended by F10 (docs/sistema.md §4.1): one list of actions for the app, the planner,
 * the flows and the MCP. A route that changes something runs its action or says why it is none; an action has its
 * control in the app (or its «Buscar» entry) and its tool in the MCP, or says why not. What is not on an action yet
 * is in a list that may only shrink.
 */
// Lower these when a route or an action gets its own; never raise them.
const NOT_YET_AT_MOST = 60;
const NO_CONTROL_AT_MOST = 14;

const WEB = join(import.meta.dirname, "..", "..", "boni-web", "src");
const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? sources(join(dir, e.name))
      : /\.tsx?$/.test(e.name) && !/\.test\./.test(e.name)
        ? [readFileSync(join(dir, e.name), "utf8")]
        : [],
  );
const registry = serverRegistry();
const names = new Set(registry.names());

describe("one list of actions (D-41, F10)", () => {
  it("every route that changes something runs its action, is its Undo, is Juan's only, or says why it is none", () => {
    const changing = Object.keys(ROUTES).filter((r) => !/^(GET|HEAD) /.test(r));
    const lists = [
      Object.keys(ROUTE_ACTIONS),
      Object.keys(UNDO_ROUTES),
      Object.keys(JUAN_ONLY),
      Object.keys(NOT_ACTIONS),
      NOT_YET,
    ];
    const said = lists.flat();
    // Each once, and only routes there are.
    expect(said.length).toBe(new Set(said).size);
    expect(said.filter((r) => !(r in ROUTES))).toEqual([]);
    expect(changing.filter((r) => !said.includes(r))).toEqual([]);
    // What is not yet an action may only shrink.
    expect(NOT_YET.length).toBeLessThanOrEqual(NOT_YET_AT_MOST);
    // A route on its action names actions there are.
    const named = [...Object.values(ROUTE_ACTIONS), ...Object.values(UNDO_ROUTES)].flat();
    expect(named.filter((a) => !names.has(a))).toEqual([]);
    for (const why of [...Object.values(JUAN_ONLY), ...Object.values(NOT_ACTIONS)])
      expect(why.length).toBeGreaterThan(5);
  });

  it("every action has its tool in the MCP or says why not; Juan's touch never has one", () => {
    const tools = new Set(mcpToolNames());
    const missing: string[] = [];
    for (const t of registry.all()) {
      if (FLOW_ONLY_AREAS.includes(t.area)) continue;
      const m = ACTION_MCP[t.name];
      if (m === undefined) missing.push(`${t.name}: nothing`);
      else if (typeof m === "string" && !tools.has(m)) missing.push(`${t.name}: no tool ${m}`);
      else if (typeof m === "string" && t.effect === "touch")
        missing.push(`${t.name}: his touch, by an assistant`);
    }
    expect(missing).toEqual([]);
    expect(Object.keys(ACTION_MCP).filter((a) => !names.has(a))).toEqual([]);
  });

  it("every action has its control in the app, or its «Buscar» entry, the same name both ways", () => {
    const text = sources(WEB).join("\n");
    const controlled = new Set(
      [...text.matchAll(/(?:data-boni-action|boniAction)=\{?"([a-z_.]+)"/g)].map((m) => m[1]),
    );
    const find = readFileSync(join(WEB, "components", "QuickFind.tsx"), "utf8");
    for (const m of find.matchAll(/\{ name: "([a-z_.]+)", icon:/g)) controlled.add(m[1]);
    // What the app names is an action there is.
    expect([...controlled].filter((a) => a && !names.has(a))).toEqual([]);
    const lacking = registry
      .all()
      .filter((t) => !FLOW_ONLY_AREAS.includes(t.area) && !controlled.has(t.name))
      .map((t) => t.name)
      .sort();
    expect(lacking).toEqual([...NO_CONTROL_YET].sort());
    expect(NO_CONTROL_YET.length).toBeLessThanOrEqual(NO_CONTROL_AT_MOST);
    // Each «Buscar» action has its words, in Spanish and in English.
    const words = readFileSync(join(WEB, "i18n.ts"), "utf8");
    for (const m of find.matchAll(/\{ name: "([a-z_.]+)", icon:/g))
      expect((words.match(new RegExp(`"find\\.action\\.${m[1]}":`, "g")) ?? []).length).toBe(2);
  });

  it("an action that works on a page or a card of the Bandeja is in its area, and Juan's touch only in his", () => {
    // (Boni's own pieces of a flow keep their area, whatever their name.)
    for (const t of registry.all().filter((x) => x.effect !== "piece")) {
      if (t.name.startsWith("pages.")) expect(t.area, t.name).toBe("pages");
      if (t.name.startsWith("inbox.")) expect(t.area, t.name).toBe("inbox");
    }
    expect(
      registry
        .all()
        .filter((t) => t.effect === "touch")
        .map((t) => t.name)
        .sort(),
    ).toEqual(["inbox.accept", "inbox.reject"]);
  });
});
