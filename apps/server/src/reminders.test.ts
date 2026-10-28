import { mkdtempSync, rmSync } from "node:fs";
import { createServer as createHttp, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fromLocal, todayIn } from "@boni/calendar";
import { label } from "@boni/entities";
import type { UserStore } from "@boni/store";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AgentHost } from "./agent.ts";
import { addUser } from "./auth.ts";
import { type Db, openDb } from "./db.ts";
import { Feeds } from "./feeds.ts";
import { makeServer } from "./http.ts";
import { Push } from "./reminders.ts";
import { loadKey } from "./secret.ts";
import { calendarDef, seed } from "./seed.test-util.ts";

/** Phase 5: the account's reminders for a device that is not running the calendar, and UnifiedPush. */
const PASSWORD = "una contraseña larga de ejemplo";
const TZ = "Europe/Madrid";
const tomorrow = todayIn(TZ) + 1;
const iso = (day: number) => new Date(day * 86_400_000).toISOString().slice(0, 10);
const at = (h: number, m = 0) => fromLocal(tomorrow, h * 60 + m, TZ);

let dir: string;
let db: Db;
let agent: AgentHost;
let store: UserStore;
let push: Push;
let base: string;
let server: ReturnType<typeof makeServer>;
let distributor: HttpServer;
let distributorUrl: string;
const posted: { url: string; auth: string; body: string }[] = [];
let gone = false;

const lesson = (title: string, start: string) =>
  `---\ntitle: "${title}"\ndate: "${iso(tomorrow)}"\nstartTime: "${start}"\nendTime: "11:00"\nlocation: "Aula 1"\ncompleted:\n---\n`;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "boni-server-reminders-"));
  db = openDb(join(dir, "db.sqlite"));
  addUser(db, "juan", PASSWORD);
  agent = new AgentHost({ dataDir: dir, providers: null });
  store = agent.store(1);
  seed(
    store,
    [
      {
        key: "docencia",
        name: "Docencia",
        folder: "agenda/docencia/",
        calendar: {
          ...calendarDef("docencia", "Docencia", "agenda/docencia"),
          reminders: { timed: "10m", allDay: "0d@09:00" },
        },
      },
    ],
    {
      [`agenda/docencia/${iso(tomorrow)} Clase de ejemplo.md`]: lesson("Clase de ejemplo", "10:00"),
    },
  );
  // The UnifiedPush distributor (the ntfy server) as a test double.
  distributor = createHttp((req, res) => {
    let body = "";
    req.on("data", (c) => {
      body += c;
    });
    req.on("end", () => {
      posted.push({ url: req.url ?? "", auth: req.headers.authorization ?? "", body });
      res.writeHead(gone ? 410 : 200).end();
    });
  });
  await new Promise<void>((r) => distributor.listen(0, "127.0.0.1", () => r()));
  const host = `127.0.0.1:${(distributor.address() as AddressInfo).port}`;
  distributorUrl = `http://${host}/upInventado123?up=1`;
  push = new Push(db, { hosts: [host], token: "tk_inventado", delayMs: 50 });
  const feed = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "BEGIN:VEVENT",
    "UID:externo@example.com",
    `DTSTART:${iso(tomorrow).replaceAll("-", "")}T150000Z`,
    `DTEND:${iso(tomorrow).replaceAll("-", "")}T160000Z`,
    "SUMMARY:Reunión externa",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  server = makeServer({
    db,
    key: loadKey(join(dir, "db.sqlite")),
    feeds: new Feeds(async () => feed),
    push,
    agent,
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  push.close();
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  distributor.close();
  agent.close();
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

async function session() {
  const r = await fetch(`${base}/api/login`, {
    method: "POST",
    body: JSON.stringify({ user: "juan", password: PASSWORD, device: "Android" }),
  });
  return ((await r.json()) as { token: string }).token;
}
const call = (token: string, method: string, path: string, body?: unknown) =>
  fetch(`${base}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
type Notice = { title: string; body: string; at: number };
const notices = async (token: string, q = "") =>
  (
    (await (await call(token, "GET", `/api/reminders?tz=${TZ}&hours=72${q}`)).json()) as {
      notices: Notice[];
    }
  ).notices;

describe("the account's reminders", () => {
  it("are worded for the device, from the calendar's definition and the external calendars that remind", async () => {
    const t = await session();
    expect(await notices(t)).toEqual([
      expect.objectContaining({
        title: "Clase de ejemplo",
        body: "Mañana, 10:00–11:00 · Aula 1",
        at: at(9, 50),
      }),
    ]);
    expect((await notices(t, "&locale=en&h24=0"))[0]?.body).toBe("Tomorrow, 10 AM–11 AM · Aula 1");

    const ext = {
      id: "ext-trabajo",
      name: "Trabajo",
      url: "https://example.com/t.ics",
      color: "#f00",
    };
    await call(t, "PUT", "/api/account/externals", {
      externals: [{ ...ext, reminders: { timed: "1h", allDay: "none" } }],
    });
    const list = await notices(t);
    expect(list.map((n) => n.title)).toEqual(["Clase de ejemplo", "Reunión externa"]);
    expect((await call(t, "GET", "/api/reminders?tz=Nowhere/Nada")).status).toBe(400);
  });
});

describe("UnifiedPush", () => {
  it("only accepts the distributor's addresses, and tells the device when something changes", async () => {
    const t = await session();
    expect(
      (await call(t, "PUT", "/api/push", { endpoint: "https://elsewhere.example.com/up" })).status,
    ).toBe(400);
    expect((await call(t, "PUT", "/api/push", { endpoint: distributorUrl })).status).toBe(200);
    posted.length = 0;
    // A new class, made in Boni (a page, the MCP): the calendar sees it and tells the device.
    const l = label("user", "personal", []);
    store.create(
      "t_docencia",
      {
        f_title: { value: "Otra clase", label: l },
        f_date: { value: iso(tomorrow), label: l },
        f_starttime: { value: "10:30", label: l },
      },
      { actor: "user", device: "boni" },
    );
    await expect.poll(() => posted.length, { timeout: 5000 }).toBeGreaterThan(0);
    expect(posted[0]).toEqual({
      url: "/upInventado123?up=1",
      auth: "Bearer tk_inventado",
      body: "reminders",
    });
    // The distributor forgot the address: the server stops posting there.
    gone = true;
    await call(t, "PUT", "/api/account/prefs", { prefs: { h24: true } });
    await expect
      .poll(() => (db.prepare("SELECT COUNT(*) AS n FROM push").get() as { n: number }).n, {
        timeout: 5000,
      })
      .toBe(0);
  });
});
