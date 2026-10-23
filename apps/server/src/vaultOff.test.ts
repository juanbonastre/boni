import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { addAccount, openSystemDb } from "@boni/identity";
import { openUserStore } from "@boni/store";
import { CORE_MARK, importVault } from "@boni/vault-import";
import { afterEach, describe, expect, it } from "vitest";
import { listUsers } from "./auth.ts";
import { saveCalendarDefs } from "./calendarStore.ts";
import { VAULT_WAS, vaultOff, vaultOn } from "./vaultOff.ts";

/** An invented vault (never real notes): a calendar and a movement. */
const FILES: Record<string, string> = {
  "agenda/docencia/2026-10-22 Clase de ejemplo.md":
    '---\ntitle: "Clase de ejemplo"\ndate: "2026-10-22"\n---\n',
  "registros/finanzas/movimientos/2026/10/2026-10-01-1200-cafe.md":
    "---\ntype: movement\ndate: 2026-10-01\namount: -1.50\ncategory: bebida/cafe\n---\n\n# Cafe 1,50 EUR\n",
};
const RAW = {
  id: "docencia",
  name: "Docencia",
  folder: "agenda/docencia",
  account: "Agenda",
  color: "#60a5fa",
  columns: [
    { id: "title", name: "Título", type: "text" },
    { id: "date", name: "Fecha", type: "date" },
    { id: "startTime", name: "Hora de inicio", type: "time" },
    { id: "endTime", name: "Hora de fin", type: "time" },
  ],
  mapping: {
    title: "title",
    when: { kind: "split", date: "date", startTime: "startTime", endTime: "endTime" },
  },
};

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
});
function env() {
  const root = mkdtempSync(join(tmpdir(), "boni-vault-off-"));
  for (const [p, t] of Object.entries(FILES)) {
    mkdirSync(dirname(join(root, p)), { recursive: true });
    writeFileSync(join(root, p), t);
  }
  const db = openSystemDb(":memory:");
  addAccount(db, "ana", "contrasena-de-prueba-12", { vault: root });
  const store = openUserStore(":memory:");
  importVault(root, store, { apply: true });
  cleanups.push(() => {
    store.close();
    db.close();
    rmSync(root, { recursive: true, force: true });
  });
  return { root, db, store };
}
const vaultOfAna = (db: Parameters<typeof listUsers>[0]) =>
  listUsers(db).find((u) => u.name === "ana")?.vault;

describe("an account without its vault (mirror --vault-off)", () => {
  it("only once its calendar and movements live in Boni; dry run first; the folder comes back", () => {
    const { root, db, store } = env();
    expect(() => vaultOff(db, store, "ana", { apply: true })).toThrow(
      /calendar still comes from the vault.*movements still live in the vault/,
    );
    saveCalendarDefs(store, [{ type: "t_nota", raw: RAW }]);
    store.setSetting(`${CORE_MARK}t_nota`, "vault");
    store.setSetting(`${CORE_MARK}t_movimiento`, "vault");

    const dry = vaultOff(db, store, "ana", { apply: false, queued: 1 });
    expect(dry.join("\n")).toContain("2 collections stop being mirrored");
    expect(dry.join("\n")).toContain('1 queued "Apuntar gasto" captures');
    expect(vaultOfAna(db)).toBe(root);

    vaultOff(db, store, "ana", { apply: true });
    expect(vaultOfAna(db)).toBe("");
    expect(store.setting(VAULT_WAS)).toBe(root);
    expect(vaultOff(db, store, "ana", { apply: true })).toEqual([
      "ana has no vault folder: nothing to do",
    ]);

    expect(vaultOn(db, store, "ana", { apply: false })[1]).toContain("Dry run");
    expect(vaultOfAna(db)).toBe("");
    vaultOn(db, store, "ana", { apply: true });
    expect(vaultOfAna(db)).toBe(root);
  });
});
