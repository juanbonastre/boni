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

/**
 * UnifiedPush (phase 5): each device session may register the address its distributor (the ntfy app)
 * gave it. When the account's calendar or settings change, the server posts a short message there and
 * the device asks for its reminders again. Only addresses on the configured hosts are accepted (the
 * server must not post anywhere a device says).
 */
export class Push {
  private timers = new Map<number, ReturnType<typeof setTimeout>>();
  private readonly db: Db;
  private readonly opts: { hosts: string[]; token?: string; delayMs?: number };

  constructor(db: Db, opts: { hosts: string[]; token?: string; delayMs?: number }) {
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

  register(tokenHash: string, userId: number, endpoint: string): void {
    this.db
      .prepare(
        `INSERT INTO push (token_hash, account_id, endpoint, updated) VALUES (?, ?, ?, ?)
         ON CONFLICT (token_hash) DO UPDATE SET endpoint = excluded.endpoint, updated = excluded.updated`,
      )
      .run(tokenHash, userId, endpoint, Date.now());
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

  private async send(userId: number): Promise<void> {
    const rows = this.db
      .prepare("SELECT token_hash, endpoint FROM push WHERE account_id = ?")
      .all(userId) as { token_hash: string; endpoint: string }[];
    await Promise.all(
      rows.map(async (r) => {
        if (!this.allowed(r.endpoint)) return this.unregister(r.token_hash);
        try {
          const res = await fetch(r.endpoint, {
            method: "POST",
            headers: this.opts.token ? { authorization: `Bearer ${this.opts.token}` } : {},
            body: "reminders",
            signal: AbortSignal.timeout(10_000),
          });
          // The distributor forgot this address (the app was removed): stop posting there.
          if (res.status === 404 || res.status === 410) this.unregister(r.token_hash);
        } catch (e) {
          console.warn("push failed", e instanceof Error ? e.message : e);
        }
      }),
    );
  }

  close(): void {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }
}
