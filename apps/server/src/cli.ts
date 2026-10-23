import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { ensureSystemTypes } from "@boni/agent";
import { frontmatterData, parseCollectionDef } from "@boni/calendar";
import { exportChunks, importExport, readZip, releaseSent } from "@boni/export";
import {
  devicesOf,
  importAccounts,
  issueSession,
  revokeDevice,
  wrappedKeysIn,
} from "@boni/identity";
import { Mirror, type MirrorFs, openMirrorState, type Profile } from "@boni/mirror";
import { openUserStore, restoreBackup, type UserStore, wrappedKeyProvider } from "@boni/store";
import { addUser, listUsers, revokeSessions } from "./auth.ts";
import { CALENDAR_DEFS, calendarDefs, saveCalendarDefs } from "./calendarStore.ts";
import { mirrorStatePath } from "./mirror.ts";
import { moneyCollections } from "./money/collections.ts";
import { loadKey } from "./secret.ts";
import { databasePaths, openServerDb } from "./startup.ts";
import { V1Store } from "./v1/store.ts";
import { vaultOff, vaultOn } from "./vaultOff.ts";

/**
 * Administration (accounts are never created by sign-up). Same commands as before; they now work on
 * the single account's system.db (next to BONI_DB, see startup.ts):
 *   node src/cli.ts add-user <name> <vault folder>   asks for the password (or BONI_PASSWORD)
 *   node src/cli.ts users
 *   node src/cli.ts devices <name>                   the devices of an account, their trust and sessions
 *   node src/cli.ts revoke <name> [device]           ends the sessions of one device, or all of them
 *   node src/cli.ts import-boni <boni.sqlite3> <name> [--apply]
 *       the first Boni server's accounts and sessions (devices stay logged in) and its charts,
 *       shortcuts, widgets, preferences and captures, into account <name>; a dry run without --apply.
 *       Running it again moves nothing twice.
 *   node src/cli.ts mirror <name>                    each type of the account and its mode (vault, core, none)
 *   node src/cli.ts mirror <name> <type> [--profile generic|vault] [--folder <folder>] [--apply]
 *       switches a type to core mode (docs/nucleo.md 9.1): the core becomes the truth and its notes the
 *       mirror. Without --apply only the report (how many notes, which differ, which the core does not have).
 *   node src/cli.ts mirror <name> <type> --stop      stops mirroring it (its notes stay as they are)
 *   node src/cli.ts export <name> <file.zip> [--log] everything of the account in one zip (docs/nucleo.md 9.3)
 *   node src/cli.ts import-export <file.zip> <name> [--apply] [--trust-labels]
 *       an export back into account <name> (ids already there are left alone); a dry run without --apply.
 *       --trust-labels keeps the file's provenance labels (only for an export of one's own that never left).
 *   node src/cli.ts restore <name> <backups/user-<id>-<day>.db.sealed> <out.db>
 *       opens one of the account's encrypted copies (store or mirror state) into a plain file; never over a file.
 *   node src/cli.ts token <name> <device>          a session for an assistant's tools (Boni's MCP), shown once
 *   node src/cli.ts mirror <name> --vault-off [--apply] | --vault-on [<folder>] [--apply]
 *       the account without its vault folder (once its calendar and movements live in Boni): the mirror stops,
 *       the notes on disk stay as they are; --vault-on gives the folder back.
 *   node src/cli.ts mirror <name> --money [--apply]
 *       the money's categories note and reglas.csv into the collections Categorías and Reglas, each movement's
 *       category into a relation to its row (dry run by default; applied, one run that undo takes back).
 *   node src/cli.ts mirror <name> --calendar [--apply | --stop]
 *       the account's calendar from Boni (once every calendar's collection is in core mode): copies the
 *       definitions of _system/colecciones/ into the store; --stop serves it from the vault again.
 */
const [cmd, ...args] = process.argv.slice(2);
const paths = databasePaths();
const { db } = openServerDb(paths);
const require = createRequire(import.meta.url);
const { openVault } = require("../../calendar-desktop/vault-fs.cjs") as {
  openVault: (root: string) => MirrorFs;
};

/** `--name value` from the arguments (and the rest without them). */
function option(list: string[], name: string): { value: string | null; rest: string[] } {
  const i = list.indexOf(name);
  if (i < 0) return { value: null, rest: list };
  return { value: list[i + 1] ?? null, rest: [...list.slice(0, i), ...list.slice(i + 2)] };
}

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
  } else if (cmd === "mirror" && (args.includes("--vault-off") || args.includes("--vault-on"))) {
    const [name, folder] = args.filter((a) => !a.startsWith("--"));
    const user = listUsers(db).find((u) => u.name === name);
    if (!name || !user)
      throw new Error(
        "Usage: mirror <name> --vault-off [--apply] | --vault-on [<folder>] [--apply]",
      );
    if (paths.system === ":memory:") throw new Error("No data folder (BONI_DB)");
    const store = openUserStore(join(dirname(paths.system), "users", `${user.id}.db`));
    try {
      const apply = args.includes("--apply");
      const lines = args.includes("--vault-off")
        ? vaultOff(db, store, name, {
            apply,
            queued: new V1Store(db).queuedCaptures().filter((q) => q.account === user.id).length,
          })
        : vaultOn(db, store, name, { apply, folder: folder ?? null });
      for (const line of lines) console.log(line);
    } finally {
      store.close();
    }
  } else if (cmd === "mirror") {
    const profile = option(args, "--profile");
    const folder = option(profile.rest, "--folder");
    const flags = new Set(folder.rest.filter((a) => a.startsWith("--")));
    const [name, typeArg] = folder.rest.filter((a) => !a.startsWith("--"));
    if (!name)
      throw new Error(
        "Usage: mirror <name> [<type> [--profile generic|vault] [--folder F] [--apply] | --stop]",
      );
    const user = listUsers(db).find((u) => u.name === name);
    if (!user) throw new Error(`No account ${name}`);
    if (!user.vault) throw new Error(`Account ${name} has no vault folder`);
    if (paths.system === ":memory:") throw new Error("No data folder (BONI_DB)");
    if (profile.value && profile.value !== "generic" && profile.value !== "vault")
      throw new Error("--profile is generic or vault");
    const users = join(dirname(paths.system), "users");
    mkdirSync(users, { recursive: true, mode: 0o700 });
    const store = openUserStore(join(users, `${user.id}.db`));
    ensureSystemTypes(store);
    const statePath = mirrorStatePath(dirname(paths.system), user.id);
    const state =
      existsSync(statePath) || flags.has("--apply")
        ? openMirrorState(statePath)
        : openMirrorState(":memory:");
    const mirror = new Mirror({
      store,
      state,
      fs: openVault(user.vault),
      propose: () => {
        throw new Error("no proposals from the command line");
      },
    });
    try {
      const types = mirror.modes();
      const type = typeArg
        ? types.find((t) => t.type === typeArg || t.name.toLowerCase() === typeArg.toLowerCase())
        : null;
      if (flags.has("--calendar")) moveCalendar(store, user.vault, types, flags);
      else if (flags.has("--money")) {
        const r = moneyCollections(store, { apply: flags.has("--apply") });
        for (const line of r.report) console.log(line);
        if (r.run) console.log(`Undo it all: the run ${r.run} (Boni's Registro or MCP undo).`);
      } else if (!typeArg) {
        for (const t of types)
          console.log(`${t.type}\t${t.mode}${t.profile ? ` (${t.profile})` : ""}\t${t.name}`);
      } else if (!type) throw new Error(`No type ${typeArg} (see: mirror ${name})`);
      else if (flags.has("--stop")) {
        mirror.stop(type.type);
        console.log(`${type.name}: no longer mirrored; its notes stay as they are.`);
      } else {
        const r = mirror.switchToCore(type.type, {
          ...(profile.value ? { profile: profile.value as Profile } : {}),
          ...(folder.value ? { folder: folder.value } : {}),
          apply: flags.has("--apply"),
        });
        console.log(`${r.name} -> core, profile ${r.profile}, folder ${r.folder}`);
        console.log(
          `${r.entities} entities: ${r.unchanged} notes as they are (they gain the boni_* lines)`,
        );
        console.log(`${r.changed.length} notes would change:`);
        const shown = (v: unknown) => JSON.stringify(v)?.slice(0, 80) ?? "null";
        for (const c of r.changed.slice(0, 50)) {
          console.log(`  ${c.path}: ${[...c.props, ...(c.body ? ["(body)"] : [])].join(", ")}`);
          for (const [k, v] of Object.entries(c.values ?? {}))
            console.log(`      ${k}: ${shown(v.note)} -> ${shown(v.core)}`);
        }
        if (r.changed.length > 50) console.log(`  ... and ${r.changed.length - 50} more`);
        console.log(
          `${r.created.length} new notes; ${r.unreadable.length} notes that do not parse (left alone)`,
        );
        console.log(`${r.unknown.length} notes the core does not have (they become proposals):`);
        for (const p of r.unknown.slice(0, 50)) console.log(`  ${p}`);
        console.log(r.applied ? "Switched." : "Dry run: nothing written (add --apply).");
      }
    } finally {
      state.close();
      store.close();
    }
  } else {
    console.log(
      "Commands: add-user <name> <vault folder> | users | devices <name> | revoke <name> [device] | token <name> <device> | import-boni <boni.sqlite3> <name> [--apply] | mirror <name> [<type> ...] | export <name> <file.zip> | import-export <file.zip> <name>",
    );
  }
} catch (e) {
  console.error((e as Error).message);
  process.exitCode = 1;
} finally {
  db.close();
}

/**
 * Moves an account's calendar to Boni (Juan, 2026-10-22): once every calendar's collection is in core mode,
 * their definitions (as written in `_system/colecciones/`) go into the store and the server serves the
 * calendar from there. Dry run unless --apply; --stop puts it back on the vault.
 */
function moveCalendar(
  store: UserStore,
  vault: string,
  modes: { type: string; mode: string; name: string }[],
  flags: Set<string>,
): void {
  if (flags.has("--stop")) {
    if (flags.has("--apply")) store.setSetting(CALENDAR_DEFS, null);
    console.log(
      flags.has("--apply")
        ? "The calendar comes from the vault again."
        : "Dry run: the calendar would come from the vault again (add --apply).",
    );
    return;
  }
  const dir = join(vault, "_system", "colecciones");
  const defs: { type: string; raw: Record<string, unknown>; id: string }[] = [];
  for (const f of readdirSync(dir)
    .filter((x) => x.endsWith(".md") && x !== "README.md")
    .sort()) {
    const fm = frontmatterData(readFileSync(join(dir, f), "utf8"));
    if ("error" in fm) continue;
    const raw = fm.data.collection as Record<string, unknown> | undefined;
    const r = parseCollectionDef(raw);
    if (!r.ok || !raw) {
      console.log(`  ${f}: does not parse (left out)`);
      continue;
    }
    defs.push({ type: `t_${r.def.id.replace(/-/g, "_")}`, raw, id: r.def.id });
  }
  const notCore = defs.filter((d) => modes.find((m) => m.type === d.type)?.mode !== "core");
  for (const d of defs)
    console.log(
      `  ${d.id}: ${modes.find((m) => m.type === d.type)?.mode ?? "no collection"} (${d.type})`,
    );
  if (!defs.length) throw new Error("No calendar definitions in _system/colecciones/");
  if (notCore.length) {
    const why = `Not in core mode yet: ${notCore.map((d) => d.type).join(", ")} (mirror <name> <type> --apply first)`;
    if (flags.has("--apply")) throw new Error(why);
    console.log(`Not ready. ${why}`);
    return;
  }
  // Copied again over calendars already in Boni: what Boni changed in them since (reminders, the column an
  // event's own reminders went to) stays; the rest comes from the vault's definitions (a new `newNote`).
  const kept = new Map(calendarDefs(store).map((p) => [p.def.id, p.raw]));
  for (const d of defs) {
    const was = kept.get(d.id);
    if (!was) continue;
    if (was.reminders !== undefined) d.raw.reminders = was.reminders;
    const wasMap = (was.mapping ?? {}) as Record<string, unknown>;
    const map = (d.raw.mapping ?? {}) as Record<string, unknown>;
    if (wasMap.reminders !== undefined && map.reminders === undefined) {
      d.raw.mapping = { ...map, reminders: wasMap.reminders };
      const cols = (d.raw.columns ?? []) as { id?: unknown }[];
      const col = ((was.columns ?? []) as { id?: unknown }[]).find(
        (c) => c.id === wasMap.reminders,
      );
      if (col && !cols.some((c) => c.id === col.id)) d.raw.columns = [...cols, col];
    }
  }
  if (flags.has("--apply")) {
    saveCalendarDefs(store, defs);
    console.log(`The calendar comes from Boni now (${defs.length} calendars).`);
  } else console.log(`Dry run: ${defs.length} calendars would come from Boni (add --apply).`);
}
