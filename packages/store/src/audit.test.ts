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

  it("keeps the activity per quarter in the store: a new instance starts from the sum, never from every row (task 43)", () => {
    const { s, path } = fresh();
    const at0 = Date.UTC(2026, 9, 1, 10);
    const ids = Array.from(
      { length: 50 },
      (_, i) => s.create("t_nota", { f_titulo: t(`Nota ${i}`) }, me).entity.id,
    );
    const seen = (id: string) => ({
      entity: id,
      type: "t_nota",
      version: 1,
      fields: ["f_titulo"],
      shapes: [],
      body: null,
      files: [],
    });
    // Invented volume shaped like his: 2,000 reads over 40 days, each seeing ten notes (20,000 rows of access).
    s.batch(() => {
      for (let i = 0; i < 2000; i++)
        s.audit.record({
          at: at0 + (i % 40) * DAY_AHEAD + (i % 7) * 60_000,
          by: i % 2 ? "model:reader:fake" : "mcp:claude-ejemplo",
          run: `r${i}`,
          tool: "mcp.query",
          target: {},
          decision: "allow",
          result: null,
          seen: ids.slice((i * 10) % 50, ((i * 10) % 50) + 10).map(seen),
        });
    });
    const from = at0 + 10 * DAY_AHEAD;
    const sum = (rows: { by: string; type: string; reads: number; writes: number }[]) => {
      const m = new Map<string, { reads: number; writes: number }>();
      for (const r of rows) {
        const c = m.get(`${r.by}|${r.type}`) ?? { reads: 0, writes: 0 };
        c.reads += r.reads;
        c.writes += r.writes;
        m.set(`${r.by}|${r.type}`, c);
      }
      return Object.fromEntries(m);
    };
    const t1 = performance.now();
    const first = s.audit.activitySince(0, 0, from);
    const firstMs = performance.now() - t1;
    // 30 of the 40 days: 1,500 reads of ten notes each, half by each actor; and the 50 creations (the store's clock).
    expect(sum(first.rows)).toEqual({
      "model:reader:fake|t_nota": { reads: 7500, writes: 0 },
      "mcp:claude-ejemplo|t_nota": { reads: 7500, writes: 0 },
      "user:portatil|t_nota": { reads: 0, writes: 50 },
    });
    // From where it was: only what came since; nothing new, nothing.
    expect(s.audit.activitySince(first.action, first.op, from).rows).toEqual([]);
    s.audit.record({
      at: at0 + 39 * DAY_AHEAD,
      by: "mcp:claude-ejemplo",
      run: "r-new",
      tool: "mcp.read",
      target: {},
      decision: "allow",
      result: null,
      seen: [seen(ids[0] as string)],
    });
    const since = s.audit.activitySince(first.action, first.op, from);
    expect(sum(since.rows)).toEqual({ "mcp:claude-ejemplo|t_nota": { reads: 1, writes: 0 } });
    // Opened again (a restart): the sum as kept, in milliseconds, the same numbers.
    s.close();
    stores.splice(stores.indexOf(s), 1);
    const again = openUserStore(path);
    stores.push(again);
    const t2 = performance.now();
    const restarted = again.audit.activitySince(0, 0, from);
    const againMs = performance.now() - t2;
    console.log(
      `activity of 20,000 reads: the first pass ${firstMs.toFixed(0)} ms, after a restart ${againMs.toFixed(0)} ms`,
    );
    expect(sum(restarted.rows)).toEqual({
      "model:reader:fake|t_nota": { reads: 7500, writes: 0 },
      "mcp:claude-ejemplo|t_nota": { reads: 7501, writes: 0 },
      "user:portatil|t_nota": { reads: 0, writes: 50 },
    });
    expect(againMs).toBeLessThan(Math.max(50, firstMs / 2));
    // The window moving later leaves the earlier quarters out; the whole audit stays summed in the table.
    // (the day 39's fifty reads are all the reader's, and the one read added after.)
    expect(sum(again.audit.activitySince(0, 0, at0 + 39 * DAY_AHEAD).rows)).toEqual({
      "model:reader:fake|t_nota": { reads: 500, writes: 0 },
      "mcp:claude-ejemplo|t_nota": { reads: 1, writes: 0 },
    });
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

describe("the storage figures (task 43)", () => {
  it("are bytes, read from each row's header (a text is never read whole to be measured); the history by collection", () => {
    const { s } = fresh();
    s.applySchema(
      { op: "create_type", type: { ...nota(), id: "t_otra", key: "otra", name: "Otra" } },
      { actor: "system" },
    );
    // The same note in two collections, but «ñ» takes two bytes where «n» takes one.
    s.create("t_nota", { f_titulo: t("nnnn") }, me);
    const otra = s.create("t_otra", { f_titulo: t("ññññ") }, me);
    const sizes = () => new Map(s.audit.storage().types.map((x) => [x.type, x]));
    const before = sizes();
    expect((before.get("t_otra")?.bytes ?? 0) - (before.get("t_nota")?.bytes ?? 0)).toBe(4);
    // A change is history of its own collection only.
    const was = before.get("t_otra")?.history ?? 0;
    s.update(otra.entity.id, { f_estado: t("hecha") }, me);
    const after = sizes();
    expect(after.get("t_otra")?.history).toBeGreaterThan(was);
    expect(after.get("t_nota")?.history).toBe(before.get("t_nota")?.history);
  });

  it("are kept as they grow: the figures of summing everything, counted a slice at a time, then only what is new (task 107)", () => {
    const { s, path } = fresh();
    s.applySchema(
      { op: "create_type", type: { ...nota(), id: "t_otra", key: "otra", name: "Otra" } },
      { actor: "system" },
    );
    const ids = Array.from(
      { length: 60 },
      (_, i) =>
        s.create(i % 2 ? "t_otra" : "t_nota", { f_titulo: t(`Nota ${i} ${"ñ".repeat(i)}`) }, me)
          .entity.id,
    );
    for (const id of ids) s.update(id, { f_estado: t("hecha") }, me);
    const seen = (id: string) => ({
      entity: id,
      type: "t_nota",
      version: 1,
      fields: ["f_titulo"],
      shapes: [],
      body: null,
      files: [],
    });
    const read = (i: number) =>
      s.audit.record({
        at: clock + i,
        by: "model:reader:fake",
        run: `r${i}`,
        tool: "mcp.query",
        target: { i },
        decision: "allow",
        result: null,
        seen: ids.slice(i % 50, (i % 50) + 10).map(seen),
      });
    const call = (i: number) =>
      s.journal.modelCall({
        run: `r${i}`,
        role: "reader",
        provider: "fake",
        model: "m-ejemplo",
        promptHash: "h",
        request: { texto: "x".repeat(500 + i) },
        response: { ok: true },
        usage: null,
        at: clock + i,
      });
    s.batch(() => {
      for (let i = 0; i < 700; i++) read(i);
      for (let i = 0; i < 450; i++) call(i);
    });
    // What the figures were before (task 43): every table summed whole, on another connection.
    const whole = () => {
      const db = new DatabaseSync(path, { readOnly: true });
      try {
        const history = Object.fromEntries(
          db
            .prepare(
              `SELECT x.type AS type, sum(coalesce(octet_length(o.before), 0) + coalesce(octet_length(o.after), 0)) AS b
               FROM ops o JOIN entities x ON x.id = o.target GROUP BY x.type`,
            )
            .all()
            .map((r) => [r.type, Number(r.b)]),
        );
        const mc = db
          .prepare(
            "SELECT count(*) AS n, sum(octet_length(request) + octet_length(response)) AS b FROM model_calls",
          )
          .get() as { n: number; b: number };
        const au = db
          .prepare(
            `SELECT (SELECT count(*) FROM actions) AS a, (SELECT count(*) FROM access) AS x,
               (SELECT sum(octet_length(by) + octet_length(tool) + coalesce(octet_length(target), 0) + 64) FROM actions)
               + (SELECT sum(octet_length(entity) + octet_length(fields) + octet_length(shapes) + 48) FROM access) AS b`,
          )
          .get() as { a: number; x: number; b: number };
        return {
          history,
          modelCalls: { rows: Number(mc.n), bytes: Number(mc.b) },
          audit: { actions: Number(au.a), access: Number(au.x), bytes: Number(au.b) },
        };
      } finally {
        db.close();
      }
    };
    const figures = (x: UserStore) => {
      const st = x.audit.storage();
      return {
        history: Object.fromEntries(st.types.map((y) => [y.type, y.history])),
        modelCalls: st.modelCalls,
        audit: st.audit,
      };
    };
    // A slice per call when no time is left: the reads (700 actions, 200 per slice) and the calls (450, 200 per
    // slice) take several, and each call says whether it is done.
    let turns = 1;
    while (!s.audit.storageCatchUp(0)) turns++;
    expect(turns).toBeGreaterThanOrEqual(6);
    expect(s.audit.storageCatchUp(0)).toBe(true);
    expect(figures(s)).toEqual(whole());
    expect(whole().audit).toMatchObject({ actions: 700, access: 7000 });
    // What comes after is added, and only it: a change, a read and a call.
    s.update(ids[3] as string, { f_estado: t("otra vez") }, me);
    read(1000);
    call(1000);
    expect(figures(s)).toEqual(whole());
    // Opened again (a restart): the kept sums, nothing to count again.
    s.close();
    stores.splice(stores.indexOf(s), 1);
    const again = openUserStore(path);
    stores.push(again);
    expect(again.audit.storageCatchUp(0)).toBe(true);
    expect(figures(again)).toEqual(whole());
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
