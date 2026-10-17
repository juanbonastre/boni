import { readFile, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { login, logout, type User, userOf } from "./auth.ts";
import type { Db } from "./db.ts";
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
 * Anything else is the web app (static files of apps/web/dist), so a browser can open the calendar.
 */
export interface ServerOptions {
  db: Db;
  vaults: Vaults;
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
  "access-control-allow-methods": "GET, POST, OPTIONS",
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
    if (size > 1_000_000) throw new Error("too large");
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
  const { db, vaults } = opts;
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
        return send(res, 200, { user: { name: user.name } });
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
        // A comment now and then keeps proxies and phones from dropping a quiet connection.
        const ping = setInterval(() => res.write(": ping\n\n"), 25_000);
        req.on("close", () => {
          off();
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
