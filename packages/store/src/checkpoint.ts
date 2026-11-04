/**
 * Checkpoints of the WAL from a thread of their own (task 43). With SQLite's automatic checkpoint, the commit that
 * crosses a thousand pages pays it, and on the NAS's disk that is a second: a mail kept, a step of a run, an action of
 * the audit held the server that long (2026-11-04). The server opens its stores with the automatic checkpoint off
 * (`autoCheckpoint: false`) and this worker checkpoints each database passively every few seconds, once its WAL has
 * grown; a passive checkpoint never waits for anyone, and the server's thread goes on meanwhile. What took long is
 * said in the log, so the log can answer next time.
 */
import { statSync } from "node:fs";
import { basename } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Worker } from "node:worker_threads";

export interface Checkpointed {
  path: string;
  /** Frames the WAL held, and how many of them went into the database now. */
  frames: number;
  moved: number;
  ms: number;
  bytes: number;
}

/** The WAL file's size, 0 when there is none (a store in memory, or never written). */
export function walBytes(path: string): number {
  try {
    return statSync(`${path}-wal`).size;
  } catch {
    return 0;
  }
}

/** One passive checkpoint of `path` through its own connection (what the worker does; here for tests and tools). */
export function checkpointOnce(path: string, db = new DatabaseSync(path)): Checkpointed {
  const t0 = performance.now();
  const bytes = walBytes(path);
  const r = db.prepare("PRAGMA wal_checkpoint(PASSIVE)").get() as {
    busy: number;
    log: number;
    checkpointed: number;
  };
  return {
    path,
    frames: Number(r.log),
    moved: Number(r.checkpointed),
    ms: Math.round(performance.now() - t0),
    bytes,
  };
}

/** Below this WAL size nothing is done: checkpointing a few pages is not worth a thread's turn. */
const MIN_BYTES = 256 * 1024;
/** A checkpoint that took longer than this, or moved many frames, is said in the log. */
const SAID_MS = 200;
const SAID_FRAMES = 2000;

/**
 * Starts the worker: every `everyMs` it checkpoints every database `paths()` names whose WAL is over `minBytes`.
 * `log` gets a line for the checkpoints worth saying, and once for a failure (then nothing more is done).
 */
export function startCheckpoints(o: {
  paths: () => string[];
  everyMs?: number;
  minBytes?: number;
  log?: (line: string) => void;
}): { stop: () => Promise<void> } {
  const log = o.log ?? (() => {});
  let worker: Worker | null = null;
  try {
    worker = new Worker(CHECKPOINTER, {
      eval: true,
      workerData: { minBytes: o.minBytes ?? MIN_BYTES },
      resourceLimits: { maxOldGenerationSizeMb: 32 },
    });
  } catch (e) {
    log(`wal checkpoint: no worker (${String(e)})`);
    return { stop: async () => {} };
  }
  const w = worker;
  w.on("message", (m: Checkpointed | { failed: string }) => {
    if ("failed" in m) return log(`wal checkpoint failed: ${m.failed}`);
    if (m.ms > SAID_MS || m.moved > SAID_FRAMES)
      log(
        `wal checkpoint: ${basename(m.path)} ${m.moved} of ${m.frames} frames (${(m.bytes / 1e6).toFixed(1)} MB) in ${m.ms} ms`,
      );
  });
  w.on("error", (e) => log(`wal checkpoint failed: ${String(e)}`));
  const tick = () => {
    try {
      w.postMessage(o.paths());
    } catch {
      // the worker is gone: nothing to tell
    }
  };
  const timer = setInterval(tick, o.everyMs ?? 15_000);
  timer.unref();
  return {
    stop: async () => {
      clearInterval(timer);
      await w.terminate();
    },
  };
}

/** The worker's thread, plain JavaScript run as it is: a connection per database, a passive checkpoint per tick. */
const CHECKPOINTER = `
const { workerData, parentPort } = require("node:worker_threads");
const { DatabaseSync } = require("node:sqlite");
const { statSync } = require("node:fs");
const { minBytes } = workerData;
const dbs = new Map();
const bytesOf = (path) => { try { return statSync(path + "-wal").size; } catch { return 0; } };
parentPort.on("message", (paths) => {
  for (const path of paths) {
    try {
      const bytes = bytesOf(path);
      if (bytes < minBytes) continue;
      let db = dbs.get(path);
      if (!db) {
        db = new DatabaseSync(path);
        db.exec("PRAGMA busy_timeout = 5000");
        dbs.set(path, db);
      }
      const t0 = performance.now();
      const r = db.prepare("PRAGMA wal_checkpoint(PASSIVE)").get();
      parentPort.postMessage({
        path,
        frames: Number(r.log),
        moved: Number(r.checkpointed),
        ms: Math.round(performance.now() - t0),
        bytes,
      });
    } catch (e) {
      parentPort.postMessage({ failed: path + ": " + String(e && e.message ? e.message : e) });
    }
  }
});
`;
