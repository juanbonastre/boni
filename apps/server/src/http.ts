import { readFile, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { formatReminderDefaults, parseReminderDefaults, type RowChange } from "@boni/calendar";
import { readAccount, saveExternals, savePrefs, validExternals, validPrefs } from "./account.ts";
import { type AgentHost, serveAgent } from "./agent.ts";
import { login, logout, sessionUser, tokenHash, type User, userOf } from "./auth.ts";
import type { Db } from "./db.ts";
import type { Feeds } from "./feeds.ts";
import { clientAddress, LoginGuard } from "./limits.ts";
import { noticesOfAccount, type Push } from "./reminders.ts";
import { bodyOf, CORS, header, SAFE, send, tokenOf } from "./reply.ts";
import { allowed, type Listener, ROUTES, routeOf } from "./routes.ts";
import type { SecretKey } from "./secret.ts";
import { serveV1 } from "./v1/http.ts";
import { V1Service } from "./v1/service.ts";
import { V1Store } from "./v1/store.ts";
import type { Vaults } from "./vaults.ts";

/**
 * The server's HTTP API (JSON), all under /api, every call but login with `Authorization: Bearer
 * <token>`:
 *   POST /api/login     { user, password, device } -> { token, user }
 *   POST /api/logout
 *   GET  /api/me        -> { user }
 *   GET  /api/snapshot  -> the calendar now (definitions, rows, version, ignored notes)
 *   GET  /api/changes?since=N -> rows changed or removed after version N (or { full: true })
 *   GET  /api/stream    -> Server-Sent Events: one "changes" event per new version
 *   POST /api/apply     { base, changes } -> { version, aliases } | 409 { conflict } (with BONI_WRITE)
 *   GET  /api/account   -> { prefs, externals, updated }: what the account shares among its devices
 *   PUT  /api/account/prefs     { prefs }      -> { updated }
 *   PUT  /api/account/externals { externals }  -> { updated } (stored encrypted)
 *   GET  /api/external?id=X[&fresh=1] -> { text, at }: that external calendar, downloaded by the server
 *   PUT  /api/collections/reminders { collectionId, reminders?, eventColumn? } -> {} (with BONI_WRITE):
 *        a calendar's reminders, written in its definition note
 *   GET  /api/reminders?tz=&hours=&locale=&h24= -> { notices }: the account's reminders of the coming hours
 *   PUT  /api/push { endpoint } / DELETE /api/push: this device's UnifiedPush address (told when they change)
 * The stream also sends an "account" event ({ updated }) when the account's prefs or calendars change.
 * The first Boni's API v1 (/api/v1/..., /healthz) is v1/http.ts, on the tailnet only; the agent's
 * conversation API (/api/agent/...) is agent.ts, on the tailnet only too.
 * Anything else is the web app (static files of apps/calendar-web/dist), so a browser can open the calendar.
 */
export interface ServerOptions {
  db: Db;
  vaults: Vaults;
  /** Encrypts the account's secrets (secret.ts). */
  key: SecretKey;
  /** Downloads external calendars for the accounts (feeds.ts). */
  feeds: Feeds;
  /** Tells devices by UnifiedPush when their reminders may have changed (reminders.ts); off without it. */
  push?: Push;
  /** Limits on logging in (limits.ts); the defaults when missing. */
  guard?: LoginGuard;
  /** The built web app to serve, if any. */
  webDir?: string | null;
  /** Which entry this server is (routes.ts); "tailnet" (everything) when missing. */
  listener?: Listener;
  /** The allow-list (tests only; ROUTES when missing). */
  routes?: Readonly<Record<string, "public" | "tailnet">>;
  /** The server's time zone for the Boni API v1 (BONI_TZ): "today", a capture's time. */
  tz?: string;
  /** The clock (tests only). */
  now?: () => number;
  /** The agent's conversation API (agent.ts); off (503) when missing. */
  agent?: AgentHost;
}

export interface App {
  handler(listener: Listener): (req: IncomingMessage, res: ServerResponse) => void;
  /** Stops its timers. */
  close(): void;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".map": "application/json",
};

/**
 * The web app's own files: only its scripts and styles run (inline style attributes are React's), it
 * talks to this server or to https (external calendars without a server), and no other site may frame it.
 */
const PAGE = {
  ...SAFE,
  "content-security-policy":
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; " +
    "connect-src 'self' https:; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; " +
    "frame-ancestors 'none'",
  "x-frame-options": "DENY",
};

/** One server per entry, all sharing one app (login limits, live streams): see `makeApp`. */
export function makeServer(opts: ServerOptions): Server {
  const app = makeApp(opts);
  const server = serve(app, opts.listener ?? "tailnet");
  server.on("close", () => app.close());
  return server;
}

/** An HTTP server for one entry of `app`. */
export function serve(app: App, listener: Listener): Server {
  const server = createServer(app.handler(listener));
  // A slow client cannot hold a connection open forever while sending its request (the live stream's
  // answer is long, its request is not).
  server.requestTimeout = 30_000;
  server.headersTimeout = 15_000;
  return server;
}

/**
 * The server's state and routes. The tailnet entry and the public one are two servers over the same
 * app, so a failed login on one counts on the other and a change made through one reaches the live
 * streams of the other.
 */
export function makeApp(opts: ServerOptions): App {
  const { db, vaults, key, feeds, push } = opts;
  const routes = opts.routes ?? ROUTES;
  const guard = opts.guard ?? new LoginGuard();
  /** Live streams of each account, told when its prefs or calendars change. */
  const accountListeners = new Map<number, Set<(updated: number) => void>>();
  const accountChanged = (userId: number, updated: number) => {
    for (const l of accountListeners.get(userId) ?? []) l(updated);
    push?.changed([userId]);
  };
  /** With push on, a change in a vault tells the devices of every account that uses it. */
  const watched = new Set<string>();
  const watchVault = (root: string) => {
    if (!push || watched.has(root)) return;
    watched.add(root);
    const v = vaults.get(root);
    v.subscribe(() => {
      const users = db.prepare("SELECT id FROM accounts WHERE vault = ?").all(root) as {
        id: number;
      }[];
      push.changed(users.map((u) => u.id));
    });
    void v.snapshot().catch((e) => console.warn("vault", e));
  };
  if (push) {
    for (const u of db
      .prepare("SELECT DISTINCT vault FROM accounts WHERE vault IS NOT NULL")
      .all() as { vault: string }[]) {
      try {
        watchVault(u.vault);
      } catch (e) {
        console.warn("vault", e instanceof Error ? e.message : e);
      }
    }
  }
  const webRoot = opts.webDir ? resolve(opts.webDir) : null;

  const tz = opts.tz ?? "Europe/Madrid";
  const v1 = new V1Service({
    store: new V1Store(db),
    tz,
    writable: vaults.writable,
    ...(opts.now ? { now: opts.now } : {}),
  });
  const vaultOf = (id: number): string | null => {
    const r = db.prepare("SELECT vault FROM accounts WHERE id = ?").get(id) as
      | { vault: string | null }
      | undefined;
    return r ? (r.vault ?? "") : null;
  };
  const hasVault = () =>
    !!db.prepare("SELECT 1 FROM accounts WHERE vault IS NOT NULL AND vault != '' LIMIT 1").get();
  // Captures that could not be written yet, and the apps told when their money notes change.
  const flush = () => {
    try {
      const n = v1.flushOutbox(vaultOf);
      if (n) console.log(`v1 outbox: ${n} capture(s) written`);
    } catch (e) {
      console.error("v1 outbox", e);
    }
  };
  flush();
  const timers = [
    setInterval(flush, 60_000),
    setInterval(() => v1.checkData((id) => vaultOf(id) ?? ""), 60_000),
  ];
  for (const t of timers) t.unref();

  const authed = (req: IncomingMessage, res: ServerResponse): User | null => {
    const user = userOf(db, tokenOf(req));
    if (!user) send(res, 401, { error: "unauthorized" });
    return user;
  };

  const api = async (
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    listener: Listener,
  ): Promise<void> => {
    if (req.method === "OPTIONS") {
      res.writeHead(204, CORS);
      return void res.end();
    }
    const { route, params } = routeOf(req.method, url.pathname, routes);
    // Before anything else, login included: on the public entry only the allow-list exists.
    if (!allowed(route, listener, routes)) return send(res, 404, { error: "not-found" });
    if (route === "GET /healthz" || url.pathname.startsWith("/api/v1/"))
      return serveV1({ svc: v1, db, guard, tz, hasVault }, req, res, url, route, params, listener);
    if (url.pathname.startsWith("/api/agent/")) {
      if (req.method !== "GET" && req.method !== "POST")
        return send(res, 404, { error: "not-found" });
      const s = sessionUser(db, tokenOf(req));
      if (!s) return send(res, 401, { error: "unauthorized" });
      if (!opts.agent) return send(res, 503, { error: "agent-off" });
      return serveAgent(opts.agent, req, res, route, params, {
        account: s.user.id,
        device: s.device,
        trust: s.trust,
      });
    }
    if (route === "POST /api/login") {
      const b = await bodyOf(req);
      const name = String(b.user ?? "").slice(0, 64);
      const from = clientAddress(req.socket.remoteAddress, header(req, "x-forwarded-for"));
      if (!guard.allow(name, from)) {
        console.warn(`login refused (too many attempts): ${JSON.stringify(name)} from ${from}`);
        res.setHeader("retry-after", "900");
        return send(res, 429, { error: "too-many" });
      }
      const r = login(db, name, String(b.password ?? ""), String(b.device ?? ""), listener);
      if (!r) {
        console.warn(`login failed: ${JSON.stringify(name)} from ${from}`);
        guard.failed(name, from);
        return send(res, 401, { error: "bad-login" });
      }
      guard.succeeded(name);
      return send(res, 200, { token: r.token, user: { name: r.user.name } });
    }
    const user = authed(req, res);
    if (!user) return;
    // An account without a vault (Boni only) has no calendar here.
    if (!user.vault) return send(res, 403, { error: "no-calendar" });
    const vault = vaults.get(user.vault);
    watchVault(user.vault);
    switch (route) {
      case "POST /api/logout":
        logout(db, tokenOf(req) ?? "");
        return send(res, 200, {});
      case "GET /api/me":
        return send(res, 200, { user: { name: user.name }, write: vault.writable });
      case "POST /api/apply": {
        if (!vault.writable) return send(res, 403, { error: "read-only" });
        const b = await bodyOf(req);
        const base = Number(b.base);
        if (!Number.isInteger(base) || !Array.isArray(b.changes))
          return send(res, 400, { error: "bad-request" });
        const r = await vault.apply(base, b.changes as RowChange[], tokenOf(req) ?? "");
        return r.ok
          ? send(res, 200, r)
          : send(res, 409, { error: "conflict", conflict: r.conflict });
      }
      case "GET /api/account":
        return send(res, 200, readAccount(db, key, user.id));
      case "PUT /api/account/prefs": {
        const prefs = validPrefs((await bodyOf(req)).prefs);
        if (!prefs) return send(res, 400, { error: "bad-request" });
        const updated = savePrefs(db, user.id, prefs);
        accountChanged(user.id, updated);
        return send(res, 200, { updated });
      }
      case "PUT /api/account/externals": {
        const list = validExternals((await bodyOf(req)).externals);
        if (!list) return send(res, 400, { error: "bad-request" });
        const updated = saveExternals(db, key, user.id, list);
        feeds.keepOnly(
          user.id,
          list.map((c) => c.id),
        );
        accountChanged(user.id, updated);
        return send(res, 200, { updated });
      }
      case "GET /api/external": {
        const id = url.searchParams.get("id");
        const cal = readAccount(db, key, user.id).externals.find((c) => c.id === id);
        if (!cal) return send(res, 404, { error: "not-found" });
        try {
          const copy = await feeds.get(user.id, cal.id, cal.url, url.searchParams.has("fresh"));
          return send(res, 200, copy);
        } catch (e) {
          return send(res, 502, {
            error: "feed",
            message: e instanceof Error ? e.message : String(e),
          });
        }
      }
      case "PUT /api/collections/reminders": {
        if (!vault.writable) return send(res, 403, { error: "read-only" });
        const b = await bodyOf(req);
        if (typeof b.collectionId !== "string") return send(res, 400, { error: "bad-request" });
        // Only what parses as reminders is written (never free text into a definition).
        const reminders =
          b.reminders === null
            ? null
            : b.reminders === undefined
              ? undefined
              : formatReminderDefaults(parseReminderDefaults(b.reminders));
        const r = await vault.setReminders(b.collectionId, {
          ...(reminders !== undefined ? { reminders } : {}),
          ...(b.eventColumn === true ? { eventColumn: true } : {}),
        });
        return r === "ok" ? send(res, 200, {}) : send(res, 409, { error: "conflict" });
      }
      case "GET /api/reminders": {
        const q = url.searchParams;
        const tz = q.get("tz") ?? "UTC";
        try {
          new Intl.DateTimeFormat("en", { timeZone: tz });
        } catch {
          return send(res, 400, { error: "tz" });
        }
        const hours = Math.min(14 * 24, Math.max(1, Number(q.get("hours")) || 7 * 24));
        const notices = await noticesOfAccount(
          vault,
          readAccount(db, key, user.id),
          feeds,
          user.id,
          {
            tz,
            hours,
            locale: q.get("locale") === "en" ? "en" : "es",
            h24: q.get("h24") !== "0",
          },
        );
        return send(res, 200, { notices });
      }
      case "PUT /api/push": {
        const endpoint = String((await bodyOf(req)).endpoint ?? "");
        if (!push) return send(res, 404, { error: "no-push" });
        if (!push.allowed(endpoint)) return send(res, 400, { error: "push-host" });
        push.register(tokenHash(tokenOf(req) ?? ""), user.id, endpoint);
        return send(res, 200, {});
      }
      case "DELETE /api/push":
        push?.unregister(tokenHash(tokenOf(req) ?? ""));
        return send(res, 200, {});
      case "GET /api/snapshot":
        return send(res, 200, await vault.snapshot());
      case "GET /api/changes": {
        await vault.snapshot();
        const since = Number(url.searchParams.get("since"));
        if (!Number.isInteger(since)) return send(res, 400, { error: "since" });
        return send(res, 200, vault.changes(since));
      }
      case "GET /api/stream": {
        await vault.snapshot();
        res.writeHead(200, {
          ...CORS,
          ...SAFE,
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-store",
          connection: "keep-alive",
        });
        res.write(": connected\n\n");
        const off = vault.subscribe((c) =>
          res.write(`event: changes\ndata: ${JSON.stringify(c)}\n\n`),
        );
        const onAccount = (updated: number) =>
          res.write(`event: account\ndata: ${JSON.stringify({ updated })}\n\n`);
        const mine = accountListeners.get(user.id) ?? new Set();
        accountListeners.set(user.id, mine);
        mine.add(onAccount);
        // A comment now and then keeps proxies and phones from dropping a quiet connection.
        const ping = setInterval(() => res.write(": ping\n\n"), 25_000);
        req.on("close", () => {
          off();
          mine.delete(onAccount);
          clearInterval(ping);
        });
        return;
      }
      default:
        return send(res, 404, { error: "not-found" });
    }
  };

  const staticFile = async (res: ServerResponse, pathname: string): Promise<void> => {
    if (!webRoot) return send(res, 404, { error: "not-found" });
    const rel = normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, "");
    let file = join(webRoot, rel || "index.html");
    // Inside the web app's folder only (not a sibling that merely starts with the same name).
    if (file !== webRoot && !file.startsWith(webRoot + sep))
      return send(res, 404, { error: "not-found" });
    try {
      if ((await stat(file)).isDirectory()) file = join(file, "index.html");
      const data = await readFile(file);
      res.writeHead(200, {
        ...PAGE,
        "content-type": MIME[extname(file)] ?? "application/octet-stream",
        "cache-control": rel.startsWith("assets/")
          ? "public, max-age=31536000, immutable"
          : "no-cache",
      });
      res.end(data);
    } catch {
      send(res, 404, { error: "not-found" });
    }
  };

  return {
    close: () => {
      for (const t of timers) clearInterval(t);
    },
    handler: (listener) => (req, res) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      const handle =
        url.pathname.startsWith("/api/") || url.pathname === "/healthz"
          ? api(req, res, url, listener)
          : staticFile(res, url.pathname);
      handle.catch((e) => {
        console.error(e);
        if (!res.headersSent) send(res, 500, { error: "server" });
        else res.end();
      });
    },
  };
}
