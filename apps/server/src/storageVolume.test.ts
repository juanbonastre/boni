import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import type { Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { UserStore } from "@boni/store";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AgentHost } from "./agent.ts";
import { addUser } from "./auth.ts";
import { type Db, openDb } from "./db.ts";
import { Feeds } from "./feeds.ts";
import { type App, makeApp, serve } from "./http.ts";
import { LoginGuard } from "./limits.ts";

/**
 * What «Todas las páginas» asks on every open, with Juan's volume, invented. The storage figures
 * (`GET /api/data/audit/storage`, task 107, A-28): on his server they were the history, the audit and the models' calls
 * summed whole, and that held the event loop 40 s; now they are kept, counted a slice at a time with the loop free
 * between slices. The activity of the last thirty days (`GET /api/data/audit/summary`, task 108, A-29): it read thirty
 * days of the audit twice and a year of runs whole; now it is counted from the kept activity per quarter.
 */
const PASSWORD = "una contraseña larga de ejemplo";
let dir: string;
let db: Db;
let host: AgentHost;
let app: App;
let http: HttpServer;
let base = "";
let t = "";

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "boni-storage-"));
  db = openDb(join(dir, "system.db"));
  addUser(db, "ana", PASSWORD);
  host = new AgentHost({ dataDir: dir, providers: null });
  app = makeApp({
    db,
    key: randomBytes(32),
    feeds: new Feeds(async () => ""),
    guard: new LoginGuard({ perUser: 50, perAddress: 100, windowMs: 60_000, perMinute: 100 }),
    agent: host,
  });
  http = serve(app, "tailnet");
  await new Promise<void>((r) => http.listen(0, "127.0.0.1", () => r()));
  base = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
  const r = await fetch(`${base}/api/login`, {
    method: "POST",
    body: JSON.stringify({ user: "ana", password: PASSWORD, device: "portatil-ejemplo" }),
  });
  t = ((await r.json()) as { token: string }).token;
  host.store(1); // opened, so migrated
  fill(join(dir, "users", "1.db"));
}, 120_000);

afterAll(async () => {
  http.closeAllConnections();
  await new Promise((r) => http.close(r));
  app.close();
  host.close();
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

/** The instant the volume ends at (not on a quarter of an hour, so the thirty days asked cut one at each end). */
const NOW = 1_790_000_123_456;
const DAY = 86_400_000;
const YEAR = 365 * DAY;

/**
 * A store shaped like his and of his size (a year, ending at `NOW`): 3,000 records in ten collections, a fifth with a
 * long text; 80,000 changes; 15,000 reads of twenty records each (300,000 rows of the audit), one in ten a model's
 * reading; 2,000 model calls; 12,000 runs (a quarter of them Juan's, the rest Boni's own) and 3,000 proposals, a third
 * of them accepted; all of it spread evenly over the year. Written in SQL,
 * since writing it a row at a time through the store would take the test's minute. The texts are short (a change of
 * 600 bytes, a call of 4 KB): the sums read a text's length from its row, never the text, so longer ones cost the old
 * route nothing more and only slowed the tests that run beside this one (a 450 MB store, 2026-11-13).
 */
function fill(path: string) {
  const sql = new DatabaseSync(path);
  // After what the store wrote of its own on opening it.
  const a0 = Number(
    (sql.prepare("SELECT coalesce(max(seq), 0) AS n FROM actions").get() as { n: number }).n,
  );
  sql.exec(`BEGIN;
    WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM n WHERE i < 2999)
    INSERT INTO entities (id, type, vals, body, created, updated, version)
      SELECT printf('e_01m7vol%06d', i), 't_' || (i % 10),
        json_object('f_titulo', 'Nota de ejemplo ' || i, 'f_x', printf('%.300c', 'x')),
        CASE WHEN i % 5 = 0 THEN printf('%.4000c', 'y') END, 1, 1, 1 FROM n;
    WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 80000)
    INSERT INTO ops (at, actor, device, by, kind, target, before, after, hash)
      SELECT ${NOW - YEAR} + i * ${Math.floor(YEAR / 80_000)}, 'user', 'portatil', 'user:portatil', 'update',
        printf('e_01m7vol%06d', (i * 7919) % 3000), printf('%.300c', 'b'), printf('%.300c', 'a'), 'h' FROM n;
    WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 15000)
    INSERT INTO actions (seq, at, by, run, tool, target, decision, hash)
      SELECT ${a0} + i, ${NOW - YEAR} + i * ${Math.floor(YEAR / 15_000)}, 'model:reader:fake', 'r' || i,
        CASE WHEN i % 10 = 0 THEN 'model.reader' ELSE 'mcp.query' END, '{}', 'allow', 'h' FROM n;
    WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM n WHERE i < 299999)
    INSERT INTO access (action, entity, type, version, fields, shapes, body, files)
      SELECT ${a0} + i / 20 + 1, printf('e_01m7vol%06d', (i * 37) % 3000), 't_' || ((i * 37) % 3000 % 10), 1,
        '["f_titulo","f_x"]', '[]', NULL, '[]' FROM n;
    WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 2000)
    INSERT INTO model_calls (run, role, provider, model, prompt_hash, request, response, usage, at)
      SELECT 'r' || i, 'reader', 'fake', 'm-ejemplo', 'h', printf('%.3000c', 'q'), printf('%.1000c', 'r'), '{}',
        ${NOW - YEAR} + i * ${Math.floor(YEAR / 2000)} FROM n;
    WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 12000)
    INSERT INTO runs (id, origin, status, plan, started, finished)
      SELECT 'run_' || i, CASE WHEN i % 4 = 0 THEN 'chat' ELSE 'background' END, 'done',
        json_object('steps', json_array(json_object('tool', 'entities.query', 'args', printf('%.1500c', 'p')))),
        ${NOW - YEAR} + i * ${Math.floor(YEAR / 12_000)}, ${NOW - YEAR} + i * ${Math.floor(YEAR / 12_000)} + 1000 FROM n;
    WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 3000)
    INSERT INTO proposals (id, run, tool, args, status, created)
      SELECT 'p_' || i, 'run_' || i, 'entities.create', json_object('x', printf('%.500c', 'a')),
        CASE WHEN i % 3 = 0 THEN 'accepted' ELSE 'pending' END, ${NOW - YEAR} + i * ${Math.floor(YEAR / 3000)} FROM n;
    COMMIT;`);
  sql.close();
}

/** The figures as the route summed them before (task 43): every table whole, in one go. */
function whole(path: string) {
  const sql = new DatabaseSync(path, { readOnly: true });
  try {
    const t0 = performance.now();
    const history = sql
      .prepare(
        `SELECT x.type AS type, sum(coalesce(octet_length(o.before), 0) + coalesce(octet_length(o.after), 0)) AS b
         FROM ops o JOIN entities x ON x.id = o.target GROUP BY x.type`,
      )
      .all();
    const mc = sql
      .prepare(
        "SELECT count(*) AS n, sum(octet_length(request) + octet_length(response)) AS b FROM model_calls",
      )
      .get() as { n: number; b: number };
    const au = sql
      .prepare(
        `SELECT (SELECT count(*) FROM actions) AS a, (SELECT count(*) FROM access) AS x,
           (SELECT sum(octet_length(by) + octet_length(tool) + coalesce(octet_length(target), 0) + 64) FROM actions)
           + (SELECT sum(octet_length(entity) + octet_length(fields) + octet_length(shapes) + 48) FROM access) AS b`,
      )
      .get() as { a: number; x: number; b: number };
    return {
      ms: performance.now() - t0,
      figures: {
        history: Object.fromEntries(history.map((r) => [r.type, Number(r.b)])),
        modelCalls: { rows: Number(mc.n), bytes: Number(mc.b) },
        audit: { actions: Number(au.a), access: Number(au.x), bytes: Number(au.b) },
      },
    };
  } finally {
    sql.close();
  }
}

type Figures = {
  types: { type: string; history: number }[];
  modelCalls: unknown;
  audit: unknown;
};

/**
 * The route asked, with the longest the event loop went without a turn while it answered and how many times it was
 * held 10 ms or more (the slices it was counted in).
 */
async function asked<T = Figures>(
  path = "/api/data/audit/storage",
): Promise<{ ms: number; held: number; long: number; body: T }> {
  let held = 0;
  let long = 0;
  let last = performance.now();
  let on = true;
  const tick = () => {
    const now = performance.now();
    held = Math.max(held, now - last);
    if (now - last >= 10) long++;
    last = now;
    if (on) setTimeout(tick, 0);
  };
  setTimeout(tick, 0);
  const t0 = performance.now();
  const r = await fetch(`${base}${path}`, {
    headers: { authorization: `Bearer ${t}` },
  });
  const body = (await r.json()) as T;
  const ms = performance.now() - t0;
  on = false;
  expect(r.status).toBe(200);
  return { ms, held, long, body };
}

describe("the storage figures with Juan's volume (task 107, A-28)", () => {
  it("never hold the server: counted a slice at a time the first time, then only what is new", async () => {
    const path = join(dir, "users", "1.db");
    // What the old route did at once, timed warm (the best of two, after one to warm it): the bounds are relative to
    // it, so a loaded runner slows both alike.
    whole(path);
    const before = whole(path);
    const ref = Math.min(before.ms, whole(path).ms);
    const first = await asked();
    const again = await asked();
    console.log(
      `storage figures with his volume: the whole sum ${ref.toFixed(0)} ms at once; the first answer ${first.ms.toFixed(0)} ms with the loop held at most ${first.held.toFixed(0)} ms, ${first.long} times 10 ms or more; the next ${again.ms.toFixed(0)} ms`,
    );
    const figures = (b: Figures) => ({
      history: Object.fromEntries(b.types.map((x) => [x.type, x.history])),
      modelCalls: b.modelCalls,
      audit: b.audit,
    });
    // The same figures as summing everything.
    expect(figures(first.body)).toEqual(before.figures);
    expect(figures(again.body)).toEqual(before.figures);
    // The loop is free between slices: never held for the whole sum (the route as it was held it all of `ref`).
    expect(first.held).toBeLessThan(Math.max(80, ref / 2));
    // And given back between slices: the old route held it once, for all of it.
    expect(first.long).toBeGreaterThanOrEqual(4);
    // Then only what is new is counted: no table read whole again.
    expect(again.ms).toBeLessThan(Math.max(40, ref / 4));
  }, 120_000);
});

/**
 * The «Actividad» numbers as the route counted them before (task 108): thirty days of the audit read twice, a year of
 * runs and every proposal read whole, the readings among the latest thousand actions of a reader.
 */
function summedBefore(store: UserStore, from: number, to: number) {
  const t0 = performance.now();
  const inRange = (at: number | null) => at !== null && at >= from && at < to;
  const activity = store.audit.activity(from, to);
  const byType = store.audit.byType(from, to);
  const proposals = store.journal.proposals().filter((p) => inRange(p.created));
  const runs = store.journal.runs(100_000).filter((r) => inRange(r.started));
  const readings = store.audit
    .actions({ from, to, byPrefix: "model:reader:", limit: 1000 })
    .filter((a) => a.tool === "model.reader").length;
  return {
    readingsCut: readings,
    ms: performance.now() - t0,
    figures: {
      activity,
      byType: byType.sort((a, b) => a.type.localeCompare(b.type) || a.by.localeCompare(b.by)),
      reads: activity.reduce((n, r) => n + r.reads, 0),
      writes: activity.reduce((n, r) => n + r.writes, 0),
      proposals: proposals.length,
      accepted: proposals.filter((p) => p.status === "accepted").length,
      requests: runs.filter((r) => r.origin !== "background").length,
    },
  };
}

type Summary = {
  activity: unknown[];
  byType: { type: string; by: string; reads: number; writes: number; name: string }[];
  totals: Record<string, number>;
};

describe("the activity of the last thirty days with Juan's volume (task 108, A-29)", () => {
  it("is counted from the kept activity, never read row by row, and gives the same numbers", async () => {
    const store = host.store(1);
    const path = join(dir, "users", "1.db");
    // As on his server: the kept activity is up to date (Boni's own records keep it); then a day of reads and
    // changes comes in, which the next open counts.
    store.audit.activitySince(0, 0, 0);
    const sql = new DatabaseSync(path);
    const a0 = Number((sql.prepare("SELECT max(seq) AS n FROM actions").get() as { n: number }).n);
    sql.exec(`BEGIN;
      WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 41)
      INSERT INTO actions (seq, at, by, run, tool, target, decision, hash)
        SELECT ${a0} + i, ${NOW - DAY} + i * 2000000, 'model:reader:fake', 'rd' || i, 'mcp.query', '{}', 'allow', 'h'
        FROM n;
      WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM n WHERE i < 819)
      INSERT INTO access (action, entity, type, version, fields, shapes, body, files)
        SELECT ${a0} + i / 20 + 1, printf('e_01m7vol%06d', (i * 41) % 3000), 't_' || ((i * 41) % 3000 % 10), 1,
          '["f_titulo"]', '[]', NULL, '[]' FROM n;
      WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 220)
      INSERT INTO ops (at, actor, device, by, kind, target, before, after, hash)
        SELECT ${NOW - DAY} + i * 390000, 'user', 'movil', 'user:movil', 'update',
          printf('e_01m7vol%06d', (i * 13) % 3000), 'b', 'a', 'h' FROM n;
      COMMIT;`);
    sql.close();
    const from = NOW - 30 * DAY;
    // The old count, timed warm (the best of two, after one to warm it).
    summedBefore(store, from, NOW);
    const before = summedBefore(store, from, NOW);
    const ref = Math.min(before.ms, summedBefore(store, from, NOW).ms);
    const got = await asked<Summary>(`/api/data/audit/summary?from=${from}&to=${NOW}`);
    const again = await asked<Summary>(`/api/data/audit/summary?from=${from}&to=${NOW}`);
    console.log(
      `activity of thirty days with his volume (${before.figures.reads} reads, ${before.figures.writes} changes, ${before.figures.requests} requests in them): counted as before ${ref.toFixed(0)} ms at once; now ${got.ms.toFixed(0)} ms with the loop held at most ${got.held.toFixed(0)} ms, the next ${again.ms.toFixed(0)} ms`,
    );
    const figures = (b: Summary) => ({
      activity: b.activity,
      byType: b.byType
        .map(({ name: _, ...r }) => r)
        .sort((a, b) => a.type.localeCompare(b.type) || a.by.localeCompare(b.by)),
      reads: b.totals.reads,
      writes: b.totals.writes,
      proposals: b.totals.proposals,
      accepted: b.totals.accepted,
      requests: b.totals.requests,
    });
    // There is something to count, and the numbers are the same as reading it all.
    expect(before.figures.reads).toBeGreaterThan(20_000);
    expect(before.figures.requests).toBeGreaterThan(200);
    expect(figures(got.body)).toEqual(before.figures);
    expect(figures(again.body)).toEqual(before.figures);
    // The models' readings are all of them: before, only those among a reader's latest thousand actions were (there
    // are more than a thousand in thirty days of his volume, so some were left out).
    const readings = new DatabaseSync(path, { readOnly: true });
    const all = Number(
      (
        readings
          .prepare(
            "SELECT count(*) AS n FROM actions WHERE at >= ? AND at < ? AND by LIKE 'model:reader:%' AND tool = 'model.reader'",
          )
          .get(from, NOW) as { n: number }
      ).n,
    );
    readings.close();
    expect(all).toBeGreaterThan(before.readingsCut);
    expect(got.body.totals.readings).toBe(all);
    // Never held for the old count (the route as it was held the loop all of `ref`): kept sums and counts on indexes.
    expect(got.held).toBeLessThan(Math.max(40, ref / 3));
    expect(again.held).toBeLessThan(Math.max(40, ref / 3));
  }, 120_000);
});
