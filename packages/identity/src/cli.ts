import {
  addAccount,
  devicesOf,
  listAccounts,
  openSystemDb,
  revokeAll,
  revokeDevice,
  setPassword,
} from "./identity.ts";
import { importAccounts } from "./import.ts";

/**
 * Administration of the single Boni account (accounts are never made by sign-up). The password is
 * read from BONI_PASSWORD (pass it with `read -rs`, never on the command line):
 *   node src/cli.ts accounts
 *   node src/cli.ts add-account <name> [vault folder]
 *   node src/cli.ts password <name>                       a new password ends every session
 *   node src/cli.ts devices <name>
 *   node src/cli.ts revoke <name> [device name or id]     one device, or every session
 *   node src/cli.ts import-accounts [--calendar <db>] [--boni <db>] [--password-from calendar|boni] [--apply]
 * BONI_SYSTEM_DB says where system.db is (default ./data/system.db).
 */
const [cmd, ...args] = process.argv.slice(2);
const db = openSystemDb(process.env.BONI_SYSTEM_DB ?? "./data/system.db");
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const password = () => {
  const p = process.env.BONI_PASSWORD;
  if (!p) throw new Error('Set BONI_PASSWORD (read -rs P; BONI_PASSWORD="$P" ...)');
  return p;
};

try {
  if (cmd === "accounts") {
    for (const a of listAccounts(db))
      console.log(
        `${a.name}\t${a.sessions} sessions${a.vault ? `\t${a.vault}` : ""}${a.disabled ? "\tdisabled" : ""}`,
      );
  } else if (cmd === "add-account") {
    const [name, vault] = args;
    if (!name) throw new Error("Usage: add-account <name> [vault folder]");
    const a = addAccount(db, name, password(), vault ? { vault } : {});
    console.log(`Account ${a.name}${a.vault ? ` -> ${a.vault}` : ""}`);
  } else if (cmd === "password") {
    const [name] = args;
    if (!name) throw new Error("Usage: password <name>");
    console.log(`Password changed; ${setPassword(db, name, password())} sessions ended`);
  } else if (cmd === "devices") {
    const [name] = args;
    if (!name) throw new Error("Usage: devices <name>");
    for (const d of devicesOf(db, name))
      console.log(
        `${d.name}\t${d.kind}\t${d.trust}\t${d.sessions} sessions\t${new Date(d.lastSeen).toISOString()}\t${d.id}`,
      );
  } else if (cmd === "revoke") {
    const [name, device] = args;
    if (!name) throw new Error("Usage: revoke <name> [device]");
    console.log(`${device ? revokeDevice(db, name, device) : revokeAll(db, name)} sessions ended`);
  } else if (cmd === "import-accounts") {
    const from = flag("password-from");
    if (from && from !== "calendar" && from !== "boni")
      throw new Error("--password-from calendar|boni");
    const calendar = flag("calendar");
    const boni = flag("boni");
    const r = importAccounts(db, {
      ...(calendar ? { calendar } : {}),
      ...(boni ? { boni } : {}),
      ...(from ? { passwordFrom: from as "calendar" | "boni" } : {}),
      apply: args.includes("--apply"),
    });
    console.log(r.applied ? "Imported:" : "Dry run (nothing written; add --apply):");
    for (const a of r.accounts)
      console.log(
        `  ${a.name}: from ${a.from.join(" + ")}, password ${a.password}, ${a.sessions} sessions${a.existing ? " (account already here)" : ""}`,
      );
    console.log(
      `  devices ${r.devices}; sessions ${r.sessions.imported} (already here ${r.sessions.already}, expired ${r.sessions.expired}); account data ${r.accountData}; push ${r.push}`,
    );
    if (r.oldDeviceTokens)
      console.log(`  Boni's old device tokens not moved: ${r.oldDeviceTokens}`);
  } else {
    console.log(
      "Commands: accounts | add-account <name> [vault] | password <name> | devices <name> | revoke <name> [device] | import-accounts ...",
    );
  }
} catch (e) {
  console.error((e as Error).message);
  process.exitCode = 1;
} finally {
  db.close();
}
