import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import type { Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AgentHost } from "./agent.ts";
import { addUser } from "./auth.ts";
import { type Db, openDb } from "./db.ts";
import { Feeds } from "./feeds.ts";
import { type App, makeApp, serve } from "./http.ts";
import { LoginGuard } from "./limits.ts";

/**
 * The storage figures of «Todas las páginas» (`GET /api/data/audit/storage`) with Juan's volume, invented (task 107,
 * A-28): on his server they were the history, the audit and the models' calls summed whole, and that held the event
 * loop 40 s. Now they are kept, counted a slice at a time with the loop free between slices.
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
});

afterAll(async () => {
  http.closeAllConnections();
  await new Promise((r) => http.close(r));
  app.close();
  host.close();
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

/**
 * A store shaped like his and of his size (a year): 3,000 records in ten collections, a fifth with a long text;
 * 80,000 changes; 15,000 reads of twenty records each (300,000 rows of the audit); 2,000 model calls. Written in SQL,
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
      SELECT 1760000000000 + i * 60000, 'user', 'portatil', 'user:portatil', 'update',
        printf('e_01m7vol%06d', (i * 7919) % 3000), printf('%.300c', 'b'), printf('%.300c', 'a'), 'h' FROM n;
    WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 15000)
    INSERT INTO actions (seq, at, by, run, tool, target, decision, hash)
      SELECT ${a0} + i, 1760000000000 + i * 30000, 'model:reader:fake', 'r' || i, 'mcp.query', '{}', 'allow', 'h' FROM n;
    WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM n WHERE i < 299999)
    INSERT INTO access (action, entity, type, version, fields, shapes, body, files)
      SELECT ${a0} + i / 20 + 1, printf('e_01m7vol%06d', (i * 37) % 3000), 't_' || ((i * 37) % 3000 % 10), 1,
        '["f_titulo","f_x"]', '[]', NULL, '[]' FROM n;
    WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 2000)
    INSERT INTO model_calls (run, role, provider, model, prompt_hash, request, response, usage, at)
      SELECT 'r' || i, 'reader', 'fake', 'm-ejemplo', 'h', printf('%.3000c', 'q'), printf('%.1000c', 'r'), '{}',
        1760000000000 + i * 600000 FROM n;
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
async function asked(): Promise<{ ms: number; held: number; long: number; body: Figures }> {
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
  const r = await fetch(`${base}/api/data/audit/storage`, {
    headers: { authorization: `Bearer ${t}` },
  });
  const body = (await r.json()) as Figures;
  const ms = performance.now() - t0;
  on = false;
  expect(r.status).toBe(200);
  return { ms, held, long, body };
}

describe("the storage figures with Juan's volume (task 107, A-28)", () => {
  it("never hold the server: counted a slice at a time the first time, then only what is new", async () => {
    host.store(1); // opened, so migrated
    const path = join(dir, "users", "1.db");
    fill(path);
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
