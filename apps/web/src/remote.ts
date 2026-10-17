import type { CollectionSnapshot, Row } from "@boni-calendar/core";
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

export class RemoteError extends Error {
  constructor(
    readonly kind: "unauthorized" | "network" | "server",
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
  if (!r.ok) throw new RemoteError("server", `HTTP ${r.status}`);
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
