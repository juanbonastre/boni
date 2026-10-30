/**
 * The server's side of the box where an extension's functions run (docs/extensiones.md §11.6, E1): one request over
 * its Unix socket (BONI_SANDBOX_SOCKET), one answer. Without a box, functions are unavailable and the answer says so;
 * nothing else of Boni depends on it. Starting it, and what goes in and comes out, is the caller's (E2).
 */
import { createHash } from "node:crypto";
import { createConnection } from "node:net";
import {
  DEFAULT_SOCKET,
  limitsOf,
  type RunRequest,
  type RunResponse,
  requestErrors,
} from "@boni/sandbox";

/** A call's code with its hash, as the box checks it. */
export const codeHash = (code: string) => createHash("sha256").update(code).digest("hex");

/** Where the box listens: the folder the server's container shares with it. */
export const sandboxSocket = () => process.env.BONI_SANDBOX_SOCKET ?? DEFAULT_SOCKET;

const once = (req: RunRequest, socket: string, waitMs: number): Promise<RunResponse> =>
  new Promise((resolve) => {
    const s = createConnection(socket);
    let buf = "";
    let done = false;
    const end = (r: RunResponse) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      s.destroy();
      resolve(r);
    };
    const timer = setTimeout(
      () => end({ id: req.id, ok: false, error: "timeout", message: "la caja no ha contestado" }),
      waitMs,
    );
    s.setEncoding("utf8");
    s.on("data", (d: string) => {
      buf += d;
      const at = buf.indexOf("\n");
      if (at < 0) return;
      try {
        const r = JSON.parse(buf.slice(0, at)) as RunResponse;
        end(
          r.id === req.id
            ? r
            : {
                id: req.id,
                ok: false,
                error: "invalid",
                message: "la caja ha contestado a otra petición",
              },
        );
      } catch {
        end({
          id: req.id,
          ok: false,
          error: "invalid",
          message: "la caja no ha contestado con JSON",
        });
      }
    });
    s.on("error", (e: Error & { code?: string }) =>
      end({
        id: req.id,
        ok: false,
        error: "unavailable",
        message:
          e.code === "ENOENT" || e.code === "ECONNREFUSED"
            ? "la caja de las extensiones no está funcionando"
            : e.message,
      }),
    );
    s.on("close", () =>
      end({
        id: req.id,
        ok: false,
        error: "unavailable",
        message: "la caja ha cerrado sin contestar",
      }),
    );
    s.write(`${JSON.stringify(req)}\n`);
  });

/**
 * Runs one call in the box. It waits for the call's own time and a margin for the box to start its interpreter; if
 * the box is restarting (refused), it tries once more a moment later.
 */
export async function runInSandbox(
  req: RunRequest,
  opts: { socket?: string; marginMs?: number } = {},
): Promise<RunResponse> {
  const errs = requestErrors(req);
  if (errs.length)
    return { id: req.id, ok: false, error: "invalid", message: `petición: ${errs.join(", ")}` };
  const socket = opts.socket ?? sandboxSocket();
  const waitMs = limitsOf(req).ms + (opts.marginMs ?? 5_000);
  const first = await once(req, socket, waitMs);
  if (first.ok || first.error !== "unavailable") return first;
  await new Promise((r) => setTimeout(r, 300));
  return once(req, socket, waitMs);
}
