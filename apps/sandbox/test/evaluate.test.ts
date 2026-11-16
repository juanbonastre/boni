// The box evaluating an automation's JavaScript (src/evaluate.ts, src/world.js; docs/automatizaciones.md §5.3, §5.4,
// §6). Real tests run the real interpreter, as box.test.ts and run.test.ts do for an extension's function: each attack
// is a file of test/cases/evaluacion, tried as an expression and as a «Código», in both modes, and through the socket
// for what only the door can stop (a call ended from outside, too many at once). Times are this thread's CPU (A-15).
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
import type { EvalRequest, EvalResponse, Json, WireEvaluated, WireRead } from "@boni/sandbox";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { evaluateCall, readKey } from "../src/evaluate.ts";
import { type Box, startBox } from "../src/server.ts";
import { call } from "./call.ts";
import { cpu } from "./cpu.test-util.ts";
import {
  categoriesLike,
  dateNames,
  evalRequest,
  NOW,
  rowsLike,
  zoneTable,
} from "./eval-helpers.ts";

type Kind = EvalRequest["kind"];
const ask = (
  kind: Kind,
  sources: string[],
  input: EvalRequest["input"],
  more: Partial<EvalRequest> = {},
) => evaluateCall(evalRequest(kind, sources, input, more));
/** The evaluations of an answer that has them (a test fails here when the call failed whole). */
const evals = (r: EvalResponse): readonly WireEvaluated[] => {
  if (!r.ok) throw new Error(`the call failed: ${r.error}: ${r.message}`);
  return r.evaluations;
};
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

const CASES = join(import.meta.dirname, "cases", "evaluacion");
const caseCode = (name: string) => readFileSync(join(CASES, name), "utf8");
/** A case tried the three ways: «Código» with all the rows, «Código» once per row, and as an expression. */
const FORMS: { label: string; req: (body: string) => EvalRequest }[] = [
  { label: "«Código», all the rows", req: (b) => evalRequest("code", [b], [{ i: 0 }, { i: 1 }]) },
  {
    label: "«Código», per row",
    req: (b) => evalRequest("code", [b], [{ i: 0 }, { i: 1 }], { mode: "perRow" }),
  },
  {
    label: "an expression",
    req: (b) => evalRequest("expressions", [`(() => {\n${b}\n})()`], [{ i: 0 }, { i: 1 }]),
  },
];
async function tryCase(
  name: string,
  opts: { through?: (req: EvalRequest) => Promise<EvalResponse> } = {},
) {
  const code = caseCode(name);
  const want = /^\/\/ expect: (.*)$/m.exec(code)?.[1] ?? "";
  for (const form of FORMS) {
    const at = `${name}, ${form.label}`;
    const r = await (opts.through ?? evaluateCall)(form.req(code));
    if (want.startsWith("call ")) {
      expect(r.ok, at).toBe(false);
      expect(want.slice(5).split("|"), at).toContain(!r.ok && r.error);
      continue;
    }
    expect(r.ok, `${at}: ${!r.ok && r.message}`).toBe(true);
    for (const e of evals(r)) {
      if (want.startsWith("done ")) {
        expect(e, at).toMatchObject({ state: "done" });
        expect(e.state === "done" && e.values[0], at).toEqual(JSON.parse(want.slice(5)));
      } else {
        expect(e.state, at).toBe("failed");
        expect(want.split("|"), at).toContain(e.state === "failed" && e.fault);
      }
    }
  }
}

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
    for (const name of ["red.js", "modulos.js", "importar.js", "proceso.js", "nada-de-fuera.js"])
      await tryCase(name);
    // An import that never comes gives nothing either: the box runs no job of a promise.
    const r = await ask(
      "code",
      [
        'let got = "nada"; try { import("node:fs").then((m) => { got = m; }); } catch {} return got;',
      ],
      [],
    );
    expect(outs(r)).toEqual(["nada"]);
  }, 30_000);

  it("AU-160 · the interpreter is made new for each call, with a memory of its own that cannot grow past its limit, in a worker of its own that the door ends: a call that never yields is answered `timeout` and the next call is served", async () => {
    await tryCase("memoria.js", { through: throughBox });
    await servesNext();
    const never = evalRequest("code", ["for (;;) {}"], [], { limits: { steps: 20_000, ms: 300 } });
    expect(await send(never)).toMatchObject({ ok: false, error: "timeout" });
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
  it("AU-37 · a row's evaluation cannot leave anything to the next row's of the same batch: a variable without `const`, a property on `globalThis`, on `Object.prototype`, `Array.prototype` or `Function.prototype`, on a function of `$input` or on `console`, a `Symbol.for`, a getter left on a shared row: each either throws (`frozen`) or is not there for the next row", async () => {
    const attempts: [string, string][] = [
      ["dejado = 1", "typeof dejado"],
      ["globalThis.dejado = 1", "typeof globalThis.dejado"],
      ["Object.prototype.dejado = 1", "typeof ({}).dejado"],
      ["Array.prototype.dejado = 1", "typeof [].dejado"],
      ["Function.prototype.dejado = 1", "typeof (() => 1).dejado"],
      ["$input.all.dejado = 1", "typeof $input.all.dejado"],
      ["console.dejado = 1", "typeof console.dejado"],
      ["Math.random = () => 0", "Math.random() === 0 ? 'cambiado' : 'undefined'"],
      ["const s = Symbol.for('dejado'); s.dato = 1", "typeof Symbol.for('dejado').dato"],
      [
        "Object.defineProperty($input.all()[1], 'trampa', { get: () => 1 })",
        "typeof Object.getOwnPropertyDescriptor($json, 'trampa')",
      ],
      ["Object.defineProperty(globalThis, '$dejado', { value: 1 })", "typeof globalThis.$dejado"],
      ["Date.prototype.dejado = 1", "typeof new Date().dejado"],
    ];
    for (const [leave, look] of attempts) {
      const r = await ask(
        "code",
        [`if ($json.i === 0) { ${leave}; return 'dejado' } return ${look}`],
        [{ i: 0 }, { i: 1 }],
        {
          mode: "perRow",
        },
      );
      const [first, second] = evals(r);
      expect(first, leave).toMatchObject({ state: "failed" });
      expect(["frozen", "threw"], leave).toContain(first?.state === "failed" && first.fault);
      expect(second, leave).toMatchObject({ state: "done", values: ["undefined"] });
    }
  });

  it("AU-37 · the rows of a cited step, shared by every row of a batch, cannot be changed by one of them: writing a field, pushing to the list or deleting a key is `frozen`, with the line, and the message says to return a copy", async () => {
    const steps = { "Buscar gastos": { rows: [{ importe: 5 }] } };
    for (const change of [
      "$('Buscar gastos').first().importe = 9",
      "$('Buscar gastos').all().push({ importe: 1 })",
      "delete $('Buscar gastos').first().importe",
    ]) {
      const r = await ask("code", [`const a = 1;\n${change};\nreturn a`], [{ i: 0 }, { i: 1 }], {
        mode: "perRow",
        steps,
      });
      for (const e of evals(r)) {
        expect(e, change).toMatchObject({ state: "failed", fault: "frozen", line: 2 });
        expect(e.state === "failed" && e.message, change).toMatch(/devuelve una copia/);
      }
    }
    // A copy is the way: it is the code's own.
    const r = await ask("code", ["return { ...$('Buscar gastos').first(), importe: 9 }"], [], {
      steps,
    });
    expect(outs(r)).toEqual([{ importe: 9 }]);
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
    });
    await servesNext();
    for (const stackBytes of [256 * 1024, 512 * 1024]) {
      const deep = await through("let d = 0; const f = () => { d++; return f(); }; return f();", {
        stackBytes,
      });
      expect(deep, String(stackBytes)).toMatchObject({
        ok: true,
        evaluations: [
          { state: "failed", fault: "threw", message: expect.stringContaining("stack") },
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
    expect(times.expression).toBeLessThan(1_000);
    expect(times.perRow).toBeLessThan(1_000);
    expect(times.all).toBeLessThan(800);
    expect(times.reading).toBeLessThan(1_000);
  }, 120_000);
});
