// (test) The box's spares (src/server.ts, task 138; A-08): workers started before any call, each given one call. A
// worker serves one call and is ended; nothing of one call reaches the next with a spare in use; a spare is handed
// nothing of any request; a call's limits count from its start; a spare that is not ready or has died leaves the call
// to start its own worker, with the same answer; and calls and spares never hold more threads than the door's
// `workers`, so the box's memory at its fullest is what it was without them.
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Worker } from "node:worker_threads";
import type { EvalRequest, RunRequest, WireRead } from "@boni/sandbox";
import { afterAll, describe, expect, it } from "vitest";
import { readKey } from "../src/evaluate.ts";
import { type Box, type BoxOptions, startBox } from "../src/server.ts";
import { call } from "./call.ts";
import { CASES, evalRequest, tryCase } from "./eval-helpers.ts";

const dir = mkdtempSync(join(tmpdir(), "boni-caja-reserva-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

type Answer = { ok: boolean; error?: string; [key: string]: unknown };
const send = (path: string, req: object): Promise<Answer> =>
  new Promise((resolve, reject) => {
    const s = createConnection(path);
    let buf = "";
    s.setEncoding("utf8");
    s.on("data", (d: string) => {
      buf += d;
      const at = buf.indexOf("\n");
      if (at >= 0) {
        s.end();
        resolve(JSON.parse(buf.slice(0, at)));
      }
    });
    s.on("error", reject);
    s.write(`${JSON.stringify(req)}\n`);
  });

type How = "spare" | "ready" | "given" | "own";
/** A box whose workers the test sees: what each was, and which are still alive. */
async function watched(name: string, opts: BoxOptions = {}) {
  const path = join(dir, `${name}.sock`);
  // A worker's threadId is -1 once it has ended, so each event keeps the one it had.
  const events: { worker: Worker; how: How; alive: number; thread: number }[] = [];
  /** What each spare said, from its first message. */
  const said = new Map<Worker, unknown[]>();
  const alive = new Set<Worker>();
  const exited = new Map<Worker, Promise<void>>();
  const waiters: (() => void)[] = [];
  const box: Box = await startBox(path, {
    ...opts,
    onWorker: (worker, how) => {
      if (how === "spare") {
        const heard: unknown[] = [];
        said.set(worker, heard);
        worker.on("message", (m: unknown) => heard.push(m));
      }
      if (how === "spare" || how === "own") {
        alive.add(worker);
        exited.set(
          worker,
          new Promise((ok) =>
            worker.once("exit", () => {
              alive.delete(worker);
              ok();
            }),
          ),
        );
      }
      // How many threads were alive besides this one when it was started.
      events.push({
        worker,
        how,
        alive: alive.size - (how === "spare" || how === "own" ? 1 : 0),
        thread: worker.threadId,
      });
      for (const w of waiters.splice(0)) w();
    },
  });
  const of = (how: How) => events.filter((e) => e.how === how).map((e) => e.worker);
  /** Spares that said they are ready and were not given a call, and are still alive. */
  const idle = () => {
    const given = new Set(of("given"));
    return of("ready").filter((w) => !given.has(w) && alive.has(w));
  };
  return {
    box,
    path,
    events,
    said,
    of,
    exited,
    ask: (req: object) => send(path, req),
    /** Until a spare is ready and waiting. */
    ready: async () => {
      while (!idle().length) await new Promise<void>((ok) => waiters.push(ok));
    },
    /** Until every thread that served a call has ended. */
    settled: () => Promise.all([...of("given"), ...of("own")].map((w) => exited.get(w))),
  };
}

const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
const MB = 1024 * 1024;
const grant = { writes: { Gastos: ["create", "update", "remove"] as const } };
const gastos: WireRead = { collection: "Gastos", op: "find" };

/** One of each answer and of each fault the box gives, in both protocols. */
const KINDS: { label: string; req: RunRequest | EvalRequest }[] = [
  { label: "a value", req: evalRequest("expressions", ["$json.a * 2"], [{ a: 21 }, { a: 1 }]) },
  { label: "the code's own error", req: evalRequest("code", ["null.x"], [{}]) },
  {
    label: "its steps",
    req: evalRequest("code", ["for (;;) {}"], [], { limits: { steps: 2_000, ms: 10_000 } }),
  },
  {
    label: "its time",
    req: evalRequest("code", ["for (;;) {}"], [], { limits: { steps: 10_000_000, ms: 300 } }),
  },
  {
    label: "its memory",
    req: evalRequest("code", ["const a = []; for (;;) a.push('x'.repeat(1e5) + a.length);"], [], {
      limits: { memoryBytes: 16 * MB, steps: 1_000_000, ms: 5_000 },
    }),
  },
  { label: "its output", req: evalRequest("code", ["return 'x'.repeat(2 * 1024 * 1024)"], []) },
  {
    label: "its writes",
    req: evalRequest(
      "code",
      ["for (let i = 0; i < 10; i++) $col('Gastos').create({ i }); return 1"],
      [{}],
      {
        ...grant,
        limits: { writes: 3 },
      },
    ),
  },
  {
    label: "a read it was not given",
    req: evalRequest("code", ["return $col('Gastos').find().length"], [{}]),
  },
  {
    label: "a code that is not its hash",
    req: { ...evalRequest("expressions", ["1"], [{}]), hash: "0".repeat(64) },
  },
  { label: "a function's output", req: call("function f(x) { return x.n + 1 }", "f", { n: 41 }) },
  { label: "a function's error", req: call("function f() { return null.x }", "f", {}) },
  {
    label: "a function's memory",
    req: call(
      "function f() { const a = []; for (;;) a.push('x'.repeat(1e5)) }",
      "f",
      {},
      {
        limits: { memoryBytes: 8 * MB, ms: 10_000 },
      },
    ),
  },
];
/** An answer without what depends on the machine: its time, and the steps counted until its time ran out. */
const same = (a: Answer) => {
  const { ms: _ms, ...rest } = a;
  if (rest.error === "timeout") delete rest.steps;
  return rest;
};

/** Every kind through a box with no spares: what the box answered before task 138. */
let before: Answer[] | null = null;
async function withoutSpares() {
  if (before) return before;
  const b = await watched("sin-reserva", { spares: 0 });
  try {
    before = [];
    for (const k of KINDS) before.push(same(await b.ask(k.req)));
    expect(b.of("spare")).toEqual([]);
    return before;
  } finally {
    await b.box.close();
  }
}

describe("a spare worker (task 138, A-08)", () => {
  it("A-08 · one worker, one evaluation: each call of either protocol is given a worker no other call had, a spare or its own, and each ends after its one answer", async () => {
    const b = await watched("uno-cada-uno");
    try {
      for (let i = 0; i < 6; i++) {
        await b.ready();
        const r = await b.ask(i % 2 ? KINDS[0]!.req : KINDS[9]!.req);
        expect(r.ok).toBe(true);
      }
      // Calls at once: some find no spare ready and start their own.
      const many = await Promise.all(Array.from({ length: 6 }, () => b.ask(KINDS[0]!.req)));
      expect(many.every((r) => r.ok)).toBe(true);
      const served = [...b.of("given"), ...b.of("own")];
      expect(served).toHaveLength(12);
      const threads = b.events
        .filter((e) => e.how === "given" || e.how === "own")
        .map((e) => e.thread);
      expect(new Set(threads).size).toBe(12);
      expect(threads.every((t) => t > 0)).toBe(true);
      expect(b.of("given").length).toBeGreaterThanOrEqual(6);
      // Each worker that served a call ends: none is kept for another.
      await Promise.all(served.map((w) => b.exited.get(w)));
    } finally {
      await b.box.close();
    }
  }, 60_000);

  it("A-08 · nothing of one evaluation reaches the next with the spare in use: a global, a changed prototype and what the box was handed for the first are not there for the second", async () => {
    const b = await watched("nada-pasa");
    try {
      const both = async (first: object, second: object) => {
        await b.ready();
        const one = await b.ask(first);
        await b.ready();
        const two = await b.ask(second);
        return [one, two] as const;
      };
      // An extension's function may change its own world: the next call's world is another.
      const [left, looked] = await both(
        call(
          "function f() { globalThis.dejado = 1; Object.prototype.dejado = 1; Array.prototype.dejado = 1; Function.prototype.dejado = 1; return [typeof globalThis.dejado, typeof ({}).dejado] }",
          "f",
          {},
        ),
        call(
          "function f() { return [typeof globalThis.dejado, typeof ({}).dejado, typeof [].dejado, typeof (() => 1).dejado] }",
          "f",
          {},
        ),
      );
      expect(left).toMatchObject({ ok: true, output: ["number", "number"] });
      expect(looked).toMatchObject({ ok: true, output: Array(4).fill("undefined") });
      // An automation's code: its world is frozen, and what it read is the first request's alone.
      const code =
        "try { globalThis.dejado = 1 } catch {} try { Object.prototype.dejado = 1 } catch {} return [typeof globalThis.dejado, typeof ({}).dejado, $col('Gastos').find()]";
      const [read, unread] = await both(
        evalRequest("code", [code], [{}], { reads: { [readKey(gastos)]: [{ secreto: 7 }] } }),
        evalRequest("code", [code], [{}]),
      );
      expect(read).toMatchObject({
        ok: true,
        evaluations: [{ state: "done", values: [["undefined", "undefined", [{ secreto: 7 }]]] }],
      });
      expect(unread).toMatchObject({ ok: true, evaluations: [{ state: "needs", read: gastos }] });
      expect(JSON.stringify(unread)).not.toContain("secreto");
      // Every call here was given a spare.
      expect(b.of("given")).toHaveLength(4);
      expect(b.of("own")).toEqual([]);
    } finally {
      await b.box.close();
    }
  }, 60_000);

  it("A-08 · a spare is handed nothing of any request, only the compiled interpreter, and makes its interpreter only once it is given a call", async () => {
    const b = await watched("solo-el-modulo", {
      spareScript: new URL("./spares/tells.ts", import.meta.url),
    });
    try {
      await b.ready();
      expect(await b.ask(KINDS[0]!.req)).toMatchObject({
        ok: true,
        evaluations: [{ values: [42] }, { values: [2] }],
      });
      const given = b.of("given");
      expect(given).toHaveLength(1);
      // Every spare says what it was handed, before it is given anything. The one started to replace the spare
      // given the call may not have said it yet when the answer comes, so each is waited for (it flaked on CI).
      for (const spare of b.of("spare"))
        await expect
          .poll(() => (b.said.get(spare) ?? []).filter((m) => (m as { told?: unknown }).told))
          .toEqual([{ told: ["module"], module: true }]);
      expect(b.said.get(given[0]!)?.[0]).toEqual({ told: ["module"], module: true });
    } finally {
      await b.box.close();
    }
  }, 60_000);

  it("A-08 · every limit counts from the call's start, never from when its spare started: after a spare waited longer than a call's time, a call within its time is answered, and one past it is the worker's own `timeout` at its time", async () => {
    const b = await watched("desde-la-llamada", { grace: 100 });
    try {
      await b.ready();
      await sleep(800);
      const quick = await b.ask(
        evalRequest("code", ["let s = 0; for (let i = 0; i < 1e5; i++) s += i; return s"], [], {
          limits: { ms: 300 },
        }),
      );
      expect(quick).toMatchObject({ ok: true, evaluations: [{ values: [4999950000] }] });
      await b.ready();
      await sleep(800);
      const late = await b.ask(KINDS[3]!.req);
      // The worker's own answer (with its steps), at its own time: not the door's, counted from the spare's start.
      expect(late).toMatchObject({ ok: false, error: "timeout" });
      expect(typeof late.steps).toBe("number");
      expect(late.ms).toBeGreaterThanOrEqual(300);
      expect(late.ms).toBeLessThan(800);
      expect(b.of("own")).toEqual([]);
    } finally {
      await b.box.close();
    }
  }, 60_000);

  it("A-08 · with a spare given each call, every answer and every fault is the one the box gave without spares, with its code", async () => {
    const want = await withoutSpares();
    const b = await watched("lo-mismo");
    try {
      const got: Answer[] = [];
      for (const k of KINDS) {
        await b.ready();
        got.push(same(await b.ask(k.req)));
      }
      for (const [i, k] of KINDS.entries()) expect(got[i], k.label).toEqual(want[i]);
      expect(got.map((a) => a.error ?? "ok")).toEqual([
        "ok",
        "ok",
        "steps",
        "timeout",
        "memory",
        "output",
        "ok",
        "ok",
        "invalid",
        "ok",
        "exception",
        "memory",
      ]);
      expect(b.of("given")).toHaveLength(KINDS.length);
      expect(b.of("own")).toEqual([]);
    } finally {
      await b.box.close();
    }
  }, 120_000);

  it("A-08 · a spare that never gets ready is never given a call: each call starts its own worker, with the same answers", async () => {
    const want = await withoutSpares();
    const b = await watched("nunca-lista", {
      spareScript: new URL("./spares/never-ready.ts", import.meta.url),
    });
    try {
      await sleep(300);
      const got: Answer[] = [];
      for (const k of KINDS) got.push(same(await b.ask(k.req)));
      for (const [i, k] of KINDS.entries()) expect(got[i], k.label).toEqual(want[i]);
      expect(b.of("given")).toEqual([]);
      expect(b.of("own")).toHaveLength(KINDS.length);
    } finally {
      await b.box.close();
    }
  }, 120_000);

  it("A-08 · a spare that died before a call is dropped: the call starts its own worker, with the same answer, and the spare is not started again until a call ends", async () => {
    const want = await withoutSpares();
    const b = await watched("muerta", {
      spareScript: new URL("./spares/dies.ts", import.meta.url),
    });
    try {
      await Promise.all(b.of("spare").map((w) => b.exited.get(w)));
      const spares = b.of("spare").length;
      await sleep(200);
      expect(b.of("spare")).toHaveLength(spares);
      const got: Answer[] = [];
      for (const k of KINDS) {
        got.push(same(await b.ask(k.req)));
        await b.settled();
      }
      for (const [i, k] of KINDS.entries()) expect(got[i], k.label).toEqual(want[i]);
      expect(b.of("given")).toEqual([]);
      expect(b.of("own")).toHaveLength(KINDS.length);
    } finally {
      await b.box.close();
    }
  }, 120_000);

  it("A-08 · a spare that dies when it is given a call, before it took it, leaves the call to start its own worker, with the same answer", async () => {
    const want = await withoutSpares();
    const b = await watched("muere-al-darsela", {
      spareScript: new URL("./spares/dies-on-call.ts", import.meta.url),
    });
    try {
      const got: Answer[] = [];
      for (const k of KINDS) {
        await b.ready();
        got.push(same(await b.ask(k.req)));
      }
      for (const [i, k] of KINDS.entries()) expect(got[i], k.label).toEqual(want[i]);
      expect(b.of("given")).toHaveLength(KINDS.length);
      expect(b.of("own")).toHaveLength(KINDS.length);
    } finally {
      await b.box.close();
    }
  }, 120_000);

  it("A-08 · the spares fit the box's memory: a spare is started only while calls, spares and the threads being ended are fewer than the door's `workers`", async () => {
    const b = await watched("caben", { workers: 2 });
    try {
      await b.ready();
      for (let round = 0; round < 3; round++) {
        await Promise.all(Array.from({ length: 5 }, () => b.ask(KINDS[0]!.req)));
        for (let i = 0; i < 3; i++) await b.ask(KINDS[9]!.req);
      }
      await b.settled();
      const spares = b.events.filter((e) => e.how === "spare");
      expect(spares.length).toBeGreaterThan(2);
      for (const e of spares) expect(e.alive).toBeLessThan(2);
      expect(b.of("given").length).toBeGreaterThan(0);
    } finally {
      await b.box.close();
    }
  }, 60_000);

  it("A-08 · every case of test/cases/evaluacion ends as it says through the door with a spare given each call", async () => {
    const b = await watched("casos");
    try {
      const through = async (req: EvalRequest) => {
        await b.ready();
        return (await b.ask(req)) as never;
      };
      const names = readdirSync(CASES).filter((f) => f.endsWith(".js"));
      for (const name of names) await tryCase(name, { through });
      // Three forms of each case, each in a spare.
      expect(b.of("given")).toHaveLength(3 * names.length);
      expect(readFileSync(join(CASES, names[0]!), "utf8")).toContain("expect:");
    } finally {
      await b.box.close();
    }
  }, 180_000);
});
