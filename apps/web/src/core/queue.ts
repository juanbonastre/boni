import { ApiError, OfflineError } from "./api.ts";
import type { ActionRequest, ActionResult } from "./contract.ts";
import { readJson, Serial, type TextStore } from "./storage.ts";

/** A capture the server has not accepted yet, or that it rejected later (kept to show it). */
export interface QueuedAction {
  request: ActionRequest;
  error?: string | null;
}

/**
 * Captures that could not reach the server. Every request keeps its `client_id`, so sending it twice never
 * duplicates an expense (the server is idempotent). Order is kept. Same file and format as the first client.
 */
export class OfflineQueue {
  private readonly store: TextStore;
  private readonly file: string;
  private readonly serial = new Serial();

  constructor(store: TextStore, file = "queue.json") {
    this.store = store;
    this.file = file;
  }

  async items(): Promise<QueuedAction[]> {
    const list = await readJson<QueuedAction[]>(this.store, this.file);
    return Array.isArray(list) ? list : [];
  }

  async pending(): Promise<number> {
    return (await this.items()).filter((i) => !i.error).length;
  }

  private save(items: QueuedAction[]) {
    return items.length
      ? this.store.write(this.file, JSON.stringify(items))
      : this.store.remove(this.file);
  }

  add(request: ActionRequest) {
    return this.serial.run(async () => this.save([...(await this.items()), { request }]));
  }

  dismiss(clientId: string) {
    return this.serial.run(async () =>
      this.save((await this.items()).filter((i) => i.request.client_id !== clientId)),
    );
  }

  /**
   * Sends pending items in order through `send`, stopping at the first one that can't reach the server.
   * Accepted (`ok`, or `queued` = the server keeps it in its own outbox): removed. Rejected (`invalid`,
   * `error`, a 4xx): kept with its message so the user can see what failed. Returns how many were delivered.
   */
  flush(send: (r: ActionRequest) => Promise<ActionResult>): Promise<number> {
    return this.serial.run(async () => {
      let delivered = 0;
      let offline = false;
      const remaining: QueuedAction[] = [];
      for (const item of await this.items()) {
        if (offline || item.error) {
          remaining.push(item);
          continue;
        }
        try {
          const r = await send(item.request);
          if (r.status === "ok" || r.status === "queued") delivered++;
          else {
            const detail = [
              ...(r.message ? [r.message] : []),
              ...Object.entries(r.field_errors ?? {}).map(([k, v]) => `${k}: ${v}`),
            ].join("; ");
            remaining.push({ ...item, error: detail || r.status });
          }
        } catch (e) {
          if (e instanceof ApiError && e.status !== 401 && e.status < 500) {
            remaining.push({ ...item, error: e.message });
          } else {
            // offline, a bad token or the server failing: try again later
            if (!(e instanceof OfflineError) && !(e instanceof ApiError)) throw e;
            offline = true;
            remaining.push(item);
          }
        }
      }
      await this.save(remaining);
      return delivered;
    });
  }
}
