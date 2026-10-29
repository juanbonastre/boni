import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { seed, type TypeSpec } from "../apps/server/src/seed.test-util.ts";
import {
  Agent,
  coreTools,
  ensureSystemTypes,
  fakePlanner,
  leaf,
  rec,
} from "../packages/agent/src/index.ts";
import { label } from "../packages/entities/src/index.ts";
import { openUserStore } from "../packages/store/src/index.ts";

/**
 * An account of a real server for the e2e, with invented data in its own store (never real notes): made with the
 * admin's command, then its collections and entries seeded before the server starts (`BONI_DB` in `dir`).
 */
export function seedAccount(
  dir: string,
  name: string,
  password: string,
  types: TypeSpec[],
  notes: Record<string, string | Uint8Array>,
): void {
  execFileSync(
    process.execPath,
    ["--disable-warning=ExperimentalWarning", "apps/server/src/cli.ts", "add-user", name],
    { env: { ...process.env, BONI_DB: join(dir, "db.sqlite"), BONI_PASSWORD: password } },
  );
  const id = execFileSync(
    process.execPath,
    ["--disable-warning=ExperimentalWarning", "apps/server/src/cli.ts", "users"],
    { env: { ...process.env, BONI_DB: join(dir, "db.sqlite") }, encoding: "utf8" },
  )
    .split("\n")
    .map((l) => l.split("\t"))
    .find(([n]) => n === name)?.[1];
  mkdirSync(join(dir, "users"), { recursive: true });
  const store = openUserStore(join(dir, "users", `${id}.db`));
  try {
    seed(store, types, notes);
  } finally {
    store.close();
  }
}

/**
 * Proposals waiting in the account's inbox (before the server starts), as a mail read in the background leaves
 * them: a new entry of `type` (its key) with these values, each from that mail. Returns their ids.
 */
export function proposeEntries(
  dir: string,
  account: number,
  type: string,
  entries: Record<string, string>[],
): string[] {
  const store = openUserStore(join(dir, "users", `${account}.db`));
  try {
    ensureSystemTypes(store);
    const agent = new Agent({
      store,
      registry: coreTools().freeze(),
      planner: fakePlanner([]),
      reader: fakePlanner([]),
    });
    const l = label("external", "personal", [{ kind: "mail", id: "ejemplo@example.edu" }], true);
    return entries.map((values) =>
      agent.propose({
        tool: "entities.create",
        args: {
          type: leaf(type, l),
          values: rec(
            Object.fromEntries(Object.entries(values).map(([k, v]) => [k, leaf(v, l)])),
            l,
          ),
        },
        origin: "background",
      }),
    );
  } finally {
    store.close();
  }
}

/** An entry's title by its id, read from the account's store itself (only while the server is off). */
export function titleInStore(dir: string, account: number, id: string): string | null {
  const store = openUserStore(join(dir, "users", `${account}.db`));
  try {
    const e = store.get(id)?.entity;
    const t = e ? store.schema().types[e.type] : undefined;
    return t && e && e.deleted === undefined ? String(e.values[t.titleField] ?? "") : null;
  } finally {
    store.close();
  }
}

/**
 * Boni's MCP on that server, as an assistant uses it (a session made by `cli.ts token`): what Boni has, and changes
 * made in Boni while a device watches (another writer of the same collections).
 */
export function mcpOf(dir: string, url: () => string, name: string) {
  const out = execFileSync(
    process.execPath,
    ["--disable-warning=ExperimentalWarning", "apps/server/src/cli.ts", "token", name, "e2e-mcp"],
    { env: { ...process.env, BONI_DB: join(dir, "db.sqlite") }, encoding: "utf8" },
  );
  const token = out.trim().split("\n").at(-1) as string;
  let id = 0;
  const call = async (tool: string, args: Record<string, unknown>) => {
    const r = await fetch(`${url()}/api/mcp`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: ++id,
        method: "tools/call",
        params: { name: tool, arguments: args },
      }),
    });
    const res = ((await r.json()) as { result: { content: { text: string }[]; isError: boolean } })
      .result;
    return { error: res.isError, text: res.content[0]?.text ?? "" };
  };
  return {
    call,
    /** An entry by the path its note had: its title, properties by name and text; null when there is none. */
    async read(
      path: string,
    ): Promise<{ title: string; properties: Record<string, unknown>; body: string } | null> {
      const r = await call("read", { path });
      return r.error ? null : JSON.parse(r.text);
    },
  };
}
