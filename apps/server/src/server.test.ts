import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { label } from "@boni/entities";
import type { UserStore } from "@boni/store";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AgentHost } from "./agent.ts";
import { addUser, hashPassword, verifyPassword } from "./auth.ts";
import { type Db, openDb } from "./db.ts";
import { Feeds } from "./feeds.ts";
import { makeServer } from "./http.ts";
import { calendarDef, seed } from "./seed.test-util.ts";

const note = (title: string, date: string) =>
  `---\ntitle: "${title}"\ndate: "${date}"\nstartTime: "10:00"\nendTime: "11:00"\ncompleted:\n---\n`;

let dir: string;
let db: Db;
let host: AgentHost;
let store: UserStore;
let ids: Map<string, string>;
let base: string;
let close: () => Promise<void>;
const started = Date.now();

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "boni-server-"));
  mkdirSync(join(dir, "web"));
  writeFileSync(join(dir, "web", "index.html"), "<!doctype html><title>Boni Calendar</title>");
  db = openDb(":memory:");
  addUser(db, "juan", "una contraseña larga de ejemplo");
  addUser(db, "otra", "otra contraseña larga de ejemplo");
  // An invented calendar (never real notes) in the account's store, and a collection that is no calendar.
  host = new AgentHost({ dataDir: dir, providers: null });
  store = host.store(1);
  ids = seed(
    store,
    [
      {
        key: "docencia",
        name: "Docencia",
        folder: "agenda/docencia/",
        calendar: calendarDef("docencia", "Docencia", "agenda/docencia"),
      },
      { key: "diario", name: "Diario", folder: "diario/", zone: "private" },
    ],
    {
      "agenda/docencia/2026-10-19 Clase de ejemplo.md": note("Clase de ejemplo", "2026-10-19"),
      "agenda/docencia/2026-10-20 Tutoría inventada.md": note("Tutoría inventada", "2026-10-20"),
      "diario/2026-10-19.md": note("Nunca", "2026-10-19"),
    },
  );
  const server = makeServer({
    db,
    key: randomBytes(32),
    feeds: new Feeds(async () => ""),
    webDir: join(dir, "web"),
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

afterEach(async () => {
  await close();
  host.close();
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

async function loginAs(user = "juan", password = "una contraseña larga de ejemplo") {
  const r = await fetch(`${base}/api/login`, {
    method: "POST",
    body: JSON.stringify({ user, password, device: "prueba" }),
  });
  return { status: r.status, body: (await r.json()) as { token?: string } };
}
const get = (path: string, token?: string) =>
  fetch(`${base}${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });

describe("accounts", () => {
  it("keeps only a salted hash of the password", () => {
    const h = hashPassword("una contraseña larga de ejemplo");
    expect(h).not.toContain("contraseña");
    expect(verifyPassword("una contraseña larga de ejemplo", h)).toBe(true);
    expect(verifyPassword("otra cosa", h)).toBe(false);
    expect(hashPassword("x".repeat(12))).not.toBe(hashPassword("x".repeat(12)));
  });

  it("logs a device in, and nothing works without a session", async () => {
    expect((await loginAs("juan", "mal")).status).toBe(401);
    expect((await loginAs("nadie", "una contraseña larga de ejemplo")).status).toBe(401);
    expect((await get("/api/snapshot")).status).toBe(401);
    expect((await get("/api/snapshot", "inventado")).status).toBe(401);
    const { status, body } = await loginAs();
    expect(status).toBe(200);
    const me = await get("/api/me", body.token);
    expect(await me.json()).toEqual({ user: { name: "juan" }, write: false });
    await fetch(`${base}/api/logout`, {
      method: "POST",
      headers: { authorization: `Bearer ${body.token}` },
    });
    expect((await get("/api/me", body.token)).status).toBe(401);
  });

  it("refuses weak passwords and odd names", () => {
    expect(() => addUser(db, "x", "una contraseña larga de ejemplo")).toThrow();
    expect(() => addUser(db, "corto", "corta")).toThrow();
  });
});

describe("the calendar from the server", () => {
  it("sends the calendars' definitions and rows, nothing of the other collections", async () => {
    const { body } = await loginAs();
    const snap = (await (await get("/api/snapshot", body.token)).json()) as {
      version: number;
      collections: { id: string }[];
      rows: { id: string; values: Record<string, unknown> }[];
    };
    // Versions start from the clock: they keep growing when the server starts again.
    expect(snap.version).toBeGreaterThanOrEqual(started);
    expect(snap.collections.map((c) => c.id)).toEqual(["docencia"]);
    expect(snap.rows.map((r) => r.id).sort()).toEqual([
      "agenda/docencia/2026-10-19 Clase de ejemplo.md",
      "agenda/docencia/2026-10-20 Tutoría inventada.md",
    ]);
    expect(JSON.stringify(snap)).not.toContain("Nunca");
  });

  it("tells what changed since a version, and streams it live", async () => {
    const { body } = await loginAs();
    const token = body.token as string;
    const first = ((await (await get("/api/snapshot", token)).json()) as { version: number })
      .version;

    // Live: read the event stream while an entry changes and another appears outside the calendar (Boni's pages,
    // the MCP, the agent write the same store).
    const ctrl = new AbortController();
    const stream = await fetch(`${base}/api/stream`, {
      headers: { authorization: `Bearer ${token}` },
      signal: ctrl.signal,
    });
    const reader = (stream.body as ReadableStream<Uint8Array>).getReader();
    let text = "";
    const until = async (pred: (t: string) => boolean) => {
      while (!pred(text)) {
        const { value, done } = await reader.read();
        if (done) break;
        text += new TextDecoder().decode(value);
      }
    };
    await until((t) => t.includes(": connected"));
    const l = label("user", "personal", [{ kind: "user-edit", id: "boni" }]);
    const meta = { actor: "user" as const, device: "boni" };
    store.update(
      ids.get("agenda/docencia/2026-10-19 Clase de ejemplo.md") as string,
      { f_title: { value: "Clase cambiada", label: l } },
      meta,
    );
    const made = store.create(
      "t_docencia",
      { f_title: { value: "Nueva", label: l }, f_date: { value: "2026-10-21", label: l } },
      meta,
    );
    await until((t) => t.includes("Nueva") && t.includes("Clase cambiada"));
    ctrl.abort();
    expect(text).toContain("event: changes");

    const changes = (await (await get(`/api/changes?since=${first}`, token)).json()) as {
      version: number;
      full?: boolean;
      upserts: { id: string; values: { title: string } }[];
      removes: string[];
    };
    expect(changes.full).toBeUndefined();
    expect(changes.upserts.map((r) => r.values.title).sort()).toEqual(["Clase cambiada", "Nueva"]);
    expect(changes.removes).toEqual([]);

    // An entry sent to the trash is a removal; an unknown future version asks for a new snapshot.
    store.remove(made.entity.id, meta);
    const later = (await (
      await get(`/api/changes?since=${changes.version}`, token)
    ).json()) as Changes;
    expect(later.removes).toEqual([made.entity.id]);
    const lost = (await (
      await get(`/api/changes?since=${later.version + 999}`, token)
    ).json()) as Changes;
    expect(lost.full).toBe(true);
  });

  it("lets the apps call it from their own origin (token, no cookies)", async () => {
    const pre = await fetch(`${base}/api/snapshot`, {
      method: "OPTIONS",
      headers: { origin: "app://example", "access-control-request-headers": "authorization" },
    });
    expect(pre.status).toBe(204);
    expect(pre.headers.get("access-control-allow-headers")).toContain("authorization");
    expect((await get("/api/me")).headers.get("access-control-allow-origin")).toBe("*");
  });

  it("serves the web app to a browser, and nothing outside it", async () => {
    expect(await (await get("/")).text()).toContain("Boni Calendar");
    expect((await get("/../../etc/passwd")).status).toBe(404);
    expect((await get("/%2e%2e/users/1.db")).status).toBe(404);
  });
});

type Changes = { version: number; full?: boolean; upserts: unknown[]; removes: string[] };
