import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Row } from "@boni/calendar";
import { definitionNote } from "@boni/calendar-web/src/vault/testing.ts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addUser } from "./auth.ts";
import { type Db, openDb } from "./db.ts";
import { Feeds } from "./feeds.ts";
import { makeServer } from "./http.ts";
import { Vaults } from "./vaults.ts";

/** Writing through the server (BONI_WRITE): the apps' writer, with a version check per row. */
const LESSON = "agenda/docencia/2026-10-19 Clase de ejemplo.md";
const lesson = `---\ntitle: "Clase de ejemplo"\ndate: "2026-10-19"\nstartTime: "10:00"\nendTime: "11:00"\nlocation: "Aula 1"\nnotion_id: "x"\ncompleted:\n---\nArea: [[docencia]]\n\n## Notas\n`;

let dir: string;
let db: Db;
let vaults: Vaults;
let base: string;
let close: () => Promise<void>;
const vaultPath = (rel: string) => join(dir, "vault", rel);

function write(rel: string, text: string) {
  mkdirSync(dirname(vaultPath(rel)), { recursive: true });
  writeFileSync(vaultPath(rel), text);
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "boni-server-write-"));
  write(
    "_system/colecciones/docencia.md",
    definitionNote("docencia", "Docencia", "agenda/docencia", "docencia"),
  );
  write(LESSON, lesson);
  db = openDb(":memory:");
  addUser(db, "juan", "una contraseña larga de ejemplo", join(dir, "vault"));
  vaults = new Vaults({ write: true });
  const server = makeServer({ db, vaults, key: randomBytes(32), feeds: new Feeds(async () => "") });
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
  vaults.close();
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

async function session() {
  const r = await fetch(`${base}/api/login`, {
    method: "POST",
    body: JSON.stringify({
      user: "juan",
      password: "una contraseña larga de ejemplo",
      device: "prueba",
    }),
  });
  return ((await r.json()) as { token: string }).token;
}
const auth = (token: string) => ({ authorization: `Bearer ${token}` });
async function snapshot(token: string) {
  return (await (await fetch(`${base}/api/snapshot`, { headers: auth(token) })).json()) as {
    version: number;
    rows: Row[];
    views: { readOnly?: boolean }[];
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

describe("writing through the server", () => {
  it("changes only the edited lines of a note, and the calendars are writable", async () => {
    const token = await session();
    const snap = await snapshot(token);
    expect(snap.views.every((v) => !v.readOnly)).toBe(true);
    const row = snap.rows.find((r) => r.id === LESSON) as Row;
    const r = await apply(token, snap.version, [
      { op: "upsert", row: { ...row, values: { ...row.values, location: "Aula 2" } } },
    ]);
    expect(r.status).toBe(200);
    expect(r.body.version).toBeGreaterThan(snap.version);
    expect(readFileSync(vaultPath(LESSON), "utf8")).toBe(lesson.replace('"Aula 1"', '"Aula 2"'));

    // The same device writes again with the version it had: its own write is not a conflict.
    const again = await apply(token, snap.version, [
      { op: "upsert", row: { ...row, values: { ...row.values, location: "Aula 3" } } },
    ]);
    expect(again.status).toBe(200);
    expect(readFileSync(vaultPath(LESSON), "utf8")).toContain('location: "Aula 3"');
  });

  it("refuses to write over a note changed elsewhere after the device's version", async () => {
    const token = await session();
    const other = await session(); // another device of the same account
    const snap = await snapshot(token);
    const row = snap.rows.find((r) => r.id === LESSON) as Row;
    // Changed in Obsidian (arrives by Syncthing) after this device took its snapshot.
    write(
      LESSON,
      readFileSync(vaultPath(LESSON), "utf8").replace("## Notas", "## Notas\nEscrito en Obsidian"),
    );
    const r = await apply(token, snap.version, [
      { op: "upsert", row: { ...row, values: { ...row.values, title: "Pisada" } } },
    ]);
    expect(r.status).toBe(409);
    expect(r.body.conflict).toEqual([LESSON]);
    expect(readFileSync(vaultPath(LESSON), "utf8")).toContain("Escrito en Obsidian");
    expect(readFileSync(vaultPath(LESSON), "utf8")).not.toContain("Pisada");
    // With the new version it goes through; a change by another device also counts as a conflict.
    const fresh = await snapshot(other);
    const row2 = fresh.rows.find((x) => x.id === LESSON) as Row;
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

  it("makes a note of a new row and says its path; a removed row goes to the vault's trash", async () => {
    const token = await session();
    const snap = await snapshot(token);
    const model = snap.rows.find((r) => r.id === LESSON) as Row;
    const draft: Row = {
      ...model,
      id: "ev-temporal-1",
      values: { title: "Cena inventada", date: "2026-10-24", startTime: "21:00", endTime: "23:00" },
    };
    const r = await apply(token, snap.version, [{ op: "upsert", row: draft }]);
    expect(r.status).toBe(200);
    const path = "agenda/docencia/2026-10-24 Cena inventada.md";
    expect(r.body.aliases).toEqual({ "ev-temporal-1": path });
    expect(readFileSync(vaultPath(path), "utf8")).toContain('title: "Cena inventada"');
    expect(readFileSync(vaultPath(path), "utf8")).toContain("Area: [[docencia]]");

    const now = await snapshot(token);
    const del = await apply(token, now.version, [
      { op: "remove", collectionId: "docencia", id: path },
    ]);
    expect(del.status).toBe(200);
    expect(existsSync(vaultPath(path))).toBe(false);
    expect(readdirSync(vaultPath(".trash"))).toContain("2026-10-24 Cena inventada.md");
  });
});

describe("a calendar's reminders", () => {
  it("are written in its definition note, only those lines, and devices see them", async () => {
    const token = await session();
    const path = "_system/colecciones/docencia.md";
    const before = readFileSync(vaultPath(path), "utf8");
    const put = (body: unknown) =>
      fetch(`${base}/api/collections/reminders`, {
        method: "PUT",
        headers: auth(token),
        body: JSON.stringify(body),
      });
    expect(
      (await put({ collectionId: "docencia", reminders: { timed: "10m, nada", allDay: "" } }))
        .status,
    ).toBe(200);
    const after = readFileSync(vaultPath(path), "utf8");
    expect(after.split("\n").filter((l) => !before.split("\n").includes(l))).toEqual([
      "  reminders: { timed: 10m, allDay: none }",
    ]);
    const snap = (await snapshot(token)) as unknown as {
      views: { id: string; reminders?: { timed: unknown[] } }[];
    };
    expect(snap.views.find((v) => v.id === "docencia")?.reminders?.timed).toEqual([
      { kind: "before", minutes: 10 },
    ]);
    // The column for an event's own reminders, once.
    expect((await put({ collectionId: "docencia", eventColumn: true })).status).toBe(200);
    expect(readFileSync(vaultPath(path), "utf8")).toContain("reminders: avisos");
    expect((await put({ collectionId: "docencia", reminders: null })).status).toBe(200);
    expect(readFileSync(vaultPath(path), "utf8")).not.toContain("timed:");
    expect((await put({ collectionId: "nada", reminders: null })).status).toBe(500);
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
        `for (const f of ["./http.ts", "./vaults.ts", "./auth.ts", "./db.ts"]) await import(new URL(f, ${JSON.stringify(import.meta.url)}).href); console.log("ok")`,
      ],
      { encoding: "utf8" },
    );
    expect(out.trim()).toBe("ok");
  });
});

describe("a read-only server", () => {
  it("says so and refuses writes", async () => {
    const ro = new Vaults();
    const server = makeServer({
      db,
      vaults: ro,
      key: randomBytes(32),
      feeds: new Feeds(async () => ""),
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
    ro.close();
  });
});
