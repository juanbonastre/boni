import type { CollectionSnapshot, Row, RowChange } from "@boni-calendar/core";
import type { ExternalCal } from "./external.ts";
import { kvStore } from "./idb.ts";

/**
 * The client side of Boni Calendar Server (apps/server, docs/servidor.md): log in, take a snapshot,
 * follow its changes live (and catch up after a gap), keep the last snapshot on the device so the
 * calendar opens without a connection.
 */
export interface RemoteSnapshot extends CollectionSnapshot {
  version: number;
  ignored: { path: string; reason: string }[];
  problems: string[];
}

export interface RemoteChanges {
  version: number;
  full?: boolean;
  upserts: Row[];
  removes: string[];
}

/** What the account shares among its devices (phase 4): preferences and external calendars. */
export interface RemoteAccount {
  prefs: Record<string, string | number | boolean | null>;
  externals: ExternalCal[];
  /** 0 when the account never stored anything. */
  updated: number;
}

export class RemoteError extends Error {
  constructor(
    readonly kind: "unauthorized" | "network" | "server" | "conflict",
    message: string,
  ) {
    super(message);
  }
}

const clean = (url: string) => url.trim().replace(/\/+$/, "");

async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
  let r: Response;
  try {
    r = await fetch(url, init);
  } catch (e) {
    throw new RemoteError("network", e instanceof Error ? e.message : String(e));
  }
  if (r.status === 401) throw new RemoteError("unauthorized", "unauthorized");
  if (r.status === 409)
    throw new RemoteError(
      "conflict",
      ((await r.json()) as { conflict?: string[] }).conflict?.join(", ") ?? "conflict",
    );
  if (!r.ok) {
    // The server says why when it can (e.g. an external calendar it could not download).
    const why = ((await r.json().catch(() => ({}))) as { message?: string }).message;
    throw new RemoteError("server", why ?? `HTTP ${r.status}`);
  }
  return (await r.json()) as T;
}

/** A new session on this device. */
export async function login(
  server: string,
  user: string,
  password: string,
  device: string,
): Promise<string> {
  const r = await request<{ token: string }>(`${clean(server)}/api/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ user, password, device }),
  });
  return r.token;
}

export class Remote {
  readonly url: string;
  constructor(
    server: string,
    private readonly token: string,
  ) {
    this.url = clean(server);
  }

  private auth(): HeadersInit {
    return { authorization: `Bearer ${this.token}` };
  }

  snapshot(): Promise<RemoteSnapshot> {
    return request(`${this.url}/api/snapshot`, { headers: this.auth() });
  }

  changes(since: number): Promise<RemoteChanges> {
    return request(`${this.url}/api/changes?since=${since}`, { headers: this.auth() });
  }

  /** Writes row changes; `base` is the version this device had. New rows come back with their path. */
  apply(
    base: number,
    changes: readonly RowChange[],
  ): Promise<{ version: number; aliases: Record<string, string> }> {
    return request(`${this.url}/api/apply`, {
      method: "POST",
      headers: { ...this.auth(), "content-type": "application/json" },
      body: JSON.stringify({ base, changes }),
    });
  }

  account(): Promise<RemoteAccount> {
    return request(`${this.url}/api/account`, { headers: this.auth() });
  }

  putPrefs(prefs: RemoteAccount["prefs"]): Promise<{ updated: number }> {
    return this.put("/api/account/prefs", { prefs });
  }

  putExternals(externals: readonly ExternalCal[]): Promise<{ updated: number }> {
    return this.put("/api/account/externals", { externals });
  }

  /** An external calendar of the account, downloaded by the server (`fresh`: not its recent copy). */
  feed(id: string, fresh = false): Promise<{ text: string; at: number }> {
    const q = `id=${encodeURIComponent(id)}${fresh ? "&fresh=1" : ""}`;
    return request(`${this.url}/api/external?${q}`, { headers: this.auth() });
  }

  /** A calendar's reminders, written by the server in its definition note (phase 5). */
  setCollectionReminders(
    collectionId: string,
    edit: { reminders?: { timed: string; allDay: string } | null; eventColumn?: boolean },
  ): Promise<unknown> {
    return this.put("/api/collections/reminders", { collectionId, ...edit });
  }

  private put<T>(path: string, body: unknown): Promise<T> {
    return request(`${this.url}${path}`, {
      method: "PUT",
      headers: { ...this.auth(), "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  async logout(): Promise<void> {
    await request(`${this.url}/api/logout`, { method: "POST", headers: this.auth() }).catch(
      () => {},
    );
  }

  /**
   * Follows the live stream until `stop` is called: `onChanges` for every new version. When the
   * connection drops it waits (longer each time, up to a minute) and connects again; `onState` says
   * whether it is live.
   */
  follow(
    onChanges: (c: RemoteChanges) => void,
    onState: (live: boolean, error?: RemoteError) => void,
    onAccount: () => void = () => {},
  ): () => void {
    let stopped = false;
    let ctrl: AbortController | null = null;
    let wait = 1000;
    const run = async () => {
      while (!stopped) {
        ctrl = new AbortController();
        try {
          const r = await fetch(`${this.url}/api/stream`, {
            headers: this.auth(),
            signal: ctrl.signal,
          });
          if (r.status === 401) {
            onState(false, new RemoteError("unauthorized", "unauthorized"));
            return;
          }
          if (!r.ok || !r.body) throw new Error(`HTTP ${r.status}`);
          onState(true);
          wait = 1000;
          const reader = r.body.getReader();
          const decoder = new TextDecoder();
          let buf = "";
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            let cut = buf.indexOf("\n\n");
            while (cut >= 0) {
              const block = buf.slice(0, cut);
              buf = buf.slice(cut + 2);
              const data = block
                .split("\n")
                .filter((l) => l.startsWith("data: "))
                .map((l) => l.slice(6))
                .join("\n");
              if (data && /^event: changes$/m.test(block))
                onChanges(JSON.parse(data) as RemoteChanges);
              else if (/^event: account$/m.test(block)) onAccount();
              cut = buf.indexOf("\n\n");
            }
          }
        } catch (e) {
          if (stopped) return;
          onState(false, new RemoteError("network", e instanceof Error ? e.message : String(e)));
        }
        if (stopped) return;
        onState(false);
        await new Promise((r) => setTimeout(r, wait));
        wait = Math.min(60_000, wait * 2);
      }
    };
    void run();
    return () => {
      stopped = true;
      ctrl?.abort();
    };
  }
}

/** The last snapshot of each server and account, on this device. */
const saved = kvStore<RemoteSnapshot>("boni-calendar-server", "snapshots");
export const savedSnapshot = (key: string) => saved.get(key);
export const saveSnapshot = (key: string, s: RemoteSnapshot) => saved.put(key, s);
export const forgetSnapshot = (key: string) => saved.delete(key);

/** Changes this device made that the server has not taken yet (sent in order when it can). */
export interface Outbox {
  base: number;
  changes: RowChange[];
}
const outboxes = kvStore<Outbox[]>("boni-calendar-server-outbox", "outbox");
export const savedOutbox = async (key: string) => (await outboxes.get(key)) ?? [];
export const saveOutbox = (key: string, o: Outbox[]) => outboxes.put(key, o);

/** Applies a set of changes to rows: changed and new rows replace theirs, removed ones go. */
export function applyChanges(rows: readonly Row[], c: RemoteChanges): Row[] {
  const up = new Map(c.upserts.map((r) => [r.id, r]));
  const gone = new Set(c.removes);
  const out: Row[] = [];
  for (const r of rows) {
    if (gone.has(r.id)) continue;
    const next = up.get(r.id);
    out.push(next ?? r);
    up.delete(r.id);
  }
  out.push(...up.values());
  return out;
}
