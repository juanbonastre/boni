import { ApiError, type BoniApi, NotConfiguredError, OfflineError } from "./api.ts";
import type { ChartData } from "./contract.ts";
import { readJson, type TextStore } from "./storage.ts";

/** What a chart card or widget shows: fresh data, the last saved data (offline), or nothing yet. */
export interface ChartState {
  data: ChartData | null;
  loading: boolean;
  /** The data comes from the device because the server could not be reached. */
  offline: boolean;
  error: "offline" | "not-configured" | string | null;
}

export const emptyState = (data: ChartData | null = null): ChartState => ({
  data,
  loading: true,
  offline: false,
  error: null,
});

/** Same file names as the first client: chart-<id>.json, chart-<id>--<drill>.json. */
export const cacheName = (chartId: string, drill?: string | null) =>
  `chart-${chartId}${drill ? `--${drill}` : ""}.json`.replace(/[^A-Za-z0-9._-]/g, "_");

/**
 * Loads chart data and keeps the last answer on the device so cards and widgets show something without network.
 * Every card showing the same chart shares one request per refresh: a load asks for a `generation` (the refresh
 * tick); an answer of that generation or newer, younger than `maxAgeMs`, is reused, and concurrent loads of the
 * same chart wait for the one in flight.
 */
export class ChartRepository {
  private readonly api: () => BoniApi | null;
  private readonly store: TextStore;
  private readonly maxAgeMs: number;
  private readonly now: () => number;
  private fresh = new Map<string, { generation: number; at: number; state: ChartState }>();
  private inFlight = new Map<string, Promise<ChartState>>();
  /** How many requests were actually sent (for tests). */
  requests = 0;

  constructor(api: () => BoniApi | null, store: TextStore, maxAgeMs = 5 * 60_000, now = Date.now) {
    this.api = api;
    this.store = store;
    this.maxAgeMs = maxAgeMs;
    this.now = now;
  }

  cached(chartId: string, drill?: string | null) {
    return readJson<ChartData>(this.store, cacheName(chartId, drill));
  }

  async load(chartId: string, drill: string | null = null, generation = 0): Promise<ChartState> {
    const key = cacheName(chartId, drill);
    const f = this.fresh.get(key);
    if (f && f.generation >= generation && this.now() - f.at < this.maxAgeMs) return f.state;
    const running = this.inFlight.get(key);
    if (running) return running;
    const job = this.fetch(chartId, drill, key).then((state) => {
      if (state.data && !state.offline && !state.error) {
        this.fresh.set(key, { generation, at: this.now(), state });
      }
      return state;
    });
    this.inFlight.set(key, job);
    try {
      return await job;
    } finally {
      this.inFlight.delete(key);
    }
  }

  private async fetch(chartId: string, drill: string | null, key: string): Promise<ChartState> {
    const api = this.api();
    const base = { loading: false, offline: false };
    if (!api) return { ...base, data: await this.cached(chartId, drill), error: "not-configured" };
    this.requests++;
    try {
      const data = await api.chartData(chartId, drill);
      await this.store.write(key, JSON.stringify(data));
      return { ...base, data, error: null };
    } catch (e) {
      const data = await this.cached(chartId, drill);
      if (e instanceof OfflineError) return { ...base, data, offline: true, error: "offline" };
      if (e instanceof NotConfiguredError) return { ...base, data, error: "not-configured" };
      if (e instanceof ApiError)
        return { ...base, data, offline: e.status >= 500, error: e.message };
      throw e;
    }
  }

  /** Forget fresh answers (the server changed, a chart was edited). */
  invalidate() {
    this.fresh.clear();
  }
}
