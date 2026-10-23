import { setVault } from "@boni/identity";
import type { UserStore } from "@boni/store";
import { CORE_MARK } from "@boni/vault-import";
import { listUsers } from "./auth.ts";
import { calendarDefs } from "./calendarStore.ts";
import type { Db } from "./db.ts";

/** Where the folder an account had is kept, so `vaultOn` can give it back. */
export const VAULT_WAS = "vault/was";

/**
 * An account without its vault (Juan, 2026-10-23: no more vault; `cli.ts mirror <name> --vault-off`): the
 * mirror stops writing notes and reading hand edits, and the server reads no vault for it. Only once nothing
 * of it lives there: the calendar from Boni (`mirror --calendar`) and the movements in core mode. Dry run
 * unless `apply`; the folder is kept in the store's settings for `vaultOn`. The notes on disk are left as
 * they are.
 */
export function vaultOff(
  db: Db,
  store: UserStore,
  name: string,
  o: { apply: boolean; queued?: number },
): string[] {
  const user = listUsers(db).find((u) => u.name === name);
  if (!user) throw new Error(`No account ${name}`);
  if (!user.vault) return [`${name} has no vault folder: nothing to do`];
  const why: string[] = [];
  if (!calendarDefs(store).length)
    why.push("its calendar still comes from the vault (mirror <name> --calendar --apply first)");
  if (store.setting(`${CORE_MARK}t_movimiento`) === null)
    why.push("its movements still live in the vault (mirror <name> movimiento --apply first)");
  if (why.length) throw new Error(`${name} still needs its vault: ${why.join("; ")}`);
  const core = Object.values(store.schema().types).filter(
    (t) => store.setting(`${CORE_MARK}${t.id}`) !== null,
  );
  const report = [
    `${name}: vault ${user.vault}`,
    `Calendar from Boni (${calendarDefs(store).length} calendars); movements in Boni`,
    `${core.length} collections stop being mirrored: ${core.map((t) => t.name).join(", ")}`,
    "The notes stay on disk as they are; hand edits there no longer reach Boni.",
  ];
  if (o.queued)
    report.push(`${o.queued} queued "Apuntar gasto" captures will be written into Boni`);
  if (!o.apply) {
    report.push("Dry run: nothing changed (add --apply).");
    return report;
  }
  store.setSetting(VAULT_WAS, user.vault);
  setVault(db, name, null);
  report.push(`Done: ${name} has no vault folder (back with: mirror ${name} --vault-on --apply).`);
  return report;
}

/** The folder back (the one `vaultOff` kept, or `folder`): the mirror resumes where it was. */
export function vaultOn(
  db: Db,
  store: UserStore,
  name: string,
  o: { apply: boolean; folder?: string | null },
): string[] {
  const user = listUsers(db).find((u) => u.name === name);
  if (!user) throw new Error(`No account ${name}`);
  const folder = o.folder || store.setting(VAULT_WAS);
  if (!folder)
    throw new Error(`No folder to give ${name} back (mirror ${name} --vault-on <folder>)`);
  if (user.vault === folder) return [`${name} already has ${folder}`];
  if (!o.apply)
    return [`${name}: vault ${folder} again`, "Dry run: nothing changed (add --apply)."];
  setVault(db, name, folder);
  return [`Done: ${name} -> ${folder}`];
}
