import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * The server downloads the external calendars of its accounts (phase 4), so a device needs no access
 * to Google or any other service, only to the server. A copy is kept in memory and reused for a few
 * minutes. Only public addresses are fetched: the server must not become a way into the NAS or the
 * tailnet (`allowPrivate` only for tests).
 */
export interface FeedCopy {
  text: string;
  at: number;
}

export type Fetcher = (url: string) => Promise<string>;

const FRESH_MS = 10 * 60_000;
const MAX_BYTES = 10_000_000;
const MAX_REDIRECTS = 4;

/** Loopback, private, link-local, carrier-grade NAT (the tailnet's 100.64/10) and other non-public addresses. */
export function isPrivateAddress(ip: string): boolean {
  const v4 = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
  if (isIP(v4) === 4) {
    const [a = 0, b = 0] = v4.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }
  const x = ip.toLowerCase();
  return x === "::" || x === "::1" || /^f[cd]/.test(x) || /^fe[89ab]/.test(x) || /^ff/.test(x);
}

async function checkHost(url: URL, allowPrivate: boolean): Promise<void> {
  if (url.protocol !== "https:" && url.protocol !== "http:")
    throw new Error("Only http(s) addresses");
  if (allowPrivate) return;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (addrs.length === 0 || addrs.some((a) => isPrivateAddress(a.address)))
    throw new Error("That address is not public");
}

/** Downloads a calendar: public addresses only, redirects checked too, size and time limited. */
export function makeFetcher(opts: { allowPrivate?: boolean } = {}): Fetcher {
  return async (address) => {
    let url = new URL(address.replace(/^webcal:\/\//i, "https://"));
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      await checkHost(url, !!opts.allowPrivate);
      const r = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(20_000) });
      const next = r.headers.get("location");
      if (r.status >= 300 && r.status < 400 && next) {
        url = new URL(next, url);
        continue;
      }
      if (!r.ok || !r.body) throw new Error(`HTTP ${r.status}`);
      const reader = r.body.getReader();
      const parts: Uint8Array[] = [];
      let size = 0;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > MAX_BYTES) {
          await reader.cancel();
          throw new Error("The calendar is too large");
        }
        parts.push(value);
      }
      return Buffer.concat(parts).toString("utf8");
    }
    throw new Error("Too many redirects");
  };
}

/** The last copy of each account's calendars, downloaded again when older than a few minutes. */
export class Feeds {
  private copies = new Map<string, FeedCopy & { url: string }>();
  private readonly fetcher: Fetcher;

  constructor(fetcher: Fetcher) {
    this.fetcher = fetcher;
  }

  async get(userId: number, id: string, url: string, fresh = false): Promise<FeedCopy> {
    const key = `${userId}:${id}`;
    const c = this.copies.get(key);
    if (c && c.url === url && !fresh && Date.now() - c.at < FRESH_MS)
      return { text: c.text, at: c.at };
    const text = await this.fetcher(url);
    const copy = { url, text, at: Date.now() };
    this.copies.set(key, copy);
    return { text, at: copy.at };
  }

  /** Forgets copies of calendars an account no longer has. */
  keepOnly(userId: number, ids: readonly string[]): void {
    for (const key of this.copies.keys()) {
      const [u, id] = key.split(":");
      if (Number(u) === userId && !ids.includes(id as string)) this.copies.delete(key);
    }
  }
}
