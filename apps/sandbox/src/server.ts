/**
 * The box's door (docs/extensiones.md §11.6, E1): a Unix socket that only Boni's server reaches (a folder their two
 * containers share), one JSON request per line and one answer per line. Each call runs in a worker thread of its own,
 * ended if it is not done in time; a few at once, a few more waiting, the rest told to come back later. Two protocols
 * share it and nothing else (docs/automatizaciones.md AU-160): an extension's function (protocol 1) and an
 * evaluation of an automation's JavaScript (protocol 2, a line with `v`), each checked by its own rules.
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
}

export interface Box {
  close(): Promise<void>;
}

const WORKER = new URL("./worker.ts", import.meta.url);

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

  const start = (req: BoxRequest, done: (r: BoxResponse) => void) => {
    const limits = isEvalRequest(req)
      ? evalLimitsOf(req as EvalRequest)
      : limitsOf(req as RunRequest);
    const worker = new Worker(WORKER, {
      workerData: { request: req, module },
      // The interpreter's memory is its own, capped (run.ts); this bounds what the worker's JavaScript may take.
      resourceLimits: { maxOldGenerationSizeMb: 32, maxYoungGenerationSizeMb: 8, stackSizeMb: 4 },
    });
    running.add(worker);
    let answered = false;
    const answer = (r: BoxResponse) => {
      if (answered) return;
      answered = true;
      clearTimeout(timer);
      running.delete(worker);
      void worker.terminate();
      done(r);
      const next = waiting.shift();
      if (next) start(next.req, next.done);
    };
    // What does not stop by itself (an expression that never yields to the interpreter) is ended from outside.
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
    worker.on("message", (r: BoxResponse) => answer(r));
    worker.on("error", (e: Error & { code?: string }) =>
      answer({
        id: req.id,
        ok: false,
        error: e.code === "ERR_WORKER_OUT_OF_MEMORY" ? "memory" : "exception",
        message: e.code === "ERR_WORKER_OUT_OF_MEMORY" ? "se ha quedado sin memoria" : e.message,
      }),
    );
    worker.on("exit", () =>
      answer({
        id: req.id,
        ok: false,
        error: "exception",
        message: "la llamada terminó sin respuesta",
      }),
    );
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

  return {
    close: async () => {
      waiting.length = 0;
      for (const w of running) void w.terminate();
      running.clear();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      if (existsSync(socketPath)) unlinkSync(socketPath);
    },
  };
}
