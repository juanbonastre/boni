import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { ensureSystemTypes } from "@boni/agent";
import { exportChunks, importExport, readZip, releaseSent } from "@boni/export";
import {
  devicesOf,
  importAccounts,
  issueSession,
  revokeDevice,
  wrappedKeysIn,
} from "@boni/identity";
import { openUserStore, restoreBackup, wrappedKeyProvider } from "@boni/store";
import { addUser, listUsers, revokeSessions } from "./auth.ts";
import { planFromNote, reshape, undoReshape } from "./reshape.ts";
import { loadKey } from "./secret.ts";
import { databasePaths, openServerDb } from "./startup.ts";
import { V1Store } from "./v1/store.ts";

/**
 * Administration (accounts are never created by sign-up). Same commands as before; they now work on
 * the single account's system.db (next to BONI_DB, see startup.ts):
 *   node src/cli.ts add-user <name>                  asks for the password (or BONI_PASSWORD)
 *   node src/cli.ts users
 *   node src/cli.ts devices <name>                   the devices of an account, their trust and sessions
 *   node src/cli.ts revoke <name> [device]           ends the sessions of one device, or all of them
 *   node src/cli.ts import-boni <boni.sqlite3> <name> [--apply]
 *       the first Boni server's accounts and sessions (devices stay logged in) and its charts,
 *       shortcuts, widgets, preferences and captures, into account <name>; a dry run without --apply.
 *       Running it again moves nothing twice.
 *   node src/cli.ts export <name> <file.zip> [--log] everything of the account in one zip (docs/nucleo.md 9.3)
 *   node src/cli.ts import-export <file.zip> <name> [--apply] [--trust-labels]
 *       an export back into account <name> (ids already there are left alone); a dry run without --apply.
 *       --trust-labels keeps the file's provenance labels (only for an export of one's own that never left).
 *   node src/cli.ts restore <name> <backups/user-<id>-<day>.db.sealed> <out.db>
 *       opens one of the account's encrypted copies into a plain file; never over a file.
 *   node src/cli.ts token <name> <device>          a session for an assistant's tools (Boni's MCP), shown once
 *   node src/cli.ts reshape <name> (--plan <file.json> | --plan-note <id>) [--apply]
 *       the account's tree reshaped as a plan says (src/reshape.ts): a dry run with counts by default; applied, one
 *       run in one transaction. The plan may live in a note of the account (its first ```json block).
 *   node src/cli.ts reshape <name> --undo <run>      that reshape taken back whole
 */
const [cmd, ...args] = process.argv.slice(2);
const paths = databasePaths();
const { db } = openServerDb(paths);

async function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const answer = await rl.question(question);
  rl.close();
  return answer;
}

try {
  if (cmd === "add-user") {
    const [name] = args;
    if (!name) throw new Error("Usage: add-user <name>");
    const password = process.env.BONI_PASSWORD ?? (await ask("Password (12+ characters): "));
    const u = addUser(db, name, password);
    console.log(`User ${u.name} (${u.id})`);
  } else if (cmd === "users") {
    for (const u of listUsers(db)) console.log(`${u.name}\t${u.id}`);
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
  } else if (cmd === "import-boni") {
    const apply = args.includes("--apply");
    const [file, name] = args.filter((a) => a !== "--apply");
    if (!file || !name) throw new Error("Usage: import-boni <boni.sqlite3> <name> [--apply]");
    if (!existsSync(file)) throw new Error(`No such file: ${file}`);
    const accounts = importAccounts(db, { boni: resolve(file), apply });
    for (const a of accounts.accounts)
      console.log(
        `account ${a.name}${a.existing ? "" : " (new)"}: ${a.sessions} sessions, password from ${a.password}`,
      );
    // Charts and the rest go to the account; in a dry run they are written and rolled back.
    db.exec("SAVEPOINT import_boni");
    try {
      const store = new V1Store(db);
      const id = (
        db.prepare("SELECT id FROM accounts WHERE name = ?").get(name) as { id: number } | undefined
      )?.id;
      if (id === undefined && apply) throw new Error(`No account ${name}`);
      const n = store.importFrom(resolve(file), id ?? -1);
      console.log(
        `${n.charts} charts, ${n.shortcuts} shortcuts, ${n.widgets} widgets, ${n.prefs} preferences, ${n.captures} captures -> ${name}`,
      );
      db.exec(apply ? "RELEASE import_boni" : "ROLLBACK TO import_boni; RELEASE import_boni");
    } catch (e) {
      db.exec("ROLLBACK TO import_boni; RELEASE import_boni");
      throw e;
    }
    console.log(apply ? "Imported." : "Dry run: nothing written (add --apply).");
  } else if (cmd === "restore") {
    const [name, sealed, out] = args;
    if (!name || !sealed || !out)
      throw new Error("Usage: restore <name> <file.db.sealed> <out.db>");
    const user = listUsers(db).find((u) => u.name === name);
    if (!user) throw new Error(`No account ${name}`);
    if (existsSync(out)) throw new Error(`${out} exists: choose a new file`);
    const key = wrappedKeyProvider(loadKey(paths.system), wrappedKeysIn(db)).dataKey(
      String(user.id),
    );
    restoreBackup(sealed, key, out);
    console.log(`${out}: restored (stop the server before putting it in place)`);
  } else if (cmd === "export" || cmd === "import-export") {
    const flags = new Set(args.filter((a) => a.startsWith("--")));
    const [a, b] = args.filter((x) => !x.startsWith("--"));
    const [name, file] = cmd === "export" ? [a, b] : [b, a];
    if (!name || !file)
      throw new Error(
        "Usage: export <name> <file.zip> [--log] | import-export <file.zip> <name> [--apply] [--trust-labels]",
      );
    const user = listUsers(db).find((u) => u.name === name);
    if (!user) throw new Error(`No account ${name}`);
    if (paths.system === ":memory:") throw new Error("No data folder (BONI_DB)");
    const users = join(dirname(paths.system), "users");
    mkdirSync(users, { recursive: true, mode: 0o700 });
    const store = openUserStore(join(users, `${user.id}.db`));
    ensureSystemTypes(store);
    try {
      if (cmd === "export") {
        const v1 = new V1Store(db);
        // Written as it is made (exportChunks): never the whole zip in memory.
        const out = openSync(file, "w", 0o600);
        let bytes = 0;
        const release = releaseSent();
        try {
          for (const c of exportChunks(store, {
            views: { charts: v1.charts(user.id), shortcuts: v1.shortcuts(user.id) },
            log: flags.has("--log"),
          })) {
            writeSync(out, c);
            bytes += c.length;
            release(c.length);
          }
        } finally {
          closeSync(out);
        }
        console.log(`${file}: ${bytes} bytes`);
      } else {
        const r = importExport(readZip(readFileSync(file)), store, {
          apply: flags.has("--apply"),
          trustLabels: flags.has("--trust-labels"),
          name: file.split("/").pop() ?? file,
        });
        for (const t of r.types)
          console.log(`${t.name} (${t.key})${t.created ? " (new type)" : ""}: ${t.entities}`);
        console.log(
          `${r.created} entities to create, ${r.existing.length} already here, ${r.failed.length} failed`,
        );
        for (const f of r.failed.slice(0, 20)) console.log(`  ${f.id}: ${f.error}`);
        console.log(r.applied ? "Imported." : "Dry run: nothing written (add --apply).");
      }
    } finally {
      store.close();
    }
  } else if (cmd === "token") {
    // A session for an assistant's tools (Boni's MCP), made by the admin: shown once, kept only as a hash.
    const [name, device] = args;
    if (!name || !device)
      throw new Error("Usage: token <name> <device> (e.g. token juan claude-code)");
    const r = issueSession(db, name, device, { listener: "tailnet" });
    if (!r) throw new Error(`No account ${name}`);
    console.log(`A session for ${name} on the device "${r.device.name}" (${r.device.trust}).`);
    console.log("Its token (shown only now; revoke it with: revoke <name> <device>):");
    console.log(r.token);
  } else if (cmd === "reshape") {
    const usage =
      "Usage: reshape <name> (--plan <file.json> | --plan-note <id>) [--apply] | reshape <name> --undo <run>";
    const [name] = args.filter((a) => !a.startsWith("--"));
    const user = listUsers(db).find((u) => u.name === name);
    const opt = (k: string) => {
      const i = args.indexOf(k);
      return i >= 0 ? args[i + 1] : undefined;
    };
    if (!name || !user) throw new Error(usage);
    if (paths.system === ":memory:") throw new Error("No data folder (BONI_DB)");
    const store = openUserStore(join(dirname(paths.system), "users", `${user.id}.db`));
    try {
      const undo = opt("--undo");
      if (undo) {
        console.log(`Deshecho: ${undoReshape(store, undo, "cli")} cambios de ${undo}.`);
      } else {
        const file = opt("--plan");
        const note = opt("--plan-note");
        const plan = file
          ? JSON.parse(readFileSync(file, "utf8"))
          : note
            ? planFromNote(store, note)
            : undefined;
        if (plan === undefined) throw new Error(usage);
        const apply = args.includes("--apply");
        // A dry run works on a copy, so the apps go on writing meanwhile (the real one is one transaction).
        const copy = apply
          ? null
          : `${join(dirname(paths.system), "users", `${user.id}`)}.ensayo.db`;
        if (copy) {
          rmSync(copy, { force: true });
          store.copyTo(copy);
        }
        const on = copy ? openUserStore(copy) : store;
        let r: ReturnType<typeof reshape>;
        try {
          r = reshape(on, plan, { apply, device: "cli" });
        } finally {
          if (copy) {
            on.close();
            for (const f of [copy, `${copy}-wal`, `${copy}-shm`]) rmSync(f, { force: true });
          }
        }
        for (const line of r.lines) console.log(line);
        for (const p of r.problems) console.log(`PROBLEMA: ${p}`);
        if (r.problems.length) process.exitCode = 1;
        else if (r.applied)
          console.log(
            `Hecho, en una sola ejecución (${r.run}). Para deshacerlo todo: reshape ${name} --undo ${r.run}`,
          );
        else console.log("Ensayo: no se ha cambiado nada (añade --apply).");
      }
    } finally {
      store.close();
    }
  } else {
    console.log(
      "Commands: add-user <name> | users | devices <name> | revoke <name> [device] | token <name> <device> | import-boni <boni.sqlite3> <name> [--apply] | export <name> <file.zip> | import-export <file.zip> <name> | restore <name> <file.db.sealed> <out.db> | reshape <name> (--plan <file> | --plan-note <id>) [--apply] | reshape <name> --undo <run>",
    );
  }
} catch (e) {
  console.error((e as Error).message);
  process.exitCode = 1;
} finally {
  db.close();
}
