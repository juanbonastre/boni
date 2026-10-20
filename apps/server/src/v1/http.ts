import type { IncomingMessage, ServerResponse } from "node:http";
import { fromLocal } from "@boni/calendar";
import { login, logout, sessionUser } from "../auth.ts";
import type { Db } from "../db.ts";
import { clientAddress, type LoginGuard } from "../limits.ts";
import { bodyOf, CORS, header, SAFE, send, tokenOf } from "../reply.ts";
import type { Listener } from "../routes.ts";
import { API_VERSION, Invalid, normalizeSpec, VERSION } from "./contract.ts";
import { type Caller, NotFound, Unavailable, type V1Service } from "./service.ts";
import type { Shortcut, Widget } from "./store.ts";

/**
 * The Boni API v1 (the first Boni's app.py and legacy/boni/api/), served by this server so the Boni
 * apps move here without a change: same paths, bodies, status codes and error messages
 * ({ error: { code, message } }). Requests are checked here the way its Pydantic models did; the rest
 * is service.ts.
 */
class BadRequest extends Error {}

const err = (res: ServerResponse, status: number, code: string, message: string) =>
  send(res, status, { error: { code, message } });
const empty = (res: ServerResponse) => {
  res.writeHead(204, { ...CORS, ...SAFE, "cache-control": "no-store" });
  res.end();
};

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
function str(b: Record<string, unknown>, key: string, def?: string): string {
  const v = b[key];
  if (v === undefined && def !== undefined) return def;
  if (typeof v !== "string") throw new BadRequest(`${key}: falta o no es texto`);
  return v;
}
const ids = (b: Record<string, unknown>): string[] => {
  if (!Array.isArray(b.ids) || !b.ids.every((x) => typeof x === "string"))
    throw new BadRequest("ids: tiene que ser una lista de textos");
  return b.ids as string[];
};

/** A UUID in any form Python's UUID() reads, written as str(UUID) does. */
export function canonicalUuid(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const hex = v
    .trim()
    .replace(/^urn:uuid:/i, "")
    .replace(/^\{|\}$/g, "")
    .replaceAll("-", "")
    .toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(hex)) return null;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** An ISO date-time; without an offset it is the server's zone. Returned as UTC ISO, or null. */
export function instant(v: unknown, tz: string): string | null {
  if (typeof v !== "string") return null;
  const m =
    /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/i.exec(
      v.trim(),
    );
  if (!m) return null;
  const [y, mo, d, h, mi] = [1, 2, 3, 4, 5].map((i) => Number(m[i])) as [
    number,
    number,
    number,
    number,
    number,
  ];
  const s = Number(m[6] ?? 0) + Number(m[7] ?? 0);
  if (
    mo < 1 ||
    mo > 12 ||
    d < 1 ||
    d > new Date(Date.UTC(y, mo, 0)).getUTCDate() ||
    h > 23 ||
    mi > 59 ||
    s >= 60
  )
    return null;
  let ms: number;
  if (m[8])
    ms = Date.parse(
      `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${String(Math.floor(s)).padStart(2, "0")}${m[7] ?? ""}${m[8].length === 5 ? `${m[8].slice(0, 3)}:${m[8].slice(3)}` : m[8]}`,
    );
  else ms = fromLocal(Math.floor(Date.UTC(y, mo - 1, d) / 86_400_000), h * 60 + mi + s / 60, tz);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function shortcutOf(b: Record<string, unknown>): Shortcut {
  const label = str(b, "label");
  if ([...label].length < 1 || [...label].length > 60)
    throw new BadRequest("label: entre 1 y 60 caracteres");
  const values = b.values === undefined ? {} : b.values;
  if (!isObj(values)) throw new BadRequest("values: tiene que ser un objeto");
  const mode = b.mode === undefined ? "open" : b.mode;
  if (mode !== "open" && mode !== "save") throw new BadRequest("mode: open o save");
  const color = b.color === undefined || b.color === null ? null : b.color;
  if (color !== null && typeof color !== "string") throw new BadRequest("color: no es texto");
  return { id: "", label, screen: str(b, "screen"), values, mode, color };
}

function widgetOf(b: Record<string, unknown>): { chartId: string; size: Widget["size"] } {
  const size = b.size === undefined ? "medium" : b.size;
  if (size !== "small" && size !== "medium" && size !== "large")
    throw new BadRequest("size: small, medium o large");
  return { chartId: str(b, "chart_id"), size };
}

function specOf(raw: unknown) {
  try {
    return normalizeSpec(raw);
  } catch (e) {
    if (e instanceof Invalid) throw new BadRequest(e.message);
    throw e;
  }
}

export interface V1Http {
  svc: V1Service;
  db: Db;
  guard: LoginGuard;
  tz: string;
  /** Whether any account has a vault here (for /healthz). */
  hasVault: () => boolean;
}

/** Serves one v1 request (`route` from routes.ts, already allowed on this entry). */
export async function serveV1(
  o: V1Http,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  route: string,
  params: Record<string, string>,
  listener: Listener,
): Promise<void> {
  const { svc, db } = o;
  try {
    if (route === "GET /healthz")
      return send(res, 200, {
        status: "ok",
        version: VERSION,
        api_version: API_VERSION,
        sources: { vault: o.hasVault() ? "ok" : "not_configured" },
      });
    if (route === "POST /api/v1/login") {
      const b = await body(req);
      const name = str(b, "user").trim().slice(0, 64);
      const password = str(b, "password");
      const device = str(b, "device").trim().slice(0, 80) || "equipo";
      const from = clientAddress(req.socket.remoteAddress, header(req, "x-forwarded-for"));
      if (!o.guard.allow(name, from)) {
        console.warn(`v1 login refused (too many attempts): ${JSON.stringify(name)} from ${from}`);
        res.setHeader("retry-after", "900");
        return err(res, 429, "too_many", "Demasiados intentos: espera unos minutos");
      }
      const r = login(db, name, password, device, listener);
      if (!r) {
        console.warn(`v1 login failed: ${JSON.stringify(name)} from ${from}`);
        o.guard.failed(name, from);
        return err(res, 401, "bad_login", "Usuario o contraseña incorrectos");
      }
      o.guard.succeeded(name);
      return send(res, 200, { token: r.token, user: r.user.name, device });
    }
    const token = tokenOf(req);
    if (route === "POST /api/v1/logout") {
      if (!token) return err(res, 401, "unauthorized", "Falta la sesión: entra con tu usuario");
      logout(db, token);
      return empty(res);
    }
    if (!token) return err(res, 401, "unauthorized", "Falta la sesión: entra con tu usuario");
    const s = sessionUser(db, token);
    if (!s) return err(res, 401, "unauthorized", "La sesión ha terminado: vuelve a entrar");
    const c: Caller = { account: s.user.id, device: s.device, vault: s.user.vault };
    const id = params.id ?? "";
    switch (route) {
      case "GET /api/v1/me":
        return send(res, 200, { user: s.user.name, device: s.device });
      case "GET /api/v1/events": {
        res.writeHead(200, {
          ...CORS,
          ...SAFE,
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-store",
          "x-accel-buffering": "no",
          connection: "keep-alive",
        });
        res.write(": connected\n\n");
        const off = svc.subscribe(c.account, (what) =>
          res.write(
            `event: changed\ndata: ${JSON.stringify({ what, at: new Date().toISOString() })}\n\n`,
          ),
        );
        const ping = setInterval(() => res.write(": ping\n\n"), 25_000);
        req.on("close", () => {
          off();
          clearInterval(ping);
        });
        return;
      }
      case "GET /api/v1/home":
        return send(res, 200, svc.home(c));
      case "GET /api/v1/screens/:id":
        return send(res, 200, svc.screen(c, id));
      case "GET /api/v1/options/:source": {
        const q = url.searchParams.get("q") ?? "";
        const rawLimit = url.searchParams.get("limit");
        const limit =
          rawLimit === null
            ? 50
            : /^\s*[+-]?\d+\s*$/.test(rawLimit)
              ? Number(rawLimit)
              : Number.NaN;
        if (!(limit >= 1 && limit <= 500)) throw new BadRequest("limit: entre 1 y 500");
        const source = params.source ?? "";
        return send(res, 200, { source, options: svc.options(c, source, q, limit) });
      }
      case "POST /api/v1/actions": {
        const b = await body(req);
        const action = str(b, "action");
        const clientId = canonicalUuid(b.client_id);
        if (!clientId) throw new BadRequest("client_id: no es un UUID");
        if (!isObj(b.values)) throw new BadRequest("values: tiene que ser un objeto");
        let createdAt: string | null = null;
        if (b.created_at !== undefined && b.created_at !== null) {
          createdAt = instant(b.created_at, o.tz);
          if (!createdAt) throw new BadRequest("created_at: fecha y hora no validas");
        }
        return send(
          res,
          200,
          svc.action(c, { action, client_id: clientId, values: b.values, created_at: createdAt }),
        );
      }
      case "GET /api/v1/charts":
        return send(res, 200, { charts: svc.store.charts(c.account) });
      case "POST /api/v1/charts":
        return send(res, 201, svc.createChart(c, specOf(await body(req))));
      case "GET /api/v1/charts/catalog":
        return send(res, 200, svc.catalog());
      case "POST /api/v1/charts/preview": {
        const b = await body(req);
        const drill = b.drill === undefined || b.drill === null ? null : str(b, "drill");
        return send(res, 200, svc.compute(c, specOf(b.spec), drill));
      }
      case "PUT /api/v1/charts/order":
        svc.orderCharts(c, ids(await body(req)));
        return send(res, 200, { charts: svc.store.charts(c.account) });
      case "GET /api/v1/charts/:id": {
        const spec = svc.store.chart(c.account, id);
        if (!spec) throw new NotFound(id);
        return send(res, 200, spec);
      }
      case "PUT /api/v1/charts/:id":
        return send(res, 200, svc.updateChart(c, id, specOf(await body(req))));
      case "DELETE /api/v1/charts/:id":
        svc.deleteChart(c, id);
        return empty(res);
      case "GET /api/v1/charts/:id/data":
        return send(res, 200, svc.chartData(c, id, url.searchParams.get("drill")));
      case "GET /api/v1/shortcuts":
        return send(res, 200, { shortcuts: svc.store.shortcuts(c.account) });
      case "POST /api/v1/shortcuts":
        return send(res, 201, svc.createShortcut(c, shortcutOf(await body(req))));
      case "PUT /api/v1/shortcuts/order":
        svc.orderShortcuts(c, ids(await body(req)));
        return send(res, 200, { shortcuts: svc.store.shortcuts(c.account) });
      case "PUT /api/v1/shortcuts/:id":
        return send(res, 200, svc.updateShortcut(c, id, shortcutOf(await body(req))));
      case "DELETE /api/v1/shortcuts/:id":
        svc.deleteShortcut(c, id);
        return empty(res);
      case "GET /api/v1/widgets":
        return send(res, 200, { widgets: svc.store.widgets(c.account, c.device) });
      case "POST /api/v1/widgets": {
        const w = widgetOf(await body(req));
        return send(res, 201, svc.addWidget(c, w.chartId, w.size));
      }
      case "PUT /api/v1/widgets/:id": {
        const w = widgetOf(await body(req));
        return send(res, 200, svc.updateWidget(c, id, w.chartId, w.size));
      }
      case "DELETE /api/v1/widgets/:id":
        svc.deleteWidget(c, id);
        return empty(res);
      default:
        return err(res, 404, "not_found", `No existe: ${url.pathname}`);
    }
  } catch (e) {
    if (e instanceof NotFound) return err(res, 404, "not_found", `No existe: ${e.message}`);
    if (e instanceof Unavailable) {
      console.warn(`v1: vault unavailable: ${e.message}`);
      return err(res, 503, "source_unavailable", "No se puede llegar a los datos ahora mismo");
    }
    if (e instanceof BadRequest) return err(res, 422, "bad_request", e.message);
    if (e instanceof Invalid) return err(res, 422, "invalid", e.message);
    throw e;
  }
}

async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  let b: unknown;
  try {
    b = await bodyOf(req);
  } catch {
    throw new BadRequest("El cuerpo no es JSON");
  }
  if (!isObj(b)) throw new BadRequest("El cuerpo tiene que ser un objeto");
  return b;
}
