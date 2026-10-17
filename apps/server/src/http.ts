import { readFile, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import type { RowChange } from "@boni-calendar/core";
import { readAccount, saveExternals, savePrefs, validExternals, validPrefs } from "./account.ts";
import { login, logout, type User, userOf } from "./auth.ts";
import type { Db } from "./db.ts";
import type { Feeds } from "./feeds.ts";
import type { SecretKey } from "./secret.ts";
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
 * The stream also sends an "account" event ({ updated }) when the account's prefs or calendars change.
 * Anything else is the web app (static files of apps/web/dist), so a browser can open the calendar.
 */
export interface ServerOptions {
  db: Db;
  vaults: Vaults;
  /** Encrypts the account's secrets (secret.ts). */
  key: SecretKey;
  /** Downloads external calendars for the accounts (feeds.ts). */
  feeds: Feeds;
  /** The built web app to serve, if any. */
  webDir?: string | null;
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
 * The desktop and Android apps are not served from here (another origin), so the API allows any
 * origin. That is safe because access is by a bearer token the app holds, never by cookies a browser
 * would send on its own.
 */
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type",
  "access-control-allow-methods": "GET, POST, PUT, OPTIONS",
  "access-control-max-age": "600",
};

function send(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    ...CORS,
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(text),
  });
  res.end(text);
}

async function bodyOf(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 8_000_000) throw new Error("too large");
    chunks.push(c as Buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}

const tokenOf = (req: IncomingMessage): string | null => {
  const h = req.headers.authorization;
  return h?.startsWith("Bearer ") ? h.slice(7).trim() : null;
};

export function makeServer(opts: ServerOptions): Server {
  const { db, vaults, key, feeds } = opts;
  /** Live streams of each account, told when its prefs or calendars change. */
  const accountListeners = new Map<number, Set<(updated: number) => void>>();
  const accountChanged = (userId: number, updated: number) => {
    for (const l of accountListeners.get(userId) ?? []) l(updated);
  };
  const webRoot = opts.webDir ? resolve(opts.webDir) : null;

  const authed = (req: IncomingMessage, res: ServerResponse): User | null => {
    const user = userOf(db, tokenOf(req));
    if (!user) send(res, 401, { error: "unauthorized" });
    return user;
  };

  const api = async (req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> => {
    if (req.method === "OPTIONS") {
      res.writeHead(204, CORS);
      return void res.end();
    }
    const route = `${req.method} ${url.pathname}`;
    if (route === "POST /api/login") {
      const b = await bodyOf(req);
      const r = login(db, String(b.user ?? ""), String(b.password ?? ""), String(b.device ?? ""));
      if (!r) return send(res, 401, { error: "bad-login" });
      return send(res, 200, { token: r.token, user: { name: r.user.name } });
    }
    const user = authed(req, res);
    if (!user) return;
    const vault = vaults.get(user.vault);
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
    if (!file.startsWith(webRoot)) return send(res, 404, { error: "not-found" });
    try {
      if ((await stat(file)).isDirectory()) file = join(file, "index.html");
      const data = await readFile(file);
      res.writeHead(200, {
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

  return createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const handle = url.pathname.startsWith("/api/")
      ? api(req, res, url)
      : staticFile(res, url.pathname);
    handle.catch((e) => {
      console.error(e);
      if (!res.headersSent) send(res, 500, { error: "server" });
      else res.end();
    });
  });
}
