// The box evaluating an automation's JavaScript (src/evaluate.ts, src/world.js; docs/automatizaciones.md §5.3, §5.4,
// §6). Real tests run the real interpreter, as box.test.ts and run.test.ts do for an extension's function: each attack
// is a file of test/cases/evaluacion, tried as an expression and as a «Código», in both modes, and through the socket
// for what only the door can stop (a call ended from outside, too many at once). Times are this thread's CPU (A-15).
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CODE_GLOBALS, CODE_LIMITS, type CodeLimit, DATE_HELP } from "@boni/automations";
import {
  addMonths,
  civilFromDays,
  daysFromCivil,
  fromLocal,
  MS_DAY,
  MS_HOUR,
  toLocal,
  weekday,
} from "@boni/calendar";
import { cpu, under } from "@boni/pace";
import {
  EVAL_DEFAULT_LIMITS,
  EVAL_MAX_LIMITS,
  type EvalRequest,
  type EvalResponse,
  type Json,
  type WireRead,
} from "@boni/sandbox";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { evaluateCall, readKey } from "../src/evaluate.ts";
import { type Box, startBox } from "../src/server.ts";
import { call } from "./call.ts";
import {
  CASES,
  caseCode,
  categoriesLike,
  dateNames,
  evalRequest,
  evals,
  NOW,
  rowsLike,
  tryCase,
  zoneTable,
} from "./eval-helpers.ts";

type Kind = EvalRequest["kind"];
type Mode = EvalRequest["mode"];
const ask = (
  kind: Kind,
  sources: string[],
  input: EvalRequest["input"],
  more: Partial<EvalRequest> = {},
) => evaluateCall(evalRequest(kind, sources, input, more));
const values = (r: EvalResponse) => evals(r).map((e) => (e.state === "done" ? e.values : e));
/** A «Código»'s one value per evaluation. */
const outs = (r: EvalResponse) => evals(r).map((e) => (e.state === "done" ? e.values[0] : e));

/** The engine's loop (E3's, in short): repeat with what was read until nothing is needed. */
async function untilDone(req: EvalRequest, serve: (read: WireRead) => Json) {
  let calls = 0;
  for (;;) {
    calls++;
    const r = await evaluateCall(req);
    const needs = evals(r).filter((e) => e.state === "needs");
    if (!needs.length) return { r, calls };
    const reads = { ...req.reads };
    for (const n of needs) if (n.state === "needs") reads[n.key] = serve(n.read);
    req = { ...req, reads };
  }
}

// ---------------------------------------------------------------- the cases of test/cases/evaluacion

describe("the cases of test/cases/evaluacion", () => {
  for (const name of readdirSync(CASES).filter((f) => f.endsWith(".js")))
    it(`«${name}» ends as it says, as a «Código» in both modes and as an expression`, async () => {
      await tryCase(name);
    }, 30_000);
});

// ---------------------------------------------------------------- the box through its socket

const dir = mkdtempSync(join(tmpdir(), "boni-caja-eval-"));
const socket = join(dir, "caja.sock");
let box: Box;
/** What the door answers, of either protocol: only what the tests here look at is typed. */
type Answer = { ok: boolean; error?: string; message?: string; [key: string]: unknown };
const send = (req: object | string, path = socket): Promise<Answer> =>
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
    s.write(`${typeof req === "string" ? req : JSON.stringify(req)}\n`);
  });
const throughBox = async (req: EvalRequest) => (await send(req)) as unknown as EvalResponse;
const servesNext = async () =>
  expect(await send(evalRequest("expressions", ["$json.a * 2"], [{ a: 21 }]))).toMatchObject({
    ok: true,
    evaluations: [{ state: "done", values: [42] }],
  });

beforeAll(async () => {
  box = await startBox(socket, { grace: 1_000 });
});
afterAll(async () => {
  await box.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("nothing of outside", () => {
  it("AU-160 · code reaches no network, file, process, module, timer or worker: `fetch`, `require`, `import()`, `process`, `globalThis.constructor`, `Function('return this')()`, `setTimeout`, `WebAssembly` and `SharedArrayBuffer` give nothing of the host, as an expression and as a «Código»", async () => {
    for (const name of [
      "red.js",
      "modulos.js",
      "importar.js",
      "importar-nunca.js",
      "proceso.js",
      "nada-de-fuera.js",
    ])
      await tryCase(name);
  }, 30_000);

  it("AU-160 · the interpreter is made new for each call, with a memory of its own that cannot grow past its limit, in a worker of its own that the door ends: a call that never yields is answered `timeout` and the next call is served", async () => {
    await tryCase("memoria.js", { through: throughBox });
    await servesNext();
    const never = evalRequest("code", ["for (;;) {}"], [], { limits: { steps: 20_000, ms: 300 } });
    expect(await send(never)).toMatchObject({ ok: false, error: "timeout" });
    await servesNext();
    // The door's own end: a worker that has not answered by its time and its grace is ended from outside, whatever it
    // is doing. With no grace and 1 ms the worker is still starting its interpreter when the door ends it, so the
    // answer is the door's (it has no `steps`, which only the worker counts), and the door serves the next call.
    const quick = join(dir, "sin-gracia.sock");
    const strict = await startBox(quick, { workers: 1, grace: 0 });
    try {
      const ended = await send(
        evalRequest("code", ["for (;;) {}"], [], { limits: { ms: 1 } }),
        quick,
      );
      expect(ended).toMatchObject({ ok: false, error: "timeout" });
      expect(ended.steps).toBeUndefined();
      expect(
        await send(evalRequest("expressions", ["$json.a * 2"], [{ a: 21 }]), quick),
      ).toMatchObject({ ok: true, evaluations: [{ state: "done", values: [42] }] });
    } finally {
      await strict.close();
    }
    await servesNext();
    // What one call left in its interpreter is not in the next one's (each is new).
    const first = await send(
      evalRequest(
        "code",
        ["try { Object.prototype.dejado = 1 } catch {} return ({}).dejado ?? null"],
        [],
      ),
    );
    expect(first).toMatchObject({ ok: true, evaluations: [{ values: [null] }] });
  }, 30_000);

  it("AU-160 · what the code is handed is data and no object of the host: `$json`, `$input`, `$('Step')`, the rows of a read and the console's functions have no way to a host function, by their prototypes, their constructors or an error's stack", async () => {
    await tryCase("anfitrion.js");
    const read: WireRead = { collection: "Gastos", op: "find" };
    const walk = `const seen = new Set(); const found = [];
      const todo = [$json, $input, $('Buscar gastos'), $('Buscar gastos').all(), $col('Gastos').find(), console.log, console];
      while (todo.length) { const o = todo.pop();
        if (o === null || (typeof o !== "object" && typeof o !== "function") || seen.has(o)) continue;
        seen.add(o); if (typeof o === "function" && /__boni/.test(o.name)) found.push(o.name);
        todo.push(Object.getPrototypeOf(o), o.constructor);
        for (const k of Reflect.ownKeys(o)) { const d = Object.getOwnPropertyDescriptor(o, k); todo.push(d.value, d.get, d.set); } }
      try { console.log(null.x) } catch (e) { if (/__boni|evaluate\\.ts|node:/.test(e.stack)) found.push(e.stack) }
      return found;`;
    const r = await ask("code", [walk], [{ a: 1 }], {
      mode: "perRow",
      steps: { "Buscar gastos": { rows: [{ b: 2 }] } },
      reads: { [readKey(read)]: [{ c: 3 }] },
    });
    expect(outs(r)).toEqual([[]]);
  });

  it("AU-160 · an evaluation of protocol 2 and a function call of protocol 1 share the door and nothing else: neither sees the other's code, input or output, and with the door full both are told `busy`", async () => {
    const small = join(dir, "pequena.sock");
    const one = await startBox(small, { workers: 1, queue: 0, grace: 500 });
    try {
      const long = send(
        evalRequest("code", ["for (;;) {}"], [], { limits: { steps: 20_000, ms: 1_500 } }),
        small,
      );
      await new Promise((ok) => setTimeout(ok, 100));
      expect(await send(call("function f() { return 1 }", "f", {}), small)).toMatchObject({
        ok: false,
        error: "busy",
      });
      expect(await send(evalRequest("expressions", ["1"], [{}]), small)).toMatchObject({
        ok: false,
        error: "busy",
      });
      expect(["steps", "timeout"]).toContain((await long).error);
      // Each sees nothing of the other's world.
      const fn = await send(
        call(
          "function f() { return [typeof $input, typeof $col, typeof $json, typeof console] }",
          "f",
          {},
        ),
        small,
      );
      expect(fn).toMatchObject({
        ok: true,
        output: ["undefined", "undefined", "undefined", "undefined"],
      });
      const ev = await send(
        evalRequest("code", ["return [typeof __boniContext, typeof f]"], []),
        small,
      );
      expect(ev).toMatchObject({
        ok: true,
        evaluations: [{ values: [["undefined", "undefined"]] }],
      });
      // A line of one protocol is checked by its own rules: an evaluation's members are not a function call's.
      expect(
        await send({ ...evalRequest("expressions", ["1"], [{}]), fn: "f", code: "x" }, small),
      ).toMatchObject({
        ok: false,
        error: "invalid",
      });
    } finally {
      await one.close();
    }
  }, 30_000);

  it("AU-34 · `Date.now()`, `new Date()` and `$now` give the request's instant, the same at the start and at the end of a long evaluation, and `performance`, `setTimeout` and `Atomics.wait` give no other clock", async () => {
    await tryCase("reloj.js");
    const r = await ask(
      "expressions",
      ["[typeof performance, typeof setTimeout, typeof Atomics, Date.now(), new Date().getTime()]"],
      [{}],
    );
    expect(values(r)).toEqual([[["undefined", "undefined", "undefined", NOW, NOW]]]);
  }, 30_000);

  it("AU-34 · `Math.random()` gives a fixed sequence from the request's seed and the row's place: the same request twice gives the same answer byte for byte, a row gives the same alone and in a batch, and two rows do not share a sequence; `crypto` gives nothing", async () => {
    const rows = [{ i: 0 }, { i: 1 }, { i: 2 }];
    const src = ["[Math.random(), Math.random()]"];
    const a = await ask("expressions", src, rows);
    const b = await ask("expressions", src, rows);
    const strip = (r: EvalResponse) => JSON.stringify(evals(r));
    expect(strip(a)).toBe(strip(b));
    const batch = values(a);
    for (let i = 0; i < rows.length; i++)
      expect(values(await ask("expressions", src, [rows[i]!], { from: i }))[0]).toEqual(batch[i]);
    const flat = batch.flat(2) as number[];
    expect(new Set(flat).size).toBe(flat.length);
    expect(values(await ask("expressions", src, rows, { seed: 43 }))).not.toEqual(batch);
    await tryCase("azar-cripto.js");
  }, 30_000);

  it("AU-34 · an answer says whether each evaluation read the clock or chance, and says no for one that did not", async () => {
    const r = await ask(
      "code",
      [
        "if ($json.i === 1) Date.now(); if ($json.i === 2) Math.random(); if ($json.i === 3) $today; return $json.i",
      ],
      [{ i: 0 }, { i: 1 }, { i: 2 }, { i: 3 }],
      { mode: "perRow" },
    );
    expect(evals(r).map((e) => e.state === "done" && [e.clock, e.random])).toEqual([
      [false, false],
      [true, false],
      [false, true],
      [true, false],
    ]);
  });
});

describe("one evaluation leaves nothing to the next", () => {
  it("AU-37 · a row's evaluation cannot leave anything to the next row's of the same batch: a variable without `const`, a property on `globalThis`, on `Object.prototype`, `Array.prototype` or `Function.prototype`, on a function of `$input` or on `console`, a `Symbol.for`, a getter left on a row of the batch: each either throws (`frozen`), or stays on the evaluation's own copy of the rows, and is not there for the next row", async () => {
    // Each attempt is a case of test/cases/evaluacion (`dejar-*.js`): it ends as its `expect` line says in the three
    // forms, and its `look` line, run for the next row of the same batch, finds nothing left.
    const attempts = readdirSync(CASES).filter((f) => /^dejar-.*\.js$/.test(f));
    expect(attempts.length).toBe(12);
    for (const name of attempts) {
      await tryCase(name);
      const code = caseCode(name);
      const look = /^\/\/ look: (.*)$/m.exec(code)?.[1];
      expect(look, name).toBeTruthy();
      const r = await ask(
        "code",
        [`if ($json.i === 0) {\n${code}\n}\nreturn ${look}`],
        [{ i: 0 }, { i: 1 }],
        { mode: "perRow" },
      );
      const [first, second] = evals(r);
      if (/^\/\/ expect: done /m.test(code)) expect(first, name).toMatchObject({ state: "done" });
      else {
        expect(first, name).toMatchObject({ state: "failed" });
        expect(["frozen", "threw"], name).toContain(first?.state === "failed" && first.fault);
      }
      expect(second, name).toMatchObject({ state: "done", values: ["undefined"] });
    }
  }, 60_000);

  it("AU-37 · the code may change the rows that reach it, and what it returns is what the step gives (Juan, 2026-11-16): a field written, a row pushed, a key deleted, on `$json`, `$input.item` or `$input.all()`; each evaluation has its own copy, so the next row of the batch finds them as they arrived", async () => {
    const look = "[$json.n, $input.all().length, $input.first()?.n, $input.last()?.n]";
    const changes = [
      "$json.n = 9",
      "delete $json.n",
      "$input.item.n = 9",
      "$input.all().push({ n: 1 })",
      "$input.all().length = 0",
      "$input.all().reverse()",
      "$input.all()[0] = { n: 7 }",
      "$input.first().n = 9",
      "Object.freeze($input.all())",
    ];
    for (const change of changes) {
      const r = await ask(
        "code",
        [`const before = ${look};\nif ($json.i === 0) ${change};\nreturn [before, ${look}]`],
        [
          { i: 0, n: 1 },
          { i: 1, n: 2 },
        ],
        { mode: "perRow" },
      );
      expect(
        evals(r).every((e) => e.state === "done"),
        change,
      ).toBe(true);
      const [first, second] = outs(r) as [unknown[][], unknown[][]];
      expect(first?.[0], change).toEqual([1, 2, 1, 2]);
      if (change !== "Object.freeze($input.all())")
        expect(first?.[1], change).not.toEqual([1, 2, 1, 2]);
      expect(second, change).toEqual([
        [2, 2, 1, 2],
        [2, 2, 1, 2],
      ]);
    }
    // Within one evaluation, every way to a row is the same object: `$json` is `$input.item` and `$input.all()[i]`,
    // and it stays the row that arrived wherever the code moves it in the list.
    const same = await ask(
      "code",
      [
        "$json.total = 1; const a = $input.all(); const was = a[$json.i]; a.reverse(); return [$input.item === $json, was === $json, $input.item.total, a.includes($json)]",
      ],
      [{ i: 0 }, { i: 1 }],
      { mode: "perRow" },
    );
    expect(outs(same)).toEqual([
      [true, true, 1, true],
      [true, true, 1, true],
    ]);
    // A place cut off by `length` is not filled again; the list is an array to every test of one.
    const list = await ask(
      "code",
      [
        "const a = $input.all(); a.length = 1; a.length = 3; return [a[1] === undefined, 2 in a, Array.isArray(a), JSON.stringify([...a]), Object.keys($input.all()).length]",
      ],
      [{ n: 1 }, { n: 2 }, { n: 3 }],
    );
    expect(outs(list)).toEqual([[true, false, true, '[{"n":1},null,null]', 1]]);
    // What it returns is what the step gives: the rows it changed.
    const all = await ask(
      "code",
      ["for (const row of $input.all()) row.total = row.importe * 2;\nreturn $input.all()"],
      [{ importe: 1 }, { importe: 2 }],
    );
    expect(outs(all)).toEqual([
      [
        { importe: 1, total: 2 },
        { importe: 2, total: 4 },
      ],
    ]);
    // As an expression too; a key `__proto__` of a row stays a key of the copy, and what a row holds is copied too.
    const expr = await ask(
      "expressions",
      [
        "(() => { $json.n += 1; if ($json.tags) $json.tags.push('b'); return [$json.n, Object.keys($json), $json.tags]; })()",
      ],
      [JSON.parse('{"n": 1, "__proto__": {"x": 1}}'), { n: 5, tags: ["a"] }, { n: 5, tags: ["a"] }],
      { from: 0 },
    );
    expect(values(expr)).toEqual([
      [[2, ["n", "__proto__"], null]],
      [[6, ["n", "tags"], ["a", "b"]]],
      [[6, ["n", "tags"], ["a", "b"]]],
    ]);
  });

  it("AU-37 · what is not the step's rows is looked at and never changed: writing the rows of a cited step, what was read or `$run` is `frozen`, with the line, and the message says to change a copy; a copy is the code's own", async () => {
    const steps = { "Buscar gastos": { rows: [{ importe: 5 }], item: [0, 0] } };
    const read: WireRead = { collection: "Gastos", op: "find" };
    const reads = { [readKey(read)]: [{ id: "g1", importe: 7 }] };
    for (const change of [
      "$('Buscar gastos').first().importe = 9",
      "$('Buscar gastos').item.importe = 9",
      "$('Buscar gastos').all().push({ importe: 1 })",
      "delete $('Buscar gastos').first().importe",
      "$col('Gastos').find()[0].importe = 9",
      "$col('Gastos').find().pop()",
      "$run.test = false",
    ]) {
      const r = await ask("code", [`const a = 1;\n${change};\nreturn a`], [{ i: 0 }, { i: 1 }], {
        mode: "perRow",
        steps,
        reads,
      });
      for (const e of evals(r)) {
        expect(e, change).toMatchObject({ state: "failed", fault: "frozen", line: 2 });
        expect(e.state === "failed" && e.message, change).toMatch(/haz una copia/);
      }
    }
    const r = await ask(
      "code",
      [
        "const g = { ...$col('Gastos').find()[0], importe: 1 }; return [{ ...$('Buscar gastos').first(), importe: 9 }, g]",
      ],
      [],
      { steps, reads },
    );
    expect(outs(r)).toEqual([[{ importe: 9 }, { id: "g1", importe: 1 }]]);
  });

  it("AU-37 · a pass repeated after a read starts from the rows as they arrived: `row.n += 1` written before the read ends as one increment, not one per pass", async () => {
    const read: WireRead = { collection: "Gastos", op: "count" };
    const forms: [string, string, Mode][] = [
      [
        "«Una vez con todas las filas»",
        "for (const row of $input.all()) row.n += 1;\nconst c = $col('Gastos').count();\nreturn $input.all().map((row) => ({ ...row, c }))",
        "all",
      ],
      [
        "«Una vez por fila»",
        "$json.n += 1;\nconst c = $col('Gastos').count();\nreturn { ...$json, c }",
        "perRow",
      ],
    ];
    for (const [label, code, mode] of forms) {
      const input = [{ n: 0 }, { n: 10 }];
      // The first pass stops at the read; the engine repeats it with the answer, from the same request's rows.
      const halted = evals(await ask("code", [code], input, { mode }));
      expect(
        halted.every((e) => e.state === "needs"),
        label,
      ).toBe(true);
      const again = await ask("code", [code], input, { mode, reads: { [readKey(read)]: 3 } });
      expect(outs(again).flat(), label).toEqual([
        { n: 1, c: 3 },
        { n: 11, c: 3 },
      ]);
    }
  });

  it("AU-37 · two calls share nothing: what the first defined, changed or read is not in the second, and the answer of a batch is the same as the answers of its rows sent one by one", async () => {
    const read: WireRead = { collection: "Gastos", op: "count" };
    const reading = ["return $col('Gastos').count()"];
    expect(outs(await ask("code", reading, [], { reads: { [readKey(read)]: 7 } }))).toEqual([7]);
    // The next call has not what the first read: it asks again.
    expect(evals(await ask("code", reading, []))).toEqual([
      { state: "needs", key: readKey(read), read },
    ]);
    const rows = rowsLike(20);
    const src = [
      "$json.importe * 1.21",
      "$date($json.fecha).plus({ days: Math.floor(Math.random() * 10) }).toDay()",
      "$now.weekday",
    ];
    const batch = await ask("expressions", src, rows);
    const alone = [];
    for (let i = 0; i < rows.length; i++)
      alone.push(...evals(await ask("expressions", src, [rows[i]!], { from: i })));
    expect(evals(batch)).toEqual(alone);
  });
});

describe("what code may name, and reads", () => {
  it("AU-24 · `$json` is the current row's fields and `$input.item` the same; `$input.all()`, `.first()` and `.last()` the batch's rows in «Una vez con todas las filas»; `$('Step').all()`, `.first()`, `.last()` and `.item` the rows sent for that step, and a step that was not sent throws by its name", async () => {
    const input = [{ a: 1 }, { a: 2 }];
    const steps = { Paso: { rows: [{ x: "p" }, { x: "q" }], item: [1, null] } };
    const per = await ask(
      "code",
      [
        "return [$json.a, $input.item.a, $input.all().length, $input.first().a, $input.last().a, $('Paso').all().length, $('Paso').first().x, $('Paso').last().x, $('Paso').item]",
      ],
      input,
      { mode: "perRow", steps },
    );
    expect(outs(per)).toEqual([
      [1, 1, 2, 1, 2, 2, "p", "q", { x: "q" }],
      [2, 2, 2, 1, 2, 2, "p", "q", null],
    ]);
    const all = await ask(
      "code",
      ["return [$input.all().length, $input.first().a, $input.last().a, $('Paso').first().x]"],
      input,
      {
        steps,
      },
    );
    expect(outs(all)).toEqual([[2, 1, 2, "p"]]);
    for (const src of ["return $json.a", "return $input.item", "return $('Paso').item"])
      expect(evals(await ask("code", [src], input, { steps }))[0], src).toMatchObject({
        state: "failed",
        fault: "threw",
        message: expect.stringMatching(/Una vez con todas las filas/),
      });
    expect(evals(await ask("expressions", ["$('Otro paso').first()"], input))[0]).toMatchObject({
      state: "failed",
      fault: "threw",
      message: expect.stringContaining("Otro paso"),
    });
  });

  it("AU-24 · `$run` says whether it is a test and what started it, `$page` is null, and `$today` is the request's day in its zone at 00:00", async () => {
    const r = await ask(
      "expressions",
      ["[$run.test, $run.startedBy, $page, $today.toISO(), $today.toMillis(), $today.hour]"],
      [{}],
      {
        run: { test: false, startedBy: "user" },
      },
    );
    expect(values(r)).toEqual([
      [[false, "user", null, "2026-11-16", Date.UTC(2026, 10, 15, 23), 0]],
    ]);
  });

  it("AU-24 · nothing is added to the prototypes of JavaScript's own values: a text, a list, a number and a date have the methods the language gives and no other (`'a'.toTitleCase` and `[].first` are undefined), and `$run` holds `test` and `startedBy` and no name or id", async () => {
    const r = await ask(
      "expressions",
      [
        "[typeof 'a'.toTitleCase, typeof [].first, typeof (1).round, typeof new Date(0).isWeekend, typeof ({}).isEmpty, Object.keys($run)]",
      ],
      [{}],
    );
    expect(values(r)).toEqual([
      [["undefined", "undefined", "undefined", "undefined", "undefined", ["test", "startedBy"]]],
    ]);
  });

  it("AU-25 · a field is read by its key and a key that the row does not have gives undefined, never an error; a key like `__proto__`, `constructor` or `toString` in a row is a field like any other, in what comes in and in what goes out", async () => {
    const row = JSON.parse('{"a":1,"__proto__":{"b":2},"constructor":"c","toString":"t"}');
    const r = await ask(
      "code",
      ["return [typeof $json.nada, $json.__proto__, $json.constructor, $json.toString]"],
      [row],
      {
        mode: "perRow",
      },
    );
    expect(outs(r)).toEqual([["undefined", { b: 2 }, "c", "t"]]);
    const out = outs(
      await ask("code", ["const o = { ...$json }; o.valueOf = 'v'; return o"], [row], {
        mode: "perRow",
      }),
    )[0] as object;
    expect(Object.keys(out)).toEqual(["a", "__proto__", "constructor", "toString", "valueOf"]);
    expect(Object.hasOwn(out, "__proto__")).toBe(true);
    expect(({} as Record<string, unknown>).b).toBeUndefined();
  });

  it("AU-31 · `$col('Name').find(…)`, `.get(id)`, `.count(…)` and `.sum(field, …)` give what the request holds for that read; without it the evaluation stops there and the answer says `needs` with the read as written and its key, and code that catches every error does not go on past it", async () => {
    const where = [{ field: "importe", op: "lt", value: 0 }];
    const reads: [string, WireRead, Json][] = [
      [
        `$col('Gastos').find({ where: ${JSON.stringify(where)}, sort: [{ field: 'fecha' }], limit: 5 })`,
        { collection: "Gastos", op: "find", where, sort: [{ field: "fecha" }], limit: 5 },
        [{ id: "e_1" }],
      ],
      [
        "$col('Gastos').get('e_01m7ejemplo')",
        { collection: "Gastos", op: "get", id: "e_01m7ejemplo" },
        null,
      ],
      [
        `$col('Gastos').count({ where: ${JSON.stringify(where)} })`,
        { collection: "Gastos", op: "count", where },
        12,
      ],
      [
        "$col('Gastos').sum('importe')",
        { collection: "Gastos", op: "sum", field: "importe" },
        -40.5,
      ],
    ];
    for (const [src, read, answer] of reads) {
      const code = [
        `let r;\ntry { r = ${src}; } catch (e) { return 'atrapado'; } finally { console.log('sigue'); }\nreturn r;`,
      ];
      const first = await ask("code", code, []);
      expect(evals(first), src).toEqual([{ state: "needs", key: readKey(read), read }]);
      expect(first.ok && first.console, src).toEqual([]);
      const then = await ask("code", code, [], { reads: { [readKey(read)]: answer } });
      expect(outs(then), src).toEqual([answer]);
    }
    // The code of the design's §5.4, with what it reads served as the engine will.
    const code = `const categorias = $col('Categorías').find();
const gastado = {};
for (const gasto of $input.all()) gastado[gasto.categoria] = (gastado[gasto.categoria] ?? 0) + gasto.importe;
console.log('categorías con gasto:', Object.keys(gastado).length);
return categorias.map((c) => ({ categoria: c.nombre, gastado: gastado[c.id] ?? 0, pasada: (gastado[c.id] ?? 0) > c.presupuesto }));`;
    const { r, calls } = await untilDone(evalRequest("code", [code], rowsLike(100)), () =>
      categoriesLike(),
    );
    expect(calls).toBe(2);
    expect((outs(r)[0] as unknown[]).length).toBe(37);
    expect(r.ok && r.console).toEqual([
      { level: "log", text: "categorías con gasto: 37", line: 4 },
    ]);
  });

  it("AU-31 · the same read written twice has one key, two reads that differ in anything have two, and a row of a batch that needs a read does not stop the rows that do not", async () => {
    const keyOf = async (src: string) => {
      const [e] = evals(await ask("code", [`return ${src}`], []));
      return e?.state === "needs" ? e.key : "";
    };
    const a = await keyOf(
      "$col('Gastos').find({ where: [{ field: 'a', op: 'eq', value: 1 }], limit: 3 })",
    );
    const b = await keyOf(
      "$col('Gastos').find({ limit: 3, where: [{ value: 1, op: 'eq', field: 'a' }] })",
    );
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(b).toBe(a);
    for (const other of [
      "$col('Gastos').find({ where: [{ field: 'a', op: 'eq', value: 2 }], limit: 3 })",
      "$col('Gastos').find({ where: [{ field: 'a', op: 'eq', value: 1 }], limit: 4 })",
      "$col('Ingresos').find({ where: [{ field: 'a', op: 'eq', value: 1 }], limit: 3 })",
      "$col('Gastos').count({ where: [{ field: 'a', op: 'eq', value: 1 }] })",
    ])
      expect(await keyOf(other), other).not.toBe(a);
    const r = await ask(
      "code",
      ["if ($json.i === 1) return $col('Gastos').count(); return $json.i"],
      [{ i: 0 }, { i: 1 }, { i: 2 }],
      {
        mode: "perRow",
      },
    );
    expect(evals(r).map((e) => e.state)).toEqual(["done", "needs", "done"]);
    expect(outs(r)[2]).toBe(2);
  });

  it("AU-32 · `$col('Name')` has find, get, count and sum and nothing else: create, update, remove and any other name are undefined, and nothing in the interpreter writes anywhere", async () => {
    const r = await ask(
      "code",
      [
        "const c = $col('Gastos'); return [Object.keys(c).sort(), typeof c.create, typeof c.update, typeof c.remove, typeof c.insert, Object.isFrozen(c)]",
      ],
      [],
    );
    expect(outs(r)).toEqual([
      [["count", "find", "get", "sum"], "undefined", "undefined", "undefined", "undefined", true],
    ]);
    // And an expression has no `$col` at all (AU-46).
    expect(evals(await ask("expressions", ["typeof $col"], [{}]))).toMatchObject([
      { values: ["undefined"] },
    ]);
  });

  it("AU-30 · a «Código» is a function's body: `return` gives its result, with no `return` the answer is `result` (`nothing`), a promise is `result` (`promise`), and a function, a cycle or a number that is not finite `result` (`notJson`)", async () => {
    const cases: [string, object][] = [
      ["return [{ a: 1 }]", { state: "done", values: [[{ a: 1 }]] }],
      ["const a = 1;", { state: "failed", fault: "result", message: "nothing" }],
      ["return Promise.resolve(1)", { state: "failed", fault: "result", message: "promise" }],
      ["return () => 1", { state: "failed", fault: "result", message: "notJson" }],
      ["return [{ f: () => 1 }]", { state: "failed", fault: "result", message: "notJson" }],
      ["const o = {}; o.o = o; return o", { state: "failed", fault: "result", message: "notJson" }],
      ["return { n: NaN }", { state: "failed", fault: "result", message: "notJson" }],
      ["return 1 / 0", { state: "failed", fault: "result", message: "notJson" }],
    ];
    for (const [src, want] of cases)
      for (const mode of ["all", "perRow"] as const)
        expect(
          evals(await ask("code", [src], [{}], { mode }))[0],
          `${src} (${mode})`,
        ).toMatchObject(want);
  });

  it("AU-22 · an expression gives the value of its JavaScript: undefined is null, an error is `threw` with its message, and several expressions of one request are evaluated for each row and answered in order", async () => {
    const r = await ask(
      "expressions",
      ["$json.a", "$json.a * 2", "'n.º ' + $json.a", "$json.nada"],
      [{ a: 1 }, { a: 2 }],
    );
    expect(values(r)).toEqual([
      [1, 2, "n.º 1", null],
      [2, 4, "n.º 2", null],
    ]);
    expect(
      evals(await ask("expressions", ["$json.a", "$json.nada.b"], [{ a: 1 }]))[0],
    ).toMatchObject({
      state: "failed",
      fault: "threw",
      source: 1,
      message: "cannot read property 'b' of undefined",
    });
  });
});

describe("saving: a call is a request (AU-172, AU-173, AU-175, AU-183)", () => {
  const grant = { writes: { Gastos: ["create", "update", "remove"] as const } };
  /** What each evaluation of an answer asked to save. */
  const writesOf = (r: EvalResponse) =>
    evals(r).map((e) => (e.state === "done" ? (e.writes ?? []) : e));

  it("AU-172 · `.create`, `.update` and `.remove` save nothing and give `undefined`; each call is a request, in the order of the calls, with its arguments as JSON copied at the call (a later change of the object is not asked for) and the line of the source", async () => {
    const r = await ask(
      "code",
      [
        [
          "const f = { importe: 12.5, nota: 'café' };",
          "const a = $col('Gastos').create(f);",
          "f.importe = 99;",
          "const b = $col('Gastos').update('e_01m7aaaaaaaaaaaaaaaaaaaaaa', { categoria: 'e_01m7bbbbbbbbbbbbbbbbbbbbbb' });",
          "const c = $col('Gastos').remove('e_01m7cccccccccccccccccccccc');",
          "return [a, b, c].map((x) => x === undefined);",
        ].join("\n"),
      ],
      [],
      grant,
    );
    expect(outs(r)).toEqual([[true, true, true]]);
    expect(writesOf(r)).toEqual([
      [
        {
          collection: "Gastos",
          action: "create",
          fields: { importe: 12.5, nota: "café" },
          line: 2,
        },
        {
          collection: "Gastos",
          action: "update",
          id: "e_01m7aaaaaaaaaaaaaaaaaaaaaa",
          fields: { categoria: "e_01m7bbbbbbbbbbbbbbbbbbbbbb" },
          line: 4,
        },
        { collection: "Gastos", action: "remove", id: "e_01m7cccccccccccccccccccccc", line: 5 },
      ],
    ]);
    // What it asked for is not JSON: the code's own error, at the call.
    const bad = await ask("code", ["$col('Gastos').create({ f: () => 1 }); return 1"], [], grant);
    expect(evals(bad)).toMatchObject([{ state: "failed", fault: "threw", line: 1 }]);
    expect(evals(bad)[0]?.state === "failed" && evals(bad)[0]).toMatchObject({
      message: expect.stringContaining("no es JSON"),
    });
  });

  it("AU-172 · a read of the same code does not see what it asked for: it reads what is saved, as if the requests did not exist", async () => {
    const source =
      "$col('Gastos').create({ importe: 1 }); $col('Gastos').remove('e_01m7aaaaaaaaaaaaaaaaaaaaaa'); return $col('Gastos').find();";
    const saved = [{ id: "e_01m7aaaaaaaaaaaaaaaaaaaaaa", importe: 5 }];
    const { r } = await untilDone(evalRequest("code", [source], [], grant), () => saved);
    expect(outs(r)).toEqual([saved]);
    expect(writesOf(r)[0]).toHaveLength(2);
  });

  it("AU-173 · only the last pass's requests count: a pass stopped at a read gives none, and the pass repeated with what it read gives each request once", async () => {
    const source =
      "$col('Gastos').update('e_01m7aaaaaaaaaaaaaaaaaaaaaa', { n: 1 }); const all = $col('Gastos').find(); $col('Gastos').create({ n: all.length }); return all.length;";
    const req = evalRequest("code", [source], [], grant);
    const first = await evaluateCall(req);
    expect(evals(first)).toMatchObject([{ state: "needs" }]);
    expect(JSON.stringify(first)).not.toContain('"writes"');
    const { r, calls } = await untilDone(req, () => [{ id: "e_01m7aaaaaaaaaaaaaaaaaaaaaa" }]);
    expect(calls).toBe(2);
    expect(writesOf(r)).toEqual([
      [
        {
          collection: "Gastos",
          action: "update",
          id: "e_01m7aaaaaaaaaaaaaaaaaaaaaa",
          fields: { n: 1 },
          line: 1,
        },
        { collection: "Gastos", action: "create", fields: { n: 1 }, line: 1 },
      ],
    ]);
  });

  it("AU-173 · in «Una vez por fila» each evaluation gives its own requests, in the order of the rows, and one row's are never another's", async () => {
    const r = await ask(
      "code",
      ["if ($json.i % 2) $col('Gastos').update($json.id, { par: false }); return $json;"],
      [
        { i: 0, id: "e_01m7aaaaaaaaaaaaaaaaaaaaaa" },
        { i: 1, id: "e_01m7bbbbbbbbbbbbbbbbbbbbbb" },
        { i: 3, id: "e_01m7cccccccccccccccccccccc" },
      ],
      { ...grant, mode: "perRow" },
    );
    expect(writesOf(r).map((w) => (Array.isArray(w) ? w.map((x) => x.id) : w))).toEqual([
      [],
      ["e_01m7bbbbbbbbbbbbbbbbbbbbbb"],
      ["e_01m7cccccccccccccccccccccc"],
    ]);
  });

  it("AU-173 · nested calls: in `$col('A').update(x, { y: $col('B').remove(1) })` the inner call is asked for first, as JavaScript evaluates the arguments before the call; the outer one is asked for without `y`, whose value is `undefined`", async () => {
    const r = await ask(
      "code",
      [
        "$col('Gastos').update('e_01m7aaaaaaaaaaaaaaaaaaaaaa', { y: $col('Notas').remove('e_01m7bbbbbbbbbbbbbbbbbbbbbb') }); return 1;",
      ],
      [],
      { writes: { Gastos: ["update"], Notas: ["remove"] } },
    );
    expect(writesOf(r)).toEqual([
      [
        { collection: "Notas", action: "remove", id: "e_01m7bbbbbbbbbbbbbbbbbbbbbb", line: 1 },
        {
          collection: "Gastos",
          action: "update",
          id: "e_01m7aaaaaaaaaaaaaaaaaaaaaa",
          fields: {},
          line: 1,
        },
      ],
    ]);
  });

  it("AU-183 · `$col('Nombre')` has only the methods the job grants that name, beside its reads: none for a name with no grant, and an expression has no `$col` even when the request names grants", async () => {
    const keys =
      "return [Object.keys($col('Gastos')).sort(), Object.keys($col('Notas')).sort(), typeof $col('Gastos').create];";
    expect(
      outs(await ask("code", [keys], [], { writes: { Gastos: ["update", "remove"] } })),
    ).toEqual([
      [
        ["count", "find", "get", "remove", "sum", "update"],
        ["count", "find", "get", "sum"],
        "undefined",
      ],
    ]);
    // Calling one it was not given is the code's own error, and asks for nothing.
    const r = await ask("code", ["$col('Gastos').create({ a: 1 }); return 1"], [], {
      writes: { Gastos: ["update"] },
    });
    expect(evals(r)).toMatchObject([{ state: "failed", fault: "threw" }]);
    expect(JSON.stringify(r)).not.toContain('"writes"');
    expect(
      values(await ask("expressions", ["typeof $col"], [{}], { writes: { Gastos: ["create"] } })),
    ).toEqual([["undefined"]]);
  });

  it("AU-175 · more requests in one evaluation than `limits.writes` stops it there as `writes`, which code that catches every error cannot catch, and in «Una vez por fila» the next row goes on", async () => {
    const r = await ask(
      "code",
      [
        "try { for (let i = 0; i < 10 * $json.n; i++) $col('Gastos').create({ i }); } catch { return 'atrapado'; } return $json.n;",
      ],
      [{ n: 1 }, { n: 0 }],
      { ...grant, mode: "perRow", limits: { writes: 3 } },
    );
    expect(evals(r)).toMatchObject([
      { state: "failed", fault: "writes" },
      { state: "done", values: [0] },
    ]);
    // Exactly the limit is not past it.
    const at = await ask(
      "code",
      ["for (let i = 0; i < 3; i++) $col('Gastos').create({ i }); return 1"],
      [],
      {
        ...grant,
        limits: { writes: 3 },
      },
    );
    expect(writesOf(at)[0]).toHaveLength(3);
  });

  it("AU-175 · the requests count towards the answer that `outputBytes` limits: a code cannot pass it by asking instead of returning", async () => {
    const source = (n: number) =>
      `for (let i = 0; i < ${n}; i++) $col('Gastos').create({ t: 'x'.repeat(100) }); return 1`;
    const limits = { outputBytes: 4_000 };
    expect(await ask("code", [source(50)], [], { ...grant, limits })).toMatchObject({
      ok: false,
      error: "output",
    });
    // The same few requests fit.
    expect(writesOf(await ask("code", [source(5)], [], { ...grant, limits }))[0]).toHaveLength(5);
  });
});

describe("dates", () => {
  const ZONES = ["Europe/Madrid", "America/New_York", "Australia/Lord_Howe", "Asia/Kolkata"];
  /** Instants around every change of hour of 2026 in a zone, and its local midnights then. */
  const instantsOf = (zone: string) => {
    const changes = zoneTable(zone)
      .offsets.filter(([t]) => t >= Date.UTC(2026, 0, 1) && t < Date.UTC(2027, 0, 1))
      .map(([t]) => t);
    const around = (changes.length ? changes : [Date.UTC(2026, 2, 29, 1)]).flatMap((t) =>
      [-25 * MS_HOUR, -MS_HOUR, -60_000, 0, 60_000, 30 * 60_000, MS_HOUR, 23 * MS_HOUR].map(
        (d) => t + d,
      ),
    );
    return [...around, Date.UTC(2026, 0, 31, 22, 15), Date.UTC(2028, 1, 29, 12)];
  };
  /** What time.ts gives for the same, as «Fecha» counts it (apps/server/src/automations/dates.ts). */
  const expected = (t: number, other: number, zone: string) => {
    const l = toLocal(t, zone);
    const o = toLocal(other, zone);
    const { y, m, d } = civilFromDays(l.day);
    const monday = l.day - ((weekday(l.day) + 6) % 7);
    const month = daysFromCivil(y, m, 1);
    let days = l.day - o.day;
    if (days > 0 && l.minute < o.minute) days -= 1;
    if (days < 0 && l.minute > o.minute) days += 1;
    const oy = civilFromDays(o.day);
    let months = (y - oy.y) * 12 + (m - oy.m);
    const cmp = d - oy.d || l.minute - o.minute;
    if (months > 0 && cmp < 0) months -= 1;
    if (months < 0 && cmp > 0) months += 1;
    return [
      fromLocal(l.day + 7, l.minute, zone),
      fromLocal(addMonths(l.day, -1), l.minute, zone),
      t + 25 * MS_HOUR,
      fromLocal(l.day, 0, zone),
      fromLocal(monday, 0, zone),
      fromLocal(month, 0, zone),
      fromLocal(daysFromCivil(y, 1, 1), 0, zone),
      fromLocal(l.day + 1, 0, zone) - 1,
      fromLocal(monday + 7, 0, zone) - 1,
      fromLocal(addMonths(month, 1), 0, zone) - 1,
      y,
      m,
      d,
      ((weekday(l.day) + 6) % 7) + 1,
      Math.floor(l.minute / 60),
      Math.floor(l.minute % 60),
      days,
      Math.trunc(days / 7),
      months,
      Math.trunc((t - other) / MS_HOUR),
    ];
  };
  const BOX = `const d = $date($json.t); const o = $date($json.o);
return [d.plus({ days: 7 }).toMillis(), d.minus({ months: 1 }).toMillis(), d.plus({ hours: 25 }).toMillis(),
  d.startOf('day').toMillis(), d.startOf('week').toMillis(), d.startOf('month').toMillis(), d.startOf('year').toMillis(),
  d.endOf('day').toMillis(), d.endOf('week').toMillis(), d.endOf('month').toMillis(),
  d.year, d.month, d.day, d.weekday, d.hour, d.minute,
  d.diff(o, 'days'), d.diff(o, 'weeks'), d.diff(o, 'months'), d.diff(o, 'hours')];`;

  it("AU-28 · `$now.plus({ days: 7 })`, `.minus`, `.startOf` and `.endOf` of day, week (from Monday), month and year, `.diff` and the parts give, for a table of instants and zones with the days a zone changes its hour, what `packages/calendar/src/time.ts` gives for the same", async () => {
    for (const zone of ZONES) {
      const ts = instantsOf(zone);
      const rows = ts.map((t, i) => ({
        t,
        o: ts[(i * 7 + 3) % ts.length]! - 17 * MS_DAY - 5 * 60_000,
      }));
      const r = await ask("code", [BOX], rows, { mode: "perRow", zone: zoneTable(zone) });
      expect(outs(r), zone).toEqual(rows.map((row) => expected(row.t, row.o, zone)));
    }
    // A civil day stays a civil day.
    const days = await ask(
      "expressions",
      [
        "[$date('2026-03-29').plus({ days: 1 }).toDay(), $date('2026-01-31').plus({ month: 1 }).toISO(), $date('2026-11-18').startOf('week').toISO(), $date('2026-11-18').endOf('month').toISO(), $date('2026-03-30').diff('2026-03-29', 'days'), $date('2026-03-29').plus({ hours: 2 }).toISO()]",
      ],
      [{}],
      { zone: zoneTable("Europe/Madrid") },
    );
    expect(values(days)).toEqual([
      [["2026-03-30", "2026-02-28", "2026-11-16", "2026-11-30", 1, "2026-03-29"]],
    ]);
  });

  it("AU-28 · `.format` writes the tokens of `DATE_HELP` with the request's names of months and days and plain text between them; a token it does not have throws by its name, and a date outside the zone table's years takes the nearest end's offset", async () => {
    const n = dateNames("es");
    const r = await ask(
      "expressions",
      [
        "$now.format('yyyy yy MMMM MMM MM M dd d EEEE EEE HH H mm')",
        "$date('2026-07-05').format(\"EEEE d 'de' MMMM 'de' yyyy, 'a las' HH:mm ''\")",
      ],
      [{}],
    );
    expect(values(r)).toEqual([
      [
        `2026 26 ${n.months[10]} ${n.monthsShort[10]} 11 11 16 16 ${n.days[0]} ${n.daysShort[0]} 09 9 30`,
        `${n.days[6]} 5 de ${n.months[6]} de 2026, a las 00:00 '`,
      ],
    ]);
    const en = await ask("expressions", ["$now.format('EEEE, MMMM d')"], [{}], {
      names: dateNames("en"),
    });
    expect(values(en)).toEqual([["Monday, November 16"]]);
    for (const token of ["Q", "yyy", "MMMMM", "ss"])
      expect(
        evals(await ask("expressions", [`$now.format('d ${token}')`], [{}]))[0],
        token,
      ).toMatchObject({
        state: "failed",
        fault: "threw",
        message: expect.stringContaining(`«${token}»`),
      });
    const table = zoneTable("Europe/Madrid");
    const first = table.offsets[0]![1];
    const last = table.offsets[table.offsets.length - 1]![1];
    const far = await ask(
      "expressions",
      ["[$date($json.antes).hour, $date($json.despues).hour]"],
      [{ antes: Date.UTC(1960, 6, 1, 12), despues: Date.UTC(2150, 6, 1, 12) }],
    );
    expect(values(far)).toEqual([[[12 + first / 60, 12 + last / 60]]]);
  });

  it('AU-28 · `$date` makes a date from a day ("YYYY-MM-DD") or an instant and throws for anything else; `.toISO()`, `.toDay()` and `.toMillis()` give its text, its day and its instant; a date written to a row is its day or its instant, never an object, and `Intl` is not there', async () => {
    const t = Date.UTC(2026, 9, 25, 0, 30);
    const r = await ask(
      "code",
      [
        `const d = $date(${t}); const c = $date('2026-10-25');
return [d.toISO(), d.toDay(), d.toMillis(), c.toISO(), c.toDay(), c.toMillis(), $date('2026-10-25T01:30:00+02:00').toMillis(), typeof Intl,
  { dia: c, instante: d, hoy: $today, ahora: $now, nativa: new Date(5) }];`,
      ],
      [],
    );
    expect(outs(r)).toEqual([
      [
        "2026-10-25T00:30:00.000Z",
        "2026-10-25",
        t,
        "2026-10-25",
        "2026-10-25",
        Date.UTC(2026, 9, 24, 22),
        Date.UTC(2026, 9, 24, 23, 30),
        "undefined",
        { dia: "2026-10-25", instante: t, hoy: "2026-11-16", ahora: NOW, nativa: 5 },
      ],
    ]);
    for (const bad of ["'ayer'", "{}", "NaN", "'2026-02-30'", "null", "'16/11/2026'"])
      expect(evals(await ask("expressions", [`$date(${bad})`], [{}]))[0], bad).toMatchObject({
        state: "failed",
        fault: "threw",
        message: expect.stringContaining("$date"),
      });
  });
});

describe("the console, the limits and the cost", () => {
  it("AU-33 · `console.log`, `.info`, `.warn` and `.error` are answered in order, each with its text, the line of the source that wrote it and, per row, the row; values are written as text (an object as JSON, a cycle without failing), and an evaluation that fails keeps what it wrote before", async () => {
    const code = `console.log('fila', $json.i, { a: [1, 2] });
console.info(true, null, undefined);
const o = {}; o.o = o;
console.warn(o, new Error('aviso'));
  console.error($date('2026-11-16'));
if ($json.i === 1) null.x;
return $json.i;`;
    const r = await ask("code", [code], [{ i: 0 }, { i: 1 }], { mode: "perRow", from: 40 });
    expect(r.ok && r.console).toEqual(
      [40, 41].flatMap((row) => [
        { level: "log", text: `fila ${row - 40} {"a":[1,2]}`, line: 1, row },
        { level: "info", text: "true null undefined", line: 2, row },
        { level: "warn", text: '{"o":"[…]"} Error: aviso', line: 4, row },
        { level: "error", text: "2026-11-16", line: 5, row },
      ]),
    );
    expect(evals(r).map((e) => e.state)).toEqual(["done", "failed"]);
    const all = await ask("code", ["console.log('una vez'); return 1"], [{}, {}]);
    expect(all.ok && all.console).toEqual([{ level: "log", text: "una vez", line: 1 }]);
  });

  it("AU-33 · an error says its message as the code gave it and the line and column of the source as it was sent, in a «Código» and in each expression of a request; an error thrown as something that is not an Error is said as text", async () => {
    const code = await ask("code", ["const a = 1;\n\n  throw new Error('mal: a vale ' + a);"], []);
    // QuickJS places an error made with `new Error(…)` at the call's parenthesis.
    expect(evals(code)[0]).toEqual({
      state: "failed",
      fault: "threw",
      message: "mal: a vale 1",
      source: 0,
      line: 3,
      column: 18,
    });
    const exprs = await ask("expressions", ["1", "2 +\n  $json.nada.b"], [{}]);
    expect(evals(exprs)[0]).toMatchObject({ state: "failed", source: 1, line: 2, column: 13 });
    const syntax = await ask("code", ["const a = 1;\nconst b = ;"], []);
    expect(evals(syntax)[0]).toMatchObject({
      state: "failed",
      fault: "threw",
      line: 2,
      column: 11,
    });
    const open = await ask("expressions", ["($json.a"], [{}]);
    expect(evals(open)[0]).toMatchObject({ state: "failed", fault: "threw", line: 1 });
    for (const [thrown, text] of [
      ["'un texto'", "un texto"],
      ["{ motivo: 'x' }", '{"motivo":"x"}'],
      ["5", "5"],
    ])
      expect(evals(await ask("code", [`throw ${thrown}`], []))[0], thrown).toMatchObject({
        state: "failed",
        fault: "threw",
        message: text,
      });
  });

  it("AU-35 · time, operations, memory, stack, the answer's size and the console's lines each have their limit: a loop without end is `timeout` or `steps`, a list without end `memory`, a recursion without end is stopped at `stackBytes` as an error of the code (`threw`) that names the stack, long before the memory's limit, an answer too big `output` with its size, and after each the box serves the next call", async () => {
    const through = async (src: string, limits: EvalRequest["limits"] = {}) =>
      send(evalRequest("code", [src], [{}], { limits }));
    expect(["steps", "timeout"]).toContain((await through("for (;;) {}")).error);
    await servesNext();
    expect(await through("for (;;) {}", { steps: 20_000, ms: 200 })).toMatchObject({
      ok: false,
      error: "timeout",
    });
    await servesNext();
    expect(
      await through("const a = []; for (;;) a.push('x'.repeat(1 << 20) + a.length);"),
    ).toMatchObject({
      ok: false,
      error: "memory",
      message: expect.stringContaining(String(64 * 1024 * 1024)),
    });
    await servesNext();
    for (const stackBytes of [256 * 1024, 512 * 1024]) {
      const deep = await through("let d = 0; const f = () => { d++; return f(); }; return f();", {
        stackBytes,
      });
      expect(deep, String(stackBytes)).toMatchObject({
        ok: true,
        evaluations: [
          {
            state: "failed",
            fault: "threw",
            message: expect.stringContaining(`stack overflow, ${stackBytes} bytes`),
          },
        ],
      });
      await servesNext();
    }
    const big = await through("return 'x'.repeat(2 * 1024 * 1024)");
    expect(big).toMatchObject({
      ok: false,
      error: "output",
      message: expect.stringMatching(/1048576 bytes \(2097\d{3}\)/),
    });
    await servesNext();
  }, 60_000);

  it("AU-35 · lines of console over the limit are counted and not kept, a line too long is cut, and neither fails the evaluation; more different reads than the limit is `reads`", async () => {
    const r = await ask(
      "code",
      ["for (let i = 0; i < 5; i++) console.log('línea ' + i + ' ' + 'x'.repeat(50)); return 1"],
      [],
      {
        limits: { consoleLines: 3, consoleLineChars: 10 },
      },
    );
    expect(r).toMatchObject({
      ok: true,
      dropped: 2,
      evaluations: [{ state: "done", values: [1] }],
    });
    expect(r.ok && r.console.map((l) => l.text)).toEqual([
      "línea 0 xx",
      "línea 1 xx",
      "línea 2 xx",
    ]);
    const first: WireRead = { collection: "Gastos", op: "count" };
    const reads = await ask(
      "code",
      ["const a = $col('Gastos').count(); const b = $col('Gastos').get('e_1'); return [a, b]"],
      [],
      {
        limits: { reads: 1 },
        reads: { [readKey(first)]: 3 },
      },
    );
    expect(evals(reads)[0]).toMatchObject({
      state: "failed",
      fault: "reads",
      message: expect.stringContaining("find"),
    });
    // The same read twice is one.
    const twice = await ask(
      "code",
      ["return $col('Gastos').count() + $col('Gastos').count()"],
      [],
      {
        limits: { reads: 1 },
        reads: { [readKey(first)]: 3 },
      },
    );
    expect(outs(twice)).toEqual([6]);
  });

  it("AU-38 · one expression over 3,000 rows in batches of `batchRows`, and a «Código» of «Una vez por fila» the same, each end within the time written in the test, and so do a «Código» with all 3,000 rows and one that reads 3,000 rows", async () => {
    const rows = rowsLike(3_000);
    const BATCH = 500; // CODE_LIMITS.batchRows
    const timed = async (what: () => Promise<void>) => {
      await what(); // the module compiled, the code warm
      const at = cpu();
      await what();
      return cpu() - at;
    };
    const batches = (kind: Kind, src: string) => async () => {
      for (let from = 0; from < rows.length; from += BATCH) {
        const r = await ask(kind, [src], rows.slice(from, from + BATCH), {
          from,
          ...(kind === "code" ? { mode: "perRow" } : {}),
        });
        expect(evals(r).every((e) => e.state === "done")).toBe(true);
      }
    };
    const read: WireRead = { collection: "Gastos", op: "find" };
    const times = {
      expression: await timed(batches("expressions", "$json.importe * 1.21")),
      perRow: await timed(
        batches("code", "return { ...$json, iva: Math.round($json.importe * 21) / 100 };"),
      ),
      all: await timed(async () => {
        const code =
          "const t = {}; for (const g of $input.all()) t[g.categoria] = (t[g.categoria] ?? 0) + g.importe; return Object.keys(t).map((k) => ({ categoria: k, total: t[k] }));";
        expect((outs(await ask("code", [code], rows))[0] as unknown[]).length).toBe(37);
      }),
      reading: await timed(async () => {
        const code =
          "const g = $col('Gastos').find(); return [{ n: g.length + $input.all().length }];";
        expect(outs(await ask("code", [code], rows, { reads: { [readKey(read)]: rows } }))).toEqual(
          [[{ n: 6_000 }]],
        );
      }),
    };
    // Measured 2026-11-16 on the laptop, in CPU ms: about 60, 80, 75 and 120 (§6, risk 4; the PR of E1). The bounds
    // are several times that, so a loaded machine passes and a slower path does not.
    under(times.expression, 1_000, "cpu", "3,000 expressions in batches");
    under(times.perRow, 1_000, "cpu", "a «Código» once per row over 3,000 rows");
    under(times.all, 800, "cpu", "a «Código» once over 3,000 rows");
    under(times.reading, 1_000, "cpu", "a «Código» reading 3,000 rows");
  }, 120_000);
});

describe("the box and the automations say the same", () => {
  it("AU-24 · the world defines exactly `CODE_GLOBALS` as its `$` names and `console`: `$col` only in «Código», and no other name that starts with `$`", async () => {
    const names =
      "return Object.getOwnPropertyNames(globalThis).filter((n) => n.startsWith('$')).sort()";
    const want = CODE_GLOBALS.filter((n) => n.startsWith("$")).sort();
    expect(outs(await ask("code", [names], []))).toEqual([want]);
    expect(values(await ask("expressions", [`(() => { ${names} })()`], [{}]))).toEqual([
      [want.filter((n) => n !== "$col")],
    ]);
    expect(values(await ask("expressions", ["typeof console.log"], [{}]))).toEqual([["function"]]);
  });

  it("AU-28 · `format` takes exactly `DATE_HELP.tokens`, and a date has exactly the methods and parts of `DATE_HELP`", async () => {
    const world = readFileSync(new URL("../src/world.js", import.meta.url), "utf8");
    const tokens = /const TOKENS = \[([^\]]*)\]/.exec(world)?.[1] ?? "";
    expect([...tokens.matchAll(/"([^"]+)"/g)].map((m) => m[1])).toEqual([...DATE_HELP.tokens]);
    // Beyond JavaScript's own conversions (`toJSON`, `toString`, `valueOf`), which a date answers as any value does.
    const r = await ask(
      "expressions",
      [
        "Object.getOwnPropertyNames(Object.getPrototypeOf($now)).filter((n) => !['constructor', 'toJSON', 'toString', 'valueOf'].includes(n)).sort()",
      ],
      [{}],
    );
    expect(values(r)).toEqual([[[...DATE_HELP.methods, ...DATE_HELP.parts].sort()]]);
  });

  it("AU-35 · the limits the engine sends are the box's: every one of `CODE_LIMITS` the box knows is within `EVAL_MAX_LIMITS`, and the box's own defaults for the stack, the console, the reads and the requests to save are `CODE_LIMITS`'", () => {
    const box = EVAL_MAX_LIMITS as unknown as Record<string, number>;
    const shared = Object.keys(EVAL_DEFAULT_LIMITS).filter((k) => k in CODE_LIMITS);
    expect(shared.sort()).toEqual(
      [
        "consoleLineChars",
        "consoleLines",
        "memoryBytes",
        "ms",
        "outputBytes",
        "reads",
        "stackBytes",
        "steps",
        "writes",
      ].sort(),
    );
    for (const k of shared)
      expect(CODE_LIMITS[k as CodeLimit], k).toBeLessThanOrEqual(box[k] as number);
    for (const k of ["stackBytes", "consoleLines", "consoleLineChars", "reads", "writes"] as const)
      expect(EVAL_DEFAULT_LIMITS[k], k).toBe(CODE_LIMITS[k]);
  });
});
