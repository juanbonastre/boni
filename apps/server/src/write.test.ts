import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Row } from "@boni/calendar";
import { label } from "@boni/entities";
import type { UserStore } from "@boni/store";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AgentHost } from "./agent.ts";
import { addUser } from "./auth.ts";
import { calendarDefs } from "./calendarStore.ts";
import { type Db, openDb } from "./db.ts";
import { Feeds } from "./feeds.ts";
import { makeServer } from "./http.ts";
import { calendarDef, seed } from "./seed.test-util.ts";

/** Writing through the server (BONI_WRITE): into the account's own collections, with a version check per row. */
const LESSON = "agenda/docencia/2026-10-19 Clase de ejemplo.md";
const lesson = `---\ntitle: "Clase de ejemplo"\ndate: "2026-10-19"\nstartTime: "10:00"\nendTime: "11:00"\nlocation: "Aula 1"\nnotion_id: "x"\ncompleted:\n---\n## Notas\n`;

let dir: string;
let db: Db;
let host: AgentHost;
let store: UserStore;
let lessonId: string;
let base: string;
let close: () => Promise<void>;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "boni-server-write-"));
  db = openDb(":memory:");
  addUser(db, "juan", "una contraseña larga de ejemplo");
  host = new AgentHost({ dataDir: dir, providers: null });
  store = host.store(1);
  const ids = seed(
    store,
    [
      {
        key: "docencia",
        name: "Docencia",
        folder: "agenda/docencia/",
        calendar: calendarDef("docencia", "Docencia", "agenda/docencia"),
      },
    ],
    { [LESSON]: lesson },
  );
  lessonId = ids.get(LESSON) as string;
  const server = makeServer({
    db,
    write: true,
    key: randomBytes(32),
    feeds: new Feeds(async () => ""),
    agent: host,
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  close = () =>
    new Promise((r) => {
      server.closeAllConnections();
      server.close(() => r());
    });
});

afterAll(async () => {
  await close();
  host.close();
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

async function session(device = "prueba") {
  const r = await fetch(`${base}/api/login`, {
    method: "POST",
    body: JSON.stringify({ user: "juan", password: "una contraseña larga de ejemplo", device }),
  });
  return ((await r.json()) as { token: string }).token;
}
const auth = (token: string) => ({ authorization: `Bearer ${token}` });
async function snapshot(token: string, url = base) {
  return (await (await fetch(`${url}/api/snapshot`, { headers: auth(token) })).json()) as {
    version: number;
    rows: Row[];
    views: { id: string; readOnly?: boolean; reminders?: { timed: unknown[] } }[];
  };
}
async function apply(token: string, baseVersion: number, changes: unknown[]) {
  const r = await fetch(`${base}/api/apply`, {
    method: "POST",
    headers: auth(token),
    body: JSON.stringify({ base: baseVersion, changes }),
  });
  return {
    status: r.status,
    body: (await r.json()) as {
      version?: number;
      aliases?: Record<string, string>;
      conflict?: string[];
    },
  };
}
const values = (id: string) => store.get(id)?.entity.values ?? {};

describe("writing through the server", () => {
  it("changes only the edited properties of an entry, and the calendars are writable", async () => {
    const token = await session();
    const snap = await snapshot(token);
    expect(snap.views.every((v) => !v.readOnly)).toBe(true);
    const row = snap.rows.find((r) => r.id === lessonId) as Row;
    const r = await apply(token, snap.version, [
      { op: "upsert", row: { ...row, values: { ...row.values, location: "Aula 2" } } },
    ]);
    expect(r.status).toBe(200);
    expect(r.body.version).toBeGreaterThan(snap.version);
    expect(values(lessonId)).toMatchObject({
      f_location: "Aula 2",
      f_notion_id: "x",
      f_title: "Clase de ejemplo",
    });
    const labels = store.get(lessonId)?.labels;
    expect(labels?.f_location?.integrity).toBe("user");
    expect(labels?.f_title?.integrity).toBe("imported"); // untouched

    // The same device writes again with the version it had: its own write is not a conflict.
    const again = await apply(token, snap.version, [
      { op: "upsert", row: { ...row, values: { ...row.values, location: "Aula 3" } } },
    ]);
    expect(again.status).toBe(200);
    expect(values(lessonId).f_location).toBe("Aula 3");
  });

  it("refuses to write over an entry changed elsewhere after the device's version", async () => {
    const token = await session();
    const other = await session("otro"); // another device of the same account
    const snap = await snapshot(token);
    const row = snap.rows.find((r) => r.id === lessonId) as Row;
    // Changed in Boni (a page, the MCP) after this device took its snapshot.
    store.update(
      lessonId,
      { $body: { value: "## Notas\nEscrito en Boni", label: label("user", "personal", []) } },
      { actor: "user", device: "boni" },
    );
    const r = await apply(token, snap.version, [
      { op: "upsert", row: { ...row, values: { ...row.values, title: "Pisada" } } },
    ]);
    expect(r.status).toBe(409);
    expect(r.body.conflict).toEqual([lessonId]);
    expect(store.get(lessonId)?.entity.body).toContain("Escrito en Boni");
    expect(values(lessonId).f_title).not.toBe("Pisada");
    // With the new version it goes through; a change by another device also counts as a conflict.
    const fresh = await snapshot(other);
    const row2 = fresh.rows.find((x) => x.id === lessonId) as Row;
    expect(
      (
        await apply(other, fresh.version, [
          { op: "upsert", row: { ...row2, values: { ...row2.values, title: "Bien" } } },
        ])
      ).status,
    ).toBe(200);
    expect(
      (
        await apply(token, fresh.version, [
          { op: "upsert", row: { ...row2, values: { ...row2.values, title: "Pisada" } } },
        ])
      ).status,
    ).toBe(409);
  });

  it("makes an entry of a new row and says its id; a removed row goes to Boni's trash", async () => {
    const token = await session();
    const snap = await snapshot(token);
    const model = snap.rows.find((r) => r.id === lessonId) as Row;
    const draft: Row = {
      ...model,
      id: "ev-temporal-1",
      values: { title: "Cena inventada", date: "2026-10-24", startTime: "21:00", endTime: "23:00" },
    };
    const r = await apply(token, snap.version, [{ op: "upsert", row: draft }]);
    expect(r.status).toBe(200);
    // Its id is the record's: no note path is made up for it.
    const id = r.body.aliases?.["ev-temporal-1"] as string;
    expect(id).toMatch(/^e_/);
    const made = (await snapshot(token)).rows.find((x) => x.id === id);
    // Its collection's new rows get the area.
    expect(made?.values).toMatchObject({ title: "Cena inventada", area: "[[docencia]]" });
    expect(store.get(id)?.entity.values.f_vault_path).toBeUndefined();

    const now = await snapshot(token);
    const del = await apply(token, now.version, [{ op: "remove", collectionId: "docencia", id }]);
    expect(del.status).toBe(200);
    expect((await snapshot(token)).rows.some((x) => x.id === id)).toBe(false);
    expect(store.get(id)?.entity.deleted).toBeDefined();
  });
});

describe("a calendar's reminders", () => {
  it("are kept in its definition, and devices see them", async () => {
    const token = await session();
    const put = (body: unknown) =>
      fetch(`${base}/api/collections/reminders`, {
        method: "PUT",
        headers: auth(token),
        body: JSON.stringify(body),
      });
    const raw = () => calendarDefs(store).find((p) => p.def.id === "docencia")?.raw ?? {};
    expect(
      (await put({ collectionId: "docencia", reminders: { timed: "10m, nada", allDay: "" } }))
        .status,
    ).toBe(200);
    expect(raw().reminders).toEqual({ timed: "10m", allDay: "none" });
    const snap = await snapshot(token);
    expect(snap.views.find((v) => v.id === "docencia")?.reminders?.timed).toEqual([
      { kind: "before", minutes: 10 },
    ]);
    // The column for an event's own reminders, once.
    expect((await put({ collectionId: "docencia", eventColumn: true })).status).toBe(200);
    expect((raw().mapping as { reminders?: string }).reminders).toBe("avisos");
    expect((await put({ collectionId: "docencia", reminders: null })).status).toBe(200);
    expect(raw().reminders).toBeUndefined();
    expect((await put({ collectionId: "nada", reminders: null })).status).toBe(409);
  });
});

describe("the server's code", () => {
  it("runs with Node's type stripping, like in its container (no TypeScript-only syntax)", () => {
    // Vitest compiles TypeScript itself; Node only strips types, so check the real loader too.
    const out = execFileSync(
      process.execPath,
      [
        "--disable-warning=ExperimentalWarning",
        "--input-type=module",
        "-e",
        `for (const f of ["./http.ts", "./calendarStore.ts", "./auth.ts", "./db.ts"]) await import(new URL(f, ${JSON.stringify(import.meta.url)}).href); console.log("ok")`,
      ],
      { encoding: "utf8" },
    );
    expect(out.trim()).toBe("ok");
  });
});

describe("a read-only server", () => {
  it("says so and refuses writes", async () => {
    const server = makeServer({
      db,
      key: randomBytes(32),
      feeds: new Feeds(async () => ""),
      agent: host,
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const token = await session();
    const me = (await (await fetch(`${url}/api/me`, { headers: auth(token) })).json()) as {
      write: boolean;
    };
    expect(me.write).toBe(false);
    const r = await fetch(`${url}/api/apply`, {
      method: "POST",
      headers: auth(token),
      body: JSON.stringify({ base: 1, changes: [] }),
    });
    expect(r.status).toBe(403);
    server.closeAllConnections();
    server.close();
  });
});
