import { openDb } from "./db.ts";
import { makeServer } from "./http.ts";
import { Vaults } from "./vaults.ts";

/**
 * Boni Calendar server. Environment:
 *   BONI_DB     the SQLite file (accounts, sessions)          default ./data/boni-calendar.db
 *   BONI_PORT   port to listen on (behind Tailscale serve)    default 8787
 *   BONI_HOST   address to listen on                          default 127.0.0.1
 *   BONI_WEB    the built web app to serve (apps/web/dist)     optional
 */
const db = openDb(process.env.BONI_DB ?? "./data/boni-calendar.db");
const vaults = new Vaults();
const server = makeServer({ db, vaults, webDir: process.env.BONI_WEB ?? null });
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
