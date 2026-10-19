import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { devicesOf, revokeDevice } from "@boni/identity";
import { addUser, listUsers, revokeSessions } from "./auth.ts";
import { databasePaths, openServerDb } from "./startup.ts";

/**
 * Administration (accounts are never created by sign-up). Same commands as before; they now work on
 * the single account's system.db (next to BONI_DB, see startup.ts):
 *   node src/cli.ts add-user <name> <vault folder>   asks for the password (or BONI_PASSWORD)
 *   node src/cli.ts users
 *   node src/cli.ts devices <name>                   the devices of an account, their trust and sessions
 *   node src/cli.ts revoke <name> [device]           ends the sessions of one device, or all of them
 */
const [cmd, ...args] = process.argv.slice(2);
const { db } = openServerDb(databasePaths());

async function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const answer = await rl.question(question);
  rl.close();
  return answer;
}

try {
  if (cmd === "add-user") {
    const [name, folder] = args;
    if (!name || !folder) throw new Error("Usage: add-user <name> <vault folder>");
    const vault = resolve(folder);
    if (!existsSync(vault) || !statSync(vault).isDirectory())
      throw new Error(`Not a folder: ${vault}`);
    const password = process.env.BONI_PASSWORD ?? (await ask("Password (12+ characters): "));
    const u = addUser(db, name, password, vault);
    console.log(`User ${u.name} -> ${u.vault}`);
  } else if (cmd === "users") {
    for (const u of listUsers(db)) console.log(`${u.name}\t${u.vault}`);
  } else if (cmd === "devices") {
    const [name] = args;
    if (!name) throw new Error("Usage: devices <name>");
    for (const d of devicesOf(db, name))
      console.log(
        `${d.name}\t${d.kind}\t${d.trust}\t${d.sessions} sessions\tlast ${new Date(d.lastSeen).toISOString()}`,
      );
  } else if (cmd === "revoke") {
    const [name, device] = args;
    if (!name) throw new Error("Usage: revoke <name> [device]");
    console.log(
      `${device ? revokeDevice(db, name, device) : revokeSessions(db, name)} sessions ended`,
    );
  } else {
    console.log(
      "Commands: add-user <name> <vault folder> | users | devices <name> | revoke <name> [device]",
    );
  }
} catch (e) {
  console.error((e as Error).message);
  process.exitCode = 1;
} finally {
  db.close();
}
