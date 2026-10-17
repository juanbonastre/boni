import { openDb } from "./db.ts";
import { Feeds, makeFetcher } from "./feeds.ts";
import { makeServer } from "./http.ts";
import { Push } from "./reminders.ts";
import { loadKey } from "./secret.ts";
import { Vaults } from "./vaults.ts";

/**
 * Boni Calendar server. Environment:
 *   BONI_DB     the SQLite file (accounts, sessions)          default ./data/boni-calendar.db
 *   BONI_PORT   port to listen on (behind Tailscale serve)    default 8787
 *   BONI_HOST   address to listen on                          default 127.0.0.1
 *   BONI_WEB    the built web app to serve (apps/web/dist)     optional
 *   BONI_WRITE  "1": devices may change the notes (the vault must be mounted writable)   default read-only
 *   BONI_SECRET_KEY  32 bytes in base64 to encrypt accounts' secrets   default: secret.key next to the DB
 *   BONI_FEEDS_ALLOW_PRIVATE  "1": external calendars may be on private addresses (tests only)
 *   BONI_PUSH_HOSTS  hosts devices may register as UnifiedPush addresses, comma separated (e.g. the ntfy
 *                    server); push is off without it
 *   BONI_PUSH_TOKEN  sent as a bearer token when posting to them (an ntfy account that may write up* topics)
 */
const dbPath = process.env.BONI_DB ?? "./data/boni-calendar.db";
const db = openDb(dbPath);
const key = loadKey(dbPath);
const feeds = new Feeds(
  makeFetcher({ allowPrivate: process.env.BONI_FEEDS_ALLOW_PRIVATE === "1" }),
);
const vaults = new Vaults({ write: process.env.BONI_WRITE === "1" });
const hosts = (process.env.BONI_PUSH_HOSTS ?? "")
  .split(",")
  .map((h) => h.trim().toLowerCase())
  .filter(Boolean);
const push = hosts.length
  ? new Push(db, {
      hosts,
      ...(process.env.BONI_PUSH_TOKEN ? { token: process.env.BONI_PUSH_TOKEN } : {}),
    })
  : undefined;
const server = makeServer({
  db,
  vaults,
  key,
  feeds,
  ...(push ? { push } : {}),
  webDir: process.env.BONI_WEB ?? null,
});
const port = Number(process.env.BONI_PORT ?? 8787);
const host = process.env.BONI_HOST ?? "127.0.0.1";
server.listen(port, host, () => console.log(`boni-calendar-server on http://${host}:${port}`));

const stop = () => {
  server.close();
  vaults.close();
  db.close();
  process.exit(0);
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
