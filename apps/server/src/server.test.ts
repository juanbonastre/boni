import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { definitionNote } from "@boni-calendar/web/src/vault/testing.ts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addUser, hashPassword, verifyPassword } from "./auth.ts";
import { type Db, openDb } from "./db.ts";
import { makeServer } from "./http.ts";
import { Vaults } from "./vaults.ts";

const note = (title: string, date: string) =>
  `---\ntitle: "${title}"\ndate: "${date}"\nstartTime: "10:00"\nendTime: "11:00"\ncompleted:\n---\nArea: [[docencia]]\n`;

let dir: string;
let db: Db;
let vaults: Vaults;
let base: string;
let close: () => Promise<void>;

function write(rel: string, text: string) {
  mkdirSync(dirname(join(dir, "vault", rel)), { recursive: true });
  writeFileSync(join(dir, "vault", rel), text);
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "boni-server-"));
  write(
    "_system/colecciones/docencia.md",
    definitionNote("docencia", "Docencia", "agenda/docencia", "docencia"),
  );
  write("agenda/docencia/2026-10-19 Clase de ejemplo.md", note("Clase de ejemplo", "2026-10-19"));
  write("agenda/docencia/2026-10-20 Tutoría inventada.md", note("Tutoría inventada", "2026-10-20"));
  write("private/diario.md", note("Nunca", "2026-10-19"));
  mkdirSync(join(dir, "web"));
  writeFileSync(join(dir, "web", "index.html"), "<!doctype html><title>Boni Calendar</title>");
  db = openDb(":memory:");
  addUser(db, "juan", "una contraseña larga de ejemplo", join(dir, "vault"));
  addUser(db, "otra", "otra contraseña larga de ejemplo", join(dir, "vault"));
  vaults = new Vaults();
  const server = makeServer({ db, vaults, webDir: join(dir, "web") });
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
  vaults.close();
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
    expect(await me.json()).toEqual({ user: { name: "juan" } });
    await fetch(`${base}/api/logout`, {
      method: "POST",
      headers: { authorization: `Bearer ${body.token}` },
    });
    expect((await get("/api/me", body.token)).status).toBe(401);
  });

  it("refuses weak passwords and odd names", () => {
    expect(() => addUser(db, "x", "una contraseña larga de ejemplo", dir)).toThrow();
    expect(() => addUser(db, "corto", "corta", dir)).toThrow();
  });
});

describe("the calendar from the server", () => {
  it("sends the vault's definitions and rows, never the reserved zones", async () => {
    const { body } = await loginAs();
    const snap = (await (await get("/api/snapshot", body.token)).json()) as {
      version: number;
      collections: { id: string }[];
      rows: { id: string; values: Record<string, unknown> }[];
    };
    expect(snap.version).toBe(1);
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
    await get("/api/snapshot", token);

    // Live: read the event stream while a note changes and another appears outside the server.
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
    write("agenda/docencia/2026-10-19 Clase de ejemplo.md", note("Clase cambiada", "2026-10-19"));
    write("agenda/docencia/2026-10-21 Nueva.md", note("Nueva", "2026-10-21"));
    await until((t) => t.includes("Nueva") && t.includes("Clase cambiada"));
    ctrl.abort();
    expect(text).toContain("event: changes");

    const changes = (await (await get("/api/changes?since=1", token)).json()) as {
      version: number;
      full?: boolean;
      upserts: { id: string; values: { title: string } }[];
      removes: string[];
    };
    expect(changes.full).toBeUndefined();
    expect(changes.upserts.map((r) => r.values.title).sort()).toEqual(["Clase cambiada", "Nueva"]);
    expect(changes.removes).toEqual([]);

    // A deleted note is a removal; an unknown future version asks for a new snapshot.
    rmSync(join(dir, "vault", "agenda/docencia/2026-10-21 Nueva.md"));
    await new Promise((r) => setTimeout(r, 900));
    const later = (await (
      await get(`/api/changes?since=${changes.version}`, token)
    ).json()) as Changes;
    expect(later.removes).toEqual(["agenda/docencia/2026-10-21 Nueva.md"]);
    const lost = (await (await get("/api/changes?since=999", token)).json()) as Changes;
    expect(lost.full).toBe(true);
  });

  it("serves the web app to a browser, and nothing outside it", async () => {
    expect(await (await get("/")).text()).toContain("Boni Calendar");
    expect((await get("/../../etc/passwd")).status).toBe(404);
    expect((await get("/%2e%2e/vault/private/diario.md")).status).toBe(404);
  });
});

type Changes = { version: number; full?: boolean; upserts: unknown[]; removes: string[] };
