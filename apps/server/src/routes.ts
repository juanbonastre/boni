/**
 * Which API routes each entry of the server may serve (docs/nucleo.md, 11; Juan, 2026-10-19: the whole
 * API on the tailnet, an allow-list on the public entry behind Funnel). The list fails closed: a route
 * missing here is never served on the public entry, and routes.test.ts fails while any route of
 * http.ts is missing, so a new route cannot become public by accident. Today every route is the
 * calendar's, which was already public; the Boni API v1 (v1/http.ts, the first Boni's apps) is
 * "tailnet", as the first Boni's server was; the agent's will be too. A ":name" segment matches any
 * one segment; a fixed route wins over a pattern ("charts/order" before "charts/:id").
 */
export type Listener = "tailnet" | "public";

export const ROUTES: Readonly<Record<string, "public" | "tailnet">> = {
  "POST /api/login": "public",
  "POST /api/logout": "public",
  "GET /api/me": "public",
  "GET /api/snapshot": "public",
  "GET /api/changes": "public",
  "GET /api/stream": "public",
  "POST /api/apply": "public",
  "GET /api/account": "public",
  "PUT /api/account/prefs": "public",
  "PUT /api/account/externals": "public",
  "GET /api/external": "public",
  "PUT /api/collections/reminders": "public",
  "GET /api/reminders": "public",
  "PUT /api/push": "public",
  "DELETE /api/push": "public",
  "GET /healthz": "tailnet",
  "POST /api/v1/login": "tailnet",
  "POST /api/v1/logout": "tailnet",
  "GET /api/v1/me": "tailnet",
  "GET /api/v1/events": "tailnet",
  "GET /api/v1/home": "tailnet",
  "GET /api/v1/screens/:id": "tailnet",
  "GET /api/v1/options/:source": "tailnet",
  "POST /api/v1/actions": "tailnet",
  "GET /api/v1/charts": "tailnet",
  "POST /api/v1/charts": "tailnet",
  "GET /api/v1/charts/catalog": "tailnet",
  "POST /api/v1/charts/preview": "tailnet",
  "PUT /api/v1/charts/order": "tailnet",
  "GET /api/v1/charts/:id": "tailnet",
  "PUT /api/v1/charts/:id": "tailnet",
  "DELETE /api/v1/charts/:id": "tailnet",
  "GET /api/v1/charts/:id/data": "tailnet",
  "GET /api/v1/shortcuts": "tailnet",
  "POST /api/v1/shortcuts": "tailnet",
  "PUT /api/v1/shortcuts/order": "tailnet",
  "PUT /api/v1/shortcuts/:id": "tailnet",
  "DELETE /api/v1/shortcuts/:id": "tailnet",
  "GET /api/v1/widgets": "tailnet",
  "POST /api/v1/widgets": "tailnet",
  "PUT /api/v1/widgets/:id": "tailnet",
  "DELETE /api/v1/widgets/:id": "tailnet",
};

/**
 * The route of a request ("GET /api/v1/charts/:id") and its parameters, or the request itself
 * ("METHOD /path", no parameters) when no route has that shape.
 */
export function routeOf(
  method: string | undefined,
  pathname: string,
  routes: Readonly<Record<string, "public" | "tailnet">> = ROUTES,
): { route: string; params: Record<string, string> } {
  const own = `${method} ${pathname}`;
  if (Object.hasOwn(routes, own)) return { route: own, params: {} };
  const parts = pathname.split("/");
  for (const route of Object.keys(routes)) {
    const [m, path = ""] = route.split(" ");
    if (m !== method || !path.includes("/:")) continue;
    const want = path.split("/");
    if (want.length !== parts.length) continue;
    const params: Record<string, string> = {};
    let ok = true;
    for (let i = 0; i < want.length && ok; i++) {
      const w = want[i] as string;
      const p = parts[i] as string;
      if (w.startsWith(":")) {
        let v: string;
        try {
          v = decodeURIComponent(p);
        } catch {
          v = "";
        }
        if (v) params[w.slice(1)] = v;
        else ok = false;
      } else ok = w === p;
    }
    if (ok) return { route, params };
  }
  return { route: own, params: {} };
}

/** Whether `route` ("METHOD /path") may be served on `listener`. */
export function allowed(
  route: string,
  listener: Listener,
  routes: Readonly<Record<string, "public" | "tailnet">> = ROUTES,
): boolean {
  return listener === "tailnet" || (Object.hasOwn(routes, route) && routes[route] === "public");
}
