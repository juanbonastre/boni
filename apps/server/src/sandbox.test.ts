import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RunRequest } from "@boni/sandbox";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { codeHash, runInSandbox } from "./sandbox.ts";

/**
 * The server's side of the box (E1), against a stand-in that answers as the box does: a line in, a line out. The box
 * itself is tested in apps/sandbox.
 */
const dir = mkdtempSync(join(tmpdir(), "boni-cliente-caja-"));
const socket = join(dir, "caja.sock");
let server: Server;
let lastLine = "";

const code = "function doble(i) { return i * 2 }";
const req = (more: Partial<RunRequest> = {}): RunRequest => ({
  id: "llamada-1",
  code,
  hash: codeHash(code),
  fn: "doble",
  input: 21,
  day: "2026-10-30",
  seed: 1,
  ...more,
});

beforeAll(async () => {
  server = createServer((s) => {
    s.setEncoding("utf8");
    s.on("data", (d: string) => {
      lastLine = d.trim();
      const r = JSON.parse(lastLine) as RunRequest;
      if (r.fn === "callada") return; // never answers
      s.write(
        `${JSON.stringify({ id: r.id, ok: true, output: (r.input as number) * 2, steps: 1, ms: 3 })}\n`,
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(socket, resolve));
});
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(dir, { recursive: true, force: true });
});

describe("a call to the box from the server", () => {
  it("sends one line and takes its answer", async () => {
    expect(await runInSandbox(req(), { socket })).toEqual({
      id: "llamada-1",
      ok: true,
      output: 42,
      steps: 1,
      ms: 3,
    });
    expect(JSON.parse(lastLine)).toMatchObject({ fn: "doble", hash: codeHash(code) });
  });

  it("without a box, functions are unavailable and nothing else breaks", async () => {
    expect(await runInSandbox(req(), { socket: join(dir, "no-hay.sock") })).toMatchObject({
      ok: false,
      error: "unavailable",
      message: "la caja de las extensiones no está funcionando",
    });
  });

  it("does not wait for ever, and does not send what is not a request", async () => {
    expect(
      await runInSandbox(req({ fn: "callada", limits: { ms: 50 } }), { socket, marginMs: 100 }),
    ).toMatchObject({ ok: false, error: "timeout" });
    expect(await runInSandbox(req({ hash: "corto" }), { socket })).toMatchObject({
      ok: false,
      error: "invalid",
    });
  });
});
