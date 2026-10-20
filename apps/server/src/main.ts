import { dirname, join } from "node:path";
import { AnthropicProvider } from "@boni/agent";
import { AgentHost } from "./agent.ts";
import { startBackups } from "./backups.ts";
import { Feeds, makeFetcher } from "./feeds.ts";
import { makeApp, serve } from "./http.ts";
import { Push } from "./reminders.ts";
import { loadKey } from "./secret.ts";
import { databasePaths, openServerDb } from "./startup.ts";
import { Vaults } from "./vaults.ts";

/**
 * Boni Calendar server. Environment:
 *   BONI_DB     the old calendar database: its accounts and sessions move to system.db once   default ./data/boni-calendar.db
 *   BONI_SYSTEM_DB  the single Boni account's system.db (accounts, devices, sessions)   default: next to BONI_DB
 *   BONI_PORT   port to listen on (behind Tailscale serve)    default 8787
 *   BONI_HOST   address to listen on                          default 127.0.0.1
 *   BONI_PUBLIC_PORT  a second entry serving only the public allow-list (routes.ts), for Funnel   optional
 *   BONI_PUBLIC_HOST  address of that entry                    default 0.0.0.0
 *   BONI_WEB    the built web app to serve (apps/calendar-web/dist)     optional
 *   BONI_BONI_WEB  Boni's built web app (apps/boni-web/dist), at /boni/ on the tailnet entry   optional
 *   BONI_WRITE  "1": devices may change the notes (the vault must be mounted writable)   default read-only
 *   BONI_SECRET_KEY  32 bytes in base64 to encrypt accounts' secrets   default: secret.key next to the DB
 *   BONI_FEEDS_ALLOW_PRIVATE  "1": external calendars may be on private addresses (tests only)
 *   BONI_PUSH_HOSTS  hosts devices may register as UnifiedPush addresses, comma separated (e.g. the ntfy
 *                    server); push is off without it
 *   BONI_PUSH_TOKEN  sent as a bearer token when posting to them (an ntfy account that may write up* topics)
 *   BONI_BACKUPS     daily copies of the database to keep in backups/ next to it   default 14 (0: none)
 *   BONI_TZ     the time zone of the Boni API v1 and of the agent ("today")   default Europe/Madrid
 *   ANTHROPIC_API_KEY  turns the agent on (tailnet only) with Anthropic's models; off without it
 *   BONI_PLANNER_MODEL / BONI_READER_MODEL   default claude-opus-5-5 / claude-haiku-4-5
 */
const paths = databasePaths();
const dbPath = paths.system;
const { db } = openServerDb(paths);
const key = loadKey(dbPath); // secret.key next to the databases, as before
const keep = Number(process.env.BONI_BACKUPS ?? 14);
const stopBackups =
  dbPath !== ":memory:" && keep > 0
    ? startBackups(db, join(dirname(dbPath), "backups"), keep)
    : () => {};
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
const tz = process.env.BONI_TZ ?? "Europe/Madrid";
const apiKey = process.env.ANTHROPIC_API_KEY ?? "";
const agent = new AgentHost({
  dataDir: dbPath === ":memory:" ? null : dirname(dbPath),
  providers: apiKey
    ? {
        planner: new AnthropicProvider({
          apiKey,
          model: process.env.BONI_PLANNER_MODEL ?? "claude-opus-5-5",
          effort: "medium",
          fallbacks: true,
        }),
        reader: new AnthropicProvider({
          apiKey,
          model: process.env.BONI_READER_MODEL ?? "claude-haiku-4-5",
        }),
      }
    : null,
  tz,
});
const app = makeApp({
  db,
  vaults,
  key,
  feeds,
  ...(push ? { push } : {}),
  webDir: process.env.BONI_WEB ?? null,
  boniWebDir: process.env.BONI_BONI_WEB ?? null,
  tz,
  agent,
});
const port = Number(process.env.BONI_PORT ?? 8787);
const host = process.env.BONI_HOST ?? "127.0.0.1";
// The whole API (the tailnet's entry). The log line is what the NAS notes check for.
const server = serve(app, "tailnet");
server.listen(port, host, () => console.log(`boni-calendar-server on http://${host}:${port}`));
console.log(agent.on ? "agent on (tailnet only)" : "agent off (no ANTHROPIC_API_KEY)");
// The public entry (behind Funnel): the same app, only the allow-list.
const publicPort = process.env.BONI_PUBLIC_PORT ? Number(process.env.BONI_PUBLIC_PORT) : null;
const publicServer = publicPort === null ? null : serve(app, "public");
if (publicServer && publicPort !== null) {
  const publicHost = process.env.BONI_PUBLIC_HOST ?? "0.0.0.0";
  publicServer.listen(publicPort, publicHost, () =>
    console.log(
      `boni-calendar-server public entry (allow-list) on http://${publicHost}:${publicPort}`,
    ),
  );
}

const stop = () => {
  stopBackups();
  app.close();
  agent.close();
  server.close();
  publicServer?.close();
  vaults.close();
  db.close();
  process.exit(0);
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
