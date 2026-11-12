import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ToolRegistry, UNDO_WAYS } from "@boni/agent";
import { describe, expect, it } from "vitest";
import {
  ACTION_MCP,
  ACTIONS,
  flowOnly,
  JUAN_ONLY,
  NOT_ACTIONS,
  ROUTE_ACTIONS,
  routeDecision,
  serverRegistry,
  UNDO_ROUTES,
  undoWays,
} from "./actions.ts";
import { mcpDecision, mcpToolNames, mcpTools } from "./mcp.ts";
import { ROUTES } from "./routes.ts";

/**
 * D-41 (docs/principios.md), extended by F10 (docs/sistema.md §4.1): one list of actions for the app, the planner,
 * the flows and the MCP. A route that changes something runs its action or says why it is none; an action has its
 * control in the app (or its «Buscar» entry) and its tool in the MCP, or says why not. Nothing waits for its action
 * any more (task 86, F10): a new route or a new action that does not say which is which does not merge.
 */
const WEB = join(import.meta.dirname, "..", "..", "boni-web", "src");
/** Boni Calendar's controls: its calendars' actions are there. */
const CALENDAR_WEB = join(import.meta.dirname, "..", "..", "calendar-web", "src");
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
    ];
    const said = lists.flat();
    // Each once, and only routes there are.
    expect(said.length).toBe(new Set(said).size);
    expect(said.filter((r) => !(r in ROUTES))).toEqual([]);
    expect(changing.filter((r) => !said.includes(r))).toEqual([]);
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
      if (flowOnly(t)) continue;
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
    const text = [...sources(WEB), ...sources(CALENDAR_WEB)].join("\n");
    const controlled = new Set(
      [...text.matchAll(/(?:data-boni-action|boniAction)=\{?"([a-z_.]+)"/g)].map((m) => m[1]),
    );
    const find = readFileSync(join(WEB, "components", "QuickFind.tsx"), "utf8");
    for (const m of find.matchAll(/\{ name: "([a-z_.]+)", icon:/g)) controlled.add(m[1]);
    // What the app names is an action there is.
    expect([...controlled].filter((a) => a && !names.has(a))).toEqual([]);
    const lacking = registry
      .all()
      .filter((t) => !flowOnly(t) && !controlled.has(t.name))
      .map((t) => t.name);
    expect(lacking).toEqual([]);
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
      if (t.name.startsWith("calendars.")) expect(t.area, t.name).toBe("calendars");
      if (t.name.startsWith("connectors.")) expect(t.area, t.name).toBe("connectors");
    }
    expect(
      registry
        .all()
        .filter((t) => t.effect === "touch")
        .map((t) => t.name)
        .sort(),
    ).toEqual([
      "connectors.mail",
      "connectors.mail_guide",
      "connectors.mail_suggestion",
      "extensions.enable",
      "flows.enable",
      "inbox.accept",
      "inbox.correct",
      "inbox.reject",
    ]);
  });
});

/**
 * A-26 (docs/principios.md, docs/sistema.md §4.1): every route that changes something and every MCP tool reach their
 * registered action through the policy engine's `decide`; how each action is undone and its icon are in its own
 * definition, never in a table kept apart.
 */
describe("the actions inside: routes and tools through the policy, Undo and icon in each action (A-26)", () => {
  /** The list without any action: what reaches an action through the policy is refused (P0, unregistered). */
  const none = new ToolRegistry().freeze();
  const juan = { trust: "personal" as const, device: "laptop-ejemplo" };

  it("every route that runs an action is decided by the policy first: with the list, none is refused; without, all", () => {
    const routes = Object.entries(ROUTE_ACTIONS);
    expect(routes.filter(([route]) => routeDecision(route, juan) !== null)).toEqual([]);
    const refused = routes
      .filter(([, names]) => names.length)
      .filter(([route]) => routeDecision(route, juan, none)?.rule !== "P0");
    expect(refused).toEqual([]);
  });

  it("every MCP tool is its registered actions or says why it is none; the list agrees with it, and the policy allows each", () => {
    const tools = mcpTools();
    expect(tools.map((t) => t.name)).toEqual(mcpToolNames());
    for (const t of tools) {
      // One or the other, never both or neither.
      expect(!!t.actions?.length !== !!t.notAction, t.name).toBe(true);
      expect((t.notAction ?? "why it is none").length, t.name).toBeGreaterThan(10);
      for (const a of t.actions ?? []) expect(ACTIONS.get(a), `${t.name}: ${a}`).not.toBeNull();
    }
    // An action the list gives a tool is one of that tool's actions.
    for (const [action, tool] of Object.entries(ACTION_MCP))
      if (typeof tool === "string")
        expect(tools.find((t) => t.name === tool)?.actions, `${action} → ${tool}`).toContain(
          action,
        );
    // Today every tool is allowed (P24), with the whole list; without it, every tool with actions is refused.
    expect(tools.filter((t) => mcpDecision(t, "laptop-ejemplo") !== null)).toEqual([]);
    const refused = tools
      .filter((t) => t.actions?.length)
      .filter((t) => mcpDecision(t, "laptop-ejemplo", {}, () => null)?.rule !== "P0");
    expect(refused).toEqual([]);
    // Only proposing a flow is a proposal (P19); nothing else may run on one.
    expect(tools.filter((t) => t.proposes).map((t) => t.name)).toEqual(["flows_propose"]);
  });

  it("every action that changes something says how it is undone, and every Undo route is computed from them", () => {
    const silent: string[] = [];
    for (const t of ACTIONS.all()) {
      // (Juan's screen's acts change only what his app shows: nothing of his to take back.)
      if (t.effect === "read" || t.effect === "screen" || flowOnly(t)) continue;
      if (t.undo === undefined) silent.push(t.name);
      else if (!Array.isArray(t.undo) && (t.undo as { none: string }).none.length < 10)
        silent.push(`${t.name}: no why`);
    }
    expect(silent).toEqual([]);
    for (const t of ACTIONS.all())
      for (const w of undoWays(t)) expect(UNDO_WAYS, t.name).toContain(w);
    // Each way an action names has its route, and an action's route lists it.
    const routed = new Set(Object.values(UNDO_ROUTES).flat());
    const unrouted = ACTIONS.all()
      .filter((t) => undoWays(t).length && !routed.has(t.name))
      .map((t) => t.name);
    expect(unrouted).toEqual([]);
    expect(UNDO_ROUTES["POST /api/agent/runs/:id/undo"]).toContain("entities.update");
    expect(UNDO_ROUTES["POST /api/data/rows/:id/restore"]).toContain("entities.delete");
    expect(UNDO_ROUTES["POST /api/pages/:id/restore"]).toEqual(["pages.delete"]);
  });

  it("every action has its icon, one lucide-react has, and «Buscar» shows the one its definition says", () => {
    const dts = readFileSync(
      join(WEB, "..", "node_modules", "lucide-react", "dist", "lucide-react.d.ts"),
      "utf8",
    );
    const exported = new Set(
      [...dts.matchAll(/^export \{([^}]*)\}/gm)].flatMap((m) =>
        (m[1] as string).split(",").map(
          (x) =>
            x
              .trim()
              .split(/\s+as\s+/)
              .pop() as string,
        ),
      ),
    );
    expect(exported.has("Trash")).toBe(true);
    const wrong = ACTIONS.all()
      .filter((t) => !t.icon || !exported.has(t.icon))
      .map((t) => `${t.name}: ${t.icon ?? "none"}`);
    expect(wrong).toEqual([]);
    const find = readFileSync(join(WEB, "components", "QuickFind.tsx"), "utf8");
    const shown = [...find.matchAll(/\{ name: "([a-z_.]+)", icon: ([A-Za-z0-9]+)/g)];
    expect(shown.length).toBeGreaterThan(3);
    for (const [, name, icon] of shown) expect(ACTIONS.get(name as string)?.icon, name).toBe(icon);
  });
});
