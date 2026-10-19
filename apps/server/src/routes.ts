/**
 * Which API routes each entry of the server may serve (docs/nucleo.md, 11; Juan, 2026-10-19: the whole
 * API on the tailnet, an allow-list on the public entry behind Funnel). The list fails closed: a route
 * missing here is never served on the public entry, and routes.test.ts fails while any route of
 * http.ts is missing, so a new route cannot become public by accident. Today every route is the
 * calendar's, which was already public; the agent's will be "tailnet".
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
};

/** Whether `route` ("METHOD /path") may be served on `listener`. */
export function allowed(
  route: string,
  listener: Listener,
  routes: Readonly<Record<string, "public" | "tailnet">> = ROUTES,
): boolean {
  return listener === "tailnet" || routes[route] === "public";
}
