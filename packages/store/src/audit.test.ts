import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { label, type TypeDef } from "@boni/entities";
import { afterEach, describe, expect, it } from "vitest";
import { blame } from "./blame.ts";
import { MIGRATIONS } from "./migrations.ts";
import { BODY, type OpMeta, openUserStore, type UserStore } from "./store.ts";

/** The audit (audit.ts) with invented data only (the repo is public). */
const JUAN = label("user", "public", [{ kind: "turn", id: "t1" }]);
const MODEL = label("model", "public", [{ kind: "model", id: "mcp:claude-ejemplo" }]);
const me: OpMeta = { actor: "user", device: "portatil" };
const mcp: OpMeta = { actor: "agent", run: "mcp-1", by: "mcp:claude-ejemplo" };
const nota = (): TypeDef => ({
  id: "t_nota",
  key: "nota",
  name: "Nota",
  fields: [
    { id: "f_titulo", key: "titulo", name: "Título", type: "text", label: JUAN },
    { id: "f_estado", key: "estado", name: "Estado", type: "text", label: JUAN },
  ],
  titleField: "f_titulo",
  sensitivity: "personal",
  schemaVersion: 1,
  label: JUAN,
});

const dirs: string[] = [];
const stores: UserStore[] = [];
afterEach(() => {
  for (const s of stores.splice(0)) s.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
let clock = Date.UTC(2026, 9, 24, 10);
const fresh = () => {
  const dir = mkdtempSync(join(tmpdir(), "boni-audit-"));
  dirs.push(dir);
  const path = join(dir, "boni.db");
  const s = openUserStore(path, { now: () => (clock += 1000) });
  stores.push(s);
  s.applySchema({ op: "create_type", type: nota() }, { actor: "system" });
  return { s, path };
};
const t = (v: string, l = JUAN) => ({ value: v, label: l });
const DAY_AHEAD = 86_400_000;

describe("the audit", () => {
  it("says who made each entity and who changed it; a model can not say it was someone else", () => {
    const { s } = fresh();
    const e = s.create("t_nota", { f_titulo: t("Plan de ejemplo") }, me);
    s.update(e.entity.id, { f_estado: t("hecho", MODEL) }, mcp);
    const m = s.audit.meta([e.entity.id]).get(e.entity.id);
    expect(m).toMatchObject({
      createdBy: "user:portatil",
      updatedBy: "mcp:claude-ejemplo",
      editors: ["user:portatil", "mcp:claude-ejemplo"],
      viewers: [],
    });
  });

  it("records what each actor saw (fields, shapes, the text) without any value, and who saw an entity", () => {
    const { s } = fresh();
    const e = s.create(
      "t_nota",
      { f_titulo: t("Reunión de ejemplo"), [BODY]: t("Texto secreto") },
      me,
    );
    const id = e.entity.id;
    const seen = (fields: string[], body: "text" | "shape" | null, shapes: string[] = []) => ({
      entity: id,
      type: "t_nota",
      version: 1,
      fields,
      shapes,
      body,
      files: [],
    });
    s.audit.record({
      at: clock,
      by: "mcp:claude-ejemplo",
      run: "mcp-2",
      tool: "mcp.search",
      target: { collection: "t_nota" },
      decision: "allow",
      result: { rows: 1 },
      seen: [seen(["f_titulo"], null)],
    });
    // The same entity twice in one action is one row: the most it saw.
    const a2 = s.audit.record({
      at: clock + 5,
      by: "model:reader:openrouter/ejemplo",
      run: "r1",
      tool: "model.reader",
      decision: "allow",
      seen: [seen(["f_titulo"], "shape", ["f_estado"]), seen([], "text")],
    });
    // A denied action: kept, but nobody saw anything by it.
    s.audit.record({
      at: clock + 6,
      by: "model:planner:anthropic/ejemplo",
      tool: "entities.get",
      decision: "deny",
      rule: "R3",
      seen: [seen(["f_titulo"], "text")],
    });
    expect(s.audit.accessOf([a2]).get(a2)).toEqual([
      { ...seen(["f_titulo"], "text", ["f_estado"]) },
    ]);
    expect(s.audit.seenBy(id).map((x) => [x.by, x.fields, x.body])).toEqual([
      ["model:reader:openrouter/ejemplo", ["f_titulo"], "text"],
      ["mcp:claude-ejemplo", ["f_titulo"], null],
    ]);
    expect(s.audit.meta([id]).get(id)).toMatchObject({
      viewers: ["mcp:claude-ejemplo", "model:reader:openrouter/ejemplo"],
      seenBy: "model:reader:openrouter/ejemplo",
    });
    // No value of the entity is in the audit's tables.
    const text = JSON.stringify([s.audit.actions(), [...s.audit.accessOf([1, 2, 3]).values()]]);
    expect(text).not.toContain("Reunión de ejemplo");
    expect(text).not.toContain("Texto secreto");
  });

  it("is out of reach of read queries", () => {
    const { s } = fresh();
    for (const table of ["actions", "access", "entity_meta", "ops"])
      expect(() => s.readQuery(`SELECT * FROM ${table}`)).toThrow();
  });

  it("verifies both chains, and finds a row changed or removed by hand", () => {
    const { s, path } = fresh();
    const e = s.create("t_nota", { f_titulo: t("Uno") }, me);
    s.update(e.entity.id, { f_titulo: t("Dos") }, me);
    s.audit.record({ at: clock, by: "mcp:x", tool: "mcp.read", decision: "allow", seen: [] });
    s.audit.record({ at: clock, by: "mcp:x", tool: "mcp.read", decision: "allow", seen: [] });
    expect(s.audit.verify()).toEqual({ ok: true, ops: 3, actions: 2, broken: null });
    const db = new DatabaseSync(path);
    db.exec("UPDATE ops SET after = replace(after, 'Dos', 'Tres') WHERE seq = 3");
    expect(s.audit.verify()).toMatchObject({ ok: false, broken: "ops:3" });
    db.exec("UPDATE ops SET after = replace(after, 'Tres', 'Dos') WHERE seq = 3");
    expect(s.audit.verify().ok).toBe(true);
    db.exec("DELETE FROM actions WHERE seq = 1");
    expect(s.audit.verify()).toMatchObject({ ok: false, broken: "actions:2" });
    db.close();
  });

  it("chains the operations of a store made before it, and fills their system columns", () => {
    const dir = mkdtempSync(join(tmpdir(), "boni-audit-"));
    dirs.push(dir);
    const path = join(dir, "old.db");
    const db = new DatabaseSync(path);
    for (const m of MIGRATIONS.slice(0, 9)) db.exec(m as string);
    db.exec("PRAGMA user_version = 9");
    db.exec(
      `INSERT INTO ops (at, actor, device, run, kind, target, before, after) VALUES
        (1, 'import', NULL, 'i1', 'create', 'e1', NULL, '{"entity":{"body":"a"}}'),
        (2, 'user', 'movil', NULL, 'update', 'e1', '{}', '{"body":"a\\nb"}'),
        (3, 'agent', NULL, 'r1', 'update', 'e1', '{}', '{"values":{}}')`,
    );
    db.close();
    const s = openUserStore(path);
    stores.push(s);
    expect(s.audit.verify()).toEqual({ ok: true, ops: 3, actions: 0, broken: null });
    expect(s.audit.meta(["e1"]).get("e1")).toMatchObject({
      createdBy: "import",
      updatedBy: "agent",
      editors: ["import", "user:movil", "agent"],
    });
    expect(blame(s.bodyVersions("e1")).map((l) => [l.text, l.by])).toEqual([
      ["a", "import"],
      ["b", "user:movil"],
    ]);
  });

  it("filters actions by kind of actor and by collection", () => {
    const { s } = fresh();
    const e = s.create("t_nota", { f_titulo: t("Uno") }, me);
    const seen = [
      {
        entity: e.entity.id,
        type: "t_nota",
        version: 1,
        fields: [],
        shapes: [],
        body: null,
        files: [],
      },
    ];
    s.audit.record({ at: clock, by: "mcp:a", tool: "mcp.read", decision: "allow", seen });
    s.audit.record({ at: clock, by: "model:reader:x/y", tool: "model.reader", decision: "allow" });
    expect(s.audit.actions({ byPrefix: "model:" }).map((a) => a.by)).toEqual(["model:reader:x/y"]);
    expect(s.audit.actions({ type: "t_nota" }).map((a) => a.by)).toEqual(["mcp:a"]);
    expect(s.audit.changes(0, Date.UTC(2100, 0, 1))).toEqual({ kinds: { create: 1 }, undone: 0 });
  });

  it("counts reads and writes per day, actor and collection", () => {
    const { s } = fresh();
    const e = s.create("t_nota", { f_titulo: t("Uno") }, me);
    s.update(e.entity.id, { f_titulo: t("Dos", MODEL) }, mcp);
    s.audit.record({
      at: clock,
      by: "mcp:claude-ejemplo",
      tool: "mcp.read",
      decision: "allow",
      seen: [
        {
          entity: e.entity.id,
          type: "t_nota",
          version: 2,
          fields: ["f_titulo"],
          shapes: [],
          body: "text",
          files: [],
        },
      ],
    });
    const from = Date.UTC(2026, 9, 1);
    const to = Date.UTC(2026, 10, 1);
    expect(s.audit.byType(from, to)).toEqual(
      expect.arrayContaining([
        { type: "t_nota", by: "mcp:claude-ejemplo", reads: 1, writes: 1 },
        { type: "t_nota", by: "user:portatil", reads: 0, writes: 1 },
      ]),
    );
    expect(s.audit.activity(from, to)).toEqual(
      expect.arrayContaining([
        { day: "2026-10-24", by: "mcp:claude-ejemplo", reads: 1, writes: 1 },
      ]),
    );
    // The same per collection too (Boni's «Actividad de Boni»).
    expect(s.audit.activityByType(from, to)).toEqual(
      expect.arrayContaining([
        { day: "2026-10-24", by: "mcp:claude-ejemplo", type: "t_nota", reads: 1, writes: 1 },
        { day: "2026-10-24", by: "user:portatil", type: "t_nota", reads: 0, writes: 1 },
      ]),
    );
    expect(s.audit.activityByType(to, to + 1)).toEqual([]);
    // Each action on its day where the account lives (the caller says which), not always the UTC one.
    expect(s.audit.activityByType(from, to, () => "2026-10-25")).toEqual(
      expect.arrayContaining([
        { day: "2026-10-25", by: "mcp:claude-ejemplo", type: "t_nota", reads: 1, writes: 1 },
      ]),
    );
    // Calls to models in a period, oldest first, cost in dollars or null when unknown.
    s.journal.modelCall({
      run: "r1",
      role: "reader",
      provider: "fake",
      model: "m-ejemplo",
      promptHash: "h",
      request: {},
      response: {},
      usage: { input: 10, output: 2, cost: 0.5 },
      at: clock,
    });
    s.journal.modelCall({
      run: "r1",
      role: "planner",
      provider: "fake",
      model: "m-ejemplo",
      promptHash: "h",
      request: {},
      response: {},
      usage: null,
      at: clock + 1,
    });
    const calls = s.journal.modelCallsIn(from, to + DAY_AHEAD);
    expect(calls.map((c) => [c.role, c.input, c.output, c.cost])).toEqual([
      ["reader", 10, 2, 0.5],
      ["planner", 0, 0, null],
    ]);
    expect(new Set(calls.map((c) => c.n)).size).toBe(2);
    expect(s.journal.modelCallsIn(clock + 2, clock + 3)).toEqual([]);
    const st = s.audit.storage();
    expect(st.types).toEqual([expect.objectContaining({ type: "t_nota", rows: 1 })]);
    expect(st.audit.actions).toBe(1);
  });
});

describe("blame", () => {
  it("gives each line to whoever left it as it is", () => {
    const v = (text: string | null, by: string, seq: number) => ({ text, by, at: seq, seq });
    const lines = blame([
      v("# Plan\nuno\ndos", "user:portatil", 1),
      v("# Plan\nuno\nINSERTADO\ndos", "mcp:claude", 2),
      v("# Plan\nuno cambiado\nINSERTADO\ndos\nfinal", "model:reader:x", 3),
      v("# Plan\nuno cambiado\ndos\nfinal", "user:movil", 4),
    ]);
    expect(lines.map((l) => [l.text, l.by])).toEqual([
      ["# Plan", "user:portatil"],
      ["uno cambiado", "model:reader:x"],
      ["dos", "user:portatil"],
      ["final", "model:reader:x"],
    ]);
    expect(blame([v("a", "x", 1), v(null, "y", 2)])).toEqual([]);
  });
});
