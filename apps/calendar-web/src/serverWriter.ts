import type { CollectionProvider, CollectionSnapshot, Row, RowChange } from "@boni/calendar";
import { type Outbox, type Remote, RemoteError } from "./remote.ts";

/** Ids the app gave to rows before the server made them, and the id the server gave them (a note's path). */
export const aliases = new Map<string, string>();

/**
 * Writing through Boni Calendar Server: the store's provider while the source is a server. Changes are
 * shown at once (the store already has them) and queued on the device; the queue is sent in order, now
 * or when the connection comes back, so nothing is lost offline. Each batch carries the version the
 * device had when it was made: the server refuses it (conflict) when one of its notes changed
 * elsewhere after that version, and then the device's change is dropped and the server's copy shown.
 */
export interface WriterHooks {
  /** The connection to send through (null while there is none). */
  remote: () => Remote | null;
  /** The server version this device shows now. */
  version: () => number;
  /** Keeps the queue on the device. */
  save: (outbox: Outbox[]) => Promise<void>;
  /** A batch was taken (new rows now have their note path: show them by it). */
  sent: () => void;
  /** A batch was refused because its notes changed elsewhere, or failed for good. */
  rejected: (why: "conflict" | "failed", error: unknown) => void;
}

/** A change with the note path in place of a temporary id, once the server said which it is. */
export function withPath(c: RowChange): RowChange {
  if (c.op === "remove") {
    const path = aliases.get(c.id);
    return path ? { ...c, id: path } : c;
  }
  const path = aliases.get(c.row.id);
  return path ? { ...c, row: { ...c.row, id: path } } : c;
}

/** Row changes applied to rows (keeps the objects of rows they do not touch). */
export function applyRowChanges(rows: readonly Row[], changes: readonly RowChange[]): Row[] {
  const out = rows.slice();
  for (const c of changes) {
    const id = c.op === "remove" ? c.id : c.row.id;
    const i = out.findIndex((r) => r.id === id);
    if (c.op === "remove") {
      if (i >= 0) out.splice(i, 1);
    } else if (i >= 0) out[i] = c.row;
    else out.push(c.row);
  }
  return out;
}

export class ServerWriter implements CollectionProvider {
  /** What is still to be sent (from an earlier session too). */
  outbox: Outbox[];
  /** Sent and taken, but the server's stream has not brought that version yet: still shown on top. */
  private taken: { version: number; changes: RowChange[] }[] = [];
  /**
   * New rows the server took but made no note of (no title yet): they live only on this device until
   * a later change gives them one (then the server says their path) or removes them.
   */
  private drafts = new Map<string, Row>();
  /** Ids of the server's rows in the last `over` (to tell a draft from an edit). */
  private serverIds = new Set<string>();
  private sending: Promise<void> | null = null;
  private readonly hooks: WriterHooks;

  constructor(hooks: WriterHooks, outbox: Outbox[] = []) {
    this.hooks = hooks;
    this.outbox = outbox;
  }

  async load(): Promise<CollectionSnapshot> {
    throw new Error("the server's rows come from its snapshot");
  }

  async apply(changes: readonly RowChange[]): Promise<void> {
    if (changes.length === 0) return;
    this.outbox.push({ base: this.hooks.version(), changes: [...changes] });
    await this.hooks.save(this.outbox);
    void this.flush();
  }

  /** The server's rows (at `version`) with what this device changed and that version lacks on top. */
  over(rows: readonly Row[], version: number): Row[] {
    this.taken = this.taken.filter((t) => t.version > version);
    this.serverIds = new Set(rows.map((r) => r.id));
    for (const id of this.drafts.keys()) if (this.serverIds.has(id)) this.drafts.delete(id);
    const mine = [
      ...[...this.drafts.values()].map((row): RowChange => ({ op: "upsert", row })),
      ...this.taken.flatMap((t) => t.changes),
      ...this.outbox.flatMap((b) => b.changes),
    ];
    return mine.length === 0 ? (rows as Row[]) : applyRowChanges(rows, mine.map(withPath));
  }

  /** Sends the queue (one request for everything waiting); stops at the first network error. */
  flush(): Promise<void> {
    this.sending ??= this.send().finally(() => {
      this.sending = null;
    });
    return this.sending;
  }

  private async send(): Promise<void> {
    for (;;) {
      const remote = this.hooks.remote();
      const n = this.outbox.length;
      const first = this.outbox[0];
      if (!remote || !first) return;
      // The oldest version of the batches is the one that counts: newer ones are this device's own.
      const changes = this.outbox.slice(0, n).flatMap((b) => b.changes.map(withPath));
      try {
        const r = await remote.apply(first.base, changes);
        for (const [id, path] of Object.entries(r.aliases)) aliases.set(id, path);
        this.taken.push({ version: r.version, changes });
        for (const c of changes) {
          if (c.op === "remove") this.drafts.delete(c.id);
          else if (aliases.has(c.row.id) || this.serverIds.has(c.row.id))
            this.drafts.delete(c.row.id);
          else this.drafts.set(c.row.id, c.row);
        }
      } catch (e) {
        // No connection or no session: kept for when there is one again.
        if (e instanceof RemoteError && (e.kind === "network" || e.kind === "unauthorized")) return;
        this.outbox.splice(0, n);
        await this.hooks.save(this.outbox);
        this.hooks.rejected(
          e instanceof RemoteError && e.kind === "conflict" ? "conflict" : "failed",
          e,
        );
        continue;
      }
      this.outbox.splice(0, n);
      await this.hooks.save(this.outbox);
      this.hooks.sent();
    }
  }
}
