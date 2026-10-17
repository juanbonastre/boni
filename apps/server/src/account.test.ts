import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer as createHttp, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { definitionNote } from "@boni-calendar/web/src/vault/testing.ts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addUser } from "./auth.ts";
import { type Db, openDb } from "./db.ts";
import { Feeds, isPrivateAddress, makeFetcher } from "./feeds.ts";
import { makeServer } from "./http.ts";
import { decrypt, encrypt, loadKey } from "./secret.ts";
import { Vaults } from "./vaults.ts";

/** Phase 4: preferences and external calendars kept per account on the server. */
const PASSWORD = "una contraseña larga de ejemplo";
const SECRET_URL = "https://calendar.example.com/ical/privado-inventado/basic.ics";
const ICS = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n";

let dir: string;
let db: Db;
let vaults: Vaults;
let base: string;
let server: Server;
const fetched: string[] = [];

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "boni-server-account-"));
  const def = join(dir, "vault", "_system/colecciones/docencia.md");
  mkdirSync(dirname(def), { recursive: true });
  writeFileSync(def, definitionNote("docencia", "Docencia", "agenda/docencia", "docencia"));
  db = openDb(join(dir, "db.sqlite"));
  addUser(db, "juan", PASSWORD, join(dir, "vault"));
  addUser(db, "otra", PASSWORD, join(dir, "vault"));
  vaults = new Vaults();
  const feeds = new Feeds(async (url) => {
    fetched.push(url);
    if (url.includes("roto")) throw new Error("HTTP 404");
    return ICS;
  });
  server = makeServer({ db, vaults, key: loadKey(join(dir, "db.sqlite")), feeds });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  vaults.close();
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

async function session(user = "juan") {
  const r = await fetch(`${base}/api/login`, {
    method: "POST",
    body: JSON.stringify({ user, password: PASSWORD, device: "prueba" }),
  });
  return ((await r.json()) as { token: string }).token;
}
const call = (token: string, method: string, path: string, body?: unknown) =>
  fetch(`${base}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

describe("the account on the server", () => {
  it("keeps preferences and external calendars for all the account's devices, not for others", async () => {
    const phone = await session();
    const laptop = await session();
    expect(await (await call(phone, "GET", "/api/account")).json()).toEqual({
      prefs: {},
      externals: [],
      updated: 0,
    });
    const cal = { id: "ext-abc123", name: "Trabajo", url: SECRET_URL, color: "#3b82f6" };
    expect((await call(laptop, "PUT", "/api/account/externals", { externals: [cal] })).status).toBe(
      200,
    );
    expect(
      (await call(laptop, "PUT", "/api/account/prefs", { prefs: { h24: false } })).status,
    ).toBe(200);
    const acc = (await (await call(phone, "GET", "/api/account")).json()) as Record<
      string,
      unknown
    >;
    expect(acc.externals).toEqual([cal]);
    expect(acc.prefs).toEqual({ h24: false });
    // Another account sees nothing of it.
    const other = await session("otra");
    expect(
      ((await (await call(other, "GET", "/api/account")).json()) as { externals: [] }).externals,
    ).toEqual([]);
  });

  it("stores the calendars' addresses encrypted, with a key made once next to the database", () => {
    const stored = (
      db.prepare("SELECT value FROM account_data WHERE key = 'externals'").all() as {
        value: string;
      }[]
    ).map((r) => r.value);
    expect(stored.join("\n")).not.toContain("privado-inventado");
    expect(stored.join("\n")).toMatch(/^v1\./);
    const keyFile = join(dir, "secret.key");
    expect(statSync(keyFile).mode & 0o777).toBe(0o600);
    expect(
      loadKey(join(dir, "db.sqlite")).equals(Buffer.from(readFileSync(keyFile, "utf8"), "base64")),
    ).toBe(true);
    const k = randomBytes(32);
    expect(decrypt(k, encrypt(k, "hola"))).toBe("hola");
    expect(() => decrypt(randomBytes(32), encrypt(k, "hola"))).toThrow();
  });

  it("refuses what is not a list of calendars or plain preferences", async () => {
    const t = await session();
    const bad = [
      [{ id: "x", name: "a", url: SECRET_URL, color: "#fff" }],
      [{ id: "ext-a", name: "a", url: "file:///etc/passwd", color: "#fff" }],
      "nope",
    ];
    for (const externals of bad)
      expect((await call(t, "PUT", "/api/account/externals", { externals })).status).toBe(400);
    expect((await call(t, "PUT", "/api/account/prefs", { prefs: { a: { b: 1 } } })).status).toBe(
      400,
    );
  });

  it("downloads an external calendar for the device, and says when it cannot", async () => {
    const t = await session();
    const r = await call(t, "GET", "/api/external?id=ext-abc123");
    expect(r.status).toBe(200);
    expect(((await r.json()) as { text: string }).text).toBe(ICS);
    await call(t, "GET", "/api/external?id=ext-abc123"); // a fresh copy is reused
    expect(fetched.filter((u) => u === SECRET_URL)).toHaveLength(1);
    await call(t, "GET", "/api/external?id=ext-abc123&fresh=1");
    expect(fetched.filter((u) => u === SECRET_URL)).toHaveLength(2);
    expect((await call(t, "GET", "/api/external?id=ext-nada")).status).toBe(404);
    const broken = {
      id: "ext-roto",
      name: "Roto",
      url: "https://example.com/roto.ics",
      color: "#f00",
    };
    await call(t, "PUT", "/api/account/externals", { externals: [broken] });
    const e = await call(t, "GET", "/api/external?id=ext-roto");
    expect(e.status).toBe(502);
    expect(await e.json()).toEqual({ error: "feed", message: "HTTP 404" });
  });

  it("tells the account's live streams when its calendars or preferences change", async () => {
    const t = await session();
    const ctrl = new AbortController();
    const stream = await fetch(`${base}/api/stream`, {
      headers: { authorization: `Bearer ${t}` },
      signal: ctrl.signal,
    });
    const reader = (stream.body as ReadableStream<Uint8Array>).getReader();
    let text = "";
    const until = async (pred: (s: string) => boolean) => {
      while (!pred(text)) {
        const { value, done } = await reader.read();
        if (done) break;
        text += new TextDecoder().decode(value);
      }
    };
    await until((s) => s.includes(": connected"));
    await call(await session(), "PUT", "/api/account/prefs", { prefs: { firstDay: 0 } });
    await until((s) => s.includes("event: account"));
    ctrl.abort();
    expect(text).toMatch(/event: account\ndata: \{"updated":\d+\}/);
  });
});

describe("downloading calendars", () => {
  it("never reaches private addresses: the NAS, the tailnet, loopback", async () => {
    for (const ip of [
      "127.0.0.1",
      "10.0.0.5",
      "192.168.1.10",
      "172.20.0.2",
      "100.101.102.103",
      "169.254.1.1",
      "::1",
      "fd7a:115c:a1e0::1",
      "::ffff:192.168.1.1",
    ])
      expect(isPrivateAddress(ip), ip).toBe(true);
    for (const ip of ["8.8.8.8", "142.250.200.14", "2a00:1450:4003:80e::200e"])
      expect(isPrivateAddress(ip), ip).toBe(false);
    const fetchFeed = makeFetcher();
    await expect(fetchFeed("http://127.0.0.1:9/x.ics")).rejects.toThrow("not public");
    await expect(fetchFeed("http://localhost:9/x.ics")).rejects.toThrow("not public");
    await expect(fetchFeed("file:///etc/passwd")).rejects.toThrow("http(s)");
  });

  it("follows redirects and reads the calendar (private addresses allowed only for tests)", async () => {
    const target = createHttp((req, res) => {
      if (req.url === "/old.ics") {
        res.writeHead(302, { location: "/new.ics" });
        return void res.end();
      }
      res.end(ICS);
    });
    await new Promise<void>((r) => target.listen(0, "127.0.0.1", () => r()));
    const port = (target.address() as AddressInfo).port;
    // Every hop goes through the same address check (with private addresses refused, see above).
    const local = makeFetcher({ allowPrivate: true });
    expect(await local(`http://127.0.0.1:${port}/old.ics`)).toBe(ICS);
    target.close();
  });
});
