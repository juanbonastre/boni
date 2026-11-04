import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { label } from "@boni/entities";
import { afterEach, describe, expect, it } from "vitest";
import { checkpointOnce, startCheckpoints, walBytes } from "./checkpoint.ts";
import { openUserStore, type UserStore } from "./store.ts";

const own = label("user", "personal", [{ kind: "user-edit", id: "portatil" }]);
const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

function filled(opts: Parameters<typeof openUserStore>[1]): { store: UserStore; path: string } {
  const dir = mkdtempSync(join(tmpdir(), "boni-wal-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "user.db");
  const store = openUserStore(path, opts);
  cleanups.push(() => store.close());
  store.applySchema(
    {
      op: "create_type",
      type: {
        id: "t_nota",
        key: "nota",
        name: "Notas",
        fields: [{ id: "f_t", key: "titulo", name: "Título", type: "text", label: own }],
        titleField: "f_t",
        sensitivity: "personal",
        schemaVersion: 1,
        label: own,
      },
    },
    { actor: "user" },
  );
  // Thousands of pages into the WAL (the notes and their operations' log): more than the automatic
  // checkpoint's thousand, in a few commits so a slow runner takes no longer than it must.
  const text = "x".repeat(4000);
  for (let b = 0; b < 3; b++)
    store.batch(() => {
      for (let i = 0; i < 400; i++)
        store.create(
          "t_nota",
          { f_t: { value: `${b}-${i} ${text}`, label: own } },
          { actor: "user" },
        );
    });
  return { store, path };
}

/** The frames a WAL holds and how many are in the database already, from a connection of our own. */
const frames = (path: string) => {
  const db = new DatabaseSync(path);
  try {
    // A passive checkpoint from here would move them itself: ask with no work (PRAGMA wal_checkpoint moves too),
    // so read the counts as the next checkpoint reports them after moving nothing new.
    const r = checkpointOnce(path, db);
    return { frames: r.frames, moved: r.moved };
  } finally {
    db.close();
  }
};

describe("checkpoints of the WAL from a thread of their own (task 43)", () => {
  it("with the automatic checkpoint off the WAL grows past a thousand pages; one passive checkpoint moves it all", {
    timeout: 30_000,
  }, () => {
    const { path } = filled({ autoCheckpoint: false });
    expect(walBytes(path)).toBeGreaterThan(1000 * 4096);
    const first = checkpointOnce(path);
    expect(first.frames).toBeGreaterThan(1000);
    expect(first.moved).toBe(first.frames);
    expect(first.bytes).toBe(walBytes(path));
    // Nothing left to move; the file stays (SQLite reuses it from its start).
    expect(checkpointOnce(path).moved).toBe(first.frames);
  });

  it("with it on (the default), SQLite keeps the WAL under its thousand pages by itself", {
    timeout: 30_000,
  }, () => {
    const { path } = filled({});
    expect(frames(path).frames).toBeLessThan(1000);
  });

  it("says a slow commit with the WAL's size; the worker checkpoints the databases it is told of and says what took long", {
    timeout: 40_000,
  }, async () => {
    const slow: [number, number][] = [];
    const { path } = filled({
      autoCheckpoint: false,
      onSlowCommit: (ms, bytes) => slow.push([ms, bytes]),
      slowCommitMs: -1, // every commit, for the test
    });
    expect(slow.length).toBeGreaterThanOrEqual(3);
    expect(slow.at(-1)?.[1]).toBe(walBytes(path));
    const lines: string[] = [];
    const cp = startCheckpoints({
      paths: () => [path, join(path, "..", "none.db")],
      everyMs: 30,
      minBytes: 1,
      log: (l) => lines.push(l),
    });
    cleanups.push(() => cp.stop());
    const until = async (ok: () => boolean, ms = 15_000) => {
      const t0 = Date.now();
      while (!ok()) {
        if (Date.now() - t0 > ms) return false;
        await new Promise((r) => setTimeout(r, 50));
      }
      return true;
    };
    // Many frames: said in the log, as the worker's own line (a database that is not there is not).
    expect(
      await until(() => lines.some((l) => /^wal checkpoint: user\.db \d+ of \d+ frames/.test(l))),
    ).toBe(true);
    // Moved by the worker: our own passive checkpoint then finds every frame already in the database (-1 while
    // the worker holds the checkpoint lock that very moment: asked again).
    expect(
      await until(() => {
        const f = frames(path);
        return f.frames > 1000 && f.moved === f.frames;
      }),
    ).toBe(true);
    expect(lines.some((l) => /failed/.test(l))).toBe(false);
    await cp.stop();
  });
});
