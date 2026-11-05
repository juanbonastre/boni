import { mkdtempSync, rmSync } from "node:fs";
import { createServer as createHttp, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fakePlanner } from "@boni/agent";
import { fromLocal, todayIn } from "@boni/calendar";
import { label } from "@boni/entities";
import type { UserStore } from "@boni/store";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AgentHost } from "./agent.ts";
import { addUser } from "./auth.ts";
import { type Db, openDb } from "./db.ts";
import { Feeds } from "./feeds.ts";
import { FlowScheduler } from "./flowScheduler.ts";
import { makeServer } from "./http.ts";
import { NOTICES_PER_HOUR, Push } from "./reminders.ts";
import { loadKey } from "./secret.ts";
import { calendarDef, seed } from "./seed.test-util.ts";
import { decrypt, deviceKeys } from "./webpush.test-util.ts";

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
let distributorHost: string;
const pushLog: string[] = [];
const posted: { url: string; auth: string; body: string }[] = [];
/** What the distributor took, as bytes and with the headers that say how it is sealed (Boni's notices, task 62). */
const raw: { url: string; body: Buffer; headers: Record<string, string | string[] | undefined> }[] =
  [];
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
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      chunks.push(c);
    });
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      posted.push({
        url: req.url ?? "",
        auth: req.headers.authorization ?? "",
        body: body.toString(),
      });
      raw.push({ url: req.url ?? "", body, headers: req.headers });
      res.writeHead(gone ? 410 : 200).end();
    });
  });
  await new Promise<void>((r) => distributor.listen(0, "127.0.0.1", () => r()));
  const host = `127.0.0.1:${(distributor.address() as AddressInfo).port}`;
  distributorUrl = `http://${host}/upInventado123?up=1`;
  distributorHost = host;
  push = new Push(db, {
    hosts: [host],
    token: "tk_inventado",
    delayMs: 50,
    log: (l) => pushLog.push(l),
  });
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

async function session(user = "juan", device = "Android") {
  const r = await fetch(`${base}/api/login`, {
    method: "POST",
    body: JSON.stringify({ user, password: PASSWORD, device }),
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

describe("Boni's notices by UnifiedPush (task 62, A-17)", () => {
  // The distributor knows every address again (the test above made it forget them).
  beforeEach(() => {
    gone = false;
  });
  /** What a device of `keys` reads from what the distributor took for `topic`. */
  const opened = (topic: string, keys: ReturnType<typeof deviceKeys>) =>
    raw
      .filter((r) => r.url.startsWith(`/${topic}`))
      .map((r) => JSON.parse(decrypt(r.body, keys.keys, keys.privateKey).toString()));

  it("a scheduled flow's «Avisar» reaches the phone with Boni closed, sealed for it alone; the calendar's address only hears «reminders»", async () => {
    const phone = deviceKeys();
    const boni = await session("juan", "pixel-boni");
    const calendarApp = await session("juan", "pixel-calendario");
    const url = (topic: string) => `http://${distributorHost}/${topic}?up=1`;
    // Boni's app gives its keys with its address; without them, or with keys no device makes, it is refused.
    expect(
      (await call(boni, "PUT", "/api/push", { endpoint: url("upBoni1"), for: "notices" })).status,
    ).toBe(400);
    expect(
      (
        await call(boni, "PUT", "/api/push", {
          endpoint: url("upBoni1"),
          for: "notices",
          keys: { p256dh: "corta", auth: phone.keys.auth },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call(boni, "PUT", "/api/push", {
          endpoint: url("upBoni1"),
          for: "notices",
          keys: phone.keys,
        })
      ).status,
    ).toBe(200);
    expect((await call(calendarApp, "PUT", "/api/push", { endpoint: url("upCal1") })).status).toBe(
      200,
    );
    raw.length = 0;

    // The 08:00 summary, a flow drawn without code: «Avisar» with the day. The agent runs it as work of its own.
    agent.providersFor = () => ({ planner: fakePlanner([]), reader: fakePlanner([]) });
    const clock = Date.parse("2026-11-06T07:00:30Z");
    store.journal.saveFlow({
      id: "resumen",
      name: "Resumen diario",
      trigger: { schedule: { every: "day", at: "08:00" } },
      inputs: [],
      plan: {
        version: 1,
        steps: [{ id: "a", op: "call", tool: "notify", args: { text: { ref: "$today" } } }],
      },
      layout: null,
      by: "user",
      enabled: true,
      created: clock - 86_400_000,
    });
    const lines: string[] = [];
    const scheduler = new FlowScheduler({
      host: agent,
      accounts: () => [1],
      tz: TZ,
      now: () => clock,
      log: (l) => lines.push(l),
    });
    await Promise.all(scheduler.tick());
    agent.providersFor = null;
    expect(lines).toEqual(["flows 1: «Resumen diario» v1 (2026-11-06 08:00): done"]);
    await expect.poll(() => raw.filter((r) => r.url.startsWith("/upBoni1")).length).toBe(1);
    const [notice] = opened("upBoni1", phone);
    expect(notice).toMatchObject({ kind: "notice", text: "2026-11-06" });
    expect(typeof notice.id).toBe("string");
    const sent = raw.find((r) => r.url.startsWith("/upBoni1"));
    expect(sent?.headers).toMatchObject({
      authorization: "Bearer tk_inventado",
      "content-encoding": "aes128gcm",
      urgency: "high",
    });
    // The distributor holds bytes: not a word of the notice in the clear.
    expect(sent?.body.includes(Buffer.from("2026-11-06"))).toBe(false);
    expect(pushLog.at(-1)).toBe("push 1: notice sent to 1 of 1 devices");
    // Boni Calendar's address hears nothing of it.
    expect(raw.some((r) => r.url.startsWith("/upCal1"))).toBe(false);

    // A change of the calendar tells Boni Calendar, and never Boni's app.
    raw.length = 0;
    await call(calendarApp, "PUT", "/api/account/prefs", { prefs: { h24: false } });
    await expect.poll(() => raw.filter((r) => r.url.startsWith("/upCal1")).length).toBe(1);
    expect(raw.find((r) => r.url.startsWith("/upCal1"))?.body.toString()).toBe("reminders");
    await new Promise((r) => setTimeout(r, 120));
    expect(raw.some((r) => r.url.startsWith("/upBoni1"))).toBe(false);
  });

  it("only to the account's own devices, cut as `notify` cuts it, and at most ten an hour", async () => {
    addUser(db, "ana", PASSWORD);
    const mine = deviceKeys();
    const hers = deviceKeys();
    const url = (topic: string) => `http://${distributorHost}/${topic}?up=1`;
    await call(await session("juan", "pixel-boni-2"), "PUT", "/api/push", {
      endpoint: url("upJuan2"),
      for: "notices",
      keys: mine.keys,
    });
    await call(await session("ana", "movil-de-ana"), "PUT", "/api/push", {
      endpoint: url("upAna1"),
      for: "notices",
      keys: hers.keys,
    });
    raw.length = 0;
    const long = `Resumen: ${"x".repeat(600)}`;
    const p = new Push(db, { hosts: [distributorHost], token: "tk_inventado", log: () => {} });
    expect(await p.notice(1, long)).toBeGreaterThanOrEqual(1);
    const [notice] = opened("upJuan2", mine);
    expect(notice.text).toBe(long.slice(0, 500));
    expect(raw.some((r) => r.url.startsWith("/upAna1"))).toBe(false);
    // Past the cap, nothing more goes out within the hour (a flow that notifies in a loop).
    for (let i = 1; i < NOTICES_PER_HOUR; i++) await p.notice(1, `aviso ${i}`);
    const before = raw.length;
    expect(await p.notice(1, "uno de más")).toBe(0);
    expect(raw.length).toBe(before);
    p.close();
  });
});
