import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { addUser, listUsers, revokeSessions } from "./auth.ts";
import { openDb } from "./db.ts";

/**
 * Administration (accounts are never created by sign-up):
 *   node src/cli.ts add-user <name> <vault folder>   asks for the password (or BONI_PASSWORD)
 *   node src/cli.ts users
 *   node src/cli.ts revoke <name>                    ends every session of that user
 */
const [cmd, ...args] = process.argv.slice(2);
const db = openDb(process.env.BONI_DB ?? "./data/boni-calendar.db");

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
  } else if (cmd === "revoke") {
    const [name] = args;
    if (!name) throw new Error("Usage: revoke <name>");
    console.log(`${revokeSessions(db, name)} sessions ended`);
  } else {
    console.log("Commands: add-user <name> <vault folder> | users | revoke <name>");
  }
} catch (e) {
  console.error((e as Error).message);
  process.exitCode = 1;
} finally {
  db.close();
}
