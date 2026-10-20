import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { Mirror, type MirrorFs, type MirrorState, openMirrorState } from "@boni/mirror";
import type { AgentHost } from "./agent.ts";

/**
 * The Markdown mirror on the server (docs/nucleo.md 9.2; plan PR 13): for each account whose types were
 * switched to `core` mode (`cli.ts mirror`, which creates `users/<id>.mirror.db`), the core writes its
 * notes into the account's vault and hand edits come back as proposals in the inbox. It runs after
 * every agent request of the account and every `everyMs`; only with writing on (`BONI_WRITE=1`) and the
 * agent on (the inbox is the agent's). The vault is reached through the desktop's vault-fs.cjs, with its
 * rules (confined, never `private/` or `restricted/`, atomic writes, deleted notes to `.trash`).
 */
const require = createRequire(import.meta.url);
const { openVault } = require("../../calendar-desktop/vault-fs.cjs") as {
  openVault: (root: string) => MirrorFs;
};

export const mirrorStatePath = (dataDir: string, account: number) =>
  join(dataDir, "users", `${account}.mirror.db`);

export interface MirrorsOptions {
  host: AgentHost;
  dataDir: string | null;
  write: boolean;
  /** The accounts and their vault folders (from system.db). */
  accounts: () => { id: number; vault: string }[];
}

export class Mirrors {
  private o: MirrorsOptions;
  private open = new Map<number, { mirror: Mirror; state: MirrorState; vault: string }>();
  private busy = new Map<number, Promise<void>>();
  private again = new Set<number>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(o: MirrorsOptions) {
    this.o = o;
  }

  private mirror(account: number, vault: string): Mirror | null {
    const { dataDir, host, write } = this.o;
    if (!dataDir || !write || !host.on || !vault) return null;
    const had = this.open.get(account);
    if (had?.vault === vault) return had.mirror;
    const path = mirrorStatePath(dataDir, account);
    if (!existsSync(path)) return null;
    had?.state.close();
    const state = openMirrorState(path);
    const agent = host.agent(account);
    const mirror = new Mirror({
      store: host.store(account),
      state,
      fs: openVault(vault),
      propose: (p) => agent.propose(p),
    });
    this.open.set(account, { mirror, state, vault });
    return mirror;
  }

  /** Writes what changed and reads the hand edits, once at a time per account (a request meanwhile runs it again). */
  run(account: number): Promise<void> {
    const vault = this.o.accounts().find((a) => a.id === account)?.vault ?? "";
    const running = this.busy.get(account);
    if (running) {
      this.again.add(account);
      return running;
    }
    const job = (async () => {
      do {
        this.again.delete(account);
        const m = this.mirror(account, vault);
        if (!m) return;
        try {
          await m.sync();
          const scan = await m.scan();
          await m.sync();
          if (scan.proposed) this.o.host.emit(account, "proposals", { n: scan.proposed });
        } catch (e) {
          console.error(`mirror ${account}: ${(e as Error).message}`);
        }
      } while (this.again.has(account));
    })().finally(() => this.busy.delete(account));
    this.busy.set(account, job);
    return job;
  }

  start(everyMs = 30_000): void {
    this.timer = setInterval(() => {
      for (const a of this.o.accounts()) void this.run(a.id);
    }, everyMs);
    this.timer.unref();
  }

  async close(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await Promise.all(this.busy.values());
    for (const o of this.open.values()) o.state.close();
    this.open.clear();
  }
}
