import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RunRequest, RunResponse } from "@boni/sandbox";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Box, startBox } from "../src/server.ts";
import { call } from "./call.ts";

/**
 * The box through its socket, as Boni's server uses it: every case of `cases/` (what a function must not manage to do)
 * ends as it says, and after each the box still answers.
 */
const dir = mkdtempSync(join(tmpdir(), "boni-caja-"));
const socket = join(dir, "caja.sock");
let box: Box;

const ask = (req: RunRequest | string): Promise<RunResponse> =>
  new Promise((resolve, reject) => {
    const s = createConnection(socket);
    let buf = "";
    s.setEncoding("utf8");
    s.on("data", (d: string) => {
      buf += d;
      const at = buf.indexOf("\n");
      if (at >= 0) {
        s.end();
        resolve(JSON.parse(buf.slice(0, at)) as RunResponse);
      }
    });
    s.on("error", reject);
    s.write(`${typeof req === "string" ? req : JSON.stringify(req)}\n`);
  });

beforeAll(async () => {
  box = await startBox(socket, { grace: 2_000 });
});
afterAll(async () => {
  await box.close();
  rmSync(dir, { recursive: true, force: true });
});

const CASES = join(import.meta.dirname, "cases");

describe("the box", () => {
  for (const name of readdirSync(CASES).filter((f) => f.endsWith(".js"))) {
    it(`ends «${name}» as it should, and goes on answering`, async () => {
      const code = readFileSync(join(CASES, name), "utf8");
      const expect1 = /^\/\/ expect: (.*)$/m.exec(code)?.[1] ?? "";
      const r = await ask(call(code, "f", {}));
      if (expect1.startsWith("ok ")) {
        expect(r).toMatchObject({ ok: true });
        expect(r.ok && r.output).toEqual(JSON.parse(expect1.slice(3)));
        // Data only: nothing on Boni's side changed.
        expect(({} as Record<string, unknown>).contaminado).toBeUndefined();
      } else {
        expect(r.ok).toBe(false);
        expect(expect1.split("|")).toContain(!r.ok && r.error);
      }
      expect(await ask(call("function f(i) { return i * 2 }", "f", 21))).toMatchObject({
        ok: true,
        output: 42,
      });
    }, 20_000);
  }

  it("a line that is not a request is told so", async () => {
    expect(await ask("{ no es json")).toMatchObject({ ok: false, error: "invalid" });
    expect(await ask(JSON.stringify({ id: "x" }))).toMatchObject({
      ok: false,
      error: "invalid",
      message: expect.stringContaining("code"),
    });
  });
});
