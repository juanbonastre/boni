import { fetchText, isBlockedAddress, NetSafetyError } from "@boni/net";

/**
 * The server downloads the external calendars of its accounts (phase 4), so a device needs no access
 * to Google or any other service, only to the server. A copy is kept in memory and reused for a few
 * minutes. Only public addresses are fetched, checked when connecting and on every redirect
 * (`@boni/net`): the server must not become a way into the NAS or the tailnet (`allowPrivate` only
 * for tests).
 */
export interface FeedCopy {
  text: string;
  at: number;
}

export type Fetcher = (url: string) => Promise<string>;

const FRESH_MS = 10 * 60_000;

/** Loopback, private, link-local, the tailnet's 100.64/10 and every other non-public address. */
export const isPrivateAddress = isBlockedAddress;

/** Downloads a calendar: public addresses only, redirects checked too, size and time limited. */
export function makeFetcher(opts: { allowPrivate?: boolean } = {}): Fetcher {
  return async (address) => {
    try {
      const r = await fetchText(address.replace(/^webcal:\/\//i, "https://"), {
        allowPrivate: !!opts.allowPrivate,
        maxBytes: 10_000_000,
        timeoutMs: 20_000,
        maxRedirects: 4,
      });
      return r.text;
    } catch (e) {
      if (e instanceof NetSafetyError && e.code === "too-large")
        throw new Error("The calendar is too large");
      throw e;
    }
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
