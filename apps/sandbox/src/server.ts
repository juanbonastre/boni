/**
 * The box's door (docs/extensiones.md §11.6, E1): a Unix socket that only Boni's server reaches (a folder their two
 * containers share), one JSON request per line and one answer per line. Each call runs in a worker thread of its own,
 * ended if it is not done in time; a few at once, a few more waiting, the rest told to come back later. Two protocols
 * share it and nothing else (docs/automatizaciones.md AU-160): an extension's function (protocol 1) and an
 * evaluation of an automation's JavaScript (protocol 2, a line with `v`), each checked by its own rules.
 *
 * A worker serves one call and is ended (A-08). Starting one is most of an empty call (task 138: its thread and its
 * modules, ~70 ms of ~105), so a few spares are started before any call comes: a spare has been handed nothing but the
 * compiled interpreter, has made no interpreter yet, and is given exactly one call. A call that finds none ready, or
 * whose spare died before it took the call, starts its worker as before, with the same answer.
 */
import { existsSync, unlinkSync } from "node:fs";
import { chmod } from "node:fs/promises";
import { createServer, type Socket } from "node:net";
import { Worker } from "node:worker_threads";
import {
  type EvalRequest,
  type EvalResponse,
  evalLimitsOf,
  evalRequestErrors,
  isEvalRequest,
  limitsOf,
  MAX_REQUEST_BYTES,
  type RunRequest,
  type RunResponse,
  requestErrors,
} from "@boni/sandbox";
import { compiledQuickJS } from "./run.ts";

export interface BoxOptions {
  /** Calls at once. */
  workers?: number;
  /** Calls waiting beyond those; more are told «busy». */
  queue?: number;
  /** Time given to a worker beyond its call's own, to start its interpreter (ms). */
  grace?: number;
  /**
   * Workers started ahead, each waiting for one call. They fill only the threads the calls leave free: calls and spares
   * together are never more than `workers` threads, so the box's memory at its fullest is what it was without them.
   */
  spares?: number;
  /** The script a spare runs (tests only: one that never gets ready, or that dies). */
  spareScript?: URL;
  /**
   * Told of every worker (tests only): `spare` when one is started ahead, `ready` when it has said so, `given` when
   * a spare is given a call, `own` when a call starts its own.
   */
  onWorker?: (worker: Worker, how: "spare" | "ready" | "given" | "own") => void;
}

export interface Box {
  close(): Promise<void>;
}

const WORKER = new URL("./worker.ts", import.meta.url);
/** What a worker's own JavaScript may take; the interpreter's memory is its own, capped (run.ts). */
const RESOURCES = { maxOldGenerationSizeMb: 32, maxYoungGenerationSizeMb: 8, stackSizeMb: 4 };

type BoxRequest = RunRequest | EvalRequest;
/** An answer the door gives itself (busy, invalid, timeout…) has the same shape in both protocols. */
type BoxResponse = RunResponse | EvalResponse;

export async function startBox(socketPath: string, opts: BoxOptions = {}): Promise<Box> {
  const workers = opts.workers ?? 2;
  const queueMax = opts.queue ?? 16;
  const grace = opts.grace ?? 3_000;
  // The interpreter compiled once, for every call's worker to make its own instance of (fast).
  const module = await compiledQuickJS();
  const running = new Set<Worker>();
  const waiting: { req: BoxRequest; done: (r: BoxResponse) => void }[] = [];
  let closed = false;

  /**
   * Every thread of the box until it has ended: the calls', the spares' and the ones being ended. A spare is started
   * only while there are fewer than `workers`: measured in a 256 MB cgroup (2026-11-16), two calls that ask for memory
   * without end peak at 248-255 MB without spares, and the box was killed when spares were counted only while they
   * waited (one run of three) or were made beside the calls.
   */
  const alive = new Set<Worker>();
  const track = (worker: Worker, how: "spare" | "own") => {
    alive.add(worker);
    worker.once("exit", () => alive.delete(worker));
    opts.onWorker?.(worker, how);
    return worker;
  };

  /** Spares waiting for a call: each is ready once its thread has loaded what a call needs and said so. */
  const spareCount = Math.max(0, Math.min(opts.spares ?? 2, workers));
  const spares = new Set<{ worker: Worker; ready: boolean; release: () => void }>();
  const makeSpare = () => {
    // Only the compiled interpreter goes in, the same for every call: nothing of any request.
    const worker = track(
      new Worker(opts.spareScript ?? WORKER, { workerData: { module }, resourceLimits: RESOURCES }),
      "spare",
    );
    const spare = { worker, ready: false, release: () => {} };
    const onMessage = (m: unknown) => {
      if ((m as { spare?: unknown } | null)?.spare !== "ready" || spare.ready) return;
      spare.ready = true;
      opts.onWorker?.(worker, "ready");
    };
    // A spare that fails or ends before it is given a call is dropped; the next call starts another (never at once:
    // a spare that cannot start would otherwise be started again for ever).
    const gone = () => {
      spare.release();
      spares.delete(spare);
      void worker.terminate();
    };
    worker.on("message", onMessage);
    worker.on("error", gone);
    worker.on("exit", gone);
    spare.release = () => {
      worker.off("message", onMessage);
      worker.off("error", gone);
      worker.off("exit", gone);
    };
    spares.add(spare);
  };
  /** Spares up to their number, in the threads that are free. */
  const refill = () => {
    while (!closed && spares.size < spareCount && alive.size < workers) makeSpare();
  };
  /** A ready spare, taken out of the spares, or none. */
  const takeSpare = (): Worker | null => {
    for (const spare of spares)
      if (spare.ready) {
        spares.delete(spare);
        spare.release();
        return spare.worker;
      }
    return null;
  };
  /** A thread that is still starting as a spare when every thread is needed for calls gives its place up. */
  const yieldSpare = () => {
    if (alive.size < workers) return;
    for (const spare of spares)
      if (!spare.ready) {
        spare.release();
        spares.delete(spare);
        void spare.worker.terminate();
        return;
      }
  };

  const start = (req: BoxRequest, done: (r: BoxResponse) => void, spare = true) => {
    const limits = isEvalRequest(req)
      ? evalLimitsOf(req as EvalRequest)
      : limitsOf(req as RunRequest);
    const taken = spare ? takeSpare() : null;
    if (!taken) yieldSpare();
    const worker =
      taken ??
      track(
        new Worker(WORKER, { workerData: { request: req, module }, resourceLimits: RESOURCES }),
        "own",
      );
    if (taken) opts.onWorker?.(taken, "given");
    running.add(worker);
    // Once this call's thread has ended, its place may go to a spare (a call waiting has already taken one of its own).
    worker.once("exit", refill);
    let answered = false;
    /** Whether a spare said it has the call: before that, the call has not started in it. */
    let started = taken === null;
    const end = () => {
      answered = true;
      clearTimeout(timer);
      running.delete(worker);
      void worker.terminate();
    };
    const answer = (r: BoxResponse) => {
      if (answered) return;
      end();
      done(r);
      const next = waiting.shift();
      if (next) start(next.req, next.done);
    };
    /** A spare that is gone before it took the call: the call starts its own worker, as with no spare. */
    const lost = (r: BoxResponse) => {
      if (answered) return;
      if (started) return answer(r);
      end();
      // A box that is closing starts nothing (its calls' spares were ended by close()).
      if (closed) return;
      start(req, done, false);
    };
    // What does not stop by itself (an expression that never yields to the interpreter) is ended from outside.
    // Its time is the call's: it starts when the call is given to its worker, never when a spare started.
    const timer = setTimeout(
      () =>
        answer({
          id: req.id,
          ok: false,
          error: "timeout",
          message: `ha pasado de ${limits.ms} ms`,
        }),
      limits.ms + grace,
    );
    worker.on("message", (r: BoxResponse | { spare: string }) => {
      if ("spare" in r) {
        if (r.spare === "taken") started = true;
        return;
      }
      answer(r);
    });
    worker.on("error", (e: Error & { code?: string }) =>
      lost({
        id: req.id,
        ok: false,
        error: e.code === "ERR_WORKER_OUT_OF_MEMORY" ? "memory" : "exception",
        message: e.code === "ERR_WORKER_OUT_OF_MEMORY" ? "se ha quedado sin memoria" : e.message,
      }),
    );
    worker.on("exit", () =>
      lost({
        id: req.id,
        ok: false,
        error: "exception",
        message: "la llamada terminó sin respuesta",
      }),
    );
    if (taken) taken.postMessage(req);
  };

  const handle = (line: string, reply: (r: BoxResponse) => void) => {
    let req: unknown;
    try {
      req = JSON.parse(line);
    } catch {
      return reply({ id: "", ok: false, error: "invalid", message: "no es JSON" });
    }
    const errs = isEvalRequest(req) ? evalRequestErrors(req) : requestErrors(req);
    const id = typeof (req as { id?: unknown }).id === "string" ? (req as { id: string }).id : "";
    if (errs.length)
      return reply({ id, ok: false, error: "invalid", message: `petición: ${errs.join(", ")}` });
    if (running.size < workers) return start(req as BoxRequest, reply);
    if (waiting.length < queueMax)
      return void waiting.push({ req: req as BoxRequest, done: reply });
    reply({ id, ok: false, error: "busy", message: "hay demasiadas llamadas esperando" });
  };

  const server = createServer((socket: Socket) => {
    let buffer = "";
    socket.setEncoding("utf8");
    const reply = (r: BoxResponse) => {
      if (!socket.destroyed) socket.write(`${JSON.stringify(r)}\n`);
    };
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      if (Buffer.byteLength(buffer) > MAX_REQUEST_BYTES + 1) {
        reply({ id: "", ok: false, error: "invalid", message: "la petición es demasiado grande" });
        socket.destroy();
        return;
      }
      for (let at = buffer.indexOf("\n"); at >= 0; at = buffer.indexOf("\n")) {
        const line = buffer.slice(0, at);
        buffer = buffer.slice(at + 1);
        if (line.trim()) handle(line, reply);
      }
    });
    socket.on("error", () => socket.destroy());
  });

  if (existsSync(socketPath)) unlinkSync(socketPath);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => resolve());
  });
  // Only its own user (the server's container runs as the same one) may connect.
  await chmod(socketPath, 0o600);
  refill();

  return {
    close: async () => {
      closed = true;
      for (const spare of spares) {
        spare.release();
        void spare.worker.terminate();
      }
      spares.clear();
      waiting.length = 0;
      for (const w of running) void w.terminate();
      running.clear();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      if (existsSync(socketPath)) unlinkSync(socketPath);
    },
  };
}
