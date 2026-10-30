/**
 * One call of an extension's function in a QuickJS interpreter of its own, compiled to WebAssembly (docs/extensiones.md
 * §11.6, E1): the code and its input go in as text, the output comes back as JSON text, and nothing of Boni or of the
 * machine is reachable from inside (no network, files, process, timers, clock or chance). It runs in a worker of its
 * own (worker.ts), which the box ends if this does not stop by itself.
 */
import { createHash } from "node:crypto";
import {
  type Limits,
  limitsOf,
  type RunError,
  type RunRequest,
  type RunResponse,
  schemaErrors,
  shortMessage,
} from "@boni/sandbox";
import { newQuickJSWASMModule } from "quickjs-emscripten";

/**
 * Before the function's code: the clock and chance are taken away (the day and a seed come in its context), and its
 * context is made: `{ day, random() }`, `random` a fixed sequence from the seed, so a call gives the same every time.
 */
const PRELUDE = `"use strict";
(() => {
  const no = (what) => () => {
    throw new Error(what + " no está disponible: el día y el azar vienen en el contexto (ctx.day, ctx.random)");
  };
  Math.random = no("Math.random");
  const RealDate = Date;
  globalThis.Date = new Proxy(RealDate, {
    construct(T, args, target) {
      if (!args.length) no("new Date() sin fecha")();
      return Reflect.construct(T, args, target);
    },
    apply: no("Date()"),
    get: (T, k) => (k === "now" ? no("Date.now") : Reflect.get(T, k)),
  });
  Object.defineProperty(globalThis, "__boniContext", {
    value: (day, seed) => {
      let s = seed >>> 0;
      return Object.freeze({
        day,
        random() {
          s = (s + 0x6d2b79f5) >>> 0;
          let t = s;
          t = Math.imul(t ^ (t >>> 15), t | 1);
          t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
          return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        },
      });
    },
  });
})();`;

/** Calls the function and gives back its output as JSON text, or throws a marked error the host tells apart. */
const DRIVER = `(function (fn, json, day, seed) {
  const f = globalThis[fn];
  if (typeof f !== "function") throw new Error("no hay ninguna función «" + fn + "»");
  const out = f(JSON.parse(json), globalThis.__boniContext(day, seed));
  if (out !== null && typeof out === "object" && typeof out.then === "function")
    throw new Error("las funciones no pueden ser asíncronas: devuelven su resultado");
  let text;
  try {
    text = JSON.stringify(out === undefined ? null : out);
  } catch (e) {
    throw { boniOutput: "la salida no es JSON: " + (e && e.message) };
  }
  if (typeof text !== "string") throw { boniOutput: "la salida no es JSON" };
  return text;
})`;

const fail = (
  id: string,
  error: RunError,
  message: unknown,
  steps?: number,
  ms?: number,
): RunResponse => ({
  id,
  ok: false,
  error,
  message: shortMessage(message),
  ...(steps !== undefined ? { steps } : {}),
  ...(ms !== undefined ? { ms } : {}),
});

/** One call, start to end: a new interpreter, the limits, the code, the function, the output checked. */
export async function runCall(req: RunRequest): Promise<RunResponse> {
  const limits: Limits = limitsOf(req);
  if (createHash("sha256").update(req.code).digest("hex") !== req.hash)
    return fail(req.id, "invalid", "el código no es el de su huella");
  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);
  let steps = 0;
  let stopped: "steps" | "timeout" | null = null;
  const deadline = Date.now() + limits.ms;
  // A module of its own: nothing of another call's interpreter is here.
  const QuickJS = await newQuickJSWASMModule();
  const runtime = QuickJS.newRuntime();
  runtime.setMemoryLimit(limits.memoryBytes);
  runtime.setMaxStackSize(limits.stackBytes);
  runtime.setInterruptHandler(() => {
    steps++;
    if (steps > limits.steps) stopped = "steps";
    else if (Date.now() > deadline) stopped = "timeout";
    return stopped !== null;
  });
  const vm = runtime.newContext();
  const failed = (e: unknown): RunResponse => {
    if (stopped === "steps")
      return fail(req.id, "steps", `ha usado sus ${limits.steps} pasos`, steps, elapsed());
    if (stopped === "timeout")
      return fail(req.id, "timeout", `ha pasado de ${limits.ms} ms`, steps, elapsed());
    const err = (e ?? {}) as { name?: string; message?: string; boniOutput?: string };
    if (typeof err.boniOutput === "string")
      return fail(req.id, "output", err.boniOutput, steps, elapsed());
    const text = `${err.name ?? "Error"}: ${err.message ?? String(e)}`;
    if (/out of memory/i.test(text))
      return fail(req.id, "memory", "ha pedido más memoria de la que tiene", steps, elapsed());
    return fail(req.id, "exception", text, steps, elapsed());
  };
  try {
    for (const [code, name] of [
      [PRELUDE, "boni.js"],
      [req.code, "funcion.js"],
    ] as const) {
      const r = vm.evalCode(code, name);
      if (r.error) {
        const e = vm.dump(r.error);
        r.error.dispose();
        return failed(e);
      }
      r.value.dispose();
    }
    const driver = vm.evalCode(DRIVER, "llamada.js");
    if (driver.error) {
      const e = vm.dump(driver.error);
      driver.error.dispose();
      return failed(e);
    }
    const args = [
      vm.newString(req.fn),
      vm.newString(JSON.stringify(req.input ?? null)),
      vm.newString(req.day),
      vm.newNumber(req.seed),
    ];
    const r = vm.callFunction(driver.value, vm.undefined, ...args);
    for (const a of args) a.dispose();
    driver.value.dispose();
    if (r.error) {
      const e = vm.dump(r.error);
      r.error.dispose();
      return failed(e);
    }
    const text = vm.getString(r.value);
    r.value.dispose();
    if (Buffer.byteLength(text) > limits.outputBytes)
      return fail(
        req.id,
        "output",
        `la salida pasa de ${limits.outputBytes} bytes`,
        steps,
        elapsed(),
      );
    const output: unknown = JSON.parse(text);
    if (req.output) {
      const errs = schemaErrors(req.output, output, "salida", 5);
      if (errs.length) return fail(req.id, "output", errs.join("; "), steps, elapsed());
    }
    return { id: req.id, ok: true, output, steps, ms: elapsed() };
  } catch (e) {
    // The interpreter itself gave up (its memory, most often): this call is over, the box is not.
    return failed(e instanceof Error ? { name: e.name, message: e.message } : e);
  } finally {
    try {
      vm.dispose();
      runtime.dispose();
    } catch {
      // A call that broke its interpreter leaves it to the worker's end.
    }
  }
}
