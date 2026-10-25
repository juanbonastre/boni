import {
  type ActionRequest,
  type ActionResult,
  type ChartCatalog,
  type ChartData,
  type ChartSpec,
  type Option,
  parseScreen,
  parseShortcut,
  parseSpec,
  type Screen,
  type Shortcut,
  type Widget,
} from "./contract.ts";

/** The server answered with an error (bad token, not found, data source down...). */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** The server could not be reached at all (no network, laptop outside the tailnet, NAS off). */
export class OfflineError extends Error {}

/** No server configured yet. */
export class NotConfiguredError extends Error {}

/** One HTTP exchange with the server; `path` is relative to the server ("api/v1/..."). */
export interface Transport {
  request(
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    body?: unknown,
  ): Promise<TransportAnswer>;
}

export type TransportAnswer =
  | { ok: true; status: number; body: string }
  | { ok: false; offline: true; message: string }
  | { ok: false; offline: false; notConfigured: true };

const q = (params: Record<string, string | number | undefined>) => {
  const s = Object.entries(params)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join("&");
  return s ? `?${s}` : "";
};

/** API v1 client. Errors: `OfflineError`, `ApiError`, `NotConfiguredError`. */
export class BoniApi {
  private readonly transport: Transport;
  constructor(transport: Transport) {
    this.transport = transport;
  }

  private async call<V>(
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    body?: unknown,
  ): Promise<V> {
    const r = await this.transport.request(method, `api/v1/${path}`, body);
    if (!r.ok) {
      if (r.offline) throw new OfflineError(r.message);
      throw new NotConfiguredError("not configured");
    }
    if (r.status < 200 || r.status >= 300) {
      let code = `http_${r.status}`;
      let message = r.body.slice(0, 200);
      try {
        const e = JSON.parse(r.body)?.error;
        if (e?.code) code = String(e.code);
        if (e?.message) message = String(e.message);
      } catch {
        // not JSON: keep the text
      }
      throw new ApiError(r.status, code, message);
    }
    return (r.body ? JSON.parse(r.body) : null) as V;
  }

  home = async (): Promise<Screen> => parseScreen(await this.call("GET", "home"));
  screen = async (id: string): Promise<Screen> =>
    parseScreen(await this.call("GET", `screens/${encodeURIComponent(id)}`));
  charts = async (): Promise<ChartSpec[]> =>
    ((await this.call<{ charts: unknown[] }>("GET", "charts")).charts ?? []).map(parseSpec);
  chartData = (id: string, drill?: string | null) =>
    this.call<ChartData>(
      "GET",
      `charts/${encodeURIComponent(id)}/data${q({ drill: drill ?? undefined })}`,
    );
  catalog = () => this.call<ChartCatalog>("GET", "charts/catalog");
  createChart = async (spec: ChartSpec) => parseSpec(await this.call("POST", "charts", spec));
  updateChart = async (spec: ChartSpec) =>
    parseSpec(await this.call("PUT", `charts/${encodeURIComponent(spec.id)}`, spec));
  deleteChart = (id: string) => this.call<null>("DELETE", `charts/${encodeURIComponent(id)}`);
  orderCharts = async (ids: string[]) =>
    ((await this.call<{ charts: unknown[] }>("PUT", "charts/order", { ids })).charts ?? []).map(
      parseSpec,
    );
  preview = (spec: ChartSpec, drill?: string | null) =>
    this.call<ChartData>("POST", "charts/preview", { spec, drill: drill ?? null });
  widgets = async () => (await this.call<{ widgets: Widget[] }>("GET", "widgets")).widgets ?? [];
  addWidget = (chartId: string, size: string) =>
    this.call<Widget>("POST", "widgets", { chart_id: chartId, size });
  updateWidget = (id: string, chartId: string, size: string) =>
    this.call<Widget>("PUT", `widgets/${encodeURIComponent(id)}`, { chart_id: chartId, size });
  deleteWidget = (id: string) => this.call<null>("DELETE", `widgets/${encodeURIComponent(id)}`);
  shortcuts = async (): Promise<Shortcut[]> =>
    ((await this.call<{ shortcuts: unknown[] }>("GET", "shortcuts")).shortcuts ?? []).map(
      parseShortcut,
    );
  createShortcut = async (s: Shortcut) =>
    parseShortcut(await this.call("POST", "shortcuts", { ...s, id: "" }));
  updateShortcut = async (s: Shortcut) =>
    parseShortcut(await this.call("PUT", `shortcuts/${encodeURIComponent(s.id)}`, s));
  deleteShortcut = (id: string) => this.call<null>("DELETE", `shortcuts/${encodeURIComponent(id)}`);
  orderShortcuts = async (ids: string[]) =>
    (
      (await this.call<{ shortcuts: unknown[] }>("PUT", "shortcuts/order", { ids })).shortcuts ?? []
    ).map(parseShortcut);
  options = async (source: string, query = "", limit = 50) =>
    (
      await this.call<{ options: Option[] }>(
        "GET",
        `options/${encodeURIComponent(source)}${q({ q: query, limit })}`,
      )
    ).options ?? [];
  action = (request: ActionRequest) => this.call<ActionResult>("POST", "actions", request);
  /** Takes a capture just saved out again (its notice's Undo; the same device, minutes after). */
  undoAction = (clientId: string) =>
    this.call<ActionResult>("DELETE", `actions/${encodeURIComponent(clientId)}`);
}
