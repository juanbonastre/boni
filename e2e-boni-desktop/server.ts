// The real server a desktop suite starts (task 117): on a port the system gives free, ready once its start line is
// read, its output always read, and said with what it printed when it does not start.
import { type ChildProcess, spawn } from "node:child_process";
import { createServer } from "node:net";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
/** How long a start may take on a loaded machine (it takes about 2 s; a busy one has been seen ten times slower). */
const START_MS = 60_000;

/** A port nothing listens on now, given by the system: one drawn at random from a range could be taken. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.on("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const a = s.address();
      const port = typeof a === "object" && a ? a.port : 0;
      s.close(() => resolve(port));
    });
  });
}

export type Server = { process: ChildProcess; port: number; url: string };

/**
 * Starts `apps/server/src/main.ts` with `env` and waits for its start line. Its stdout and stderr are read for as long
 * as it runs (a pipe nobody reads stops the server once it is full), the last of them kept for the error. A port
 * taken between being found free and being listened on is tried again with another. Given a `port` (a server started
 * again where the app already knows it, task 118), it starts on that one only.
 */
export async function startServer(env: NodeJS.ProcessEnv, port?: number): Promise<Server> {
  if (port !== undefined) return startOn(port, env);
  for (let attempt = 1; ; attempt++) {
    const port = await freePort();
    try {
      return await startOn(port, env);
    } catch (e) {
      if (attempt >= 3 || !String((e as Error).message).includes("EADDRINUSE")) throw e;
    }
  }
}

function startOn(port: number, env: NodeJS.ProcessEnv): Promise<Server> {
  const child = spawn("node", ["apps/server/src/main.ts"], {
    cwd: ROOT,
    env: { ...env, BONI_PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  const keep = (b: Buffer) => {
    out = (out + b.toString()).slice(-8000);
  };
  child.stdout?.on("data", keep);
  child.stderr?.on("data", keep);
  const url = `http://127.0.0.1:${port}`;
  return new Promise<Server>((resolve, reject) => {
    const fail = (why: string) => {
      clearTimeout(timer);
      child.kill();
      reject(new Error(`server did not start (${why}); it printed:\n${out}`));
    };
    const timer = setTimeout(() => fail(`no start line in ${START_MS / 1000} s`), START_MS);
    child.on("exit", (code, signal) => fail(`it ended, ${signal ?? `code ${code}`}`));
    // The start line may come in two pieces: what has come so far is what is looked at.
    const ready = () => {
      if (!out.includes(`on ${url}`)) return;
      clearTimeout(timer);
      child.stdout?.off("data", ready);
      child.removeAllListeners("exit");
      resolve({ process: child, port, url });
    };
    child.stdout?.on("data", ready);
  });
}
