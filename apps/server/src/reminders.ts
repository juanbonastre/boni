import { randomUUID } from "node:crypto";
import {
  type CalEvent,
  hasReminders,
  makeModel,
  parseIcal,
  parseReminderDefaults,
  type ReminderDefaults,
  rowToEvent,
} from "@boni/calendar";
import { type Notice, noticesFor } from "@boni/calendar-web/src/notifications.ts";
import type { Account } from "./account.ts";
import type { CalendarSource } from "./calendarStore.ts";
import type { Db } from "./db.ts";
import type { Feeds } from "./feeds.ts";
import { encrypt, type PushKeys, validKeys } from "./webpush.ts";

/**
 * Reminders for a device that is not running the calendar (phase 5): the Android app asks for the
 * notices of the coming days and sets them as system alarms. The server words them as the app would,
 * in the device's timezone and language; external calendars that remind are downloaded here too.
 */
export async function noticesOfAccount(
  calendar: Pick<CalendarSource, "snapshot">,
  account: Account,
  feeds: Feeds,
  userId: number,
  opts: { tz: string; hours: number; locale: "es" | "en"; h24: boolean; now?: number },
): Promise<Notice[]> {
  const snap = await calendar.snapshot();
  const model = makeModel(snap.collections, snap.views, { defaultTz: opts.tz });
  const events: CalEvent[] = [];
  for (const row of snap.rows) {
    const ev = rowToEvent(model, row);
    if (ev) events.push(ev);
  }
  const defaults = new Map<string, ReminderDefaults>();
  for (const v of snap.views) if (v.reminders) defaults.set(v.id, v.reminders);
  for (const ext of account.externals) {
    const d = parseReminderDefaults(ext.reminders);
    if (!hasReminders(d)) continue;
    defaults.set(ext.id, d);
    try {
      const copy = await feeds.get(userId, ext.id, ext.url);
      events.push(...parseIcal(copy.text, { calendarId: ext.id, defaultTz: opts.tz }).events);
    } catch {
      // Not reachable now: its reminders wait for the next time the device asks.
    }
  }
  return noticesFor(events, (id) => defaults.get(id), { ...opts, now: opts.now ?? Date.now() });
}

/** What an address is for: Boni Calendar's reminders, or Boni's notices (task 62). */
export type PushKind = "reminders" | "notices";

/** At most this many notices go to an account's devices in an hour: a flow that notifies in a loop stops there. */
export const NOTICES_PER_HOUR = 10;

/**
 * UnifiedPush (phase 5): each device session may register the address its distributor (the ntfy app)
 * gave it. When the account's calendar or settings change, the server posts a short message there and
 * the device asks for its reminders again; that message carries nothing. Only addresses on the configured
 * hosts are accepted (the server must not post anywhere a device says).
 * Boni's notices (task 62, A-17): Boni's app registers its address «for notices» with the Web Push keys it
 * made, and a notice of Boni's (the agent's `notify`, a flow's «Avisar») goes to the account's addresses for
 * notices at once, sealed for each device (webpush.ts): the distributor never reads it. The recipient is the
 * code's: the account's own devices, never an argument (docs/nucleo.md 7.9).
 */
export class Push {
  private timers = new Map<number, ReturnType<typeof setTimeout>>();
  /** When each account's latest notices went out (the hourly cap). */
  private sentAt = new Map<number, number[]>();
  private readonly db: Db;
  private readonly opts: {
    hosts: string[];
    token?: string;
    delayMs?: number;
    now?: () => number;
    log?: (line: string) => void;
  };

  constructor(
    db: Db,
    opts: {
      hosts: string[];
      token?: string;
      delayMs?: number;
      now?: () => number;
      log?: (line: string) => void;
    },
  ) {
    this.db = db;
    this.opts = opts;
  }

  /** Whether a device may register this address. */
  allowed(endpoint: string): boolean {
    try {
      const u = new URL(endpoint);
      return (
        (u.protocol === "https:" || u.protocol === "http:") &&
        this.opts.hosts.includes(u.host.toLowerCase())
      );
    } catch {
      return false;
    }
  }

  /** This session's address: for reminders, or for notices with the keys its device made (never in the clear). */
  register(tokenHash: string, userId: number, endpoint: string, notices?: PushKeys): void {
    this.db
      .prepare(
        `INSERT INTO push (token_hash, account_id, endpoint, updated, kind, p256dh, auth) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (token_hash) DO UPDATE SET endpoint = excluded.endpoint, updated = excluded.updated,
           kind = excluded.kind, p256dh = excluded.p256dh, auth = excluded.auth`,
      )
      .run(
        tokenHash,
        userId,
        endpoint,
        Date.now(),
        notices ? "notices" : "reminders",
        notices?.p256dh ?? null,
        notices?.auth ?? null,
      );
  }

  unregister(tokenHash: string): void {
    this.db.prepare("DELETE FROM push WHERE token_hash = ?").run(tokenHash);
  }

  /** Something of these accounts changed: tell their devices a moment later (one message per burst). */
  changed(userIds: readonly number[]): void {
    for (const id of userIds) {
      if (this.timers.has(id)) continue;
      this.timers.set(
        id,
        setTimeout(() => {
          this.timers.delete(id);
          void this.send(id);
        }, this.opts.delayMs ?? 5000),
      );
    }
  }

  private rows(userId: number, kind: PushKind) {
    return this.db
      .prepare(
        "SELECT token_hash, endpoint, p256dh, auth FROM push WHERE account_id = ? AND kind = ?",
      )
      .all(userId, kind) as {
      token_hash: string;
      endpoint: string;
      p256dh: string | null;
      auth: string | null;
    }[];
  }

  private async send(userId: number): Promise<void> {
    await Promise.all(
      this.rows(userId, "reminders").map((r) =>
        this.post(r.token_hash, r.endpoint, "reminders", {}),
      ),
    );
  }

  /**
   * A notice of Boni's for the account's devices that show them (Boni's app), now: its text (cut at 500, as
   * `notify` cuts it), sealed for each device with its own keys. Returns how many devices it was sent to; none
   * past the hourly cap (said in the log).
   */
  async notice(userId: number, text: string): Promise<number> {
    const rows = this.rows(userId, "notices");
    if (!rows.length) return 0;
    const now = this.opts.now?.() ?? Date.now();
    const recent = (this.sentAt.get(userId) ?? []).filter((t) => now - t < 3_600_000);
    if (recent.length >= NOTICES_PER_HOUR) {
      this.log(`push ${userId}: notice not sent, ${NOTICES_PER_HOUR} already in the last hour`);
      return 0;
    }
    recent.push(now);
    this.sentAt.set(userId, recent);
    const payload = Buffer.from(
      JSON.stringify({ kind: "notice", id: randomUUID(), text: text.slice(0, 500), at: now }),
    );
    const sent = await Promise.all(
      rows.map((r) => {
        const keys = { p256dh: r.p256dh ?? "", auth: r.auth ?? "" };
        if (!validKeys(keys)) {
          this.unregister(r.token_hash);
          return false;
        }
        let body: Buffer;
        try {
          body = encrypt(payload, keys);
        } catch {
          // Keys that are not a point of the curve: that address can never be told anything.
          this.unregister(r.token_hash);
          return false;
        }
        // RFC 8030: how it is sealed, how long it may wait for the device (a day) and that it should wake it.
        return this.post(r.token_hash, r.endpoint, body, {
          "content-encoding": "aes128gcm",
          "content-type": "application/octet-stream",
          ttl: "86400",
          urgency: "high",
        });
      }),
    );
    const n = sent.filter(Boolean).length;
    this.log(`push ${userId}: notice sent to ${n} of ${rows.length} devices`);
    return n;
  }

  /** One post to a distributor's address; false when it did not take it. */
  private async post(
    tokenHash: string,
    endpoint: string,
    body: string | Buffer,
    headers: Record<string, string>,
  ): Promise<boolean> {
    if (!this.allowed(endpoint)) {
      this.unregister(tokenHash);
      return false;
    }
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          ...headers,
          ...(this.opts.token ? { authorization: `Bearer ${this.opts.token}` } : {}),
        },
        body: typeof body === "string" ? body : new Uint8Array(body),
        signal: AbortSignal.timeout(10_000),
      });
      // The distributor forgot this address (the app was removed): stop posting there.
      if (res.status === 404 || res.status === 410) this.unregister(tokenHash);
      return res.ok;
    } catch (e) {
      console.warn("push failed", e instanceof Error ? e.message : e);
      return false;
    }
  }

  private log(line: string): void {
    (this.opts.log ?? console.log)(line);
  }

  close(): void {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }
}
