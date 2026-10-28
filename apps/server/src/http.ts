import { readFile, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import {
  formatReminderDefaults,
  parseReminderDefaults,
  type RowChange,
  toLocal,
} from "@boni/calendar";
import { exportChunks, releaseSent } from "@boni/export";
import { readAccount, saveExternals, savePrefs, validExternals, validPrefs } from "./account.ts";
import { type AgentHost, serveAgent } from "./agent.ts";
import {
  auditAction,
  auditActions,
  auditRow,
  auditSettings,
  auditStorage,
  auditSummary,
  recordFileRead,
  recordUserRead,
  setAuditSettings,
  systemColumns,
} from "./audit.ts";
import { listUsers, login, logout, sessionUser, tokenHash, type User, userOf } from "./auth.ts";
import { BlocksError, blockRowsOf, computeBlocks } from "./blocks.ts";
import { type CalendarSource, calendarDefs, StoreCalendar } from "./calendarStore.ts";
import {
  createRow,
  DataError,
  findByPath,
  getRow,
  listNotes,
  listRows,
  listTypes,
  removeRow,
  restoreRow,
  setNotesInTree,
  setProtection,
  setRowUi,
  setRule,
  treeOf,
  updateRow,
} from "./data.ts";
import type { Db } from "./db.ts";
import type { Feeds } from "./feeds.ts";
import { entityFromNote } from "./fromNote.ts";
import { clientAddress, LoginGuard } from "./limits.ts";
import { MailError, type Mails } from "./mail.ts";
import { mcpAnswer } from "./mcp.ts";
import {
  createPage,
  getPage,
  listPages,
  listTrash,
  PageError,
  removePage,
  restorePage,
  seedFromV1,
  seedTemplates,
  updatePage,
} from "./pages.ts";
import { noticesOfAccount, type Push } from "./reminders.ts";
import { bodyOf, CORS, header, SAFE, send, sendFile, tokenOf } from "./reply.ts";
import { allowed, type Listener, ROUTES, routeOf } from "./routes.ts";
import type { SecretKey } from "./secret.ts";
import { isSystemCollection, systemCollections } from "./systemCollections.ts";
import { serveV1 } from "./v1/http.ts";
import { V1Service } from "./v1/service.ts";
import { V1Store } from "./v1/store.ts";
import { StoreMoney } from "./v1/storeMoney.ts";

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
 *        a calendar's reminders, kept in its definition
 *   GET  /api/reminders?tz=&hours=&locale=&h24= -> { notices }: the account's reminders of the coming hours
 *   PUT  /api/push { endpoint } / DELETE /api/push: this device's UnifiedPush address (told when they change)
 *   GET  /api/mail · PUT /api/mail { host, port, user, password?, folder, collections, on } · POST /api/mail/check ·
 *        POST /api/mail/reread { days } (the pending proposals of that mail withdrawn, the mail read again) ·
 *        GET · PUT /api/mail/guide { instructions?, rules?, keepExamples? } (the reading guide, docs/nucleo.md 7.4b) ·
 *        POST /api/mail/review (the reviewer now) · POST /api/mail/suggestion { id, accept } (Juan's answer) ·
 *        POST /api/mail/forget: the account's mailbox (mail.ts; a personal device; the password never comes back)
 * The stream also sends an "account" event ({ updated }) when the account's prefs or calendars change.
 * The first Boni's API v1 (/api/v1/..., /healthz) is v1/http.ts, on the tailnet only; the agent's
 * conversation API (/api/agent/...) is agent.ts, on the tailnet only too.
 * Anything else is the web app (static files of apps/calendar-web/dist), so a browser can open the calendar.
 */
export interface ServerOptions {
  db: Db;
  /** Whether devices may change the calendar and the v1 captures be written (BONI_WRITE). */
  write?: boolean;
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
  /** Boni's web app (apps/boni-web/dist), served at /boni/ on the tailnet entry only, like its APIs. */
  boniWebDir?: string | null;
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
  /** The accounts' mailboxes (mail.ts); 503 when missing. */
  mails?: Mails;
  /** Proxies whose X-Forwarded-For is trusted besides loopback (BONI_TRUSTED_PROXIES; limits.ts). */
  trustedProxies?: ReadonlySet<string>;
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
  const { db, key, feeds, push } = opts;
  const writable = opts.write === true;
  const routes = opts.routes ?? ROUTES;
  const guard = opts.guard ?? new LoginGuard();
  /** Live streams of each account, told when its prefs or calendars change. */
  const accountListeners = new Map<number, Set<(updated: number) => void>>();
  const accountChanged = (userId: number, updated: number) => {
    for (const l of accountListeners.get(userId) ?? []) l(updated);
    push?.changed([userId]);
  };
  /**
   * An account's calendar: its own collections in Boni (their definitions are in its store, `calendar/defs`);
   * none when it keeps none.
   */
  const storeCalendars = new Map<number, StoreCalendar>();
  const onStore = (account: number): boolean => {
    if (!opts.agent?.hasData) return false;
    try {
      return calendarDefs(opts.agent.store(account)).length > 0;
    } catch {
      return false;
    }
  };
  const calendarOf = (user: { id: number }): CalendarSource | null => {
    if (!onStore(user.id)) return null;
    let c = storeCalendars.get(user.id);
    if (!c) {
      c = new StoreCalendar((opts.agent as NonNullable<typeof opts.agent>).store(user.id), {
        write: writable,
      });
      storeCalendars.set(user.id, c);
      const id = user.id;
      c.subscribe(() => push?.changed([id]));
    }
    return c;
  };
  if (push) {
    // Each calendar watched from the start: a change tells the account's devices (and its series are topped up).
    for (const u of listUsers(db)) {
      try {
        calendarOf(u);
      } catch (e) {
        console.warn("calendar", e instanceof Error ? e.message : e);
      }
    }
  }
  const webRoot = opts.webDir ? resolve(opts.webDir) : null;
  const boniRoot = opts.boniWebDir ? resolve(opts.boniWebDir) : null;

  const tz = opts.tz ?? "Europe/Madrid";
  const v1store = new V1Store(db);
  /** The account's store when it keeps its movements in Boni (the collection Movimiento). */
  const moneyStore = (account: number) => {
    if (!opts.agent?.hasData) return null;
    const store = opts.agent.store(account);
    return store.schema().types.t_movimiento ? store : null;
  };
  const v1 = new V1Service({
    store: v1store,
    tz,
    writable,
    // "Apuntar gasto": the movement goes into Boni, with the path its note would have had.
    intoBoni: (account, path, text, device) => {
      const store = moneyStore(account);
      if (!store) return false;
      entityFromNote(store, "t_movimiento", path, text, device);
      return true;
    },
    outOfBoni: (account, path, device) => {
      const store = moneyStore(account);
      if (!store) return false;
      try {
        removeRow(store, findByPath(store, path).id, device);
      } catch {
        return false;
      }
      return true;
    },
    moneyOf: (account) => {
      const store = moneyStore(account);
      return store ? new StoreMoney(store) : null;
    },
    ...(opts.now ? { now: opts.now } : {}),
  });
  const hasMoney = () => listUsers(db).some((u) => moneyStore(u.id) !== null);
  // Captures that could not be written yet, and the apps told when their money changes.
  const flush = () => {
    try {
      const n = v1.flushOutbox();
      if (n) console.log(`v1 outbox: ${n} capture(s) written`);
    } catch (e) {
      console.error("v1 outbox", e);
    }
  };
  flush();
  const timers = [setInterval(flush, 60_000), setInterval(() => v1.checkData(), 60_000)];
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
      return serveV1(
        { svc: v1, db, guard, tz, hasMoney, proxies: opts.trustedProxies },
        req,
        res,
        url,
        route,
        params,
        listener,
      );
    if (url.pathname.startsWith("/api/agent/")) {
      if (req.method !== "GET" && req.method !== "POST" && req.method !== "PUT")
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
    if (route.endsWith(" /api/mcp")) {
      // Boni's MCP (mcp.ts): the assistants' tools over the account's collections. JSON answers only (no
      // stream to open), a personal device's session (`cli.ts token`).
      if (req.method === "GET") return send(res, 405, { error: "no-stream" });
      const s = sessionUser(db, tokenOf(req));
      if (!s) return send(res, 401, { error: "unauthorized" });
      if (!opts.agent?.hasData) return send(res, 503, { error: "no-store" });
      if (s.trust !== "personal") return send(res, 403, { error: "personal-device-only" });
      let body: unknown;
      try {
        body = await bodyOf(req);
      } catch {
        return send(res, 400, {
          jsonrpc: "2.0",
          id: null,
          error: { code: -32700, message: "parse error" },
        });
      }
      const out = mcpAnswer(opts.agent.store(s.user.id), s.device, body, opts.now ?? Date.now);
      if (out === null) {
        res.writeHead(202, { ...CORS, ...SAFE });
        return void res.end();
      }
      return send(res, 200, out);
    }
    if (route.includes(" /api/data/")) {
      // The user's collections as databases (data.ts): only from a personal device, reading too (the rows
      // hold what the AI may not see and money).
      const s = sessionUser(db, tokenOf(req));
      if (!s) return send(res, 401, { error: "unauthorized" });
      if (!opts.agent?.hasData) return send(res, 503, { error: "no-store" });
      if (s.trust !== "personal") return send(res, 403, { error: "personal-device-only" });
      const store = opts.agent.store(s.user.id);
      const now = opts.now ?? Date.now;
      // Boni's own records as read-only collections (systemCollections.ts), made only when a route needs them.
      const sys = () =>
        systemCollections(store, {
          now: now(),
          usdToEur: opts.agent?.models?.config(s.user.id).usdToEur ?? 0.9,
        });
      try {
        if (route === "GET /api/data/tree") return send(res, 200, treeOf(store));
        if (route === "PUT /api/data/types/:type/tree") {
          const b = await bodyOf(req);
          if (typeof b.notes !== "boolean") return send(res, 400, { error: "bad-request" });
          setNotesInTree(store, params.type ?? "", b.notes);
          return send(res, 200, {});
        }
        if (route === "GET /api/data/types")
          return send(res, 200, { types: listTypes(store, sys()) });
        if (route === "GET /api/data/types/:type/rows") {
          const type = params.type ?? "";
          if (isSystemCollection(type))
            return send(res, 200, { ...listRows(store, type, sys()), columns: {} });
          const out = listRows(store, type);
          const ids = out.rows.map((r) => r.id);
          recordUserRead(store, s.device, "data.rows", type, ids, false, now());
          return send(res, 200, { ...out, columns: systemColumns(store, ids) });
        }
        if (route === "POST /api/data/types/:type/rows") {
          const b = (await bodyOf(req)) as { values?: unknown };
          return send(res, 200, {
            row: createRow(store, params.type ?? "", b.values ?? {}, s.device),
          });
        }
        if (route === "POST /api/data/blocks" || route === "POST /api/data/blocks/rows") {
          // A page's numbers and charts (blocks.ts), or the rows one of them counts; "today" in the server's
          // zone like the API v1.
          const day = toLocal(now(), opts.tz ?? "Europe/Madrid").day;
          const today = new Date(day * 86_400_000).toISOString().slice(0, 10);
          const o = { today, device: s.device, now: now(), sys };
          const body = await bodyOf(req);
          return send(
            res,
            200,
            route.endsWith("/rows") ? blockRowsOf(store, body, o) : computeBlocks(store, body, o),
          );
        }
        if (route === "GET /api/data/notes") return send(res, 200, listNotes(store));
        if (route === "GET /api/data/lookup")
          return send(res, 200, findByPath(store, url.searchParams.get("path") ?? ""));
        if (route === "GET /api/data/rows/:id") {
          const row = getRow(store, params.id ?? "");
          recordUserRead(store, s.device, "data.row", row.type, [row.id], true, now());
          return send(res, 200, { row, columns: systemColumns(store, [row.id])[row.id] });
        }
        // The audit (audit.ts): who did and saw what, a row's history, storage, and which reads are kept.
        if (route === "GET /api/data/audit/summary")
          return send(res, 200, auditSummary(store, url, now()));
        if (route === "GET /api/data/audit/actions")
          return send(res, 200, auditActions(store, url));
        if (route === "GET /api/data/audit/actions/:seq") {
          const a = auditAction(store, Number(params.seq));
          return a ? send(res, 200, a) : send(res, 404, { error: "not-found" });
        }
        if (route === "GET /api/data/audit/rows/:id") {
          const a = auditRow(store, params.id ?? "");
          return a ? send(res, 200, a) : send(res, 404, { error: "not-found" });
        }
        if (route === "GET /api/data/audit/verify") return send(res, 200, store.audit.verify());
        if (route === "GET /api/data/audit/storage") return send(res, 200, auditStorage(store));
        if (route === "GET /api/data/audit/settings") return send(res, 200, auditSettings(store));
        if (route === "PUT /api/data/audit/settings") {
          const r = setAuditSettings(store, await bodyOf(req));
          return r ? send(res, 200, r) : send(res, 400, { error: "bad-request" });
        }
        if (route === "PUT /api/data/rows/:id") {
          const b = (await bodyOf(req)) as { values?: unknown; body?: unknown };
          return send(res, 200, {
            row: updateRow(store, params.id ?? "", b.values, s.device, b.body),
          });
        }
        if (route === "DELETE /api/data/rows/:id") {
          removeRow(store, params.id ?? "", s.device);
          return send(res, 200, {});
        }
        if (route === "POST /api/data/rows/:id/restore") {
          restoreRow(store, params.id ?? "", s.device);
          return send(res, 200, {});
        }
        if (route === "PUT /api/data/types/:type/row-ui") {
          const r = setRowUi(store, params.type ?? "", await bodyOf(req));
          return "error" in r ? send(res, r.status, { error: r.error }) : send(res, 200, r);
        }
        if (route === "PUT /api/data/types/:type/protection") {
          const r = setProtection(store, params.type ?? "", await bodyOf(req), s.device);
          return "error" in r ? send(res, r.status, { error: r.error }) : send(res, 200, r);
        }
        if (
          route === "POST /api/data/types/:type/rules" ||
          route === "PUT /api/data/rules/:id" ||
          route === "DELETE /api/data/rules/:id"
        ) {
          const r = setRule(
            store,
            route.startsWith("POST") ? { type: params.type } : { ruleId: params.id },
            await bodyOf(req),
            s.device,
            route.startsWith("DELETE"),
          );
          return "error" in r ? send(res, r.status, { error: r.error }) : send(res, 200, r);
        }
        if (route === "GET /api/data/files/:sha") {
          const f = store.getFile(params.sha ?? "");
          if (f) recordFileRead(store, s.device, params.sha ?? "", now());
          return f ? sendFile(res, f.mime, f.data) : send(res, 404, { error: "not-found" });
        }
      } catch (e) {
        if (e instanceof DataError)
          return send(res, e.code === "not-found" ? 404 : 400, { error: e.code });
        if (e instanceof BlocksError) return send(res, 400, { error: e.code });
        throw e;
      }
    }
    if (
      route.startsWith("GET /api/pages") ||
      route.startsWith("POST /api/pages") ||
      route.startsWith("PUT /api/pages") ||
      route.startsWith("DELETE /api/pages")
    ) {
      // The user's pages (pages.ts, docs/extensiones.md 6): any device of the account reads them; only a
      // personal one changes them.
      const s = sessionUser(db, tokenOf(req));
      if (!s) return send(res, 401, { error: "unauthorized" });
      if (!opts.agent?.hasData) return send(res, 503, { error: "no-store" });
      const store = opts.agent.store(s.user.id);
      const id = params.id ?? "";
      if (route === "GET /api/pages") {
        seedFromV1(store, v1store, s.user.id);
        seedTemplates(store);
        return send(res, 200, { pages: listPages(store) });
      }
      if (route === "GET /api/pages-trash") return send(res, 200, { pages: listTrash(store) });
      if (route === "GET /api/pages/:id") {
        const p = getPage(store, id);
        return p ? send(res, 200, { page: p }) : send(res, 404, { error: "not-found" });
      }
      if (s.trust !== "personal") return send(res, 403, { error: "personal-device-only" });
      try {
        if (route === "POST /api/pages")
          return send(res, 200, { page: createPage(store, await bodyOf(req), s.device) });
        if (route === "PUT /api/pages/:id")
          return send(res, 200, { page: updatePage(store, id, await bodyOf(req), s.device) });
        if (route === "POST /api/pages/:id/restore")
          return send(res, 200, { page: restorePage(store, id, s.device) });
        if (route === "DELETE /api/pages/:id") {
          removePage(store, id, s.device);
          return send(res, 200, {});
        }
      } catch (e) {
        if (e instanceof PageError)
          return send(res, e.code === "not-found" ? 404 : 400, { error: e.code });
        throw e;
      }
    }
    if (
      route === "GET /api/mail" ||
      route === "PUT /api/mail" ||
      route === "POST /api/mail/check" ||
      route === "POST /api/mail/reread" ||
      route === "GET /api/mail/guide" ||
      route === "PUT /api/mail/guide" ||
      route === "POST /api/mail/review" ||
      route === "POST /api/mail/suggestion" ||
      route === "POST /api/mail/forget"
    ) {
      // The account's mailbox (mail.ts), from a personal device only; the password never comes back.
      const s = sessionUser(db, tokenOf(req));
      if (!s) return send(res, 401, { error: "unauthorized" });
      if (s.trust !== "personal") return send(res, 403, { error: "personal-device-only" });
      const mails = opts.mails;
      if (!mails || !opts.agent?.hasData) return send(res, 503, { error: "no-store" });
      const id = s.user.id;
      if (route === "GET /api/mail") return send(res, 200, { mail: mails.view(id) });
      if (route === "POST /api/mail/forget") {
        mails.forget(id);
        return send(res, 200, { mail: null });
      }
      if (route === "POST /api/mail/check") {
        if (!mails.view(id)) return send(res, 404, { error: "not-configured" });
        await mails.check(id);
        return send(res, 200, { mail: mails.view(id) });
      }
      if (route === "GET /api/mail/guide") return send(res, 200, { guide: mails.guide(id) });
      if (route === "PUT /api/mail/guide") {
        try {
          const b = await bodyOf(req);
          return send(res, 200, { guide: mails.saveGuide(id, b) });
        } catch (e) {
          if (e instanceof MailError) return send(res, 400, { error: e.code });
          throw e;
        }
      }
      if (route === "POST /api/mail/review") {
        if (!mails.view(id)) return send(res, 404, { error: "not-configured" });
        await mails.reviewNow(id);
        return send(res, 200, { mail: mails.view(id) });
      }
      if (route === "POST /api/mail/suggestion") {
        const b = await bodyOf(req);
        try {
          const guide = mails.answerSuggestion(id, String(b.id ?? ""), b.accept === true);
          return send(res, 200, { guide, mail: mails.view(id) });
        } catch (e) {
          if (e instanceof MailError) return send(res, 409, { error: e.code });
          throw e;
        }
      }
      if (route === "POST /api/mail/reread") {
        if (!mails.view(id)) return send(res, 404, { error: "not-configured" });
        const b = await bodyOf(req);
        const days = typeof b.days === "number" && Number.isFinite(b.days) ? b.days : 7;
        return send(res, 200, await mails.reread(id, days));
      }
      try {
        const b = await bodyOf(req);
        const mail = await mails.save(id, {
          ...(typeof b.host === "string" ? { host: b.host } : {}),
          ...(typeof b.port === "number" ? { port: b.port } : {}),
          ...(typeof b.user === "string" ? { user: b.user } : {}),
          ...(typeof b.password === "string" && b.password ? { password: b.password } : {}),
          ...(typeof b.folder === "string" ? { folder: b.folder } : {}),
          ...(Array.isArray(b.collections) ? { collections: b.collections as string[] } : {}),
          ...(typeof b.on === "boolean" ? { on: b.on } : {}),
        });
        if (mail.on) void mails.check(id);
        return send(res, 200, { mail });
      } catch (e) {
        if (e instanceof MailError) return send(res, 400, { error: e.code });
        throw e;
      }
    }
    if (route === "GET /api/export") {
      // Everything of the account in one zip (docs/nucleo.md 9.3), from a personal device only.
      const s = sessionUser(db, tokenOf(req));
      if (!s) return send(res, 401, { error: "unauthorized" });
      if (s.trust !== "personal") return send(res, 403, { error: "personal-device-only" });
      if (!opts.agent?.hasData) return send(res, 503, { error: "no-store" });
      // Sent as it is made, an entry at a time and at the client's pace (the attachments alone are more than
      // the container's memory: never the whole zip at once).
      const chunks = exportChunks(opts.agent.store(s.user.id), {
        views: { charts: v1store.charts(s.user.id), shortcuts: v1store.shortcuts(s.user.id) },
        log: url.searchParams.get("log") === "1",
      });
      res.writeHead(200, {
        ...CORS,
        ...SAFE,
        "content-type": "application/zip",
        "content-disposition": `attachment; filename="boni-${new Date().toISOString().slice(0, 10)}.zip"`,
        "cache-control": "no-store",
      });
      const release = releaseSent();
      for (const c of chunks) {
        if (res.destroyed) return;
        release(c.length);
        if (!res.write(c))
          await new Promise<void>((ok) => {
            const done = () => {
              res.off("drain", done);
              res.off("close", done);
              ok();
            };
            res.on("drain", done);
            res.on("close", done);
          });
      }
      return void res.end();
    }
    if (route === "POST /api/login") {
      const b = await bodyOf(req);
      const name = String(b.user ?? "").slice(0, 64);
      const from = clientAddress(
        req.socket.remoteAddress,
        header(req, "x-forwarded-for"),
        opts.trustedProxies,
      );
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
    // An account that keeps no calendar has none here.
    const calendar = calendarOf(user);
    if (!calendar) return send(res, 403, { error: "no-calendar" });
    switch (route) {
      case "POST /api/logout":
        logout(db, tokenOf(req) ?? "");
        return send(res, 200, {});
      case "GET /api/me":
        return send(res, 200, { user: { name: user.name }, write: calendar.writable });
      case "POST /api/apply": {
        if (!calendar.writable) return send(res, 403, { error: "read-only" });
        const b = await bodyOf(req);
        const base = Number(b.base);
        if (!Number.isInteger(base) || !Array.isArray(b.changes))
          return send(res, 400, { error: "bad-request" });
        const r = await calendar.apply(
          base,
          b.changes as RowChange[],
          tokenOf(req) ?? "",
          sessionUser(db, tokenOf(req))?.device,
        );
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
        if (!calendar.writable) return send(res, 403, { error: "read-only" });
        const b = await bodyOf(req);
        if (typeof b.collectionId !== "string") return send(res, 400, { error: "bad-request" });
        // Only what parses as reminders is written (never free text into a definition).
        const reminders =
          b.reminders === null
            ? null
            : b.reminders === undefined
              ? undefined
              : formatReminderDefaults(parseReminderDefaults(b.reminders));
        const r = await calendar.setReminders(b.collectionId, {
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
          calendar,
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
        return send(res, 200, await calendar.snapshot());
      case "GET /api/changes": {
        await calendar.snapshot();
        const since = Number(url.searchParams.get("since"));
        if (!Number.isInteger(since)) return send(res, 400, { error: "since" });
        return send(res, 200, calendar.changes(since));
      }
      case "GET /api/stream": {
        await calendar.snapshot();
        res.writeHead(200, {
          ...CORS,
          ...SAFE,
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-store",
          connection: "keep-alive",
        });
        res.write(": connected\n\n");
        const off = calendar.subscribe((c) =>
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

  const staticFile = async (
    res: ServerResponse,
    pathname: string,
    listener: Listener,
  ): Promise<void> => {
    // /boni/... is Boni's web app (tailnet only); everything else is the calendar's.
    const boni = pathname === "/boni" || pathname.startsWith("/boni/");
    // The tailnet's address is Boni's (`boni.`, Juan 2026-10-23): its root opens Boni, not the calendar's page
    // (which, logged out, shows invented data). The public entry (`calendar.`) keeps the calendar there.
    const home = pathname === "/" || pathname === "/index.html";
    if (home && listener === "tailnet" && boniRoot) {
      res.writeHead(302, { ...SAFE, location: "/boni/" });
      return void res.end();
    }
    if (boni && pathname === "/boni") {
      res.writeHead(301, { ...SAFE, location: "/boni/" });
      return void res.end();
    }
    const root = boni ? (listener === "tailnet" ? boniRoot : null) : webRoot;
    if (!root) return send(res, 404, { error: "not-found" });
    let rel: string;
    try {
      rel = normalize(decodeURIComponent(boni ? pathname.slice("/boni".length) : pathname)).replace(
        /^([/\\])+/,
        "",
      );
    } catch {
      return send(res, 404, { error: "not-found" });
    }
    let file = join(root, rel || "index.html");
    // Inside the web app's folder only (not a sibling that merely starts with the same name).
    if (file !== root && !file.startsWith(root + sep))
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
      for (const c of storeCalendars.values()) c.close();
      storeCalendars.clear();
    },
    handler: (listener) => (req, res) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      const handle =
        url.pathname.startsWith("/api/") || url.pathname === "/healthz"
          ? api(req, res, url, listener)
          : staticFile(res, url.pathname, listener);
      handle.catch((e) => {
        console.error(e);
        if (!res.headersSent) send(res, 500, { error: "server" });
        else res.end();
      });
    },
  };
}
